function classifyMarketRegime(candles = [], start = 0, end = candles.length - 1) {
  const sample = candles.slice(Math.max(0, start), Math.min(candles.length, end + 1)).filter(candle => Number(candle?.close) > 0);
  if (sample.length < 2) return { label: 'unknown', returnPct: null, volatilityPct: null, candles: sample.length };
  const returns = sample.slice(1).map((candle, index) => (candle.close - sample[index].close) / sample[index].close * 100), mean = returns.reduce((sum, value) => sum + value, 0) / returns.length, volatilityPct = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length), returnPct = (sample.at(-1).close - sample[0].close) / sample[0].close * 100, averageAbsMove = returns.reduce((sum, value) => sum + Math.abs(value), 0) / returns.length;
  const label = volatilityPct > Math.max(0.5, Math.abs(mean) * 3, averageAbsMove * 0.9) ? 'volatile' : returnPct >= Math.max(0.5, averageAbsMove * 2) ? 'bullish' : returnPct <= -Math.max(0.5, averageAbsMove * 2) ? 'bearish' : 'range';
  return { label, returnPct, volatilityPct, averageAbsMovePct: averageAbsMove, candles: sample.length, method: 'retorno del tramo y dispersión de retornos de cierre; heurística descriptiva, no clasificación predictiva' };
}

function summarizeRegimes(folds = []) {
  const groups = new Map();
  for (const fold of folds) {
    const regime = fold.regime?.label || 'unknown', group = groups.get(regime) || { regime, folds: 0, positiveFolds: 0, strategyReturnPct: 0, benchmarkReturnPct: 0, averageVolatilityPct: 0 };
    group.folds += 1; group.positiveFolds += Number(fold.returnPct) > 0 ? 1 : 0; group.strategyReturnPct += Number(fold.returnPct) || 0; group.benchmarkReturnPct += Number(fold.buyAndHoldReturnPct) || 0; group.averageVolatilityPct += Number(fold.regime?.volatilityPct) || 0; groups.set(regime, group);
  }
  return [...groups.values()].map(group => ({ ...group, averageStrategyReturnPct: group.folds ? group.strategyReturnPct / group.folds : null, averageBenchmarkReturnPct: group.folds ? group.benchmarkReturnPct / group.folds : null, positiveFoldRatePct: group.folds ? group.positiveFolds / group.folds * 100 : null, averageVolatilityPct: group.folds ? group.averageVolatilityPct / group.folds : null }));
}

module.exports = { classifyMarketRegime, summarizeRegimes };
