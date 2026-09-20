const test = require('node:test');
const assert = require('node:assert/strict');
const { safeAutomationStartup } = require('../src/main/automationStartup');

test('fuerza pausa al abrir aunque hubiera quedado habilitado', () => {
  const result = safeAutomationStartup({ automationEnabled: true, mode: 'paper' }, { status: 'running' }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(result.settings.automationEnabled, false);
  assert.equal(result.automation.status, 'paused');
  assert.match(result.automation.pausedReason, /preflight/);
});
