"""Reproducible, separate ridge models for the bundled 2024/25 LCRA/LCHO data.
Run: python -m pip install -r scripts/regression-requirements.txt
     python scripts/fit-regression.py
Writes only public/regression.json. No live data or credentials required.
"""
from pathlib import Path
import hashlib,json
import numpy as np
import sklearn
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold,GridSearchCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error,mean_absolute_error,r2_score

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'public/housing.json'
ALPHAS=np.logspace(-3,4,29)
REGIONS=['London','Midlands','Mixed','North','South']
LABELS=['Overall satisfaction','Repairs service','Time taken for repairs','Well-maintained home','Safe home','Listens and acts','Keeps tenants informed','Fairness and respect','Complaints handling','Communal areas','Neighbourhood contribution','Anti-social behaviour']

def tune(x,y,seed):
    pipeline=make_pipeline(StandardScaler(),Ridge(solver='svd'))
    search=GridSearchCV(pipeline,{'ridge__alpha':ALPHAS},cv=KFold(5,shuffle=True,random_state=seed),scoring='neg_mean_squared_error',n_jobs=1)
    search.fit(x,y)
    return search

def metrics(y,p):
    return {'rmse':float(np.sqrt(mean_squared_error(y,p))),'mae':float(mean_absolute_error(y,p)),'r2':float(r2_score(y,p))}

def fit(providers,tenure):
    indices=list(range(1,12)) if tenure=='LCRA' else list(range(4,12))
    eligible=[p for p in providers if p['tenures'][tenure]['stock']>0 and p['tenures'][tenure]['scores'][0] is not None]
    cohort=[p for p in eligible if all(p['tenures'][tenure]['scores'][i] is not None for i in indices) and p['region'] in REGIONS]
    cohort.sort(key=lambda p:p['id'])
    excluded=[{'id':p['id'],'name':p['name'],'reason':'Missing applicable TP predictor or known region'} for p in eligible if p not in cohort]
    features=[{'key':'size','label':'Association size (log₁₀ homes)','kind':'numeric','group':'Size'}]+[{'key':f'TP{i+1:02d}','label':LABELS[i],'kind':'numeric','group':'Tenant measures'} for i in indices]+[{'key':'region_'+r,'label':r,'kind':'region','group':'Region'} for r in REGIONS[1:]]
    x=np.array([[np.log10(p['tenures'][tenure]['stock'])]+[p['tenures'][tenure]['scores'][i] for i in indices]+[float(p['region']==r) for r in REGIONS[1:]] for p in cohort])
    y=np.array([p['tenures'][tenure]['scores'][0] for p in cohort])
    assert np.isfinite(x).all() and np.isfinite(y).all()
    assert all(f['key']!='TP01' for f in features)
    outer=list(KFold(5,shuffle=True,random_state=20260909).split(x))
    oof=np.full(len(y),np.nan);baseline=np.full(len(y),np.nan);fold_ids=np.zeros(len(y),dtype=int);folds=[];fold_coefficients=[]
    for fold,(train,test) in enumerate(outer):
        fitted=tune(x[train],y[train],500+fold)
        oof[test]=fitted.predict(x[test]);baseline[test]=np.mean(y[train]);fold_ids[test]=fold+1
        raw=fitted.best_estimator_['ridge'].coef_/fitted.best_estimator_['standardscaler'].scale_
        fold_coefficients.append(raw)
        folds.append({'fold':fold+1,'trainN':len(train),'testN':len(test),'alpha':float(fitted.best_params_['ridge__alpha']),'trainIds':[cohort[i]['id'] for i in train],'testIds':[cohort[i]['id'] for i in test],'rmse':float(np.sqrt(mean_squared_error(y[test],oof[test])))})
    assert np.isfinite(oof).all()
    final=tune(x,y,42);pipe=final.best_estimator_;scaler=pipe['standardscaler'];ridge=pipe['ridge'];full_pred=pipe.predict(x)
    raw=ridge.coef_/scaler.scale_
    for k,f in enumerate(features):
        # Numeric: pp TP01 / 1 full-cohort SD. Region: pp relative to London.
        factor=scaler.scale_[k] if f['kind']=='numeric' else 1
        fold_effects=[float(c[k]*factor) for c in fold_coefficients]
        f.update({'coefficient':float(raw[k]*factor),'rawCoefficient':float(raw[k]),'mean':float(scaler.mean_[k]),'sd':float(scaler.scale_[k]),'foldMin':min(fold_effects),'foldMax':max(fold_effects),'foldCoefficients':fold_effects})
    ablations=[]
    for group in ['Size','Region','Tenant measures']:
        keep=[i for i,f in enumerate(features) if f['group']!=group]
        reduced=np.full(len(y),np.nan)
        for fold,(train,test) in enumerate(outer):
            reduced[test]=tune(x[train][:,keep],y[train],500+fold).predict(x[test][:,keep])
        m=metrics(y,reduced);ablations.append({'group':group,'rmseWithout':m['rmse'],'rmseIncrease':m['rmse']-metrics(y,oof)['rmse']})
    points=[]
    for i,p in enumerate(cohort):
        points.append({'id':p['id'],'name':p['name'],'region':p['region'],'stock':p['tenures'][tenure]['stock'],'actual':float(y[i]),'predicted':float(oof[i]),'fitted':float(full_pred[i]),'residual':float(y[i]-oof[i]),'fold':int(fold_ids[i]),'x':[float(v) for v in x[i]]})
    cv=final.cv_results_
    curve=[{'alpha':float(a),'logAlpha':float(np.log10(a)),'rmse':float(np.sqrt(-m))} for a,m in zip(ALPHAS,cv['mean_test_score'])]
    return {'tenure':tenure,'n':len(cohort),'eligible':len(eligible),'excluded':excluded,'featureCount':len(features),'alpha':float(final.best_params_['ridge__alpha']),'alphaAtBoundary':bool(final.best_params_['ridge__alpha'] in (ALPHAS[0],ALPHAS[-1])),'referenceRegion':'London','regionCounts':{r:sum(p['region']==r for p in cohort) for r in REGIONS},'targetMean':float(np.mean(y)),'intercept':float(ridge.intercept_),'rawIntercept':float(ridge.intercept_-np.dot(raw,scaler.mean_)),'metrics':metrics(y,oof),'baseline':metrics(y,baseline),'trainingMetrics':metrics(y,full_pred),'features':features,'points':points,'folds':folds,'curve':curve,'ablations':ablations}

if __name__=='__main__':
    source=SOURCE.read_bytes();providers=json.loads(source)['providers']
    result={'schemaVersion':1,'sourceSha256':hashlib.sha256(source).hexdigest(),'dataYear':'2024/25','method':{'estimator':'Ridge','objective':'sum squared residuals + alpha * sum squared coefficients; intercept unpenalized','preprocessing':'log10 tenure stock; reference-coded region (London); all feature columns standardized within each training fold','validation':'5-fold outer CV; 5-fold inner CV selects alpha by mean squared error; final alpha selected by independent seeded 5-fold CV on all eligible complete cases','outerSeed':20260909,'finalSeed':42,'alphas':ALPHAS.tolist(),'versions':{'numpy':np.__version__,'scikitLearn':sklearn.__version__}},'models':{t:fit(providers,t) for t in ['LCRA','LCHO']}}
    (ROOT/'public/regression.json').write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n')
    for t,m in result['models'].items():
        print(t,'n',m['n'],'alpha',m['alpha'],'OOF',m['metrics'],'baseline',m['baseline'])
        print('Top numeric',[(f['key'],round(f['coefficient'],2)) for f in sorted([f for f in m['features'] if f['kind']=='numeric'],key=lambda f:-abs(f['coefficient']))[:3]])
