import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=f=>JSON.parse(readFileSync(new URL('../public/'+f,import.meta.url)));
const snapshots=['housing-2023-24.json','housing.json','housing-2025-26.json'].map(f=>load(f).providers);
const operational=JSON.parse(readFileSync(new URL('../data/operational-metrics.json',import.meta.url)));
const models=JSON.parse(readFileSync(new URL('../data/forecast-ridge-2027.json',import.meta.url)));

test('one-year forecasts use both observed transitions and score only complete 2026 inputs',()=>{
 for(const tenure of ['LCRA','LCHO']){
  const years=snapshots.map(rows=>new Map(rows.filter(p=>p.tenures[tenure].stock>0).map(p=>[p.id,p])));
  const indices=tenure==='LCRA'?[...Array(12).keys()]:[0,4,5,6,7,8,9,10,11];
  const codes=indices.map(i=>'TP'+String(i+1).padStart(2,'0'));
  const availableOps=operational.filter(m=>tenure==='LCRA'||m.scope!=='LCRA').map(m=>m.key);
  assert.deepEqual(Object.keys(models[tenure]),[...codes,...availableOps]);
  const baseOps=[...(tenure==='LCRA'?['RP01','RP02_1','RP02_2']:[]),'CH01_1','CH01_2','CH02_1','CH02_2'];
  const scores=p=>p?.tenures[tenure].scores;
  const tp=p=>indices.map(i=>scores(p)[i]);
  const op=(p,key)=>p?.operational?.[tenure]?.values[key]??null;
  for(const [target,model] of Object.entries(models[tenure])){
   const ops=availableOps.includes(target)&&!baseOps.includes(target)?[...baseOps,target]:baseOps;
   const values=p=>ops.map(key=>op(p,key));
   const observed=p=>target.startsWith('TP')?(scores(p)?.[Number(target.slice(2))-1]??null):op(p,target);
   assert.deepEqual(model.inputs,[...codes,...ops]);
   assert.ok(model.fit.outcomeScale>0);
   const features=p=>[...tp(p),...values(p).map((v,i)=>v??model.imputation[ops[i]].mean)];
   const counts=ops.map(()=>({n:0,sum:0,missing:0,firstN:0,firstSum:0}));
   const predict=x=>model.intercept+x.reduce((total,v,i)=>total+v*model.coefficients[i],0);
   const gradient=Array(model.inputs.length+1).fill(0);
   for(let t=0;t<2;t++){
    let n=0,eligible=0,pairedN=0,baselineSquaredError=0;
    for(const [id,p] of years[t]){
     const y=observed(years[t+1].get(id));
     if(y==null)continue;
     eligible++;
     if(tp(p).some(v=>v==null))continue;
     const x=features(p);
     values(p).forEach((v,i)=>{
      const c=counts[i];
      if(v==null){c.missing++;return}
      c.n++;c.sum+=v;
      if(t===0){c.firstN++;c.firstSum+=v}
     });
     n++;
     [1,...x].forEach((v,k)=>gradient[k]+=v*(y-predict(x)));
     const prior=observed(p);
     if(prior!==null){pairedN++;baselineSquaredError+=(y-prior)**2}
    }
    assert.deepEqual(model.training[t],{used:n,eligible});
    if(t===1){
     assert.equal(model.backtest.n,n);
     assert.equal(model.backtest.pairedN,pairedN);
     assert.ok(Math.abs(model.backtest.persistence.rmse-Math.sqrt(baselineSquaredError/pairedN))<1e-10);
     assert.ok(Number.isFinite(model.backtest.pairedRidge.rmse));
     if(n===pairedN)assert.equal(model.backtest.ridge.rmse,model.backtest.pairedRidge.rmse);
    }
   }
   assert.ok(model.fit.penalty>0);
   const n=model.training.reduce((sum,row)=>sum+row.used,0);
   assert.ok(Math.abs(gradient[0])<1e-6,'unpenalized intercept');
   model.coefficients.forEach((b,i)=>{
    const penaltyGradient=n*model.fit.penalty*model.fit.scales[i]**2*b;
    assert.ok(Math.abs(gradient[i+1]-penaltyGradient)<1e-6,'ridge normal equations in original units');
   });
   const complete=[...years[2]].filter(([,p])=>tp(p).every(v=>v!=null));
   ops.forEach((key,i)=>{
    const c=counts[i], imputation=model.imputation[key];
    assert.equal(imputation.trainingMissing,c.missing);
    assert.equal(imputation.forecastMissing,complete.filter(([,p])=>values(p)[i]==null).length);
    assert.ok(Math.abs(imputation.mean-c.sum/c.n)<1e-10);
    assert.ok(Math.abs(imputation.validationMean-c.firstSum/c.firstN)<1e-10);
   });
   [model.intercept,...model.coefficients].forEach((b,i)=>{
    assert.ok(model.fit.standardErrors[i]>0);
    assert.ok(Math.abs(b/model.fit.standardErrors[i]-model.fit.coefficientSERatios[i])<1e-10);
   });
   assert.deepEqual(model.predictions.map(p=>p.id).sort(),complete.map(([id])=>id).sort());
   const zeroed=model.coefficients.map((b,i)=>Math.abs(b*model.fit.scales[i]/model.fit.outcomeScale)<0.05?0:b);
   assert.ok(Number.isFinite(model.threshold.ridge.rmse));
   assert.ok(Number.isFinite(model.threshold.pairedRidge.rmse));
   for(const p of model.predictions){
    assert.ok(Math.abs(p.prediction-predict(features(years[2].get(p.id))))<1e-10);
    const thresholdPrediction=features(years[2].get(p.id)).reduce((sum,v,i)=>sum+v*zeroed[i],model.threshold.intercept);
    assert.ok(Math.abs(p.thresholdPrediction-thresholdPrediction)<1e-10);
    assert.deepEqual(p.observed,years.map(year=>observed(year.get(p.id))));
   }
  }
 }
});
