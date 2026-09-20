const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDepthSnapshot, availableNotional, consumeNotional, applyDepthDiff } = require('../src/main/depthQuality');

test('aplica un evento incremental contiguo y actualiza lastUpdateId', () => {
  const base = normalizeDepthSnapshot({ bids: [['100', '1'], ['99', '2']], asks: [['101', '1'], ['102', '2']], lastUpdateId: 10 }, 'BTCUSDT', 2, 'rest', 1000);
  const result = applyDepthDiff(base, { U: 11, u: 12, b: [['100', '3'], ['99', '0']], a: [['101', '0'], ['100.5', '1']] }, 2, 1100);
  assert.equal(result.status, 'fresh');
  assert.equal(result.snapshot.lastUpdateId, 12);
  assert.deepEqual(result.snapshot.bids, [[100, 3]]);
  assert.deepEqual(result.snapshot.asks[0], [100.5, 1]);
});

test('detecta salto de secuencia y exige resync', () => {
  const base = normalizeDepthSnapshot({ bids: [['100', '1']], asks: [['101', '1']], lastUpdateId: 10 }, 'BTCUSDT', 2, 'rest', 1000);
  const result = applyDepthDiff(base, { U: 13, u: 13, b: [], a: [] }, 2, 1100);
  assert.equal(result.status, 'gap');
  assert.equal(result.needsResync, true);
});

test('calcula nocional disponible según el lado que consume el libro', () => {
  const snapshot = normalizeDepthSnapshot({ bids: [['100', '2']], asks: [['101', '3']] }, 'BTCUSDT');
  assert.equal(availableNotional(snapshot, 'BUY'), 303);
  assert.equal(availableNotional(snapshot, 'SELL'), 200);
});

test('consume liquidez del lado correcto para no reutilizar el mismo depth en el tick', () => {
  const snapshot = normalizeDepthSnapshot({ bids: [['100', '2']], asks: [['101', '3']] }, 'BTCUSDT');
  assert.equal(availableNotional(consumeNotional(snapshot, 'BUY', 101), 'BUY'), 202);
  assert.equal(availableNotional(consumeNotional(snapshot, 'SELL', 100), 'SELL'), 100);
  assert.equal(consumeNotional(snapshot, 'BUY', 1000).status, 'stale');
});
