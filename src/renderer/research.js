const researchState = { report: null, running: false, experiments: [], agentEvaluation: null, researchReport: null };

function renderResearchReport(result) {
  const root = $('#researchReport'); if (!root) return;
  const rows = (result.groups || []).map(group => { const backtest = group.type === 'backtest'; const evidence = backtest ? `${group.returnPct == null ? 'N/D' : `${group.returnPct >= 0 ? '+' : ''}${group.returnPct.toFixed(2)}%`} · test ${group.testReturnPct == null ? 'N/D' : `${group.testReturnPct >= 0 ? '+' : ''}${group.testReturnPct.toFixed(2)}%`}` : `${group.calls} análisis · ${money(group.totalCostUsd)}`; return `<tr><td>${esc(group.strategy)}</td><td>${esc(group.model || 'N/D')}</td><td>${esc(group.promptVersion || 'N/D')}</td><td>${esc(group.symbol)} · ${esc(group.interval)}</td><td>${group.period ? `${time(group.period.startAt)} · ${time(group.period.endAt)}` : 'N/D'}</td><td>${evidence}</td></tr>`; }).join('');
  root.innerHTML = `<div class="card-header"><div><p class="section-kicker">RESEARCH REPORT</p><h2>Informe por estrategia y contexto</h2><p>${result.groupCount} grupos · generado ${time(result.generatedAt)} · capital base ${money(result.initialCash)}.</p></div><button class="btn" id="generateResearchReport">Actualizar informe</button></div><p class="subtle">El modelo y prompt se muestran como metadatos de trazabilidad; los resultados no implican rentabilidad futura.</p>${rows ? `<table class="table"><thead><tr><th>ESTRATEGIA</th><th>MODELO</th><th>PROMPT</th><th>UNIVERSO</th><th>PERIODO</th><th>EVIDENCIA</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No hay backtests ni análisis suficientes para agrupar todavía.</p>'}`;
  bindResearchReport();
}

async function runResearchReport() {
  const button = $('#generateResearchReport'); if (!button) return; button.disabled = true; try { researchState.researchReport = await window.traderAPI.researchReport(); renderResearchReport(researchState.researchReport); } catch (error) { toast(error.message); } finally { $('#generateResearchReport')?.removeAttribute('disabled'); }
}

function bindResearchReport() { $('#generateResearchReport')?.addEventListener('click', runResearchReport); }

function mountResearchReportControls() {
  setTimeout(() => {
    if (page !== 'research' || !$('#page') || $('#researchReport')) return;
    const section = document.createElement('section'); section.id = 'researchReport'; section.className = 'card settings-card'; section.innerHTML = '<div class="card-header"><div><p class="section-kicker">RESEARCH REPORT</p><h2>Informe por estrategia y contexto</h2><p>Resume estrategia, modelo, prompt y periodo de cada evidencia guardada.</p></div><button class="btn" id="generateResearchReport">Generar informe</button></div><p class="subtle">Aún no se ha generado.</p>'; $('#page').appendChild(section); bindResearchReport();
  }, 0);
}

function renderAgentEvaluation(result) {
  const root = $('#agentEvaluation'); if (!root) return;
  const row = (label, item) => `<tr><td>${label}</td><td>${item.samples}</td><td>${item.actionable}</td><td>${item.hitRatePct == null ? 'N/D' : item.hitRatePct.toFixed(1) + '%'}</td><td>${item.averageForwardReturnPct == null ? 'N/D' : `${item.averageForwardReturnPct >= 0 ? '+' : ''}${item.averageForwardReturnPct.toFixed(2)}%`}</td><td>${item.afterLlmCostPct == null ? 'N/D' : `${item.afterLlmCostPct >= 0 ? '+' : ''}${item.afterLlmCostPct.toFixed(2)}%`}</td></tr>`;
  root.innerHTML = `<div class="card-header"><div><p class="section-kicker">AGENT EVALUATION</p><h2>Agente único vs multiagente</h2><p>Mis mismas muestras observadas, periodo ${result.period ? `${time(result.period.startAt)} · ${time(result.period.endAt)}` : 'N/D'} · coste LLM ${money(result.totalCostUsd)}.</p></div><div class="actions"><span class="tag">${result.sampleCount} MUESTRAS</span><button class="btn" id="evaluateAgents">Reevaluar</button></div></div><p class="subtle">${esc(result.method)}</p><table class="table"><thead><tr><th>VARIANTE</th><th>MUESTRAS</th><th>ENTRADAS</th><th>ACIERTOS</th><th>RETORNO 1 VELA</th><th>DESPUÉS LLM</th></tr></thead><tbody>${row('Técnico único', result.singleAgent)}${row('Consenso multiagente', result.multiAgent)}</tbody></table>`;
  bindAgentEvaluation();
}

async function runAgentEvaluation() {
  const button = $('#evaluateAgents'), status = $('#agentEvaluationStatus'); if (!button) return; button.disabled = true; if (status) status.textContent = 'Reconstruyendo cierres futuros observados…'; try { researchState.agentEvaluation = await window.traderAPI.evaluateAgents(); renderAgentEvaluation(researchState.agentEvaluation); } catch (error) { if (status) status.textContent = error.message; } finally { $('#evaluateAgents')?.removeAttribute('disabled'); }
}

function bindAgentEvaluation() { $('#evaluateAgents')?.addEventListener('click', runAgentEvaluation); }

function mountAgentEvaluationControls() {
  setTimeout(() => {
    if (page !== 'research' || !$('#page') || $('#agentEvaluation')) return;
    const section = document.createElement('section'); section.id = 'agentEvaluation'; section.className = 'card settings-card'; section.innerHTML = '<div class="card-header"><div><p class="section-kicker">AGENT EVALUATION</p><h2>Agente único vs multiagente</h2><p>Compara las decisiones observadas con el mismo dataset y coste.</p></div><button class="btn" id="evaluateAgents">Evaluar agentes</button></div><p id="agentEvaluationStatus" class="subtle">No se ha ejecutado esta evaluación.</p>'; $('#page').appendChild(section);
    $('#evaluateAgents').onclick = runAgentEvaluation;
  }, 0);
}

function renderResearch() {
  mountAgentEvaluationControls();
  mountResearchReportControls();
  $('#page').innerHTML = `<div class="notice"><strong>Investigación:</strong> este backtest usa una estrategia SMA 20/50 como referencia, llena en la apertura de la vela siguiente y aplica los costes configurados. El LLM se evalúa después contra esta base.</div><section class="card settings-card"><div class="card-header"><div><p class="section-kicker">BACKTEST</p><h2>Estrategia base</h2><p>Primer punto de comparación antes de añadir agentes.</p></div><span class="tag">HISTORICAL</span></div><div class="form-row"><div class="field"><label for="backtestSymbol">Símbolo</label><input id="backtestSymbol" value="BTCUSDT" spellcheck="false"></div><div class="field"><label for="backtestInterval">Intervalo</label><select id="backtestInterval"><option value="15m">15 minutos</option><option value="1h" selected>1 hora</option><option value="4h">4 horas</option><option value="1d">1 día</option></select></div><div class="field"><label for="backtestCash">Capital inicial ($)</label><input id="backtestCash" type="number" min="1" step="1" value="${Number(snapshot.state.initialCash)||100}"></div></div><div class="actions"><button class="btn primary" id="runBacktest">Ejecutar backtest</button><span id="backtestStatus" class="subtle"></span></div></section><section id="backtestResult"></section>`;
  const strategyField = document.createElement('div'); strategyField.className = 'field'; strategyField.innerHTML = '<label for="backtestStrategy">Estrategia</label><select id="backtestStrategy"><option value="sma20-50">SMA 20/50 · baseline</option><option value="ema12-26">EMA 12/26 · tendencia</option><option value="rsi-reversion">RSI 14 · reversión</option></select>'; $('#backtestCash').closest('.form-row').appendChild(strategyField);
  const history = document.createElement('section'); history.id = 'experimentHistory'; history.className = 'card settings-card'; $('#page').appendChild(history); renderExperimentHistory(); if (typeof window.traderAPI.listExperiments === 'function') window.traderAPI.listExperiments().then(items => { researchState.experiments = Array.isArray(items) ? items : []; renderExperimentHistory(); }).catch(() => {});
  const comparison = document.createElement('section'); comparison.id = 'comparisonResult'; comparison.className = 'card settings-card'; $('#page').appendChild(comparison); const compareButton = document.createElement('button'); compareButton.className = 'btn'; compareButton.id = 'compareStrategies'; compareButton.textContent = 'Comparar las 3 estrategias'; $('#runBacktest').parentElement.appendChild(compareButton); compareButton.onclick = compareStrategies;
  $('#runBacktest').onclick=runBacktest;
  if(researchState.report)drawBacktest(researchState.report);
}

async function runBacktest() {
  const button=$('#runBacktest'), status=$('#backtestStatus'); button.disabled=true; status.textContent='Descargando histórico y simulando…';
  try { researchState.report=await window.traderAPI.runBacktest({symbol:$('#backtestSymbol').value,interval:$('#backtestInterval').value,initialCash:Number($('#backtestCash').value),strategy:$('#backtestStrategy').value}); drawBacktest(researchState.report); researchState.experiments = await window.traderAPI.listExperiments?.() || researchState.experiments; renderExperimentHistory(); status.textContent='Listo'; }
  catch(error){status.textContent='';toast(error.message);}
  finally{button.disabled=false;}
}

async function compareStrategies() {
  const button = $('#compareStrategies'), status = $('#backtestStatus'); button.disabled = true; status.textContent = 'Comparando estrategias con el mismo dataset…';
  try { const result = await window.traderAPI.compareBacktests({ symbol: $('#backtestSymbol').value, interval: $('#backtestInterval').value, initialCash: Number($('#backtestCash').value) }); renderComparison(result); researchState.experiments = await window.traderAPI.listExperiments?.() || researchState.experiments; renderExperimentHistory(); status.textContent = 'Comparación lista'; }
  catch (error) { status.textContent = ''; toast(error.message); }
  finally { button.disabled = false; }
}

function renderExperimentHistory() {
  const root = $('#experimentHistory'); if (!root) return;
  if (!researchState.experiments.length) { root.innerHTML = '<div class="card-header"><div><p class="section-kicker">EXPERIMENT LOG</p><h2>Historial de experimentos</h2><p>Las corridas aparecerán aquí con su resultado y benchmark.</p></div></div>'; return; }
  root.innerHTML = `<div class="card-header"><div><p class="section-kicker">EXPERIMENT LOG</p><h2>Historial de experimentos</h2><p>${researchState.experiments.length} corridas conservadas localmente.</p></div></div><table class="table"><thead><tr><th>FECHA</th><th>ESTRATEGIA</th><th>ACTIVO</th><th>RESULTADO</th><th>TEST</th><th>BUY &amp; HOLD</th><th>TRADES</th></tr></thead><tbody>${researchState.experiments.map(item => `<tr><td>${time(item.savedAt)}</td><td>${esc(item.strategy)}</td><td>${esc(item.symbol)} · ${esc(item.interval)}</td><td class="${Number(item.returnPct) >= 0 ? 'positive' : 'negative'}">${item.returnPct == null ? 'N/D' : `${item.returnPct >= 0 ? '+' : ''}${Number(item.returnPct).toFixed(2)}%`}<small>${money(item.finalValue)}</small></td><td class="${Number(item.testReturnPct) >= 0 ? 'positive' : 'negative'}">${item.testReturnPct == null ? 'N/D' : `${item.testReturnPct >= 0 ? '+' : ''}${Number(item.testReturnPct).toFixed(2)}%`}</td><td>${item.buyAndHoldReturnPct == null ? 'N/D' : `${item.buyAndHoldReturnPct >= 0 ? '+' : ''}${Number(item.buyAndHoldReturnPct).toFixed(2)}%`}</td><td>${item.trades}</td></tr>`).join('')}</tbody></table>`;
}

function renderComparison(result) {
  const root = $('#comparisonResult'); if (!root) return;
  root.innerHTML = `<div class="card-header"><div><p class="section-kicker">STRATEGY COMPARISON</p><h2>${esc(result.symbol)} · ${esc(result.interval)}</h2><p>Mismo capital, período y costes. Selección manual; no se elige por el mejor resultado.</p></div><span class="tag">${result.reports.length} ESTRATEGIAS</span></div><table class="table"><thead><tr><th>ESTRATEGIA</th><th>FINAL</th><th>RETORNO</th><th>TEST</th><th>BUY &amp; HOLD</th><th>MC POSITIVA</th></tr></thead><tbody>${result.reports.map(report => { const mc = report.monteCarlo || {}; const returnPct = report.initialCash ? (Number(report.cash) - Number(report.initialCash)) / Number(report.initialCash) * 100 : null; return `<tr><td>${esc(report.strategy)}</td><td>${money(report.cash)}</td><td class="${returnPct >= 0 ? 'positive' : 'negative'}">${returnPct == null ? 'N/D' : `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`}</td><td>${report.outOfSample?.returnPct == null ? 'N/D' : `${report.outOfSample.returnPct >= 0 ? '+' : ''}${report.outOfSample.returnPct.toFixed(2)}%`}</td><td>${report.benchmarks?.buyAndHold?.returnPct == null ? 'N/D' : `${report.benchmarks.buyAndHold.returnPct >= 0 ? '+' : ''}${report.benchmarks.buyAndHold.returnPct.toFixed(2)}%`}</td><td>${mc.status === 'completed' ? `${mc.positiveProbability.toFixed(1)}%` : 'N/D'}</td></tr>`; }).join('')}</tbody></table>`;
}

function renderCostStress(report) {
  setTimeout(() => {
    const target = $('#backtestResult .monte-carlo'), scenarios = report.monteCarlo?.scenarios || [];
    if (!target || !scenarios.length || target.querySelector('.cost-stress')) return;
    const rows = scenarios.map(item => `<tr><td>${item.costMultiplier.toFixed(1)}x</td><td>${money(item.finalP50)}</td><td>${item.positiveProbability.toFixed(1)}%</td><td>${item.drawdownP95.toFixed(2)}%</td><td>${item.beatBenchmarkProbability == null ? 'N/D' : item.beatBenchmarkProbability.toFixed(1) + '%'}</td></tr>`).join('');
    target.insertAdjacentHTML('beforeend', `<div class="cost-stress"><h3>Stress de costes</h3><p class="subtle">El mismo bootstrap con costes de ejecución base, 1.5x y 2x.</p><table class="table"><thead><tr><th>COSTE</th><th>EQUITY P50</th><th>PROB. POSITIVA</th><th>DRAWDOWN P95</th><th>SUPERAR B&amp;H</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }, 0);
}

function drawBacktest(report) {
  renderCostStress(report);
  const splits = (report.splits || []).map(split => `<tr><td>${esc(split.key)}</td><td>${time(split.startAt)} – ${time(split.endAt)}</td><td>${split.candles}</td><td>${split.tradeCount}</td><td class="${split.returnPct >= 0 ? 'positive' : 'negative'}">${split.returnPct >= 0 ? '+' : ''}${split.returnPct.toFixed(2)}%</td><td>${split.buyAndHoldReturnPct >= 0 ? '+' : ''}${split.buyAndHoldReturnPct.toFixed(2)}%</td></tr>`).join('');
  const walkRows = (report.walkForward || []).map(fold => `<tr><td>${esc(fold.key)}</td><td>${time(fold.testStartAt)} – ${time(fold.testEndAt)}</td><td>${esc(fold.regime?.label || 'unknown')}</td><td>${fold.candles}</td><td class="${fold.returnPct >= 0 ? 'positive' : 'negative'}">${fold.returnPct >= 0 ? '+' : ''}${fold.returnPct.toFixed(2)}%</td><td>${fold.buyAndHoldReturnPct >= 0 ? '+' : ''}${fold.buyAndHoldReturnPct.toFixed(2)}%</td></tr>`).join('');
  const monteCarlo = report.monteCarlo || {}, monteCarloBox = monteCarlo.status === 'completed' ? `<div class="table-card monte-carlo"><h3>Stress Monte Carlo</h3><p class="subtle">${monteCarlo.iterations} simulaciones bootstrap con reemplazo · seed ${esc(report.seed)}</p><div class="stat-cards"><div><small>EQUITY P5</small><strong>${money(monteCarlo.finalP5)}</strong></div><div><small>EQUITY MEDIANA</small><strong>${money(monteCarlo.finalP50)}</strong></div><div><small>EQUITY P95</small><strong>${money(monteCarlo.finalP95)}</strong></div><div><small>PROB. POSITIVA</small><strong>${monteCarlo.positiveProbability.toFixed(1)}%</strong></div><div><small>PROB. SUPERAR B&amp;H</small><strong>${monteCarlo.beatBenchmarkProbability == null ? 'N/D' : monteCarlo.beatBenchmarkProbability.toFixed(1)+'%'}</strong></div><div><small>DRAWDOWN P95</small><strong class="negative">${monteCarlo.drawdownP95.toFixed(2)}%</strong></div></div></div>` : `<div class="table-card monte-carlo"><h3>Stress Monte Carlo</h3><p class="subtle">${esc(monteCarlo.reason || 'No hay suficientes trades cerrados para simular escenarios.')}</p></div>`;
  const regimeRows = (report.regimeSummary || []).map(item => `<tr><td>${esc(item.regime)}</td><td>${item.folds}</td><td>${item.positiveFoldRatePct == null ? 'N/D' : item.positiveFoldRatePct.toFixed(1) + '%'}</td><td>${item.averageStrategyReturnPct == null ? 'N/D' : `${item.averageStrategyReturnPct >= 0 ? '+' : ''}${item.averageStrategyReturnPct.toFixed(2)}%`}</td><td>${item.averageBenchmarkReturnPct == null ? 'N/D' : `${item.averageBenchmarkReturnPct >= 0 ? '+' : ''}${item.averageBenchmarkReturnPct.toFixed(2)}%`}</td></tr>`).join('');
  $('#backtestResult').innerHTML=`<section class="card analysis-card"><div class="card-header"><div><p class="section-kicker">${esc(report.strategy)}</p><h2>${esc(report.symbol)} · ${esc(report.interval)}</h2><p>Fill: ${esc(report.assumptions.fill)} · Fees ${(Number(report.assumptions.feeRate)*100).toFixed(3)}% · Spread ${Number(report.assumptions.spreadBps)} bps · Liquidez ${report.assumptions.liquidityNotionalPerTick ? money(report.assumptions.liquidityNotionalPerTick)+'/tick' : 'sin límite'}</p></div><span class="tag">REPLAY</span></div>${renderStatistics(report)}${monteCarloBox}<div class="table-card split-panel"><h3>Fuera de muestra y comparación</h3><p class="subtle">El histórico se divide cronológicamente; el tramo test no se usa para elegir parámetros.</p><table class="table"><thead><tr><th>TRAMO</th><th>PERIODO</th><th>VELAS</th><th>TRADES</th><th>ESTRATEGIA</th><th>BUY &amp; HOLD</th></tr></thead><tbody>${splits}</tbody></table></div>${walkRows ? `<div class="table-card split-panel"><h3>Walk-forward por régimen</h3><p class="subtle">Cada fold evalúa un tramo futuro y se etiqueta descriptivamente por el comportamiento observado.</p><table class="table"><thead><tr><th>FOLD</th><th>TEST</th><th>RÉGIMEN</th><th>VELAS</th><th>ESTRATEGIA</th><th>BUY &amp; HOLD</th></tr></thead><tbody>${walkRows}</tbody></table>${regimeRows ? `<h3>Resumen por régimen</h3><table class="table"><thead><tr><th>RÉGIMEN</th><th>FOLDS</th><th>FOLDS POSITIVOS</th><th>ESTRATEGIA MEDIA</th><th>BUY &amp; HOLD MEDIO</th></tr></thead><tbody>${regimeRows}</tbody></table>` : ''}</div>` : ''}<div class="table-card"><h3>Operaciones del backtest</h3>${renderTrades(report.trades)}</div></section>`;
}
