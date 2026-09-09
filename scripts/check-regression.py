"""Independently verify held-out predictions via a direct ridge linear solve."""
import json
from pathlib import Path
import numpy as np
r=json.loads((Path(__file__).resolve().parents[1]/'public/regression.json').read_text())
for name,m in r['models'].items():
    points={p['id']:p for p in m['points']}
    for fold in m['folds']:
        train=[points[i] for i in fold['trainIds']];test=[points[i] for i in fold['testIds']]
        x=np.array([p['x'] for p in train]);y=np.array([p['actual'] for p in train]);mean=x.mean(0);sd=x.std(0);sd[sd==0]=1
        z=(x-mean)/sd
        beta=np.linalg.solve(z.T@z+fold['alpha']*np.eye(z.shape[1]),z.T@(y-y.mean()))
        predicted=y.mean()+((np.array([p['x'] for p in test])-mean)/sd)@beta
        np.testing.assert_allclose(predicted,[p['predicted'] for p in test],atol=1e-9)
    print(name,': independent training-only ridge solves match all held-out predictions')
