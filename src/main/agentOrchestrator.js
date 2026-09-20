const DECISIONS = new Set(['BUY', 'SELL', 'HOLD']);

function technicalAgent(features = {}) {
  let score = 0;
  if (features.trend === 'bullish') score += 2;
  if (features.trend === 'bearish') score -= 2;
  if (Number(features.rsi14) >= 55 && Number(features.rsi14) <= 72) score += 1;
  if (Number(features.rsi14) <= 45 && Number(features.rsi14) >= 28) score -= 1;
  if (Number(features.volumeRatio) >= 1.2) score += features.trend === 'bearish' ? -1 : 1;
  return { name: 'technical-agent', score, bias: score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral', inputs: ['EMA12/26', 'RSI14', 'ATR14', 'volumeRatio'] };
}

function newsAgent(items = [], symbol = '') {
  const asset = String(symbol).toUpperCase().replace(/USDT$|USD$|BTC$|ETH$|SOL$/g, '');
  const positive = ['approved', 'approval', 'adoption', 'partnership', 'surge', 'rally', 'growth', 'inflow', 'bullish', 'launch', 'upgrade', 'gains', 'record'];
  const negative = ['hack', 'exploit', 'lawsuit', 'ban', 'outflow', 'crash', 'liquidation', 'fraud', 'investigation', 'bearish', 'delay', 'losses', 'risk'];
  const now = Date.now(), relevant = items.filter(item => { const text = `${item.title} ${item.description || ''}`.toUpperCase(); return !asset || text.includes(asset) || (asset === 'BTC' && /BITCOIN|BTC/.test(text)) || (asset === 'ETH' && /ETHEREUM|ETH/.test(text)) || (asset === 'SOL' && /SOLANA|SOL/.test(text)); });
  const scored = relevant.map(item => { const text = `${item.title} ${item.description || ''}`.toLowerCase(), ageHours = item.publishedAt ? (now - new Date(item.publishedAt).getTime()) / 3600000 : null, validAge = Number.isFinite(ageHours) && ageHours >= 0, recencyWeight = validAge ? ageHours <= 6 ? 1 : ageHours <= 24 ? 0.6 : ageHours <= 72 ? 0.25 : 0 : item.publishedAt ? 0 : 0.25, sentimentScore = positive.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0) - negative.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0); return { item, ageHours, recencyWeight, sentimentScore }; });
  const score = Math.round(scored.reduce((sum, entry) => sum + entry.sentimentScore * entry.recencyWeight, 0) * 100) / 100, recent = scored.filter(entry => entry.recencyWeight > 0), staleCount = scored.filter(entry => entry.recencyWeight === 0).length;
  return { name: 'news-agent', status: items.length ? 'completed' : 'unavailable', relevantCount: relevant.length, recentCount: recent.length, staleCount, sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', score, items: scored.sort((a, b) => b.recencyWeight - a.recencyWeight || (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity)).slice(0, 8).map(entry => ({ ...entry.item, ageHours: Number.isFinite(entry.ageHours) ? Math.round(entry.ageHours * 10) / 10 : null, recencyWeight: entry.recencyWeight })) };
}

function liquidityAgent(orderBook = {}) {
  const bidLiquidity = Number(orderBook.bidLiquidity || 0), askLiquidity = Number(orderBook.askLiquidity || 0), total = bidLiquidity + askLiquidity, imbalance = total ? (bidLiquidity - askLiquidity) / total : 0, spreadBps = Number(orderBook.spreadBps);
  if (orderBook.status === 'stale' || orderBook.dataQuality?.status === 'stale') return { name: 'liquidity-agent', status: 'stale', bias: 'neutral', imbalance: 0, spreadBps: Number.isFinite(spreadBps) ? spreadBps : null, score: 0, warnings: ['Order book obsoleto; se excluye de la señal.'] };
  if (!total) return { name: 'liquidity-agent', status: 'unavailable', bias: 'neutral', imbalance: 0, spreadBps: Number.isFinite(spreadBps) ? spreadBps : null, score: 0, warnings: ['Order book no disponible.'] };
  const bias = imbalance >= 0.15 ? 'bullish' : imbalance <= -0.15 ? 'bearish' : 'neutral', warnings = [];
  if (Number.isFinite(spreadBps) && spreadBps > 50) warnings.push(`Spread del libro elevado (${spreadBps.toFixed(1)} bps).`);
  return { name: 'liquidity-agent', status: 'completed', bias, imbalance, spreadBps: Number.isFinite(spreadBps) ? spreadBps : null, bidLiquidity, askLiquidity, score: Math.round(imbalance * 10), warnings };
}

function validateTradeIntent(intent, currentPrice) {
  const decision = String(intent?.decision || '').toUpperCase(), confidence = Number(intent?.confidence);
  const entry = Number(intent?.entry), stopLoss = Number(intent?.stopLoss), takeProfit = Number(intent?.takeProfit);
  const errors = [];
  if (!DECISIONS.has(decision)) errors.push('decision debe ser BUY, SELL o HOLD');
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) errors.push('confidence debe ser un entero entre 0 y 100');
  if (decision !== 'HOLD') {
    if (!(entry > 0 && stopLoss > 0 && takeProfit > 0)) errors.push('BUY/SELL requiere entry, stopLoss y takeProfit positivos');
    if (decision === 'BUY' && !(stopLoss < entry && entry < takeProfit)) errors.push('BUY requiere stopLoss < entry < takeProfit');
    if (decision === 'SELL' && !(takeProfit < entry && entry < stopLoss)) errors.push('SELL debe declarar niveles coherentes para una salida/short');
    if (Number.isFinite(currentPrice) && currentPrice > 0 && Math.abs(entry - currentPrice) / currentPrice > 0.1) errors.push('entry está a más de 10% del precio observado');
  }
  return { valid: errors.length === 0, errors, normalized: { decision, confidence: Number.isInteger(confidence) ? confidence : 0, entry: entry > 0 ? entry : null, stopLoss: stopLoss > 0 ? stopLoss : null, takeProfit: takeProfit > 0 ? takeProfit : null, riskNotes: Array.isArray(intent?.riskNotes) ? intent.riskNotes.map(String).slice(0, 8) : [] } };
}

function direction(value) {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'BUY' || normalized === 'BULLISH' || normalized === 'POSITIVE' ? 1 : normalized === 'SELL' || normalized === 'BEARISH' || normalized === 'NEGATIVE' ? -1 : 0;
}

function criticalAgent(intent = {}, technical = {}, news = {}, features = {}, currentPrice = null, higherTechnical = {}, liquidity = {}) {
  const decision = String(intent.decision || '').toUpperCase(), issues = [], warnings = [];
  const intentDirection = direction(decision), technicalDirection = direction(technical.bias), newsDirection = direction(news.sentiment);
  if (decision !== 'HOLD' && technicalDirection && technicalDirection !== intentDirection && Number(technical.score || 0) * intentDirection <= -2) issues.push(`La señal ${decision} contradice al agente técnico (${technical.bias}).`);
  if (decision !== 'HOLD' && direction(higherTechnical.bias) && direction(higherTechnical.bias) !== intentDirection && Number(higherTechnical.score || 0) * intentDirection <= -2) warnings.push(`La señal ${decision} está contra la tendencia del timeframe superior (${higherTechnical.bias}).`);
  if (decision !== 'HOLD' && direction(liquidity.bias) && direction(liquidity.bias) !== intentDirection && Math.abs(Number(liquidity.imbalance || 0)) >= 0.35) warnings.push(`El desequilibrio del order book favorece ${liquidity.bias}.`);
  if (decision !== 'HOLD' && newsDirection && newsDirection !== intentDirection && Math.abs(Number(news.score || 0)) >= 2) warnings.push(`Las noticias relevantes tienen sesgo ${news.sentiment}.`);
  const entry = Number(intent.entry || currentPrice), stop = Number(intent.stopLoss), target = Number(intent.takeProfit);
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry), rewardRisk = risk > 0 ? reward / risk : null;
  if (decision !== 'HOLD' && rewardRisk !== null && rewardRisk < 1) issues.push(`La relación beneficio/riesgo es demasiado baja (${rewardRisk.toFixed(2)}).`);
  if (decision !== 'HOLD' && !Number.isFinite(Number(features.atr14))) warnings.push('ATR no disponible; la volatilidad no pudo ser contrastada.');
  return { name: 'critical-agent', status: issues.length ? 'rejected' : warnings.length ? 'caution' : 'completed', veto: issues.length > 0, issues, warnings, rewardRisk, bias: decision === 'BUY' ? 'bullish' : decision === 'SELL' ? 'bearish' : 'neutral' };
}

function portfolioAgent(current = {}, intent = {}, currentPrice = null, config = {}) {
  const positions = Array.isArray(current.positions) ? current.positions : [];
  const cash = Number(current.cash) || 0;
  const marketValue = positions.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.bid || item.mark || item.entry || 0), 0);
  const accountValue = cash + marketValue, decision = String(intent.decision || '').toUpperCase(), symbol = String(intent.symbol || '').toUpperCase();
  const position = positions.find(item => item.symbol === symbol), issues = [], warnings = [];
  if (decision === 'SELL' && (!position || Number(position.quantity) <= 0)) issues.push(`No existe una posición abierta de ${symbol || 'este activo'} para vender en paper.`);
  if (decision === 'BUY' && accountValue > 0) {
    const totalExposurePct = marketValue / accountValue * 100;
    const assetExposure = position ? Number(position.quantity || 0) * Number(position.bid || position.mark || position.entry || currentPrice || 0) : 0;
    const assetExposurePct = assetExposure / accountValue * 100;
    if (totalExposurePct >= (Number(config.maxExposurePct) || 75)) issues.push('La exposición total ya está en el límite configurado.');
    else if (totalExposurePct >= (Number(config.maxExposurePct) || 75) * 0.85) warnings.push('La exposición total está cerca del límite.');
    if (assetExposurePct >= (Number(config.maxAssetExposurePct) || 35)) issues.push(`La exposición de ${symbol} ya está en el límite por activo.`);
  }
  return { name: 'portfolio-agent', status: issues.length ? 'rejected' : warnings.length ? 'caution' : 'completed', veto: issues.length > 0, issues, warnings, accountValue, marketValue, exposurePct: accountValue ? marketValue / accountValue * 100 : 0, positionQuantity: Number(position?.quantity || 0) };
}

function consensusAgent(intent = {}, technical = {}, news = {}, critical = {}, portfolio = {}, higherTechnical = {}, liquidity = {}) {
  const original = String(intent.decision || '').toUpperCase(), originalDirection = direction(original);
  const opposes = value => original !== 'HOLD' && direction(value) !== 0 && direction(value) !== originalDirection, opposed = [opposes(technical.bias), opposes(higherTechnical.bias), opposes(news.sentiment), original !== 'HOLD' && Math.abs(Number(liquidity.imbalance || 0)) >= 0.35 && opposes(liquidity.bias)].filter(Boolean).length;
  const vetoes = [...(critical.issues || []), ...(portfolio.issues || [])];
  const hold = original === 'HOLD' || critical.veto || portfolio.veto || opposed >= 2;
  const decision = hold ? 'HOLD' : original;
  let confidence = Math.max(0, Math.min(100, Math.round(Number(intent.confidence) || 0)));
  if (critical.veto || portfolio.veto) confidence = Math.min(confidence, 35);
  else if (opposed) confidence = Math.min(confidence, Math.max(0, confidence - opposed * 15));
  const expectedBias = original === 'BUY' ? 'bullish' : original === 'SELL' ? 'bearish' : 'neutral';
  const supporting = [technical.bias === expectedBias, higherTechnical.bias === expectedBias, news.sentiment === (original === 'BUY' ? 'positive' : original === 'SELL' ? 'negative' : 'neutral'), Math.abs(Number(liquidity.imbalance || 0)) >= 0.15 && liquidity.bias === expectedBias].filter(Boolean).length;
  return { name: 'consensus-agent', decision, confidence, originalDecision: original, agreement: supporting, opposed, vetoes, status: decision === 'HOLD' && original !== 'HOLD' ? 'rejected' : opposed ? 'caution' : 'completed', rationale: decision === 'HOLD' && original !== 'HOLD' ? 'La señal fue retenida por contradicciones o un veto de riesgo.' : `La señal ${decision} conserva la intención del analista con ${supporting} agentes alineados.` };
}

function agentTrace(technical, validation, news = { status: 'unavailable', relevantCount: 0 }, critical = null, portfolio = null, consensus = null, higherTechnical = null, liquidity = null) {
  const trace = [
    { name: 'market-data', status: 'completed', detail: 'OHLCV recibido y validado' },
    { name: 'technical-agent', status: 'completed', detail: `bias=${technical.bias}, score=${technical.score}` },
    { name: 'news-agent', status: news.status, detail: `${news.relevantCount || 0} titulares relevantes` },
    { name: 'llm-analyst', status: 'completed', detail: 'TradeIntent generado' },
    { name: 'intent-validator', status: validation.valid ? 'completed' : 'rejected', detail: validation.valid ? 'schema y niveles coherentes' : validation.errors.join('; ') }
  ];
  if (!critical && !portfolio && !consensus) { trace.push({ name: 'risk-governor', status: 'pending', detail: 'se ejecuta al crear la orden' }); return trace; }
  if (higherTechnical) trace.push({ name: 'higher-timeframe-agent', status: 'completed', detail: `bias=${higherTechnical.bias}, score=${higherTechnical.score}` });
  if (liquidity) trace.push({ name: 'liquidity-agent', status: liquidity.status || 'unavailable', detail: `bias=${liquidity.bias}, imbalance=${Number(liquidity.imbalance || 0).toFixed(2)}` });
  trace.push({ name: 'critical-agent', status: critical?.status || 'pending', detail: critical?.veto ? critical.issues.join('; ') : 'contradicciones y beneficio/riesgo revisados' });
  trace.push({ name: 'portfolio-agent', status: portfolio?.status || 'pending', detail: portfolio?.veto ? portfolio.issues.join('; ') : `exposición ${Number(portfolio?.exposurePct || 0).toFixed(1)}%` });
  trace.push({ name: 'consensus-agent', status: consensus?.status || 'pending', detail: consensus?.rationale || 'agentes pendientes' });
  trace.push({ name: 'risk-governor', status: 'pending', detail: 'se ejecuta al crear la orden' });
  return trace;
}

module.exports = { technicalAgent, newsAgent, liquidityAgent, validateTradeIntent, criticalAgent, portfolioAgent, consensusAgent, agentTrace };
