function computeTradingStats(data, rangeDays = 'all') {
  const initial = Number(data.initialCash) || 100, now = Date.now();
  const all = (data.equityHistory || []).filter(p => Number.isFinite(p.value)).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const cutoff = rangeDays === 'all' ? 0 : now - Number(rangeDays)*86400000;
  const anchor = cutoff ? all.filter(p=>Date.parse(p.time)<cutoff).at(-1) : null;
  const history = [...(anchor?[anchor]:[]),...all.filter(p=>Date.parse(p.time)>=cutoff)];
  const cash=Number(data.cash||0),exposure=(data.positions||[]).reduce((n,p)=>n+p.quantity*(p.bid||p.mark||p.entry),0),current=cash+exposure;
  const base=cutoff?(history[0]?.value??current):initial,values=history.map(p=>p.value);
  if(!values.length)values.push(base);if(values.at(-1)!==current)values.push(current);
  const trades=(data.trades||[]).filter(t=>Date.parse(t.createdAt)>=cutoff),sells=trades.filter(t=>t.side==='SELL');
  // Aggregate partial exit fills from the same order before counting outcomes.
  const groups=new Map();sells.forEach((t,i)=>{const id=t.id||`fill-${i}`;groups.set(id,(groups.get(id)||0)+Number(t.netPnl??t.realizedPnl??0));});
  const outcomes=[...groups.values()],wins=outcomes.filter(v=>v>0),losses=outcomes.filter(v=>v<0),sum=a=>a.reduce((n,v)=>n+v,0);
  const winTotal=sum(wins),lossTotal=-sum(losses),netPnl=sum(outcomes),grossPnl=sum(sells.map(t=>Number(t.grossPnl??t.realizedPnl??0)));
  const fees=sum(trades.map(t=>Number(t.fee||0))),turnover=sum(trades.map(t=>Number(t.notional||0)));
  const llmCost=Number(data.llmTotalCostUsd??data.llmUsage?.estimatedCostUsd??0);
  let peak=base,peakIndex=0,underwater=null,maxDuration=0,maxRecovery=0;
  const drawdowns=values.map((value,i)=>{if(value>=peak){if(underwater!==null)maxRecovery=Math.max(maxRecovery,i-underwater);peak=value;peakIndex=i;underwater=null;}else{underwater??=peakIndex;maxDuration=Math.max(maxDuration,i-peakIndex);}return peak?Math.max(0,(peak-value)/peak*100):0;});
  const daily=new Map();history.forEach(p=>{const date=p.time.slice(0,10);daily.set(date,p.value);});
  let previous=base;
  const dailyPnl=[...daily.entries()].map(([date,last])=>{const pnl=last-previous,returnPct=previous?pnl/previous*100:0;previous=last;return{date,pnl,returnPct};});
  const today=new Date(now).toISOString().slice(0,10);
  const returns=dailyPnl.filter(d=>d.date<today).map(d=>d.returnPct/100),mean=returns.length?sum(returns)/returns.length:0;
  const std=returns.length>=30?Math.sqrt(sum(returns.map(v=>(v-mean)**2))/(returns.length-1)):null;
  const downside=returns.length>=30?Math.sqrt(sum(returns.map(v=>Math.min(0,v)**2))/returns.length):null;
  const periodReturn=timestamp=>{const p=all.filter(p=>Date.parse(p.time)<=timestamp).at(-1);return p?.value?(current-p.value)/p.value*100:null;};
  const benchmark=cutoff?null:(data.benchmark?.startPrice&&data.benchmark?.currentPrice?(data.benchmark.currentPrice/data.benchmark.startPrice-1)*100:null);
  const returnPct=base?(current-base)/base*100:0,exposureSeries=history.map(p=>p.value>0?Number(p.exposure||0)/p.value*100:0);
  return {initial:base,current,cash,exposure,exposurePct:current?exposure/current*100:0,maxExposurePct:Math.max(0,...exposureSeries),avgExposurePct:exposureSeries.length?sum(exposureSeries)/exposureSeries.length:0,grossPnl,netPnl,llmCost,returnPct,
    netAfterLlmPct:data.currency&&data.currency!=='USD'?null:(current-base-llmCost)/base*100,
    benchmarkReturn:benchmark,alpha:benchmark==null?null:returnPct-benchmark,returnToday:periodReturn(Date.parse(today+'T00:00:00Z')),return7:periodReturn(now-7*86400000),return30:periodReturn(now-30*86400000),
    trades:outcomes.length,winRate:outcomes.length?wins.length/outcomes.length*100:null,avgWin:wins.length?winTotal/wins.length:null,avgLoss:losses.length?lossTotal/losses.length:null,
    maxDrawdown:Math.max(0,...drawdowns),maxDrawdownPoints:maxDuration,maxDrawdownDurationPoints:maxDuration,maxRecoveryPoints:maxRecovery,fees,turnover,profitFactor:lossTotal?winTotal/lossTotal:null,expectancy:outcomes.length?netPnl/outcomes.length:null,
    volatility:std==null?null:std*Math.sqrt(365)*100,sharpe:std?mean/std*Math.sqrt(365):null,sortino:downside?mean/downside*Math.sqrt(365):null,history:values,drawdowns,dailyPnl};
}
if(typeof module!=='undefined')module.exports={computeTradingStats};
