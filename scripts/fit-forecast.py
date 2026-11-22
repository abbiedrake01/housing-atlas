"""Fit one pooled one-year-ahead ridge model per tenure and TP outcome."""
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


OPERATIONAL = [
    m['key'] for m in json.loads((ROOT / 'data/operational-metrics.json').read_text())
    if m['key'].startswith(('RP', 'CH'))
]


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
    operational = [key for key in OPERATIONAL if tenure == 'LCRA' or not key.startswith('RP')]
    scores = [
        {pid: p['tenures'][tenure]['scores'] for pid, p in providers.items() if p['tenures'][tenure]['stock'] > 0}
        for providers in snapshots
    ]
    def inputs(year, pid):
        values = [scores[year][pid][i] for i in indices]
        if any(v is None for v in values):
            return None
        operations = snapshots[year][pid].get('operational', {}).get(tenure, {}).get('values', {})
        return values + [operations.get(key) for key in operational]

    def transition(year):
        start, end = scores[year:year+2]
        rows = []
        eligible = 0
        for pid in sorted(start.keys() & end.keys()):
            y = end[pid][target]
            if y is None:
                continue
            eligible += 1
            X = inputs(year, pid)
            if X is not None:
                rows.append((X, y, start[pid][target], pid))
        return rows, eligible

    first, eligible_first = transition(0)
    second, eligible_second = transition(1)
    penalty = choose_penalty(first)
    validation, validation_means, *_ = fit(first, penalty)
    held_out = np.asarray([r[1] for r in second])
    model_errors = design(second, validation_means) @ validation - held_out
    naive_errors = np.asarray([r[2] for r in second]) - held_out
    pooled = first + second
    coefficients, means, scales, Z, y, bread, transform = fit(pooled, penalty)
    residuals = y - design(pooled, means) @ coefficients
    standard_errors, clusters = clustered_errors(Z, residuals, [r[3] for r in pooled], bread, transform)
    assert np.all(standard_errors > 0)
    rss = float(residuals @ residuals)
    tss = float(np.sum((y - y.mean())**2))

    predictions = []
    for pid in scores[2]:
        X = inputs(2, pid)
        if X is None:
            continue
        predictions.append({
            'id': pid, 'name': snapshots[2][pid]['name'],
            'observed': [s.get(pid, [None] * 12)[target] for s in scores],
            'prediction': float(design([(X,)], means)[0] @ coefficients),
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
            'clusters': clusters,
            'standardErrors': standard_errors.tolist(),
            'coefficientSERatios': (coefficients / standard_errors).tolist(),
        },
        'training': [{'used': len(first), 'eligible': eligible_first}, {'used': len(second), 'eligible': eligible_second}],
        'backtest': {'n': len(second), 'ridge': metrics(model_errors), 'persistence': metrics(naive_errors)},
        'intercept': float(coefficients[0]), 'coefficients': coefficients[1:].tolist(),
        'predictions': sorted(predictions, key=lambda p: p['name'].casefold()),
    }


models = {}
for tenure, indices in [('LCRA', list(range(12))), ('LCHO', [0, *range(4, 12)])]:
    models[tenure] = {f'TP{i+1:02d}': build(tenure, indices, i) for i in indices}
    tp01 = models[tenure]['TP01']
    print(tenure, tp01['training'], tp01['backtest'], len(tp01['predictions']))
(ROOT / 'data/forecast-ridge-2027.json').write_text(json.dumps(models, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n')
