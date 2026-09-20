const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDepthSnapshot, depthFreshness } = require('../src/main/depthQuality');

test('normaliza niveles desordenados y calcula spread/liquidez', () => {
  const depth = normalizeDepthSnapshot({ bids: [['99', '2'], ['100', '1']], asks: [['102', '1'], ['101', '2']], lastUpdateId: 7 }, 'btcusdt', 2, 'test', 1000);
  assert.equal(depth.symbol, 'BTCUSDT');
  assert.deepEqual(depth.bids[0], [100, 1]);
  assert.deepEqual(depth.asks[0], [101, 2]);
  assert.equal(depth.spreadBps > 0, true);
  assert.equal(depth.status, 'fresh');
});

test('rechaza un libro cruzado y marca snapshots viejos como stale', () => {
  assert.throws(() => normalizeDepthSnapshot({ bids: [['101', '1']], asks: [['100', '1']] }, 'BTCUSDT'), /spread/);
  const depth = normalizeDepthSnapshot({ bids: [['99', '1']], asks: [['101', '1']] }, 'BTCUSDT', 2, 'test', 1000);
  assert.equal(depthFreshness(depth, 20000, 5000).status, 'stale');
});
