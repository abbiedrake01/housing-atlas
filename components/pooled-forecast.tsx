import {useEffect, useState} from 'react';
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import forecastUrl from '@/data/forecast-ridge-2027.json?url&no-inline';
import {measures, allMeasures} from '@/lib/measures';

type Tenure = 'LCRA' | 'LCHO';
type Prediction = {id:string; name:string; observed:(number|null)[]; prediction:number; thresholdPrediction:number; imputed:string[]};
type ErrorMetrics = {rmse:number; mae:number};
type Model = {
 inputs:string[];
 training:{used:number; eligible:number}[];
 backtest:{n:number; ridge:ErrorMetrics; pairedN:number; pairedRidge:ErrorMetrics|null; persistence:ErrorMetrics|null};
 threshold:{intercept:number; r2:number; ridge:ErrorMetrics; pairedRidge:ErrorMetrics|null};
 intercept:number;
 coefficients:number[];
 fit:{scales:number[]; outcomeScale:number; r2:number; penalty:number; clusters:number; standardErrors:number[]; coefficientSERatios:number[]};
 imputation:Record<string,{mean:number; trainingMissing:number; forecastMissing:number}>;
 predictions:Prediction[];
};
type Models = Record<Tenure, Record<string,Model>>;
const signed = (n:number, digits=2) => `${n>0?'+':''}${n.toFixed(digits)}`;
const effectClass = (n:number) => n>0?'forecast-positive':n<0?'forecast-negative':'forecast-neutral';
const WEAK_EFFECT = 0.05;

export default function PooledForecast() {
 const [models, setModels] = useState<Models|null>(null);
 const [error, setError] = useState(false);
 const [attempt, setAttempt] = useState(0);
 const [tenure, setTenure] = useState<Tenure>('LCRA');
 const [target, setTarget] = useState('TP01');
 const [provider, setProvider] = useState('');
 const [showSmall, setShowSmall] = useState(false);
 const [threshold, setThreshold] = useState(false);
 useEffect(() => {
  const controller = new AbortController();
  setError(false);
  fetch(forecastUrl, {signal:controller.signal})
   .then(response => {
    if (!response.ok) throw new Error('Forecast data unavailable');
    return response.json() as Promise<Models>;
   })
   .then(data => {
    if (!data.LCRA?.TP01?.fit?.penalty || !data.LCHO?.TP01?.fit?.penalty) {
     throw new Error('Unexpected forecast data version');
    }
    return data;
   })
   .then(setModels)
   .catch(() => { if (!controller.signal.aborted) setError(true); });
  return () => controller.abort();
 }, [attempt]);

 const satisfaction = measures('satisfaction', tenure);
 const operational = measures('operational', tenure);
 const catalog = [...satisfaction, ...operational];
 const outcome = catalog.find(m => m.key===target) ?? catalog[0];
 const model = models?.[tenure][outcome.key];
 const errorUnit = outcome.unit==='%' ? 'pp' : outcome.unit;
 const format = (n:number|null) => n===null?'—':`${n.toFixed(1)}${outcome.unit==='%'?'%':` ${outcome.unit}`}`;
 const coefficients = model ? model.inputs.map((key,index)=>({
  key, index:index+1, beta:model.coefficients[index],
  standardized:model.coefficients[index]*model.fit.scales[index]/model.fit.outcomeScale,
 })).sort((a,b)=>Math.abs(b.standardized)-Math.abs(a.standardized)) : [];
 const hidden = coefficients.filter(row=>Math.abs(row.standardized)<WEAK_EFFECT).length;
 const scale = Math.max(WEAK_EFFECT,...coefficients.map(row=>Math.abs(row.standardized)));
 const selected = model?.predictions.find(p => p.id===provider);
 const cohort = selected ? [selected] : model?.predictions ?? [];
 const average = (values:number[]) => values.length ? values.reduce((sum,v)=>sum+v,0)/values.length : null;
 const projection = average(cohort.map(p=>threshold?p.thresholdPrediction:p.prediction));
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
   <div className="eyebrow">ONE-YEAR-AHEAD RIDGE MODEL</div>
   <h1>2027 TSM projections</h1>
   <p>Forecast a satisfaction or operational measure for the year ending March 2027.</p>
  </div></div>
  <div className="corr-controls forecast-controls pooled-controls">
   <label className="corr-control">Housing type
    <select value={tenure} onChange={e=>{setTenure(e.target.value as Tenure);setTarget('TP01');setProvider('')}}>
     <option value="LCRA">LCRA · rental</option><option value="LCHO">LCHO · ownership</option>
    </select>
   </label>
   <label className="corr-control">Outcome to predict
    <select value={outcome.key} onChange={e=>setTarget(e.target.value)}>
     {[{label:'Tenant satisfaction',items:satisfaction},{label:'Operational measures',items:operational}].map(group=>
      <optgroup key={group.label} label={group.label}>
       {group.items.map(m=><option key={m.key} value={m.key}>{m.key} · {m.label}</option>)}
      </optgroup>)}

    </select>
   </label>
   <label className="corr-control">Association
    <select value={provider} disabled={!model} onChange={e=>setProvider(e.target.value)}>
     <option value="">Forecast cohort average ({model?.predictions.length ?? 0})</option>
     {model?.predictions.map(p=><option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
    </select>
   </label>
  </div>
  <label className="forecast-small-effects"><input type="checkbox" checked={threshold} onChange={e=>setThreshold(e.target.checked)}/> Zero standardized coefficients below 0.05 in absolute value</label>
  {error ? <p role="alert">Couldn’t load the ridge forecasts. <button className="forecast-retry" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>
  : !model || projection===null ? <p role="status">Loading forecasts…</p>
  : <>
   <div className="reg-stats forecast-stats">
    <div><span>2026/27 projection</span><strong>{format(projection)}</strong><p>{selected?.name ?? 'Forecast cohort average'}</p></div>
    <div><span>2025/26 observed</span><strong>{format(current)}</strong><p>{current!==null && history[2].n===cohort.length ? `${signed(projection-current,1)} ${errorUnit} projected change` : `Published for ${history[2].n} of ${cohort.length}`}</p></div>
    <div><span>Training observations</span><strong>{model.training.reduce((total,p)=>total+p.used,0)}</strong><p>{model.training[0].used} in 2024→25 · {model.training[1].used} in 2025→26</p></div>
   </div>
   <section className="reg-card">
    <div className="reg-card-heading"><div><h2>{outcome.key} · {outcome.label}</h2><p>Published scores and the one-year-ahead estimate.</p></div></div>
    {outcome.scope==='combined' && <p className="reg-footnote">Published across LCRA and LCHO combined. The selected tenure determines the provider cohort and predictors.</p>}
    <div style={{height:320}}><ResponsiveContainer width="100%" height="100%">
     <LineChart data={rows} margin={{left:8,right:24,top:8,bottom:8}}>
      <CartesianGrid strokeDasharray="3 3"/>
      <XAxis dataKey="year"/>
      <YAxis type="number" domain={['auto','auto']} tickFormatter={v=>outcome.unit==='%'?`${v}%`:String(v)} label={outcome.unit==='%'?undefined:{value:outcome.unit,angle:-90,position:'insideLeft',fontSize:11}}/>
      <Tooltip formatter={v=>format(Number(v))}/>
      <Legend/>
      <Line dataKey="observed" name="Published score" stroke="#013d5b" strokeWidth={2} dot={{r:5}} isAnimationActive={false}/>
      <Line dataKey="forecast" name="Projection" stroke="#ca2c27" strokeWidth={2} strokeDasharray="6 4" dot={{r:5}} isAnimationActive={false}/>
     </LineChart>
    </ResponsiveContainer></div>
    {!selected && <p className="reg-footnote">Associations are equally weighted. Historical means use the available scores within this forecast cohort ({history.map(r=>r.n).join(', ')} providers by year).</p>}
    {selected && selected.imputed.length>0 && <p className="reg-footnote">Training averages substituted for {selected.imputed.join(', ')} in this forecast.</p>}
    {(projection<0 || (outcome.unit==='%' && projection>100)) && <p className="reg-footnote">The unconstrained model returned a value outside the valid range for this measure.</p>}
   </section>
   <section className="reg-card forecast-backtest">
    <h2>Backtest RMSE by measure</h2>
    <p>Train and tune on 2024→2025, then predict 2025→2026. Each row uses the measure’s own units. {threshold && "Showing errors after zeroing small effects."} The paired comparison uses only providers with a published previous value, so both methods are scored on the same rows. Negative paired change favours ridge.</p>
    <div className="forecast-table-wrap">
     <table className="forecast-table forecast-errors">
      <thead><tr><th scope="col">Outcome</th><th scope="col">Error unit</th><th scope="col">Test n</th><th scope="col">Ridge RMSE</th><th scope="col">Paired n</th><th scope="col">Paired ridge</th><th scope="col">Carry forward</th><th scope="col">Paired change</th></tr></thead>
      <tbody>{catalog.map(measure=>{
       const candidate=models?.[tenure][measure.key];
       if(!candidate)return null;
       const stats=candidate.backtest;
       const results=threshold?candidate.threshold:stats;
       const change=results.pairedRidge&&stats.persistence ? results.pairedRidge.rmse-stats.persistence.rmse : null;
       return <tr key={measure.key} className={measure.key===outcome.key?'forecast-active-row':undefined}>
        <th scope="row"><button type="button" className="forecast-outcome-button" aria-pressed={measure.key===outcome.key} onClick={()=>setTarget(measure.key)}>{measure.key} · {measure.label}</button></th>
        <td>{measure.unit==='%'?'pp':measure.unit}</td><td>{stats.n}</td><td><strong>{results.ridge.rmse.toFixed(2)}</strong></td>
        <td>{stats.pairedN}</td><td>{results.pairedRidge?.rmse.toFixed(2)??'—'}</td><td>{stats.persistence?.rmse.toFixed(2)??'—'}</td>
        <td className={change===null?undefined:effectClass(-change)}>{change===null?'—':signed(change)}</td>
       </tr>;
      })}</tbody>
     </table>
    </div>
   </section>
   <details className="reg-method">
    <summary>Model specification and coefficients</summary>
    <div>
     <div className="forecast-fit-metrics">
      <span><small>In-sample R²</small><strong>{(threshold?model.threshold.r2:model.fit.r2).toFixed(3)}</strong></span>
      <span><small>Ridge λ</small><strong>{Number(model.fit.penalty.toPrecision(3))}</strong></span>
      <span><small>Provider clusters</small><strong>{model.fit.clusters}</strong></span>
     </div>
     <p>Ridge minimizes mean squared error plus λ times the sum of squared standardized coefficients. The intercept is unpenalized. Five-fold provider-grouped cross-validation on 2024→2025 selects λ, which is then kept fixed when fitting both transitions. Scaling and imputation are learned within each training split. Each provider-year transition receives equal weight, matched by registration code and tenure. The backtest learns replacement averages from the first transition only. The 2027 forecast uses means from the pooled fit. Missing operational values are filled feature by feature. TP inputs and the training outcome must be present. RP measures apply to rental only. Safety and ASB forecasts also use the outcome’s own prior-year value.</p>
     <p>Standard errors refer to the full ridge fit and use a provider-clustered sandwich estimate. Coefficient ÷ SE is descriptive because ridge shrinks estimates and λ is selected from data. Region, housing mix, survey changes and mergers are unadjusted.</p>
     <p>Standardized effects compare one predictor standard deviation with one outcome standard deviation. Blue indicates a positive effect and red a negative effect. Effects below 0.05 in absolute value are hidden by default. The zeroing option applies the cutoff after ridge fitting and adjusts the intercept to preserve the fitted mean. The error table updates to reflect the chosen model.</p>
     <label className="forecast-small-effects"><input type="checkbox" checked={showSmall} onChange={e=>setShowSmall(e.target.checked)}/> Show small effects ({hidden})</label>
     <div className="forecast-table-wrap">
      <table className="forecast-table">
       <thead><tr><th scope="col">Predictor</th><th scope="col">Standardized effect</th><th scope="col">Raw coefficient</th><th scope="col">Clustered SE</th><th scope="col">Coefficient ÷ SE</th><th scope="col">Imputation mean</th><th scope="col">Filled · fit / forecast</th></tr></thead>
       <tbody>
        <tr><th scope="row">Intercept</th><td>—</td><td>{(threshold?model.threshold.intercept:model.intercept).toFixed(3)}</td><td>{threshold?'—':model.fit.standardErrors[0].toFixed(3)}</td><td>{threshold?'—':model.fit.coefficientSERatios[0].toFixed(2)}</td><td>—</td><td>—</td></tr>
        {coefficients.filter(row=>showSmall||Math.abs(row.standardized)>=WEAK_EFFECT).map(({key,index,beta,standardized})=>{
         const measure=allMeasures.find(m=>m.key===key);
         const imputation=model.imputation[key];
         const zeroed=threshold && Math.abs(standardized)<WEAK_EFFECT;
         const effect=zeroed?0:standardized;
         return <tr key={key}>
          <th scope="row">{measure ? `${key} · ${measure.label} (${measure.unit})` : key}</th>
          <td className={effectClass(effect)}><span className="forecast-effect"><span className="forecast-effect-track" aria-hidden="true"><i style={{width:`${Math.abs(effect)/scale*50}%`,[effect>=0?'left':'right']:'50%'}}/></span>{signed(effect,3)}</span></td>
          <td>{zeroed?'0.000':beta.toFixed(3)}</td>
          <td>{zeroed?'—':model.fit.standardErrors[index].toFixed(3)}</td>
          <td>{zeroed?'—':model.fit.coefficientSERatios[index].toFixed(2)}</td>
          <td>{imputation?.mean.toFixed(2)??'—'}</td>
          <td>{imputation?`${imputation.trainingMissing} / ${imputation.forecastMissing}`:'—'}</td>
         </tr>;
        })}
       </tbody>
      </table>
     </div>
     <p>Raw coefficients are in {errorUnit} of outcome per unit of predictor. Training coverage was {model.training[0].used}/{model.training[0].eligible} for 2024→2025 and {model.training[1].used}/{model.training[1].eligible} for 2025→2026.</p>
    </div>
   </details>
  </>}
 </div>;
}
