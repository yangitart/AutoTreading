const { technicalAgent } = require('./agentOrchestrator');

function decisionFromBias(bias) {
  return bias === 'bullish' ? 'BUY' : bias === 'bearish' ? 'SELL' : 'HOLD';
}

function forwardSamples(analyses = []) {
  const series = new Map();
  for (const analysis of analyses) {
    const key = `${analysis.symbol || ''}:${analysis.interval || ''}`;
    for (const candle of Array.isArray(analysis.marketSnapshot) ? analysis.marketSnapshot : []) {
      if (!Number.isFinite(Number(candle?.time)) || !(Number(candle?.close) > 0)) continue;
      const time = Number(candle.time), keyAtTime = `${key}:${time}`;
      series.set(keyAtTime, { key, time, close: Number(candle.close) });
    }
  }
  const bySeries = new Map();
  for (const candle of series.values()) bySeries.set(candle.key, [...(bySeries.get(candle.key) || []), candle]);
  for (const candles of bySeries.values()) candles.sort((a, b) => a.time - b.time);
  return analyses.map(analysis => {
    const candles = Array.isArray(analysis.marketSnapshot) ? analysis.marketSnapshot.filter(candle => Number(candle?.time) > 0 && Number(candle?.close) > 0) : [];
    if (!candles.length) return null;
    const last = candles.reduce((latest, candle) => Number(candle.time) > Number(latest.time) ? candle : latest);
    const key = `${analysis.symbol || ''}:${analysis.interval || ''}`;
    const next = (bySeries.get(key) || []).find(candle => candle.time > Number(last.time));
    if (!next) return null;
    const forwardReturnPct = (next.close - Number(last.close)) / Number(last.close) * 100;
    const technical = analysis.technicalAgent || technicalAgent(analysis.features || {});
    return { analysisId: analysis.id || null, symbol: analysis.symbol, interval: analysis.interval, decisionAt: Number(last.time), nextAt: next.time, forwardReturnPct, singleDecision: decisionFromBias(technical.bias), multiDecision: String(analysis.consensus?.decision || analysis.decision || 'HOLD').toUpperCase(), estimatedCostUsd: Number(analysis.estimatedCostUsd ?? analysis.llmUsage?.callCostUsd ?? 0) || 0, model: analysis.model || null, promptVersion: analysis.promptVersion || null };
  }).filter(Boolean);
}

function scoreSamples(samples, field, initialCash, totalCostUsd) {
  const actionable = samples.filter(sample => sample[field] === 'BUY' || sample[field] === 'SELL');
  const hits = actionable.filter(sample => (sample[field] === 'BUY' && sample.forwardReturnPct > 0) || (sample[field] === 'SELL' && sample.forwardReturnPct < 0));
  const cumulativeForwardReturnPct = actionable.reduce((sum, sample) => sum + (sample[field] === 'SELL' ? -sample.forwardReturnPct : sample.forwardReturnPct), 0);
  const llmCostPct = initialCash > 0 ? totalCostUsd / initialCash * 100 : null;
  return { samples: samples.length, actionable: actionable.length, holdCount: samples.length - actionable.length, hitRatePct: actionable.length ? hits.length / actionable.length * 100 : null, averageForwardReturnPct: actionable.length ? cumulativeForwardReturnPct / actionable.length : null, cumulativeForwardReturnPct, llmCostUsd: totalCostUsd, llmCostPct, afterLlmCostPct: llmCostPct == null ? null : cumulativeForwardReturnPct - llmCostPct };
}

function evaluateAnalyses(analyses = [], initialCash = 100) {
  const samples = forwardSamples(analyses).sort((a, b) => a.decisionAt - b.decisionAt), totalCostUsd = samples.reduce((sum, sample) => sum + sample.estimatedCostUsd, 0), dates = samples.map(sample => sample.decisionAt);
  return { method: 'evaluación observada: siguiente cierre disponible del mismo símbolo/timeframe; no es backtest y puede tener muestras solapadas', sampleCount: samples.length, period: dates.length ? { startAt: new Date(Math.min(...dates)).toISOString(), endAt: new Date(Math.max(...dates)).toISOString() } : null, models: [...new Set(samples.map(sample => sample.model).filter(Boolean))], promptVersions: [...new Set(samples.map(sample => sample.promptVersion).filter(Boolean))], totalCostUsd, singleAgent: scoreSamples(samples, 'singleDecision', Number(initialCash) || 100, totalCostUsd), multiAgent: scoreSamples(samples, 'multiDecision', Number(initialCash) || 100, totalCostUsd), samples };
}

module.exports = { decisionFromBias, forwardSamples, scoreSamples, evaluateAnalyses };
