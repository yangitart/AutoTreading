const test = require('node:test');
const assert = require('node:assert/strict');
const { reservationForOrder, releaseForFill, releaseAll } = require('../src/main/cashReservation');

test('reserva cash solo para BUY y cubre fee/slippage', () => {
  assert.equal(reservationForOrder({ side: 'SELL', quantity: 1, requestedPrice: 100 }), 0);
  assert.ok(Math.abs(reservationForOrder({ side: 'BUY', quantity: 2, requestedPrice: 100, feeRate: 0.001, slippageBps: 10 }) - 200.4002) < 1e-9);
});

test('libera proporcionalmente un fill parcial y todo al cancelar', () => {
  const order = { side: 'BUY', quantity: 10, filledQuantity: 0, reservedCash: 100 };
  assert.equal(releaseForFill(order, 4), 40);
  assert.equal(releaseForFill({ ...order, filledQuantity: 4, reservedCash: 60 }, 6), 60);
  assert.equal(releaseAll(order), 100);
});
