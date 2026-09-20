/* OHLCV chart: no synthetic prices or interpolated candles. */
function candleChart(rows, symbol, interval) {
  const data = rows.filter(c => ['open','high','low','close','volume','time'].every(k => Number.isFinite(c[k]))).slice(-70);
  if (!data.length) return '<div class="chart-empty">No hay velas disponibles.</div>';
  const w = 960, h = 360, right = 86, top = 25, bottom = 257, volumeTop = 282, volumeBottom = 332;
  let lo = Math.min(...data.map(c => c.low)), hi = Math.max(...data.map(c => c.high));
  const margin = Math.max((hi-lo)*.08, hi*.0001, .000001); lo -= margin; hi += margin;
  const y = p => top + (hi-p)/(hi-lo)*(bottom-top);
  const step = (w-right-16)/data.length, body = Math.max(2,step*.65);
  const vmax = Math.max(1,...data.map(c=>c.volume));
  const fmt = p => p.toLocaleString('en-US',{maximumFractionDigits:p<1?6:2});
  let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="candles" role="img" aria-label="Velas japonesas y volumen de ${symbol}, ${interval}">`;
  for(let i=0;i<=4;i++) { const p=hi-(hi-lo)*i/4, py=y(p); svg+=`<line x1="0" x2="${w-right}" y1="${py}" y2="${py}" class="c-grid"/><text x="${w-right+10}" y="${py+4}" class="c-label">${fmt(p)}</text>`; }
  svg+=`<text x="12" y="278" class="c-label">VOLUMEN</text>`;
  data.forEach((c,i)=>{
    const x=8+(i+.5)*step, color=c.close>=c.open?'#25bd98':'#ef6472', by=Math.min(y(c.open),y(c.close)), bh=Math.max(1,Math.abs(y(c.open)-y(c.close)));
    svg+=`<g class="candle"><title>${new Date(c.time).toISOString()} | O ${fmt(c.open)} H ${fmt(c.high)} L ${fmt(c.low)} C ${fmt(c.close)} | Vol ${fmt(c.volume)}</title><line x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}"/><rect x="${x-body/2}" y="${by}" width="${body}" height="${bh}" fill="${color}"/><rect x="${x-body/2}" y="${volumeBottom-c.volume/vmax*(volumeBottom-volumeTop)}" width="${body}" height="${c.volume/vmax*(volumeBottom-volumeTop)}" fill="${color}" opacity=".35"/></g>`;
    if(i%Math.max(1,Math.floor(data.length/5))===0) svg+=`<text x="${Math.max(58,x)}" y="353" class="c-label" text-anchor="middle">${new Date(c.time).toLocaleString('es',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</text>`;
  });
  const last=data.at(-1), py=y(last.close), color=last.close>=last.open?'#25bd98':'#ef6472';
  svg+=`<line x1="0" x2="${w-right}" y1="${py}" y2="${py}" stroke="${color}" stroke-dasharray="4 4" opacity=".65"/><rect x="${w-right}" y="${py-11}" width="86" height="22" rx="3" fill="${color}"/><text x="${w-right+6}" y="${py+4}" fill="#07120f" font-size="11">${fmt(last.close)}</text></svg>`;
  return svg;
}
if(typeof module!=='undefined') module.exports={candleChart};
