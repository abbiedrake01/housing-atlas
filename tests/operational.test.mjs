import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {measures,measureValue,measureBounds,projectMeasures} from '../lib/measures.ts';
import {filterProviders,projectTenure} from '../lib/analysis.ts';
import {pairStats,ranks} from '../lib/correlation.ts';
const {providers}=JSON.parse(readFileSync(new URL('../public/housing.json',import.meta.url)));
const ops=measures('operational','LCRA');
test('operational measures retain units and tenure applicability; published examples match',()=>{
 assert.equal(ops.length,14);assert.equal(measures('operational','LCHO').length,11);
 const p=providers.find(p=>p.id==='L4240');
 assert.equal(measureValue(p,ops.find(m=>m.key==='CH01_1'),'LCRA'),199.9);
 assert.equal(measureValue(p,ops.find(m=>m.key==='CH01_1'),'LCHO'),194.2);
 assert.equal(measureValue(p,ops.find(m=>m.key==='CH01_1'),'all'),199.9);
 assert.equal(measureValue(p,ops.find(m=>m.key==='RP02_1'),'LCRA'),73.9);
 assert.equal(measureValue(p,ops.find(m=>m.key==='RP01'),'LCHO'),null);
 assert.equal(measureValue(p,ops.find(m=>m.key==='BS01'),'LCHO'),96.9);
 assert.equal(measureValue(p,ops.find(m=>m.key==='CH01_1'),'LCHO',true),143);
 for(const p of providers)for(const m of ops)for(const t of ['LCRA','LCHO'])for(const previous of [false,true]){
  const v=measureValue(p,m,t,previous);assert.ok(v===null||Number.isFinite(v)&&v>=0);
  if(m.unit==='%')assert.ok(v===null||v<=100);
  if(t==='LCHO'&&m.scope==='LCRA')assert.equal(v,null);
 }
});
test('operational projection retains satisfaction targets and range filters do not cap rates at 100',()=>{
 const m=ops.find(m=>m.key==='CH01_1'),k=ops.indexOf(m);
 const ps=projectMeasures(projectTenure(providers,'LCRA'),'operational','LCRA');
 const bounds=measureBounds(ps,m,'LCRA','score');assert.ok(bounds[1]>=199.9);
 const base={query:'',region:'All regions',size:[0,120000],rent:[0,300],knownRent:false,metric:k,scoreRange:bounds,scoreBounds:bounds};
 assert.equal(filterProviders(ps,base).length,ps.length);
 assert.ok(filterProviders(ps,{...base,scoreRange:[150,bounds[1]]}).some(p=>p.id==='L4240'));
 assert.ok(filterProviders(ps,{...base,scoreRange:[150,bounds[1]]}).every(p=>p.scores[k]>=150));
 const p=ps.find(p=>p.id==='L4240');assert.notEqual(p.scores[0],p.tenures.LCRA.scores[0]);
});
test('correlation statistics handle ties, negative relationships, small samples and constants',()=>{
 assert.deepEqual(ranks([30,10,10,20]),[4,1.5,1.5,3]);
 const pairs=[1,2,3,4].map((x,i)=>({x,y:10-2*x,id:String(i),name:String(i)}));
 assert.equal(pairStats(pairs).r,-1);assert.equal(pairStats(pairs).slope,-2);assert.equal(pairStats(pairs).intercept,10);
 assert.equal(pairStats(pairs,'spearman').r,-1);
 assert.equal(pairStats(pairs.slice(0,2)),null);assert.equal(pairStats(pairs.map(p=>({...p,x:1}))),null);
 const tied=[{x:1,y:1},{x:1,y:2},{x:2,y:3},{x:3,y:4}];
 assert.ok(Math.abs(pairStats(tied,'spearman').r-0.9486832980505138)<1e-12);
});
