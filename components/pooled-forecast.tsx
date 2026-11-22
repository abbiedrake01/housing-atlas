import {useEffect, useState} from 'react';
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {measures, allMeasures} from '@/lib/measures';

type Tenure = 'LCRA' | 'LCHO';
type Prediction = {id:string; name:string; observed:(number|null)[]; prediction:number; imputed:string[]};
type Model = {
 inputs:string[];
 training:{used:number; eligible:number}[];
 backtest:{n:number; linear:{rmse:number; mae:number}; persistence:{rmse:number; mae:number}};
 intercept:number;
 coefficients:number[];
 fit:{r2:number; adjustedR2:number; clusters:number; standardErrors:number[]; tStats:number[]};
 imputation:Record<string,{mean:number; trainingMissing:number; forecastMissing:number}>;
 predictions:Prediction[];
};
type Models = Record<Tenure, Record<string,Model>>;
const pct = (value:number) => `${value.toFixed(1)}%`;

export default function PooledForecast() {
 const [models, setModels] = useState<Models|null>(null);
 const [error, setError] = useState(false);
 const [attempt, setAttempt] = useState(0);
 const [tenure, setTenure] = useState<Tenure>('LCRA');
 const [target, setTarget] = useState('TP01');
 const [provider, setProvider] = useState('');
 useEffect(() => {
  const controller = new AbortController();
  setError(false);
  fetch(`${import.meta.env.BASE_URL}forecast-2027.json`, {signal:controller.signal})
   .then(response => {
    if (!response.ok) throw new Error('Forecast data unavailable');
    return response.json() as Promise<Models>;
   })
   .then(setModels)
   .catch(() => { if (!controller.signal.aborted) setError(true); });
  return () => controller.abort();
 }, [attempt]);

 const catalog = measures('satisfaction', tenure);
 const outcome = catalog.find(m => m.key===target) ?? catalog[0];
 const model = models?.[tenure][outcome.key];
 const selected = model?.predictions.find(p => p.id===provider);
 const cohort = selected ? [selected] : model?.predictions ?? [];
 const average = (values:number[]) => values.length ? values.reduce((sum,v)=>sum+v,0)/values.length : null;
 const projection = average(cohort.map(p=>p.prediction));
 const history = ['2023/24','2024/25','2025/26'].map((year,i)=>{
  const values = cohort.flatMap(p=>p.observed[i]===null ? [] : [p.observed[i]!]);
  return {year, observed:average(values), n:values.length, forecast:null};
 });
 const current = history[2].observed;
 const rows = [
  ...history.slice(0,2),
  {...history[2], forecast:current},
  {year:'2026/27', observed:null, n:cohort.length, forecast:projection},
 ];

 return <div className="regression-page forecast-page">
  <div className="reg-heading"><div>
   <div className="eyebrow">ONE-YEAR-AHEAD LINEAR MODEL</div>
   <h1>2027 satisfaction projections</h1>
   <p>Use a provider’s prior-year TP, repairs and complaints measures to estimate one selected TP score.</p>
  </div></div>
  <div className="corr-controls forecast-controls pooled-controls">
   <label className="corr-control">Housing type
    <select value={tenure} onChange={e=>{setTenure(e.target.value as Tenure);setTarget('TP01');setProvider('')}}>
     <option value="LCRA">LCRA · rental</option><option value="LCHO">LCHO · ownership</option>
    </select>
   </label>
   <label className="corr-control">Outcome to predict
    <select value={outcome.key} onChange={e=>setTarget(e.target.value)}>
     {catalog.map(m=><option key={m.key} value={m.key}>{m.key} · {m.label}</option>)}
    </select>
   </label>
   <label className="corr-control">Association
    <select value={provider} disabled={!model} onChange={e=>setProvider(e.target.value)}>
     <option value="">Forecast cohort average ({model?.predictions.length ?? 0})</option>
     {model?.predictions.map(p=><option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
    </select>
   </label>
  </div>
  {error ? <p role="alert">Couldn’t load the linear forecasts. <button className="forecast-retry" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>
  : !model || projection===null || current===null ? <p role="status">Loading forecasts…</p>
  : <>
   <div className="reg-stats forecast-stats">
    <div><span>2026/27 projection</span><strong>{pct(projection)}</strong><p>{selected?.name ?? 'Forecast cohort average'}</p></div>
    <div><span>2025/26 observed</span><strong>{pct(current)}</strong><p>{(projection-current).toLocaleString('en-GB',{maximumFractionDigits:1,signDisplay:'exceptZero'})} pp projected change</p></div>
    <div><span>Training observations</span><strong>{model.training.reduce((total,p)=>total+p.used,0)}</strong><p>{model.training[0].used} in 2024→25 · {model.training[1].used} in 2025→26</p></div>
   </div>
   <section className="reg-card">
    <div className="reg-card-heading"><div><h2>{outcome.key} · {outcome.label}</h2><p>Published scores and the one-year-ahead estimate.</p></div></div>
    <div style={{height:320}}><ResponsiveContainer width="100%" height="100%">
     <LineChart data={rows} margin={{left:8,right:24,top:8,bottom:8}}>
      <CartesianGrid strokeDasharray="3 3"/>
      <XAxis dataKey="year"/>
      <YAxis type="number" domain={['auto','auto']} tickFormatter={v=>`${v}%`}/>
      <Tooltip formatter={v=>pct(Number(v))}/>
      <Legend/>
      <Line dataKey="observed" name="Published score" stroke="#013d5b" strokeWidth={2} dot={{r:5}} isAnimationActive={false}/>
      <Line dataKey="forecast" name="Projection" stroke="#ca2c27" strokeWidth={2} strokeDasharray="6 4" dot={{r:5}} isAnimationActive={false}/>
     </LineChart>
    </ResponsiveContainer></div>
    {!selected && <p className="reg-footnote">Associations are equally weighted. Historical means use the available scores within this forecast cohort ({history.map(r=>r.n).join(', ')} providers by year).</p>}
    {selected && selected.imputed.length>0 && <p className="reg-footnote">Training averages substituted for {selected.imputed.join(', ')} in this forecast.</p>}
    {(projection<0 || projection>100) && <p className="reg-footnote">The unconstrained model returned a value outside the valid 0–100% range.</p>}
   </section>
   <section className="reg-card forecast-backtest">
    <h2>How well did it predict 2025/26?</h2>
    <p>Fit on 2024→2025 only, then tested on 2025→2026 across {model.backtest.n} provider transitions. The comparison forecasts each provider’s previous score on the same test rows.</p>
    <p><strong>{model.backtest.linear.rmse.toFixed(2)} pp</strong> linear model RMSE · <strong>{model.backtest.persistence.rmse.toFixed(2)} pp</strong> previous score RMSE</p>
   </section>
   <details className="reg-method">
    <summary>Model specification and coefficients</summary>
    <div>
     <p>In-sample R² {model.fit.r2.toFixed(3)} · Adjusted R² {model.fit.adjustedR2.toFixed(3)} · {model.fit.clusters} provider clusters</p>
     <p>Ordinary least squares with an intercept. Each provider-year transition receives equal weight, matched by registration code and tenure. The backtest learns replacement averages from the first transition only. The 2027 forecast uses means from the pooled fit. Missing operational values are filled feature by feature. TP inputs and the training outcome must be present. RP measures apply to rental only.</p>
     <p>Standard errors are clustered by provider (CR1) to account for repeat observations. The t-statistics are coefficient ÷ standard error, conditional on the filled-in data. Region, housing mix, survey changes and mergers are unadjusted.</p>
     <div className="forecast-table-wrap">
      <table className="forecast-table">
       <thead><tr><th scope="col">Predictor</th><th scope="col">Coefficient</th><th scope="col">Clustered SE</th><th scope="col">t-statistic</th><th scope="col">Imputation mean</th><th scope="col">Filled · fit / forecast</th></tr></thead>
       <tbody>
        {['Intercept',...model.inputs].map((key,i)=>{
         const measure=allMeasures.find(m=>m.key===key);
         const imputation=model.imputation[key];
         return <tr key={key}>
          <th scope="row">{measure ? `${key} · ${measure.label} (${measure.unit})` : key}</th>
          <td>{(i===0?model.intercept:model.coefficients[i-1]).toFixed(3)}</td>
          <td>{model.fit.standardErrors[i].toFixed(3)}</td>
          <td>{model.fit.tStats[i].toFixed(2)}</td>
          <td>{imputation?.mean.toFixed(2)??'—'}</td>
          <td>{imputation?`${imputation.trainingMissing} / ${imputation.forecastMissing}`:'—'}</td>
         </tr>;
        })}
       </tbody>
      </table>
     </div>
     <p>Coefficients show the forecast change in percentage points per one unit of the predictor. Training coverage was {model.training[0].used}/{model.training[0].eligible} for 2024→2025 and {model.training[1].used}/{model.training[1].eligible} for 2025→2026.</p>
    </div>
   </details>
  </>}
 </div>;
}
