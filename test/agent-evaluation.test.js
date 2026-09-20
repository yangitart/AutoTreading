const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAnalyses } = require('../src/main/agentEvaluation');

function analysis(time, close, decision, technicalBias = 'bullish') {
  return { id: `a-${time}`, symbol: 'BTCUSDT', interval: '1h', model: 'test-model', promptVersion: 'test-prompt', estimatedCostUsd: 0.1, features: { trend: technicalBias }, technicalAgent: { bias: technicalBias }, consensus: { decision }, marketSnapshot: [{ time, close }] };
}

test('compara agente técnico único y consenso multiagente con el mismo dataset', () => {
  const report = evaluateAnalyses([analysis(1000, 100, 'BUY'), analysis(2000, 105, 'HOLD', 'bearish'), analysis(3000, 100, 'HOLD', 'bearish')], 100);
  assert.equal(report.sampleCount, 2);
  assert.equal(report.singleAgent.actionable, 2);
  assert.equal(report.multiAgent.actionable, 1);
  assert.equal(report.singleAgent.hitRatePct, 100);
  assert.equal(report.multiAgent.hitRatePct, 100);
  assert.equal(report.totalCostUsd, 0.2);
  assert.equal(report.multiAgent.llmCostUsd, report.singleAgent.llmCostUsd);
});

test('no inventa una muestra futura cuando no existe otra vela observada', () => {
  const report = evaluateAnalyses([{ symbol: 'ETHUSDT', interval: '1h', marketSnapshot: [{ time: 1000, close: 100 }], consensus: { decision: 'BUY' } }]);
  assert.equal(report.sampleCount, 0);
  assert.equal(report.singleAgent.hitRatePct, null);
});
