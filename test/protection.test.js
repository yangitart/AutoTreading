const test = require('node:test');
const assert = require('node:assert/strict');
const { stopIsTriggered, protectiveExecutionPrice, resolveProtectiveExit } = require('../src/main/protection');

test('detecta un stop de salida por el mínimo de una vela aunque cierre por encima', () => {
  assert.equal(resolveProtectiveExit({ stopLoss: 95, takeProfit: 120 }, { open: 105, high: 110, low: 94, bid: 108 }, 108).reason, 'stop-loss');
});

test('un gap por debajo del stop llena al open y marca gap', () => {
  const exit = resolveProtectiveExit({ stopLoss: 95 }, { open: 90, high: 92, low: 88 }, 90);
  assert.equal(exit.executionPrice, 90);
  assert.equal(exit.gap, true);
});

test('stop y objetivo en la misma vela siguen la política configurada', () => {
  const stopFirst = resolveProtectiveExit({ stopLoss: 95, takeProfit: 115 }, { open: 105, high: 116, low: 94 }, 105, 'conservative');
  const takeFirst = resolveProtectiveExit({ stopLoss: 95, takeProfit: 115 }, { open: 105, high: 116, low: 94 }, 105, 'take-first');
  assert.equal(stopFirst.reason, 'stop-loss-ambiguous');
  assert.equal(takeFirst.reason, 'take-profit-ambiguous');
});

test('las órdenes stop pendientes usan high/low y no solo el cierre', () => {
  assert.equal(stopIsTriggered('SELL', 95, { open: 105, high: 108, low: 94, last: 106 }), true);
  assert.equal(stopIsTriggered('BUY', 115, { open: 105, high: 116, low: 104, last: 106 }), true);
  assert.equal(stopIsTriggered('SELL', 95, { open: 105, high: 108, low: 96, last: 106 }), false);
});

test('un stop sin gap usa el nivel solicitado como precio de disparo', () => {
  assert.equal(protectiveExecutionPrice('SELL', 95, { open: 105, low: 94 }, 94), 95);
});
