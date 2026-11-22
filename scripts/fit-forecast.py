"""Fit one pooled one-year-ahead ridge model per tenure and measure."""
from pathlib import Path
import json

import numpy as np
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
years = sorted(json.loads((ROOT / 'data/years.json').read_text()), key=lambda year: year['stockYear'])
assert [year['stockYear'] for year in years] == [2024, 2025, 2026]
snapshots = [
    {p['id']: p for p in json.loads((ROOT / 'public' / year['housing']).read_text())['providers']}
    for year in years
]


OPERATIONAL = json.loads((ROOT / 'data/operational-metrics.json').read_text())


def applicable_operational(tenure):
    return [m['key'] for m in OPERATIONAL if tenure == 'LCRA' or m['scope'] != 'LCRA']


def operational_value(provider, tenure, key):
    return (provider or {}).get('operational', {}).get(tenure, {}).get('values', {}).get(key)


def design(rows, means):
    scores = np.asarray([r[0] for r in rows], dtype=float)
    scores = np.where(np.isnan(scores), means, scores)
    assert np.isfinite(scores).all()
    return np.column_stack([np.ones(len(scores)), scores])


def fit(rows, penalty):
    means = np.nanmean(np.asarray([r[0] for r in rows], dtype=float), axis=0)
    X = design(rows, means)
    y = np.asarray([r[1] for r in rows])
    scales = X[:, 1:].std(axis=0)
    scales[scales == 0] = 1
    Z = X.copy()
    Z[:, 1:] = (X[:, 1:] - means) / scales
    regularizer = np.diag([0, *([len(y) * penalty] * len(means))])
    bread = np.linalg.inv(Z.T @ Z + regularizer)
    beta = bread @ Z.T @ y
    # Map standardized coefficients and their covariance back to the reported units.
    transform = np.diag([1, *(1 / scales)])
    transform[0, 1:] = -means / scales
    return transform @ beta, means, scales, Z, y, bread, transform


def threshold(coefficients, means, scales, outcome_scale):
    """Zero small standardized effects while preserving the fitted mean."""
    result = coefficients.copy()
    weak = np.abs(result[1:] * scales / outcome_scale) < 0.05
    result[1:] = np.where(weak, 0, result[1:])
    result[0] += (coefficients[1:] - result[1:]) @ means
    return result


def choose_penalty(rows):
    folds = list(GroupKFold(n_splits=5).split(rows, groups=[r[3] for r in rows]))
    candidates = np.logspace(-4, 1, 26)
    errors = []
    for penalty in candidates:
        squared = []
        for train, test in folds:
            coeff, means, *_ = fit([rows[i] for i in train], penalty)
            holdout = [rows[i] for i in test]
            residual = design(holdout, means) @ coeff - [r[1] for r in holdout]
            squared.extend(residual**2)
        errors.append(np.mean(squared))
    return float(candidates[np.argmin(errors)])


def clustered_errors(X, residuals, provider_ids, bread, transform):
    groups = {}
    for x, residual, pid in zip(X, residuals, provider_ids):
        groups.setdefault(pid, np.zeros(X.shape[1]))
        groups[pid] += x * residual
    scores = np.asarray(list(groups.values()))
    n, k = X.shape
    g = len(groups)
    correction = g / (g - 1) * (n - 1) / (n - k)
    raw_bread = transform @ bread
    covariance = correction * raw_bread @ (scores.T @ scores) @ raw_bread.T
    return np.sqrt(np.diag(covariance)), g


def metrics(errors):
    return {'rmse': float(np.sqrt(np.mean(errors**2))), 'mae': float(np.mean(np.abs(errors)))}


def build(tenure, indices, target):
    operational = [key for key in applicable_operational(tenure) if key.startswith(('RP', 'CH'))]
    if not target.startswith('TP') and target not in operational:
        operational.append(target)
    target_index = int(target[2:]) - 1 if target.startswith('TP') else None
    scores = [
        {pid: p['tenures'][tenure]['scores'] for pid, p in providers.items() if p['tenures'][tenure]['stock'] > 0}
        for providers in snapshots
    ]
    def observed(year, pid):
        if pid not in scores[year]:
            return None
        if target_index is not None:
            return scores[year][pid][target_index]
        return operational_value(snapshots[year][pid], tenure, target)

    def inputs(year, pid):
        values = [scores[year][pid][i] for i in indices]
        if any(v is None for v in values):
            return None
        return values + [operational_value(snapshots[year][pid], tenure, key) for key in operational]

    def transition(year):
        start, end = scores[year:year+2]
        rows = []
        eligible = 0
        for pid in sorted(start.keys() & end.keys()):
            y = observed(year+1, pid)
            if y is None:
                continue
            eligible += 1
            X = inputs(year, pid)
            if X is not None:
                rows.append((X, y, observed(year, pid), pid))
        return rows, eligible

    first, eligible_first = transition(0)
    second, eligible_second = transition(1)
    penalty = choose_penalty(first)
    validation, validation_means, validation_scales, _, validation_y, *_ = fit(first, penalty)
    held_out = np.asarray([r[1] for r in second])
    test_design = design(second, validation_means)
    model_errors = test_design @ validation - held_out
    threshold_errors = test_design @ threshold(validation, validation_means, validation_scales, validation_y.std()) - held_out
    previous = np.asarray([r[2] for r in second], dtype=float)
    paired = np.isfinite(previous)
    naive_errors = previous[paired] - held_out[paired]
    pooled = first + second
    coefficients, means, scales, Z, y, bread, transform = fit(pooled, penalty)
    residuals = y - design(pooled, means) @ coefficients
    standard_errors, clusters = clustered_errors(Z, residuals, [r[3] for r in pooled], bread, transform)
    assert np.all(standard_errors > 0)
    rss = float(residuals @ residuals)
    tss = float(np.sum((y - y.mean())**2))
    sparse = threshold(coefficients, means, scales, y.std())
    sparse_residuals = y - design(pooled, means) @ sparse

    predictions = []
    for pid in scores[2]:
        X = inputs(2, pid)
        if X is None:
            continue
        row = design([(X,)], means)[0]
        predictions.append({
            'id': pid, 'name': snapshots[2][pid]['name'],
            'observed': [observed(year, pid) for year in range(3)],
            'prediction': float(row @ coefficients),
            'thresholdPrediction': float(row @ sparse),
            'imputed': [key for key, value in zip(operational, X[len(indices):]) if value is None],
        })
    return {
        'inputs': [f'TP{i+1:02d}' for i in indices] + operational,
        'imputation': {
            key: {
                'mean': float(means[i]),
                'validationMean': float(validation_means[i]),
                'trainingMissing': sum(r[0][i] is None for r in pooled),
                'forecastMissing': sum(key in p['imputed'] for p in predictions),
            }
            for i, key in enumerate(operational, start=len(indices))
        },
        'fit': {
            'r2': 1 - rss / tss,
            'penalty': penalty,
            'scales': scales.tolist(),
            'outcomeScale': float(y.std()),
            'clusters': clusters,
            'standardErrors': standard_errors.tolist(),
            'coefficientSERatios': (coefficients / standard_errors).tolist(),
        },
        'training': [{'used': len(first), 'eligible': eligible_first}, {'used': len(second), 'eligible': eligible_second}],
        'backtest': {
            'n': len(second),
            'ridge': metrics(model_errors),
            'pairedN': int(paired.sum()),
            'pairedRidge': metrics(model_errors[paired]) if paired.any() else None,
            'persistence': metrics(naive_errors) if paired.any() else None,
        },
        'threshold': {
            'intercept': float(sparse[0]),
            'r2': 1 - float(sparse_residuals @ sparse_residuals) / tss,
            'ridge': metrics(threshold_errors),
            'pairedRidge': metrics(threshold_errors[paired]) if paired.any() else None,
        },
        'intercept': float(coefficients[0]), 'coefficients': coefficients[1:].tolist(),
        'predictions': sorted(predictions, key=lambda p: p['name'].casefold()),
    }


models = {}
for tenure, indices in [('LCRA', list(range(12))), ('LCHO', [0, *range(4, 12)])]:
    outcomes = [f'TP{i+1:02d}' for i in indices] + applicable_operational(tenure)
    models[tenure] = {target: build(tenure, indices, target) for target in outcomes}
    tp01 = models[tenure]['TP01']
    print(tenure, tp01['training'], tp01['backtest'], len(tp01['predictions']))
(ROOT / 'data/forecast-ridge-2027.json').write_text(json.dumps(models, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n')
