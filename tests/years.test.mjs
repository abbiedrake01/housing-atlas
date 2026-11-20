import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url)));
const years=read('data/years.json');
const old=read('public/housing.json'),fresh=read('public/housing-2025-26.json');
test('year manifest resolves separate datasets and freshly fitted models',()=>{
 assert.deepEqual(years.map(y=>y.label),['2025/26','2024/25']);
 for(const year of years){const raw=readFileSync(new URL('../public/'+year.housing,import.meta.url));const model=read('public/'+year.regression);assert.equal(model.dataYear,year.label);assert.equal(model.sourceSha256,createHash('sha256').update(raw).digest('hex'));}
});
test('2025/26 published examples and yearly stock are distinct from 2024/25',()=>{
 const p=fresh.providers.find(p=>p.id==='L4240');assert.equal(p.stock,25212);assert.equal(p.rent,154.21);assert.equal(p.region,'South East');
 assert.equal(p.tenures.LCRA.scores[0],59.7);assert.equal(p.tenures.LCHO.scores[0],27.6);
 assert.equal(p.operational.LCRA.values.CH01_1,239.4);assert.equal(p.operational.LCHO.values.CH01_1,206.4);
 assert.equal(p.tenures.LCRA.previous[0],60.7);assert.equal(p.operational.LCRA.previous.CH01_1,199.9);
 assert.notEqual(old.providers.find(x=>x.id===p.id).stock,p.stock);
 assert.equal(fresh.providers.length,1063);assert.equal(fresh.stockDate,'2026-03-31');
});
test('new year stock, geography, missing values and exact-code YoY reconcile',()=>{
 const previous=new Map(old.providers.map(p=>[p.id,p])),geo=new Set(fresh.areas.map(a=>a.id));
 assert.equal(new Set(fresh.providers.map(p=>p.id)).size,fresh.providers.length);
 const members=fresh.providers.flatMap(p=>p.members);assert.equal(new Set(members).size,members.length);
 for(const p of fresh.providers){
  assert.equal(p.stock,p.tenures.LCRA.stock+p.tenures.LCHO.stock);
  for(const v of [p,...Object.values(p.tenures)]){assert.equal(v.stock,v.areas.reduce((s,a)=>s+a.stock,0)+v.unlocatedStock);for(const a of v.areas)assert.ok(geo.has(a.id));}
  for(const t of ['LCRA','LCHO']){
   assert.deepEqual(p.tenures[t].previous,previous.get(p.id)?.tenures[t].scores??Array(12).fill(null));
   for(const v of p.tenures[t].scores)assert.ok(v===null||(Number.isFinite(v)&&v>=0&&v<=100));
   for(const [key,value] of Object.entries(p.operational[t].previous))assert.equal(value,previous.get(p.id)?.operational[t].values[key]??null);
  }
  assert.deepEqual(p.tenures.LCHO.scores.slice(1,4),[null,null,null]);
 }
 assert.ok(geo.has('E08000038')&&geo.has('E08000039'));
});
