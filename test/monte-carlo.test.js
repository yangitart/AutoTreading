const test = require('node:test');
const assert = require('node:assert/strict');
const { monteCarloStress, stressedOutcome } = require('../src/main/monteCarlo');

test('escala el coste observado sin alterar el bruto', () => {
  const trade = { grossPnl: 10, netPnl: 8 };
  assert.equal(stressedOutcome(trade, 1), 8);
  assert.equal(stressedOutcome(trade, 2), 6);
});

test('genera escenarios de coste deterministas y ordenados', () => {
  const trades = [{ side: 'SELL', grossPnl: 10, netPnl: 9 }, { side: 'SELL', grossPnl: -5, netPnl: -6 }];
  const first = monteCarloStress(trades, 100, 101, 'abcdef123456', 30), second = monteCarloStress(trades, 100, 101, 'abcdef123456', 30);
  assert.deepEqual(first, second);
  assert.deepEqual(first.scenarios.map(item => item.costMultiplier), [1, 1.5, 2]);
  assert.equal(first.finalP50, first.scenarios[0].finalP50);
  assert.equal(first.scenarios[2].finalP50 <= first.scenarios[0].finalP50, true);
});
