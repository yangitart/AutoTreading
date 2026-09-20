const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeNewsFeeds, newsFetchQuality } = require('../src/main/newsQuality');

test('sanitiza feeds RSS y bloquea esquemas no HTTPS', () => {
  assert.deepEqual(sanitizeNewsFeeds(['https://example.com/rss', 'file:///secret', 'http://insecure.test/rss', 'https://example.com/rss']), ['https://example.com/rss']);
});

test('clasifica disponibilidad parcial y total del contexto de noticias', () => {
  assert.equal(newsFetchQuality(['a', 'b'], [{ feed: 'b', error: 'timeout' }], 1000).status, 'degraded');
  assert.equal(newsFetchQuality(['a'], [{ feed: 'a', error: 'timeout' }], 1000).status, 'offline');
});
