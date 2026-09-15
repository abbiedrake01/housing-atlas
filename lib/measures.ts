import operational from '../data/operational-metrics.json' with {type:'json'};
import type {Provider,Tenure} from './analysis';
export type Family='satisfaction'|'operational';
export type Measure={key:string;label:string;unit:string;scope:string};
const labels=['Overall satisfaction','Repairs service','Time taken for repairs','Well-maintained home','Safe home','Listens and acts','Keeps tenants informed','Fairness and respect','Complaints handling','Communal areas','Neighbourhood contribution','Anti-social behaviour'];
export const satisfaction:Measure[]=labels.map((label,i)=>({key:`TP${String(i+1).padStart(2,'0')}`,label,unit:'%',scope:i>=1&&i<=3?'LCRA':'tenure'}));
export const allMeasures:Measure[]=[...satisfaction,...operational];
export function measures(family:Family,tenure:Tenure){return (family==='satisfaction'?satisfaction:operational).filter(m=>tenure!=='LCHO'||m.scope!=='LCRA')}
export function measureValue(p:Provider,m:Measure,tenure:Tenure,previous=false):number|null{
 const t=tenure==='LCHO'?'LCHO':'LCRA';
 if(t==='LCHO'&&m.scope==='LCRA')return null;
 return m.key.startsWith('TP')?p.tenures[t][previous?'previous':'scores'][Number(m.key.slice(2))-1]??null:p.operational?.[t]?.[previous?'previous':'values'][m.key]??null;
}
export function projectMeasures(ps:Provider[],family:Family,tenure:Tenure):Provider[]{const ms=measures(family,tenure);return ps.map(p=>({...p,scores:ms.map(m=>measureValue(p,m,tenure)),previous:ms.map(m=>measureValue(p,m,tenure,true))}))}
export const formatMeasure=(v:number|null,unit:string)=>v==null?'—':`${v.toFixed(1)}${unit==='%'?'%':` ${unit}`}`;
export const scopeLabel=(m:Measure,tenure:Tenure)=>m.scope==='combined'?'LCRA + LCHO combined':tenure==='LCHO'?'LCHO':'LCRA';
export function measureBounds(ps:Provider[],m:Measure,tenure:Tenure,mode:string):[number,number]{
 if(m.unit==='%')return mode==='change'?[-100,100]:[0,100];
 const values=ps.map(p=>{const a=measureValue(p,m,tenure),b=measureValue(p,m,tenure,true);return a==null?0:mode==='change'?(b==null?0:Math.abs(a-b)):a});
 const max=Math.max(10,Math.ceil(Math.max(0,...values)/10)*10);return mode==='change'?[-max,max]:[0,max];
}
