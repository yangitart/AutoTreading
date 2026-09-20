const test = require('node:test');
const assert = require('node:assert/strict');
const { createSingleFlight } = require('../src/main/singleFlight');

test('impide corridas automáticas solapadas y libera el bloqueo al terminar', async () => {
  let calls = 0;
  const run = createSingleFlight(async value => { calls += 1; await new Promise(resolve => setTimeout(resolve, 8)); return value; });
  const [first, second] = await Promise.all([run('first'), run('second')]);
  assert.equal(first, 'first');
  assert.equal(second, 'first');
  assert.equal(calls, 1);
  assert.equal(await run('third'), 'third');
  assert.equal(calls, 2);
});
