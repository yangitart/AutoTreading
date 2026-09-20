const test = require('node:test');
const assert = require('node:assert/strict');
const { technicalAgent, newsAgent, liquidityAgent, validateTradeIntent, criticalAgent, consensusAgent } = require('../src/main/agentOrchestrator');

test('el contrato de intención acepta una BUY coherente y normaliza el resultado', () => {
  const result = validateTradeIntent({ decision: 'buy', confidence: 72, entry: 100, stopLoss: 95, takeProfit: 112, riskNotes: ['volatilidad'] }, 101);
  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized, { decision: 'BUY', confidence: 72, entry: 100, stopLoss: 95, takeProfit: 112, riskNotes: ['volatilidad'] });
});

test('el contrato rechaza niveles incoherentes aunque el JSON sea válido', () => {
  const result = validateTradeIntent({ decision: 'BUY', confidence: 80, entry: 100, stopLoss: 105, takeProfit: 112, riskNotes: [] }, 100);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /stopLoss < entry < takeProfit/);
});

test('el veto crítico y el consenso conservan HOLD ante beneficio/riesgo insuficiente', () => {
  const intent = { decision: 'BUY', confidence: 90, entry: 100, stopLoss: 95, takeProfit: 102 };
  const technical = technicalAgent({ trend: 'bullish', rsi14: 60, volumeRatio: 1.4 });
  const critical = criticalAgent(intent, technical, { sentiment: 'neutral', score: 0 }, { atr14: 2 }, 100, { bias: 'bullish', score: 2 }, { bias: 'neutral', imbalance: 0 });
  const consensus = consensusAgent(intent, technical, {}, critical, { veto: false, issues: [] }, { bias: 'bullish', score: 2 }, {});
  assert.equal(critical.veto, true);
  assert.equal(consensus.decision, 'HOLD');
});

test('el agente de liquidez no usa un order book stale', () => {
  const result = liquidityAgent({ status: 'stale', bidLiquidity: 100000, askLiquidity: 1, spreadBps: 1 });
  assert.equal(result.status, 'stale');
  assert.equal(result.bias, 'neutral');
  assert.match(result.warnings.join(' '), /obsoleto/);
});

test('el agente de noticias pondera recencia y separa titulares stale', () => {
  const now = Date.now();
  const result = newsAgent([{ title: 'Bitcoin approved partnership gains', publishedAt: new Date(now - 2 * 3600000).toISOString() }, { title: 'Bitcoin hack crash', publishedAt: new Date(now - 100 * 3600000).toISOString() }, { title: 'Ethereum upgrade', publishedAt: new Date(now - 2 * 3600000).toISOString() }], 'BTCUSDT');
  assert.equal(result.relevantCount, 2);
  assert.equal(result.recentCount, 1);
  assert.equal(result.staleCount, 1);
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.items[0].recencyWeight, 1);
});
