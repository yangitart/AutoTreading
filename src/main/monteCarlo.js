function seededRandom(seed) {
  let value = parseInt(String(seed).slice(0, 8), 16) >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

function stressedOutcome(trade, costMultiplier) {
  const net = Number(trade.netPnl ?? trade.realizedPnl), gross = Number(trade.grossPnl);
  if (!Number.isFinite(net)) return null;
  if (!Number.isFinite(gross)) return net;
  return gross - (gross - net) * costMultiplier;
}

function runScenario(outcomes, initialCash, benchmarkFinal, seed, iterations, costMultiplier) {
  const random = seededRandom(`${seed}:${costMultiplier}`), finals = [], drawdowns = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let equity = initialCash, peak = initialCash, maxDrawdown = 0;
    for (let index = 0; index < outcomes.length; index += 1) { equity += outcomes[Math.floor(random() * outcomes.length)]; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak * 100 : 0); }
    finals.push(equity); drawdowns.push(maxDrawdown);
  }
  finals.sort((a, b) => a - b); drawdowns.sort((a, b) => a - b);
  const percentile = (values, quantile) => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * quantile)))];
  return { costMultiplier, finalP5: percentile(finals, 0.05), finalP50: percentile(finals, 0.5), finalP95: percentile(finals, 0.95), drawdownP50: percentile(drawdowns, 0.5), drawdownP95: percentile(drawdowns, 0.95), positiveProbability: finals.filter(value => value > initialCash).length / finals.length * 100, beatBenchmarkProbability: Number.isFinite(benchmarkFinal) ? finals.filter(value => value > benchmarkFinal).length / finals.length * 100 : null };
}

function monteCarloStress(trades = [], initialCash, benchmarkFinal, seed, iterations = 200, costMultipliers = [1, 1.5, 2]) {
  const source = trades.filter(trade => trade.side === 'SELL').map(trade => costMultipliers.map(multiplier => stressedOutcome(trade, multiplier))).filter(row => row.some(Number.isFinite));
  if (!source.length) return { status: 'unavailable', iterations: 0, reason: 'Se necesita al menos un trade cerrado.' };
  const scenarios = costMultipliers.map((costMultiplier, scenarioIndex) => runScenario(source.map(row => row[scenarioIndex]).filter(Number.isFinite), initialCash, benchmarkFinal, seed, iterations, costMultiplier));
  const base = scenarios[0];
  return { status: 'completed', iterations, trades: source.length, finalP5: base.finalP5, finalP50: base.finalP50, finalP95: base.finalP95, drawdownP50: base.drawdownP50, drawdownP95: base.drawdownP95, positiveProbability: base.positiveProbability, beatBenchmarkProbability: base.beatBenchmarkProbability, scenarios, method: 'bootstrap con reemplazo, semilla determinista y escenarios de coste base/1.5x/2x' };
}

module.exports = { seededRandom, stressedOutcome, runScenario, monteCarloStress };
