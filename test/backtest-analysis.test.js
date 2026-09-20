const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMarketRegime, summarizeRegimes } = require('../src/main/backtestAnalysis');

function candles(values) { return values.map((close, index) => ({ time: index, close })); }

test('etiqueta un tramo alcista y expone la métrica descriptiva', () => {
  const regime = classifyMarketRegime(candles([100, 101, 103, 106, 110]), 0, 4);
  assert.equal(regime.label, 'bullish');
  assert.equal(regime.candles, 5);
  assert.equal(Math.round(regime.returnPct), 10);
});

test('etiqueta un tramo lateral y resume folds por régimen', () => {
  const regime = classifyMarketRegime(candles([100, 100.1, 99.9, 100.05, 100]), 0, 4);
  const summary = summarizeRegimes([{ returnPct: 2, buyAndHoldReturnPct: 1, regime }, { returnPct: -1, buyAndHoldReturnPct: 0, regime }]);
  assert.equal(regime.label, 'range');
  assert.equal(summary[0].regime, 'range');
  assert.equal(summary[0].folds, 2);
  assert.equal(summary[0].positiveFoldRatePct, 50);
});

test('etiqueta oscilaciones amplias como volátiles', () => {
  assert.equal(classifyMarketRegime(candles([100, 110, 100, 110, 100]), 0, 4).label, 'volatile');
});
