const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/paperHarness.cjs');

function setup(response = 'BUY') {
  const h = createHarness(), requests = [];
  h.context.fetch = async (url, options = {}) => {
    const u = new URL(url), ok = payload => ({ ok: true, status: 200, json: async () => payload, text: async () => '' });
    if (u.pathname.endsWith('/chat/completions')) {
      const body = JSON.parse(options.body); requests.push(body);
      if (response === '401') return { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) };
      const content = response === 'invalid' ? 'not JSON' : JSON.stringify({ decision: response, confidence: 90, thesis: 'Fixture controlada, sin predicción real.', entry: 100, stopLoss: 98, takeProfit: 104, riskNotes: [] });
      return ok({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    }
    if (u.pathname.endsWith('/klines')) {
      const step = u.searchParams.get('interval') === '1h' ? 3600000 : 900000;
      const start = Math.floor(Date.now() / step) * step - 100 * step;
      return ok(Array.from({ length: 100 }, (_, i) => [start+i*step,95+i*.05,95.1+i*.05,94.95+i*.05,95.04+i*.05,1000,start+(i+1)*step-1]));
    }
    if (u.pathname.endsWith('/ticker/bookTicker')) return ok({ bidPrice:'99.99',askPrice:'100.01' });
    if (u.pathname.endsWith('/depth')) return ok({ lastUpdateId:1,bids:[[99.99,100]],asks:[[100.01,100]] });
    if (u.pathname.endsWith('/exchangeInfo')) return ok({ symbols:[{ symbol:'BTCUSDT',status:'TRADING',baseAsset:'BTC',quoteAsset:'USDT',filters:[{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'100'},{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'NOTIONAL',minNotional:'5'}] }] });
    return ok({});
  };
  h.run('subscribeMarket = () => true');h.ready();
  h.invoke('secrets:saveKey', 'fake-local-fixture');
  return { h, requests };
}

test('preflight → HTTP LLM → schema → consenso → riesgo → fill → ledger', async () => {
  const {h,requests}=setup();
  const started=await h.invoke('paper:automation-start');
  assert.equal(started.started,true,JSON.stringify(started.preflight));
  await h.run('runPaperAutomation()');
  assert.equal(requests.length,1);assert.equal(requests[0].model,'gpt-5.6-luna');assert.equal(requests[0].reasoning_effort,'low');
  assert.equal(requests[0].max_completion_tokens,1600);assert.equal(requests[0].response_format.type,'json_schema');assert.equal(requests[0].temperature,undefined);
  const s=h.state();assert.equal(s.trades.length,1);assert.equal(s.trades[0].side,'BUY');assert.equal(s.orders[0].status,'filled');
  assert.ok(s.positions[0].stopLoss>0);assert.equal(s.analyses.length,1);assert.equal(s.llmUsage.calls,1);assert.ok(s.llmTotalCostUsd>0);
  assert.equal(h.run('verifyPaperIntegrity().valid'),true);assert.equal(JSON.stringify(s).includes('fake-local-fixture'),false);
  assert.ok(s.automation.history[0].events.some(e=>e.action==='submitted'));
});

test('HOLD guarda análisis sin crear órdenes',async()=>{
  const {h}=setup('HOLD');await h.invoke('paper:automation-start');await h.run('runPaperAutomation()');
  assert.equal(h.state().orders.length,0);assert.equal(h.state().analyses[0].decision,'HOLD');
});

for(const response of ['401','invalid'])test(`API ${response}: registra fallo y pausa sin operar`,async()=>{
  const {h}=setup(response);h.configure({llmFailurePauseThreshold:1});await h.invoke('paper:automation-start');await h.run('runPaperAutomation()');
  assert.equal(h.state().orders.length,0);assert.equal(h.run('settings().automationEnabled'),false);assert.ok(h.state().llmUsage.lastError);
});

test('presupuesto de llamadas impide una segunda llamada facturable',async()=>{
  const {h,requests}=setup('HOLD');h.configure({llmDailyCallBudget:1});
  await h.invoke('paper:automation-start');await h.run('runPaperAutomation()');
  const next=await h.invoke('paper:automation-start');assert.equal(next.started,false);assert.equal(requests.length,1);
});

test('sin clave el preflight explica el requisito y no consulta al LLM',async()=>{
  const h=createHarness();h.run('subscribeMarket=()=>true');h.ready();
  const preflight=await h.run('buildAutomationPreflight({config:settings(),current:state(),apiKeyPresent:false,integrity:verifyPaperIntegrity()})');
  assert.equal(preflight.ready,false);assert.ok(preflight.checks.some(c=>c.label==='API key LLM'&&!c.ok));
});
