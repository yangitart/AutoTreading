const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutomationPreflight } = require('../src/main/automationPreflight');

const base = { mode: 'paper', endpoint: 'https://llm.example/v1', model: 'model', accountCurrency: 'USDT', feeRate: 0.001, slippageBps: 10, maxOrderPct: 25, maxExposurePct: 75, maxAssetExposurePct: 35, partialFillPct: 100, maxDataAgeMs: 15000, intrabarPolicy: 'conservative', riskPerTradePct: 1, requireStopForAuto: true, llmDailyCallBudget: 24, llmDailyBudgetUsd: 1, automationSymbols: ['BTCUSDT'] };
const market = { BTCUSDT: { ok: true, quoteFresh: true, marketValid: true, instrumentTrading: true, currencyCompatible: true, detail: 'Feed fresco.', instrumentDetail: 'TRADING/USDT.' } };

test('el preflight aprueba una configuración paper completa', () => {
  const result = buildAutomationPreflight({ config: base, current: { initialCash: 100, cash: 100, currency: 'USDT', paused: false, automation: { status: 'paused' } }, apiKeyPresent: true, integrity: { valid: true }, marketChecks: market, todayUsage: { calls: 0, estimatedCostUsd: 0 } });
  assert.equal(result.ready, true);
  assert.equal(result.checks.every(check => check.ok), true);
});

test('el preflight rechaza feed stale y cuenta pausada', () => {
  const result = buildAutomationPreflight({ config: base, current: { initialCash: 100, cash: 100, currency: 'USDT', paused: true, pauseReason: 'manual', automation: { status: 'paused' } }, apiKeyPresent: true, integrity: { valid: true }, marketChecks: { BTCUSDT: { ok: true, quoteFresh: false, marketValid: false, instrumentTrading: true, currencyCompatible: true, detail: 'stale' } }, todayUsage: { calls: 0, estimatedCostUsd: 0 } });
  assert.equal(result.ready, false);
  assert.equal(result.checks.some(check => check.label === 'Cuenta sin pausa' && !check.ok), true);
  assert.equal(result.checks.some(check => check.label === 'Feed BTCUSDT' && !check.ok), true);
});

test('el preflight rechaza una segunda ejecución mientras la primera inicia', () => {
  const result = buildAutomationPreflight({ config: base, current: { initialCash: 100, cash: 100, currency: 'USDT', paused: false, automation: { status: 'starting' } }, apiKeyPresent: true, integrity: { valid: true }, marketChecks: market, todayUsage: { calls: 0, estimatedCostUsd: 0 } });
  assert.equal(result.ready, false);
  assert.equal(result.checks.some(check => check.label === 'Sin corrida activa' && !check.ok), true);
});
