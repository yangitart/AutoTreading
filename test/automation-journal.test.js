const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationRun, updateAutomationRun, recoverStaleAutomation } = require('../src/main/automationJournal');

test('conserva una corrida y sus eventos de decisión/ejecución', () => {
  const run = createAutomationRun('run-1', ['BTCUSDT'], '2026-01-01T00:00:00.000Z');
  const history = updateAutomationRun([run], 'run-1', { event: { symbol: 'BTCUSDT', action: 'skipped', reason: 'confidence' } });
  const finished = updateAutomationRun(history, 'run-1', { status: 'completed', durationMs: 120 });
  assert.equal(finished[0].events[0].action, 'skipped');
  assert.equal(finished[0].status, 'completed');
  assert.equal(finished[0].durationMs, 120);
});

test('no modifica corridas de otro runId', () => {
  const history = [createAutomationRun('run-1'), createAutomationRun('run-2')];
  const updated = updateAutomationRun(history, 'run-2', { event: { action: 'failed' } });
  assert.equal(updated[0].events.length, 0);
  assert.equal(updated[1].events.length, 1);
});

test('recupera una corrida running sin heartbeat y la marca interrupted', () => {
  const run = createAutomationRun('run-1', ['BTCUSDT'], '2026-01-01T00:00:00.000Z');
  const result = recoverStaleAutomation([run], Date.parse('2026-01-01T00:05:00.000Z'), 120000);
  assert.equal(result.recovered, true);
  assert.equal(result.history[0].status, 'interrupted');
  assert.equal(result.history[0].events[0].action, 'interrupted');
});

test('conserva eventos de fase junto a las decisiones de una corrida', () => {
  const run = createAutomationRun('run-1', ['BTCUSDT']);
  const history = updateAutomationRun([run], 'run-1', { event: { action: 'progress', phase: 'technical-agent', status: 'completed' } });
  assert.equal(history[0].events[0].action, 'progress');
  assert.equal(history[0].events[0].phase, 'technical-agent');
});
