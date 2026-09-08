import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {correlations,filterProviders} from '../lib/analysis.ts';
const p=(name,stock,rent,scores)=>({name,stock,rent,region:'North',scores,previous:Array(12).fill(null)});
const base={query:'',region:'All regions',size:[0,120000],rent:[0,300],knownRent:false};
test('Pearson uses pairwise completeness and excludes TP01 and zero variance',()=>{
const ps=[p('a',100,100,[10,20,5,null]),p('b',100,100,[20,40,5,20]),p('c',100,100,[30,60,5,10]),p('d',100,100,[40,null,5,0])];
const cs=correlations(ps);assert.equal(cs[0].index,1);assert.equal(cs[0].n,3);assert.equal(cs[0].r,1);assert.equal(cs[1].r,-1);assert.equal(cs.length,2);
});
test('filters preserve unknown rents only when the unrestricted range permits them',()=>{
const ps=[p('Alpha',1000,null,[]),p('Beta',120000,130,[]),p('Gamma',150000,400,[])];
assert.equal(filterProviders(ps,base).length,3);
assert.equal(filterProviders(ps,{...base,knownRent:true}).length,2);
assert.deepEqual(filterProviders(ps,{...base,rent:[100,150]}).map(x=>x.name),['Beta']);
assert.deepEqual(filterProviders(ps,{...base,query:'ALP'}).map(x=>x.name),['Alpha']);
assert.equal(filterProviders(ps,{...base,region:'South'}).length,0);
});
test('published data has unique groups, valid percentages and reconciling geographic stock',()=>{
const {providers,areas}=JSON.parse(readFileSync(new URL('../public/housing.json',import.meta.url)));
assert.equal(new Set(providers.map(p=>p.id)).size,providers.length);
const members=providers.flatMap(p=>p.members);assert.equal(new Set(members).size,members.length);
const areaSet=new Set(areas.map(a=>a.id));
for(const p of providers){assert.equal(p.scores.length,12);assert.equal(p.previous.length,12);assert.ok(p.stock>0);for(const v of [...p.scores,...p.previous])assert.ok(v===null||(v>=0&&v<=100));for(const a of p.areas)assert.ok(areaSet.has(a.id),a.id);assert.equal(p.areas.reduce((n,a)=>n+a.stock,0)+p.unlocatedStock,p.stock)}
assert.ok(providers.filter(p=>p.scores[0]!==null).length>150);
});

test('association selections intersect other filters; empty selection is unrestricted',()=>{
 const ps=[{...p('Alpha',1000,100,[50]),id:'a'},{...p('Beta',2000,120,[80]),id:'b'}];
 assert.equal(filterProviders(ps,{...base,selectedIds:[]}).length,2);
 assert.deepEqual(filterProviders(ps,{...base,selectedIds:['a']}).map(p=>p.id),['a']);
 assert.equal(filterProviders(ps,{...base,selectedIds:['a'],size:[2000,120000]}).length,0);
});
test('displayed measure filters distinguish percentage levels, changes and missing scores',()=>{
 const ps=[{...p('Alpha',1000,100,[50,80]),previous:[40,90]},{...p('Beta',2000,120,[80,null]),previous:[85,40]}];
 assert.deepEqual(filterProviders(ps,{...base,metric:1,scoreRange:[70,90]}).map(p=>p.name),['Alpha']);
 assert.deepEqual(filterProviders(ps,{...base,metric:0,mode:'change',scoreRange:[0,20]}).map(p=>p.name),['Alpha']);
 assert.deepEqual(filterProviders(ps,{...base,metric:1,mode:'change',scoreRange:[-20,0]}).map(p=>p.name),['Alpha']);
 assert.equal(filterProviders(ps,{...base,metric:1,scoreRange:[0,100]}).length,2);
 assert.equal(filterProviders(ps,{...base,metric:1,reportedScoreOnly:true}).length,1);
});
test('LCRA and LCHO stocks reconcile; LCHO never inherits rental scores',async()=>{
 const {projectTenure}=await import('../lib/analysis.ts');
 const {providers}=JSON.parse(readFileSync(new URL('../public/housing.json',import.meta.url)));
 for(const p of providers){
  assert.equal(p.tenures.LCRA.stock+p.tenures.LCHO.stock,p.stock);
  for(const t of Object.values(p.tenures)){
   assert.equal(t.areas.reduce((s,a)=>s+a.stock,0)+t.unlocatedStock,t.stock);
   assert.equal(t.scores.length,12);assert.equal(t.previous.length,12);
   for(const v of [...t.scores,...t.previous])assert.ok(v===null||(v>=0&&v<=100));
  }
  assert.deepEqual(p.tenures.LCHO.scores.slice(1,4),[null,null,null]);
 }
 const abri=providers.find(p=>p.id==='L4172');const cho=projectTenure([abri],'LCHO')[0];
 assert.equal(cho.stock,4801);assert.equal(cho.scores[0],52.4);assert.equal(cho.previous[0],62.7);assert.equal(cho.rent,null);
 assert.notEqual(cho.scores[0],abri.scores[0]);assert.equal(projectTenure([abri],'all')[0].stock,abri.stock);
});
