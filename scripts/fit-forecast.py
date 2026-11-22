"""Fit one pooled one-year-ahead OLS model per tenure and TP outcome."""
from pathlib import Path
import json

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
years = sorted(json.loads((ROOT / 'data/years.json').read_text()), key=lambda year: year['stockYear'])
assert [year['stockYear'] for year in years] == [2024, 2025, 2026]
snapshots = [
    {p['id']: p for p in json.loads((ROOT / 'public' / year['housing']).read_text())['providers']}
    for year in years
]


def design(scores):
    X = np.asarray(scores)
    return np.column_stack([np.ones(len(X)), X])


def fit(rows):
    X = design([r[0] for r in rows])
    y = np.asarray([r[1] for r in rows])
    coefficients, _, rank, _ = np.linalg.lstsq(X, y, rcond=None)
    assert rank == X.shape[1], 'Forecast predictors are rank deficient'
    return coefficients


def metrics(errors):
    return {'rmse': float(np.sqrt(np.mean(errors**2))), 'mae': float(np.mean(np.abs(errors)))}


def build(tenure, indices, target):
    scores = [
        {pid: p['tenures'][tenure]['scores'] for pid, p in providers.items() if p['tenures'][tenure]['stock'] > 0}
        for providers in snapshots
    ]
    def inputs(row):
        values = [row[i] for i in indices]
        return values if all(v is not None for v in values) else None

    def transition(start, end):
        rows = []
        eligible = 0
        for pid in sorted(start.keys() & end.keys()):
            y = end[pid][target]
            if y is None:
                continue
            eligible += 1
            X = inputs(start[pid])
            if X is not None:
                rows.append((X, y, start[pid][target]))
        return rows, eligible

    first, eligible_first = transition(scores[0], scores[1])
    second, eligible_second = transition(scores[1], scores[2])
    validation = fit(first)
    held_out = np.asarray([r[1] for r in second])
    model_errors = design([r[0] for r in second]) @ validation - held_out
    naive_errors = np.asarray([r[2] for r in second]) - held_out
    coefficients = fit(first + second)

    predictions = []
    for pid, row in scores[2].items():
        X = inputs(row)
        if X is None:
            continue
        predictions.append({
            'id': pid, 'name': snapshots[2][pid]['name'],
            'observed': [s.get(pid, [None] * 12)[target] for s in scores],
            'prediction': float(np.dot([1, *X], coefficients)),
        })
    return {
        'inputs': [f'TP{i+1:02d}' for i in indices],
        'training': [{'used': len(first), 'eligible': eligible_first}, {'used': len(second), 'eligible': eligible_second}],
        'backtest': {'n': len(second), 'linear': metrics(model_errors), 'persistence': metrics(naive_errors)},
        'intercept': float(coefficients[0]), 'coefficients': coefficients[1:].tolist(),
        'predictions': sorted(predictions, key=lambda p: p['name'].casefold()),
    }


models = {}
for tenure, indices in [('LCRA', list(range(12))), ('LCHO', [0, *range(4, 12)])]:
    models[tenure] = {f'TP{i+1:02d}': build(tenure, indices, i) for i in indices}
    tp01 = models[tenure]['TP01']
    print(tenure, tp01['training'], tp01['backtest'], len(tp01['predictions']))
(ROOT / 'public/forecast-2027.json').write_text(json.dumps(models, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n')
