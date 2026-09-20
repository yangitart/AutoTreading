const test = require('node:test');
const assert = require('node:assert/strict');
const { SerializedMutationQueue } = require('../src/main/mutationQueue');

test('serializa mutaciones aunque la primera sea asíncrona', async () => {
  const queue = new SerializedMutationQueue(), events = [];
  const first = queue.enqueue('first', async () => { events.push('first:start'); await new Promise(resolve => setTimeout(resolve, 10)); events.push('first:end'); return 1; });
  const second = queue.enqueue('second', async () => { events.push('second'); return 2; });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('un fallo no bloquea las mutaciones posteriores', async () => {
  const queue = new SerializedMutationQueue();
  await assert.rejects(queue.enqueue('failed', async () => { throw new Error('fallo esperado'); }), /fallo esperado/);
  assert.equal(await queue.enqueue('after-failure', () => 'ok'), 'ok');
});
