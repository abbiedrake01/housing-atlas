import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=f=>JSON.parse(readFileSync(new URL('../public/'+f,import.meta.url)));
const snapshots=['housing-2023-24.json','housing.json','housing-2025-26.json'].map(f=>load(f).providers);
const models=load('forecast-2027.json');

test('one-year forecasts use both observed transitions and score only complete 2026 inputs',()=>{
 for(const tenure of ['LCRA','LCHO']){
  const years=snapshots.map(rows=>new Map(rows.filter(p=>p.tenures[tenure].stock>0).map(p=>[p.id,p.tenures[tenure].scores])));
  const indices=tenure==='LCRA'?[...Array(12).keys()]:[0,4,5,6,7,8,9,10,11];
  const codes=indices.map(i=>'TP'+String(i+1).padStart(2,'0'));
  assert.deepEqual(Object.keys(models[tenure]),codes);
  const features=s=>indices.map(i=>s[i]);
  for(const [target,model] of Object.entries(models[tenure])){
   assert.deepEqual(model.inputs,codes);
   const j=Number(target.slice(2))-1;
   const predict=x=>model.intercept+x.reduce((total,v,i)=>total+v*model.coefficients[i],0);
   const gradient=Array(indices.length+1).fill(0);
   for(let t=0;t<2;t++){
    let n=0,eligible=0,baselineSquaredError=0;
    for(const [id,scores] of years[t]){
     const y=years[t+1].get(id)?.[j];
     if(y==null)continue;
     eligible++;
     const x=features(scores);
     if(x.some(v=>v==null))continue;
     n++;
     [1,...x].forEach((v,k)=>gradient[k]+=v*(y-predict(x)));
     baselineSquaredError+=(y-scores[j])**2;
    }
    assert.deepEqual(model.training[t],{used:n,eligible});
    if(t===1){
     assert.equal(model.backtest.n,n);
     assert.ok(Math.abs(model.backtest.persistence.rmse-Math.sqrt(baselineSquaredError/n))<1e-10);
    }
   }
   assert.ok(gradient.every(g=>Math.abs(g)<1e-6),'pooled OLS normal equations');
   const complete=[...years[2]].filter(([,scores])=>features(scores).every(v=>v!=null));
   assert.deepEqual(model.predictions.map(p=>p.id).sort(),complete.map(([id])=>id).sort());
   for(const p of model.predictions){
    assert.ok(Math.abs(p.prediction-predict(features(years[2].get(p.id))))<1e-10);
    assert.deepEqual(p.observed,years.map(year=>year.get(p.id)?.[j]??null));
   }
  }
 }
});
