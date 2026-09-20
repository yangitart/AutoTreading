const terminal = { symbol:'BTCUSDT', interval:'1h', rows:[], features:null, depth:null, instrument:null, quotes:{}, loading:false, submitting:false, orderAttempt:null, error:'', request:0, tab:'positions', side:'BUY', receivedAt:0, marketStale:false, dataQuality:null, statsRange:'all' };
function terminalTick(tick) {
  const history=[...(terminal.quotes[tick.symbol]?.history||[]),tick.price].slice(-30);
  terminal.quotes[tick.symbol]={price:tick.price,bid:tick.bid,ask:tick.ask,at:tick.fetchedAt || Date.now(),transport:tick.transport,history};
  if(tick.symbol===terminal.symbol) {
    terminal.receivedAt=Date.now(); terminal.marketStale=false;
    const last=terminal.rows.at(-1);
    if(last&&Number.isFinite(Number(tick.price))) { last.close=Number(tick.price); last.high=Math.max(last.high,last.close); last.low=Math.min(last.low,last.close); }
  }
}
function renderDashboard() {
  if(!document.querySelector('#tradingTerminal')) {
    $('#page').innerHTML=`<div id="tradingTerminal">
      <div class="account-strip" id="accountStrip"></div>
      <div id="operationStatus" class="operation-status" role="status"></div>
      <div id="sessionOverview" class="session-overview"></div>
      <div class="trading-grid">
        <section class="terminal-panel chart-panel"><div class="market-toolbar"><span class="asset-emblem" id="assetEmblem">BTC</span><div><small>MERCADO SPOT</small><h2 id="marketName"></h2></div><div class="market-price-block"><strong id="marketPrice">—</strong><span id="barChange"></span></div><span id="quotePair" class="quote-pair">Bid — · Ask —</span><button class="btn icon-button" id="reloadMarket" aria-label="Actualizar mercado" title="Actualizar mercado"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button></div>
          <div class="timeframes">${['15m','1h','4h','1d'].map(i=>`<button data-frame="${i}">${i}</button>`).join('')}<span>Velas japonesas · volumen</span></div><div id="marketIndicators" class="market-indicators"></div>
          <div id="candleStage"></div><div class="market-footer" id="marketFooter"></div>
        </section>
        <aside class="terminal-panel market-list"><div class="panel-heading"><h3>Watchlist</h3><span>SPOT</span></div><div id="watchlist"></div><div class="terminal-divider"></div><div class="panel-heading"><h3>Crear orden</h3><span class="paper-tag">PAPER</span></div><p>Precios de mercado · ejecución virtual</p>
          <div class="side-switch"><button id="buySide" class="selected">Comprar</button><button id="sellSide">Vender</button></div>
          <label class="ticket-label" for="orderType">Tipo de orden</label><select id="orderType"><option value="market">Mercado</option><option value="limit">Limit</option><option value="stop-market">Stop mercado</option><option value="stop-limit">Stop limit</option></select><div id="stopPriceWrap" class="ticket-field-hidden"><label class="ticket-label" for="stopPrice">Precio disparador</label><input id="stopPrice" type="number" min="0" step="any" placeholder="Precio que activa la orden"></div><div id="limitPriceWrap" class="ticket-field-hidden"><label class="ticket-label" for="limitPrice">Precio límite</label><input id="limitPrice" type="number" min="0" step="any" placeholder="Precio máximo/mínimo"></div>
          <label class="ticket-label" for="orderQuantity">Cantidad del activo</label><input id="orderQuantity" type="number" min="0" step="any" placeholder="0.0001">
          <div class="size-shortcuts">${[25,50,100].map(p=>`<button type="button" data-size="${p}" title="${p}% del tamaño permitido por riesgo">${p}%</button>`).join('')}<span>del límite</span></div><small id="instrumentRules" class="subtle"></small>
          <div class="ticket-pair"><div><label class="ticket-label" for="orderStop">Stop loss</label><input id="orderStop" type="number" min="0" step="any" placeholder="Opcional"></div><div><label class="ticket-label" for="orderTarget">Take profit</label><input id="orderTarget" type="number" min="0" step="any" placeholder="Opcional"></div></div>
          <div id="ticketEstimate" class="ticket-estimate">Introduce una cantidad</div><button id="submitTicket" class="order-submit">Revisar compra</button><p class="ticket-note">Capital virtual. Se aplican comisión, deslizamiento y protección configurados.</p>
        </aside>
      </div>
      <div class="terminal-panel portfolio-panel"><div class="portfolio-tabs"><button data-ledger="positions">Posiciones</button><button data-ledger="orders">Órdenes</button><button data-ledger="trades">Operaciones</button><button data-ledger="performance">Rendimiento</button><button data-ledger="agents">Agentes <span class="agent-tab-pulse" aria-hidden="true"></span></button><span id="autoLabel"></span><button class="report-button" id="openAgentsPage">Vista completa</button><button id="exportReport" class="report-button">JSON</button><button id="exportCsv" class="report-button">CSV</button></div><div id="ledgerContent"></div></div>
    </div>`;
    $('#reloadMarket').onclick=()=>loadTerminalMarket();
    $$('[data-frame]').forEach(b=>b.onclick=()=>{terminal.interval=b.dataset.frame;loadTerminalMarket();});
    $$('[data-ledger]').forEach(b=>b.onclick=()=>{terminal.tab=b.dataset.ledger;updateTerminal();});
    $('#exportReport').onclick=async()=>{try{const file=await window.traderAPI.exportPaper();if(file)toast('Reporte JSON exportado');}catch(e){toast(e.message);}};
    $('#exportCsv').onclick=async()=>{try{const file=await window.traderAPI.exportPaperCsv();if(file)toast('Datos CSV exportados');}catch(e){toast(e.message);}};
    $('#openAgentsPage').onclick=()=>navigate('agents');
    $('#buySide').onclick=()=>setTicketSide('BUY'); $('#sellSide').onclick=()=>setTicketSide('SELL');
    $('#orderType').onchange=()=>{ const type=$('#orderType').value; $('#limitPriceWrap').classList.toggle('ticket-field-hidden', !['limit','stop-limit'].includes(type)); $('#stopPriceWrap').classList.toggle('ticket-field-hidden', !type.startsWith('stop')); updateTicket(); }; $('#orderQuantity').oninput=updateTicket; $('#limitPrice').oninput=updateTicket; $('#stopPrice').oninput=updateTicket; $('#orderStop').oninput=updateTicket; $('#orderTarget').oninput=updateTicket; $('#submitTicket').onclick=submitTicket;
    $$('[data-size]').forEach(button=>button.onclick=()=>sizeTicket(Number(button.dataset.size)/100));
    if(!terminal.rows.length&&!terminal.loading) loadTerminalMarket();
  }
  updateTerminal();
}
async function loadTerminalMarket(background = false) {
  const id=++terminal.request, symbol=terminal.symbol, interval=terminal.interval;
  terminal.loading=true; terminal.error=''; if(!background)terminal.rows=[]; updateTerminal();
  try {
    const [result, depth, instrument] = await Promise.all([window.traderAPI.loadMarket({symbol,interval}), window.traderAPI.loadDepth({symbol,limit:10}).catch(() => null), window.traderAPI.loadInstrument(symbol).catch(() => null)]);
    if(id!==terminal.request)return;
    terminal.rows=result.candles; terminal.features=result.features||null; terminal.depth=depth; terminal.dataQuality=result.dataQuality||null; terminal.marketStale=Boolean(result.stale); terminal.receivedAt=Date.now();
    terminal.instrument=instrument;
    subscribeSymbols([symbol]);
  } catch(e) {if(id===terminal.request)terminal.error=e.message;}
  finally {if(id===terminal.request){terminal.loading=false;updateTerminal();}}
}
function updateTerminal() {
  if(!document.querySelector('#tradingTerminal'))return;
  const s=snapshot.state, cash=Number(s.cash), reserved=Number(s.reservedCash||0), invested=s.positions.reduce((n,p)=>n+p.quantity*(p.bid||p.mark||p.entry),0), total=cash+invested, pnl=total-Number(s.initialCash||100), drawdown=s.peakEquity>0?Math.max(0,(s.peakEquity-total)/s.peakEquity*100):0;
  const automationStatus=s.automation?.status||'paused', automationActive=Boolean(snapshot.settings.automationEnabled)&&!['paused','stopped','interrupted','completed-with-errors'].includes(automationStatus);
  const currency=s.currency||snapshot.settings.accountCurrency||'USDT'; $('#accountStrip').innerHTML=[['Equity · '+currency,money(total)],['Libre / reservado',`${money(cash-reserved)} / ${money(reserved)}`],['P&L de sesión',money(pnl)],['Drawdown',`${drawdown.toFixed(2)}%`],['Exposición',`${(total?invested/total*100:0).toFixed(1)}%`]].map(([label,value])=>`<div><small>${label}</small><strong>${value}</strong></div>`).join('')+`<div class="paper-controls"><button id="togglePaper" class="paper-control start">${automationActive?'Pausar agentes':'Iniciar agentes'}</button><button id="pauseEntries" class="paper-control">${s.paused?'Reanudar entradas':'Pausar entradas'}</button><button id="killPaper" class="paper-control danger">Detener todo</button></div>`;
  $('#accountStrip').children[2].querySelector('strong').className=pnl>=0?'positive':'negative';
  $('#accountStrip').children[3].querySelector('strong').className=drawdown>0?'negative':'';
  renderSessionOverview(s);
  $('#marketName').textContent=terminal.symbol.replace('USDT',' / USDT');
  $('#assetEmblem').textContent=terminal.symbol.replace(/USDT|USDC|USD$/g,'');
  const price=terminalPrice(),quote=terminal.quotes[terminal.symbol]; $('#marketPrice').textContent=price?money(price):'—'; $('#quotePair').textContent=quote&&quote.bid&&quote.ask?`Bid ${money(quote.bid)} · Ask ${money(quote.ask)}`:'Bid — · Ask —';
  const candle=terminal.rows.at(-1),barChange=candle?.open?(price/candle.open-1)*100:null;
  $('#barChange').textContent=barChange==null?'':`${barChange>=0?'+':''}${barChange.toFixed(2)}% · vela ${terminal.interval}`;
  $('#barChange').className=barChange>=0?'positive':'negative';
  const f=terminal.features; $('#marketIndicators').innerHTML=f?`<span><b>RSI</b> ${f.rsi14==null?'—':f.rsi14.toFixed(1)}</span><span><b>EMA 12</b> ${f.ema12==null?'—':money(f.ema12)}</span><span><b>EMA 26</b> ${f.ema26==null?'—':money(f.ema26)}</span><span><b>ATR</b> ${f.atr14==null?'—':money(f.atr14)}</span><span><b>VOL</b> ${f.volumeRatio==null?'—':f.volumeRatio.toFixed(2)+'x'}</span><span class="trend-${f.trend}">${f.trend==='bullish'?'TENDENCIA ALCISTA':f.trend==='bearish'?'TENDENCIA BAJISTA':'TENDENCIA —'}</span>`:'Sin indicadores';
  if(terminal.depth) $('#marketIndicators').insertAdjacentHTML('beforeend',`<span><b>BOOK</b> ${terminal.depth.imbalance>=0?'+':''}${Number(terminal.depth.imbalance).toFixed(2)}</span><span><b>SPREAD</b> ${terminal.depth.spreadBps==null?'—':Number(terminal.depth.spreadBps).toFixed(1)+' bps'}</span><span><b>LIQ</b> ${money(Number(terminal.depth.bidLiquidity||0)+Number(terminal.depth.askLiquidity||0))}</span>`);
  $$('[data-frame]').forEach(b=>{b.classList.toggle('selected',b.dataset.frame===terminal.interval);b.disabled=terminal.loading;});
  $('#candleStage').innerHTML=terminal.loading&&!terminal.rows.length?'<div class="chart-empty">Cargando velas del mercado…</div>':terminal.error?`<div class="chart-empty"><strong>No se pudo conectar al mercado</strong><span>${esc(terminal.error)}</span><span>Pulsa Actualizar para reintentar.</span></div>`:candleChart(terminal.rows,terminal.symbol,terminal.interval);
  const fresh=quote&&Date.now()-quote.at<snapshot.settings.maxDataAgeMs;
  $('#liveStatus').textContent=fresh?`${quote.transport==='websocket'?'Stream':'REST · 3 s'} · ${Math.max(0,Math.floor((Date.now()-quote.at)/1000))} s`:'Sin cotización fresca';
  $('#liveStatus').className=fresh?'positive':'negative';
  $('#operationStatus').innerHTML=`<span class="status-pill ${fresh?'healthy':'warning'}">${fresh?'MERCADO DISPONIBLE':'ESPERANDO COTIZACIÓN'}</span><span>${s.paused?esc(s.pauseReason)+' · puedes reducir posiciones.':fresh?'Simulación activa · capital virtual · posiciones vigiladas mientras la app está abierta.':'Las órdenes esperan un bid/ask válido. La conexión se recupera automáticamente.'}</span><button id="verifyAccount" class="report-button">Verificar cuenta</button>`;
  $('#verifyAccount').onclick=async()=>{try{const result=await window.traderAPI.verifyPaper();toast(result.valid?'Cuenta reconciliada: cash, reservas, activos y P&L.':result.issues.join(' · '));}catch(e){toast(e.message);}};
  $('#marketFooter').textContent=terminal.rows.length?`${terminal.rows.length} velas · ${terminal.marketStale?'Caché local · sin cotización fresca':`Última consulta ${new Date(terminal.receivedAt).toLocaleTimeString()} · OHLCV cada 30 s`}`:'Esperando datos de mercado';
  $('#watchlist').innerHTML=['BTCUSDT','ETHUSDT','SOLUSDT'].map(sym=>`<button class="watch-row ${sym===terminal.symbol?'selected':''}" data-market="${sym}"><span class="watch-asset"><b>${sym.replace('USDT','')}</b><small>USDT</small></span><span class="watch-spark">${miniEquity(terminal.quotes[sym]?.history||[],`watch-${sym}`,true)}</span><strong>${terminal.quotes[sym]?money(terminal.quotes[sym].price):sym===terminal.symbol&&price?money(price):'—'}</strong></button>`).join('');
  $$('[data-market]').forEach(b=>b.onclick=()=>{terminal.symbol=b.dataset.market;loadTerminalMarket();});
  $('#togglePaper').onclick=async()=>{if(!automationActive){openAutomationStartModal('dashboard');return;}try{snapshot.state=await window.traderAPI.stopPaperAutomation();snapshot.settings.automationEnabled=false;toast('Auto-Paper pausado');updateTerminal();}catch(e){toast(e.message);}};
  $('#pauseEntries').onclick=async()=>{try{snapshot.state=await (s.paused?window.traderAPI.resumePaper():window.traderAPI.pausePaper());updateTerminal();}catch(e){toast(e.message);}};
  $('#killPaper').onclick=async()=>{if(!confirm('¿Activar kill switch? Se pausarán nuevas entradas y se cancelarán órdenes pendientes.'))return;try{snapshot.state=await window.traderAPI.killPaper();toast('Kill switch activado');updateTerminal();}catch(e){toast(e.message);}};
  $$('[data-ledger]').forEach(b=>b.classList.toggle('selected',b.dataset.ledger===terminal.tab));
  $('#autoLabel').textContent=snapshot.settings.automationEnabled?'Auto-Paper activo':'Auto-Paper pausado';
  $$('[data-ledger]').forEach(button=>{const count=({positions:s.positions.length,orders:s.orders.filter(o=>['accepted','partial'].includes(o.status)).length,trades:s.trades.length})[button.dataset.ledger];button.querySelector('.tab-count')?.remove();if(count!==undefined)button.insertAdjacentHTML('beforeend',`<span class="tab-count">${count}</span>`);});
  $('#ledgerContent').innerHTML=terminal.tab==='positions'?renderPositions(s.positions):terminal.tab==='orders'?renderOrders(s.orders):terminal.tab==='trades'?renderTrades(s.trades):terminal.tab==='agents'?renderAgentTerminalPanel(s):renderStatistics(s,terminal.statsRange,true);
  $$('[data-cancel-order]').forEach(b=>b.onclick=()=>cancelTerminalOrder(b.dataset.cancelOrder));
  $$('[data-close-position]').forEach(b=>b.onclick=async()=>{terminal.symbol=b.dataset.closePosition;await loadTerminalMarket();setTicketSide('SELL');sizeTicket(1);$('#orderQuantity').focus();});
  $('#startAgentsTerminal')?.addEventListener('click', () => openAutomationStartModal('dashboard'));
  $('#statsRange')?.addEventListener('change',()=>{terminal.statsRange=$('#statsRange').value==='all'?'all':Number($('#statsRange').value);updateTerminal();});
  updateTicket();
}
function renderAgentTerminalPanel(s) {
  const automation=s.automation||{}, progress=[...(automation.progress||[])].reverse(), latest=new Map(); progress.forEach(item=>{const key=item.agent||item.phase;if(!latest.has(key))latest.set(key,item);});
  const roster=[['market-data','Mercado'],['technical-agent','Técnico'],['news-agent','Noticias'],['liquidity-agent','Liquidez'],['llm-analyst','Analista LLM'],['critical-agent','Crítico'],['portfolio-agent','Cartera'],['consensus-agent','Consenso'],['risk-governor','Riesgo']];
  const status=automation.status==='running'?'EJECUTANDO':automation.status==='paused'?'PAUSADO':automation.status==='interrupted'?'INTERRUMPIDO':automation.status==='completed-with-errors'?'CON ERRORES':'EN ESPERA';
  const tagClass=value=>['failed','rejected','interrupted'].includes(value)?'sell':['running','caution','degraded','unavailable'].includes(value)?'amber':value==='completed'?'':'idle';
  return `<div class="terminal-agents"><div class="terminal-agents-head"><div><small class="section-kicker">AGENT CONTROL</small><h3>Actividad de agentes</h3><p>${esc(automation.pausedReason||'El consenso propone; Risk Governor decide la ejecución paper.')}</p><button class="btn primary agent-start-action" id="startAgentsTerminal" ${automation.status === 'running' || automation.status === 'starting' ? 'disabled' : ''}>${automation.status === 'running' || automation.status === 'starting' ? 'Agentes activos' : 'Iniciar agentes'}</button></div><span class="tag ${tagClass(automation.status)}">${status}</span></div><div class="terminal-agent-roster">${roster.map(([id,name])=>{const event=latest.get(id), state=event?.status||'idle';return `<div class="terminal-agent-chip"><i class="agent-dot ${tagClass(state)}"></i><div><strong>${esc(name)}</strong><small>${esc(event?.detail||'Sin actividad en esta corrida')}</small></div><span class="tag ${tagClass(state)}">${esc(state)}</span></div>`;}).join('')}</div><div class="terminal-agent-feed">${progress.length?progress.slice(0,12).map(item=>`<div class="agent-activity-row"><span class="tag ${tagClass(item.status)}">${esc(item.status)}</span><strong>${esc(item.agent||item.phase)}</strong><span>${esc(item.symbol||'sistema')} · ${esc(item.detail)}</span><small>${time(item.at)}</small></div>`).join(''):'<div class="empty">No hay eventos todavía. Ejecuta un análisis o inicia Auto-Paper para ver el flujo.</div>'}</div></div>`;
}
function terminalPrice() {const q=terminal.quotes[terminal.symbol];return q&&Date.now()-q.at<15000?q.price:terminal.rows.at(-1)?.close||0;}
async function refreshTerminalDepth() { if(typeof page!=='undefined'&&page==='dashboard'&&typeof window.traderAPI.loadDepth==='function'&&!terminal.loading){ try { terminal.depth=await window.traderAPI.loadDepth({symbol:terminal.symbol,limit:10}); updateTerminal(); } catch { /* preserve the last book and its timestamp */ } } }
async function cancelTerminalOrder(orderId) { try { snapshot.state=await window.traderAPI.cancelPaper(orderId); toast('Orden cancelada'); updateTerminal(); } catch(e) { toast(e.message); } }
function setTicketSide(side) {terminal.side=side;$('#buySide').classList.toggle('selected',side==='BUY');$('#sellSide').classList.toggle('selected',side==='SELL');$('#submitTicket').textContent=side==='BUY'?'Revisar compra':'Revisar venta';updateTicket();}
function updateTicket() {
  const input=$('#orderQuantity');if(!input)return;
  const amount=Number(input.value),price=terminalPrice(),orderType=$('#orderType').value,limit=Number($('#limitPrice').value),stop=Number($('#stopPrice').value),quote=terminal.quotes[terminal.symbol],fresh=quote&&Date.now()-quote.at<snapshot.settings.maxDataAgeMs;
  const effective=['limit','stop-limit'].includes(orderType)&&limit>0?limit:orderType.startsWith('stop')&&stop>0?stop:price;
  const validPrice=orderType==='market'||(orderType==='limit'&&limit>0)||(orderType==='stop-market'&&stop>0)||(orderType==='stop-limit'&&stop>0&&limit>0);
  const fee=amount*effective*snapshot.settings.feeRate, slip=orderType.includes('limit')?0:amount*effective*snapshot.settings.slippageBps/10000;
  $('#ticketEstimate').innerHTML=amount>0&&effective?`<div><span>Valor de la orden</span><strong>${money(amount*effective)}</strong></div><div><span>Comisión estimada</span><b>${money(fee)}</b></div><div><span>Slippage estimado</span><b>${money(slip)}</b></div>`:'<span>Introduce una cantidad o selecciona un porcentaje de tu límite.</span>';
  $('#submitTicket').classList.toggle('sell',terminal.side==='SELL');
  $('#submitTicket').textContent=terminal.submitting?'Procesando…':terminal.side==='BUY'?'Revisar compra':'Revisar venta';
  $('#instrumentRules').textContent=terminal.instrument?`Lote ${qty(terminal.instrument.stepSize)} · mínimo ${money(terminal.instrument.minNotional)} ${terminal.instrument.quoteAsset}`:'Cargando reglas del instrumento…';
  $('#submitTicket').disabled=terminal.submitting||!(amount>0&&price&&fresh&&validPrice&&terminal.instrument&&!(snapshot.state.paused&&terminal.side==='BUY'));
}
async function submitTicket() {
  if(terminal.submitting)return;
  const symbol=terminal.symbol,side=terminal.side,quantity=Number($('#orderQuantity').value),orderType=$('#orderType').value,limitPrice=Number($('#limitPrice').value)||null,stopPrice=Number($('#stopPrice').value)||null,stopLoss=Number($('#orderStop').value)||null,takeProfit=Number($('#orderTarget').value)||null;
  if(!confirm(`¿${side==='BUY'?'Comprar':'Vender'} ${quantity} ${symbol} en SIMULACIÓN? El precio se consultará al ejecutar.`))return;
  $('#submitTicket').disabled=true;
  terminal.submitting=true;
  const request={symbol,side,quantity,orderType,limitPrice,stopPrice,stopLoss,takeProfit}, fingerprint=JSON.stringify(request);
  if(terminal.orderAttempt?.fingerprint!==fingerprint)terminal.orderAttempt={fingerprint,id:crypto.randomUUID()};
  try {snapshot.state=await window.traderAPI.executePaper({...request,clientOrderId:terminal.orderAttempt.id});terminal.orderAttempt=null;toast('Orden registrada en la cuenta simulada');$('#orderQuantity').value='';$('#limitPrice').value='';$('#stopPrice').value='';$('#orderStop').value='';$('#orderTarget').value='';}
  catch(e){terminal.orderAttempt=null;toast(e.message);}finally{terminal.submitting=false;updateTerminal();}
}
function sizeTicket(fraction) {
  const s=snapshot.state,c=snapshot.settings,price=terminalPrice(),step=terminal.instrument?.stepSize;
  if(!price||!step)return;
  const exposure=s.positions.reduce((n,p)=>n+p.quantity*(p.bid||p.mark||p.entry),0),equity=Number(s.cash)+exposure;
  const pending=s.orders.filter(o=>['accepted','partial'].includes(o.status));
  const held=s.positions.find(p=>p.symbol===terminal.symbol);
  let amount;
  if(terminal.side==='SELL')amount=Math.max(0,(held?.quantity||0)-pending.filter(o=>o.side==='SELL'&&o.symbol===terminal.symbol).reduce((n,o)=>n+o.remainingQuantity,0));
  else {
    const cap=Math.min(s.cash-(s.reservedCash||0),equity*c.maxOrderPct/100,equity*c.maxExposurePct/100-exposure,equity*c.maxAssetExposurePct/100-(held?.quantity||0)*price);
    amount=Math.max(0,cap)/(price*(1+c.feeRate+c.slippageBps/10000+c.maxSpreadBps/10000));
    const stop=Number($('#orderStop').value);if(stop>0&&stop<price)amount=Math.min(amount,equity*c.riskPerTradePct/100/(price-stop));
  }
  $('#orderQuantity').value=Number((Math.floor(amount*fraction/step+1e-9)*step).toFixed(12));updateTicket();
}
function miniEquity(values, id, compact=false) {
  const numbers=values.filter(Number.isFinite);
  if(numbers.length<2)return `<div class="spark-empty">${compact?'':'La curva aparecerá con las próximas valoraciones.'}</div>`;
  const w=320,h=compact?30:68,pad=3,lo=Math.min(...numbers),hi=Math.max(...numbers),range=hi-lo||Math.max(1,hi*.001);
  const points=numbers.map((n,i)=>[pad+i/(numbers.length-1)*(w-pad*2),hi===lo?h/2:pad+(hi-n)/range*(h-pad*2)]),path=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '),color=numbers.at(-1)>=numbers[0]?'#46d6a1':'#f07b88';
  return `<svg class="equity-mini" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${compact?'Precios recibidos durante esta sesión':'Evolución del capital'}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${compact?'':`<path d="${path} L${w-pad},${h} L${pad},${h} Z" fill="url(#${id})"/>`}<path d="${path}" fill="none" stroke="${color}" stroke-width="${compact?1.5:2}" vector-effect="non-scaling-stroke"/><circle cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="2.2" fill="${color}"/></svg>`;
}
function renderSessionOverview(s) {
  const stats=computeTradingStats(s), latest=s.lastAnalysis, alerts=(s.alerts||[]).filter(a=>Date.now()-Date.parse(a.createdAt)<3600000).slice(0,2);
  const today=stats.dailyPnl.at(-1)?.pnl??0;
  $('#sessionOverview').innerHTML=`<section class="overview-card equity-card"><div class="overview-heading"><span>CURVA DE CAPITAL</span><b class="${stats.returnPct>=0?'positive':'negative'}">${stats.returnPct>=0?'+':''}${stats.returnPct.toFixed(2)}%</b></div>${miniEquity(stats.history,'session-equity')}<div class="chart-caption"><span>Inicial ${money(s.initialCash)}</span><span>BTC ${stats.benchmarkReturn==null?'N/D':stats.benchmarkReturn.toFixed(2)+'%'}</span></div></section><section class="overview-card"><div class="overview-heading"><span>P&L DIARIO</span><span>${stats.trades} cierres</span></div><div class="daily-result"><strong class="${today>=0?'positive':'negative'}">${money(today)}</strong><small>${stats.dailyPnl.at(-1)?.date||'Sin registros'} · ${esc(s.currency)}</small></div><div class="cost-strip"><span>Comisiones <b>${money(stats.fees)}</b></span><span>API · USD <b>${money(stats.llmCost)}</b></span></div></section><section class="overview-card decision-card"><div class="overview-heading"><span>ÚLTIMA DECISIÓN</span><span class="tag ${latest?.decision==='SELL'?'sell':''}">${esc(latest?.decision||'EN ESPERA')}</span></div><strong>${esc(latest?.symbol||'Tu próxima operación empieza aquí')}</strong><p>${esc(latest?.thesis||'Observa el mercado y prueba una orden manual. Los agentes se activan cuando decidas.')}</p><small>${latest?time(latest.createdAt):'Análisis opcional · control de riesgo independiente'}</small>${alerts.slice(0,1).map(a=>`<div class="compact-alert">${esc(a.message)}</div>`).join('')}</section>`;
}
setInterval(()=>{if(typeof snapshot!=='undefined'&&snapshot&&page==='dashboard')updateTerminal();},1000);
setInterval(()=>{if(typeof page!=='undefined'&&page==='dashboard'&&!terminal.loading)loadTerminalMarket(true);},30000);
setInterval(()=>{refreshTerminalDepth();},15000);
