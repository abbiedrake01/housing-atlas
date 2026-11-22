import {useEffect, useMemo, useState} from 'react';
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import years from '@/data/years.json';
import {annualTrend} from '@/lib/trend';
import type {Provider} from '@/lib/analysis';

const history = [...years].sort((a,b) => a.stockYear - b.stockYear);
const pct = (n: number) => `${n.toFixed(1)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
type Tenure = 'LCRA' | 'LCHO';

export default function Forecast() {
 const [snapshots, setSnapshots] = useState<Provider[][] | null>(null);
 const [error, setError] = useState(false);
 const [attempt, setAttempt] = useState(0);
 const [tenure, setTenure] = useState<Tenure>('LCRA');
 const [provider, setProvider] = useState('');
 useEffect(() => {
  const controller = new AbortController();
  setError(false);
  Promise.all(history.map(async year => {
   const response = await fetch(`${import.meta.env.BASE_URL}${year.housing}`, {signal: controller.signal});
   if (!response.ok) throw new Error('Could not load annual data');
   return (await response.json() as {providers: Provider[]}).providers;
  })).then(setSnapshots).catch(() => {if (!controller.signal.aborted) setError(true)});
  return () => controller.abort();
 }, [attempt]);

 const cohort = useMemo(() => {
  if (!snapshots) return [];
  const lookup = snapshots.map(rows => new Map(rows.map(p => [p.id, p])));
  return snapshots[2].flatMap(p => {
   const scores = lookup.map(year => year.get(p.id)?.tenures[tenure].scores[0]);
   if (!scores.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return [];
   return [{id:p.id, name:p.name, scores}];
  }).sort((a,b) => a.name.localeCompare(b.name));
 }, [snapshots, tenure]);

 const selected = cohort.find(p => p.id === provider);
 const scores = selected?.scores ?? history.map((_,i) => cohort.reduce((sum,p) => sum + p.scores[i],0) / cohort.length);
 const fit = annualTrend(scores);
 const rows = fit ? [
  ...history.map((year,i) => ({year:year.label, observed:scores[i], fitted:fit.fitted[i], projection:i===2?fit.fitted[i]:null})),
  {year:'2026/27', observed:null, fitted:null, projection:fit.projected},
 ] : [];

 return <div className="regression-page forecast-page">
  <div className="reg-heading"><div>
   <div className="eyebrow">TP01 · OVERALL SATISFACTION</div>
   <h1>2027 satisfaction projections</h1>
   <p>Extrapolate the 2023/24–2025/26 trend to the reporting year ending March 2027.</p>
  </div></div>
  <div className="corr-controls forecast-controls">
   <label className="corr-control">Housing type
    <select value={tenure} onChange={e=>{setTenure(e.target.value as Tenure);setProvider('')}}>
     <option value="LCRA">LCRA · rental</option><option value="LCHO">LCHO · ownership</option>
    </select>
   </label>
   <label className="corr-control">Association
    <select value={provider} disabled={!cohort.length} onChange={e=>setProvider(e.target.value)}>
     <option value="">Matched cohort average ({cohort.length})</option>
     {cohort.map(p=><option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
    </select>
   </label>
  </div>
  {error ? <p role="alert">Couldn’t load the three annual datasets. <button className="forecast-retry" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>
  : !snapshots ? <p role="status">Loading three annual datasets…</p>
  : fit ? <>
   <div className="reg-stats forecast-stats">
    <div><span>2026/27 projection</span><strong>{pct(fit.projected)}</strong><p>{selected?.name ?? 'Matched cohort average'}</p></div>
    <div><span>2025/26 observed</span><strong>{pct(scores[2])}</strong><p>Latest published year</p></div>
    <div><span>Annual fitted trend</span><strong>{signed(fit.slope)}<small>pp/year</small></strong><p>Three annual observations</p></div>
   </div>
   <section className="reg-card">
    <div className="reg-card-heading"><div><h2>Observed scores and extrapolation</h2><p>Hover the chart for annual values.</p></div></div>
    <div style={{height:320}}><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{left:8,right:24,top:8,bottom:8}}>
     <CartesianGrid strokeDasharray="3 3"/>
     <XAxis dataKey="year"/>
     <YAxis type="number" domain={['auto','auto']} tickFormatter={v=>`${v}%`}/>
     <Tooltip formatter={v=>pct(Number(v))}/>
     <Legend/>
     <Line dataKey="observed" name="Observed TP01" stroke="#013d5b" strokeWidth={2} dot={{r:5}} isAnimationActive={false}/>
     <Line dataKey="fitted" name="Fitted trend" stroke="#356785" strokeWidth={2} dot={false} isAnimationActive={false}/>
     <Line dataKey="projection" name="Extrapolated trend" stroke="#ca2c27" strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false}/>
    </LineChart></ResponsiveContainer></div>
    { (fit.projected < 0 || fit.projected > 100) && <p className="reg-footnote">The straight line extrapolates beyond the valid 0–100% range here. The raw result is shown to make that failure visible.</p> }
   </section>
  </> : <p>No associations have all three published scores for this tenure.</p>}
  <p className="reg-footnote">Ordinary least squares on three equally spaced years. Includes only associations with a published TP01 score under the same registration code and tenure in all three releases. The cohort average weights associations equally. Changes in group structure, tenant mix, region and survey methods are unadjusted. With three annual observations, treat the estimate as an exploratory baseline.</p>
 </div>;
}
