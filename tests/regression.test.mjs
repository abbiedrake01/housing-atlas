import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const raw=readFileSync(new URL('../public/housing.json',import.meta.url));
const data=JSON.parse(raw),results=JSON.parse(readFileSync(new URL('../public/regression.json',import.meta.url)));
const models=[...Object.values(results.models),...Object.values(results.operationalModels)];
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('regressions use the exact current dataset and separate tenure targets',()=>{
 assert.equal(results.sourceSha256,createHash('sha256').update(raw).digest('hex'));
 for(const m of models){
  const tenure=m.tenure;assert.equal(m.tenure,tenure);assert.equal(m.points.length,m.n);assert.equal(m.eligible,m.n+m.excluded.length);
  assert.ok(!m.features.some(f=>f.key==='TP01'));assert.equal(m.featureCount,m.features.length);
  if(tenure==='LCHO')assert.ok(!m.features.some(f=>['TP02','TP03','TP04','RP01','RP02_1','RP02_2'].includes(f.key)));
  if(m.family==='operational')assert.ok(!m.features.some(f=>f.key.startsWith('TP')));
  for(const p of m.points){const source=data.providers.find(v=>v.id===p.id);assert.equal(p.actual,source.tenures[tenure].scores[0]);assert.equal(p.stock,source.tenures[tenure].stock);close(p.x[0],Math.log10(p.stock));
   m.features.forEach((f,i)=>{if(f.key.startsWith('TP'))close(p.x[i],source.tenures[tenure].scores[Number(f.key.slice(2))-1]);if(f.group==='Operational measures')close(p.x[i],source.operational[tenure].values[f.key]);if(f.kind==='region')assert.equal(p.x[i],Number(source.region===f.label));});
  }
 }
});
test('every held-out provider occurs once and never in its training fold',()=>{
 for(const m of models){
  const held=[];
  for(const fold of m.folds){assert.equal(fold.trainIds.length,fold.trainN);assert.equal(fold.testIds.length,fold.testN);assert.equal(fold.trainN+fold.testN,m.n);for(const id of fold.testIds){assert.ok(!fold.trainIds.includes(id));assert.equal(m.points.find(p=>p.id===id).fold,fold.fold)}held.push(...fold.testIds);}
  assert.equal(held.length,m.n);assert.equal(new Set(held).size,m.n);assert.deepEqual([...held].sort(),m.points.map(p=>p.id).sort());
 }
});
test('reported metrics and final coefficients agree with predictions and ridge normal equations',()=>{
 for(const m of models){
  const mse=m.points.reduce((s,p)=>s+(p.actual-p.predicted)**2,0)/m.n;
  const variance=m.points.reduce((s,p)=>s+(p.actual-m.targetMean)**2,0)/m.n;
  close(m.metrics.rmse,Math.sqrt(mse));close(m.metrics.r2,1-mse/variance);close(m.metrics.mae,m.points.reduce((s,p)=>s+Math.abs(p.actual-p.predicted),0)/m.n);
  for(const p of m.points){close(p.residual,p.actual-p.predicted);close(p.fitted,m.rawIntercept+m.features.reduce((s,f,i)=>s+f.rawCoefficient*p.x[i],0));}
  m.features.forEach((f,i)=>{
   const beta=f.rawCoefficient*f.sd;
   const gradient=m.points.reduce((s,p)=>s+(p.x[i]-f.mean)/f.sd*(p.actual-p.fitted),0);
   close(gradient,m.alpha*beta,1e-6);
   close(f.coefficient,f.kind==='numeric'?beta:f.rawCoefficient);
  });
  close(m.points.reduce((s,p)=>s+p.actual-p.fitted,0),0,1e-6);
  for(const a of m.ablations)close(a.rmseIncrease,a.rmseWithout-m.metrics.rmse);
  const best=[...m.curve].sort((a,b)=>a.rmse-b.rmse)[0];assert.equal(m.alpha,best.alpha);
 }
});
