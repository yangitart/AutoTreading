const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResearchReport } = require('../src/main/researchReport');

test('agrupa análisis por modelo, prompt, estrategia, símbolo e intervalo', () => {
  const report = buildResearchReport({ initialCash: 100, analyses: [
    { model: 'model-a', promptVersion: 'prompt-1', symbol: 'BTCUSDT', interval: '1h', decision: 'BUY', confidence: 80, estimatedCostUsd: 0.02, marketSnapshot: [{ time: 1000, close: 100 }, { time: 2000, close: 101 }], criticalAgent: { veto: false } },
    { model: 'model-a', promptVersion: 'prompt-1', symbol: 'BTCUSDT', interval: '1h', decision: 'HOLD', confidence: 60, estimatedCostUsd: 0.03, marketSnapshot: [{ time: 3000, close: 102 }, { time: 4000, close: 103 }], dataQuality: { status: 'degraded' } }
  ] });
  assert.equal(report.groupCount, 1);
  assert.equal(report.groups[0].calls, 2);
  assert.deepEqual(report.groups[0].decisions, { BUY: 1, HOLD: 1 });
  assert.equal(report.groups[0].totalCostUsd, 0.05);
  assert.equal(report.groups[0].vetoRatePct, 0);
  assert.equal(report.groups[0].period.startAt, new Date(1000).toISOString());
  assert.equal(report.groups[0].period.endAt, new Date(4000).toISOString());
});

test('incluye backtests y conserva fingerprint, test y benchmark', () => {
  const report = buildResearchReport({ backtests: [{ strategy: 'SMA', strategyId: 'sma20-50', symbol: 'ETHUSDT', interval: '4h', initialCash: 100, cash: 108, datasetFingerprint: 'abc', period: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-02-01T00:00:00.000Z' }, outOfSample: { returnPct: 4 }, benchmarks: { buyAndHold: { returnPct: 6 } }, trades: [{ side: 'SELL' }] }] });
  assert.equal(report.groups[0].type, 'backtest');
  assert.equal(report.groups[0].returnPct, 8);
  assert.equal(report.groups[0].testReturnPct, 4);
  assert.equal(report.groups[0].buyAndHoldReturnPct, 6);
  assert.equal(report.groups[0].datasetFingerprint, 'abc');
});
