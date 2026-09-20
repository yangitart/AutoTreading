const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDailyRisk } = require('../src/main/riskCalendar');

test('reinicia la pérdida diaria al comenzar un nuevo día', () => {
  const current = { dailyLoss: -5, dailyLossDate: '2026-01-01' };
  assert.equal(resetDailyRisk(current, Date.parse('2026-01-02T00:01:00Z')), true);
  assert.equal(current.dailyLoss, 0);
  assert.equal(current.dailyLossDate, '2026-01-02');
});

test('no altera la pérdida durante el mismo día', () => {
  const current = { dailyLoss: -5, dailyLossDate: '2026-01-02' };
  assert.equal(resetDailyRisk(current, Date.parse('2026-01-02T12:00:00Z')), false);
  assert.equal(current.dailyLoss, -5);
});
