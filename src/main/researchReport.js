function periodFromAnalysis(analysis = {}) {
  const times = (Array.isArray(analysis.marketSnapshot) ? analysis.marketSnapshot : []).map(candle => Number(candle?.time)).filter(Number.isFinite);
  if (!times.length) return analysis.createdAt ? { startAt: analysis.createdAt, endAt: analysis.createdAt } : null;
  return { startAt: new Date(Math.min(...times)).toISOString(), endAt: new Date(Math.max(...times)).toISOString() };
}

function addDecision(group, decision) {
  const normalized = ['BUY', 'SELL', 'HOLD'].includes(decision) ? decision : 'UNKNOWN';
  group.decisions[normalized] = (group.decisions[normalized] || 0) + 1;
}

function buildAnalysisGroups(analyses = []) {
  const groups = new Map();
  for (const analysis of analyses) {
    const strategy = 'llm-multi-agent', model = analysis.model || 'unknown-model', promptVersion = analysis.promptVersion || 'unknown-prompt', symbol = analysis.symbol || 'unknown-symbol', interval = analysis.interval || 'unknown-interval', key = [strategy, model, promptVersion, symbol, interval].join('|');
    const group = groups.get(key) || { type: 'llm-analysis', strategy, model, promptVersion, symbol, interval, period: null, calls: 0, decisions: {}, confidenceSum: 0, vetoes: 0, degradedData: 0, totalCostUsd: 0 };
    const period = periodFromAnalysis(analysis);
    group.calls += 1; addDecision(group, String(analysis.decision || '').toUpperCase()); group.confidenceSum += Number(analysis.confidence) || 0; group.vetoes += analysis.criticalAgent?.veto || analysis.portfolioAgent?.veto ? 1 : 0; group.degradedData += ['degraded', 'stale', 'invalid'].includes(analysis.dataQuality?.status) ? 1 : 0; group.totalCostUsd += Number(analysis.estimatedCostUsd) || 0;
    if (period) {
      if (!group.period) group.period = { ...period };
      else { group.period.startAt = period.startAt < group.period.startAt ? period.startAt : group.period.startAt; group.period.endAt = period.endAt > group.period.endAt ? period.endAt : group.period.endAt; }
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, averageConfidence: group.calls ? group.confidenceSum / group.calls : null, vetoRatePct: group.calls ? group.vetoes / group.calls * 100 : null, confidenceSum: undefined }));
}

function buildBacktestGroups(backtests = []) {
  return backtests.map(report => ({ type: 'backtest', strategy: report.strategy || report.strategyId || 'unknown-strategy', strategyId: report.strategyId || null, model: 'rule-engine', promptVersion: null, symbol: report.symbol || 'unknown-symbol', interval: report.interval || 'unknown-interval', period: report.period || (report.splits?.length ? { startAt: report.splits[0].startAt, endAt: report.splits.at(-1).endAt } : null), runs: 1, initialCash: Number(report.initialCash) || null, finalValue: Number(report.cash) || null, returnPct: report.initialCash ? (Number(report.cash) - Number(report.initialCash)) / Number(report.initialCash) * 100 : null, testReturnPct: report.outOfSample?.returnPct ?? null, buyAndHoldReturnPct: report.benchmarks?.buyAndHold?.returnPct ?? null, trades: (report.trades || []).filter(trade => trade.side === 'SELL').length, datasetFingerprint: report.datasetFingerprint || null }));
}

function buildResearchReport({ analyses = [], backtests = [], initialCash = 100 } = {}) {
  const groups = [...buildBacktestGroups(backtests), ...buildAnalysisGroups(analyses)];
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), initialCash: Number(initialCash) || 100, groupCount: groups.length, groups };
}

module.exports = { periodFromAnalysis, buildAnalysisGroups, buildBacktestGroups, buildResearchReport };
