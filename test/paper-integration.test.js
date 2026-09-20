const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, quote, instrument, submit } = require('./helpers/paperHarness.cjs');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
const integrity = h => assert.deepEqual(Array.from(h.run('verifyPaperIntegrity().issues')), []);

test('round trip, cierre parcial, ledger y reinicio conservan costes y efectivo', () => {
  const h = createHarness(); h.configure({ slippageBps: 0 });
  submit(h); near(h.state().cash,79.98); integrity(h);
  submit(h,{side:'SELL',quantity:0.1,quote:quote(110),price:110});
  near(h.state().cash,90.969); near(h.state().grossRealizedPnl,1); near(h.state().netRealizedPnl,0.979); integrity(h);
  const restarted = createHarness(h.files); integrity(restarted);
  submit(restarted,{side:'SELL',quantity:0.1}); near(restarted.state().cash,100.959); near(restarted.state().netRealizedPnl,0.959); integrity(restarted);
});

test('compra/venta a precio constante pierde exactamente fees y slippage', () => {
  const h=createHarness();submit(h);submit(h,{side:'SELL'});
  near(h.state().cash,99.92); near(h.state().feesPaid,0.04); near(h.state().slippagePaid,0.04);integrity(h);
});

test('idempotencia, cash reservado, cancelación y venta excesiva', () => {
  const h=createHarness();h.configure({slippageBps:0});
  submit(h,{clientOrderId:'once'});submit(h,{clientOrderId:'once'});assert.equal(h.state().trades.length,1);
  assert.throws(()=>submit(h,{side:'SELL',quantity:1}),/Cantidad no disponible/);
  const queued=submit(h,{quantity:0.1,orderType:'limit',limitPrice:90,clientOrderId:'pending'});
  near(queued.reservedCash,9.009);integrity(h);
  h.context.id=queued.orders[0].id;h.run('cancelPaperOrder(id)');near(h.state().reservedCash,0);integrity(h);
});

test('rechaza entradas inválidas/obsoletas antes de aceptar órdenes pendientes', () => {
  const h=createHarness();
  for(const values of [{quantity:NaN},{quantity:-1},{side:'INVALID'},{quote:{...quote(),fetchedAt:Date.now()-60000}},{quantity:0.0001},{stopLoss:Infinity}])assert.throws(()=>submit(h,{orderType:'limit',limitPrice:90,...values}));
  assert.equal(h.state().orders.length,0);integrity(h);
});

test('pausa y kill bloquean BUY, permiten SELL y liberan reservas', () => {
  const h=createHarness();h.configure({slippageBps:0});submit(h);
  submit(h,{quantity:0.1,orderType:'limit',limitPrice:90});h.run('killPaper()');near(h.state().reservedCash,0);
  assert.throws(()=>submit(h),/pausad/);submit(h,{side:'SELL'});assert.equal(h.state().positions.length,0);integrity(h);
});

test('stop tras desconexión se ejecuta al bid disponible, no al stop ficticio', async () => {
  const h=createHarness();h.configure({slippageBps:0});submit(h,{stopLoss:96});
  h.context.tick={...quote(80),fetchedAt:Date.now()-60000};await h.run('markToMarket("BTCUSDT",80,tick)');assert.equal(h.state().positions.length,1);
  h.context.tick=quote(80);await h.run('markToMarket("BTCUSDT",80,tick)');
  assert.equal(h.state().positions.length,0);near(h.state().trades[0].price,80);integrity(h);
});

test('fills parciales liberan reservas y no sobrepasan liquidez', async () => {
  const h=createHarness();h.configure({slippageBps:0,partialFillPct:50,liquidityNotionalPerTick:5});
  submit(h,{quantity:0.2});near(h.state().orders[0].filledQuantity,0.05);integrity(h);
  for(let i=0;i<10;i++){h.context.tick=quote();await h.run('markToMarket("BTCUSDT",100,tick)');}
  near(h.state().orders[0].filledQuantity,0.2);near(h.state().reservedCash,0);integrity(h);
});

test('IPC fuerza source manual e impide saltarse riesgo con risk-exit', async () => {
  const h=createHarness();h.run('subscribeMarket = () => true');h.ready();
  h.context.testQuote=quote();h.context.testInstrument=instrument;h.run('fetchQuote = async () => testQuote; fetchInstrument = async () => testInstrument');
  await assert.rejects(h.invoke('paper:execute',{symbol:'BTCUSDT',side:'BUY',quantity:0.8,source:'risk-exit'}),/límite/);
  assert.equal(h.state().trades.length,0);integrity(h);
});

test('detener durante LLM invalida la decisión que llega tarde', async () => {
  const h=createHarness();h.context.release=null;
  h.run('apiKey = () => "test"; writeJson(SETTINGS_FILE,{...settings(),automationEnabled:true}); automationStartApproved=true; analyzeMarket=()=>new Promise(resolve=>globalThis.release=resolve)');
  const run=h.run('runPaperAutomation(true)');await new Promise(resolve=>setImmediate(resolve));
  h.run('stopPaperAutomation()');h.context.release({symbol:'BTCUSDT',decision:'BUY',confidence:99,entry:100,stopLoss:96,takeProfit:110});await run;
  assert.equal(h.state().orders.length,0);assert.equal(h.state().automation.status,'stopped');
});

test('fallback REST con WebSocket fallando mantiene cotización fresca', async () => {
  const h=createHarness();h.context.testQuote=quote();h.run('fetchQuote = async () => testQuote; fetchDepth = async () => null; WebSocket = class { constructor(){throw new Error("offline")} }');
  h.run('subscribeMarket(["BTCUSDT"])');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state().marketHealth.status,'live');assert.equal(h.state().marketHealth.symbols.BTCUSDT.transport,'rest');
  for(const t of h.timers)if(t.ms===3000)await t.fn();integrity(h);
});

test('migración de ledger conserva historial y añade corrección auditable', () => {
  const h=createHarness();h.configure({slippageBps:0});submit(h);submit(h,{side:'SELL',price:110,quote:quote(110)});
  h.run('const legacy=state();legacy.schemaVersion=4;for(const m of legacy.ledger){if(m.side==="SELL"){m.entries=m.entries.filter(e=>e.account!=="realized-pnl");m.entries.find(e=>e.account.startsWith("asset:")).amount=22;}}writeJson(STATE_FILE,legacy)');
  const restarted=createHarness(h.files);integrity(restarted);assert.equal(restarted.state().ledger.at(-1).type,'accounting-migration');
});

test('aumentar posición y bajar su stop reevalúa el riesgo de toda la posición',()=>{
  const h=createHarness();h.configure({slippageBps:0,riskPerTradePct:5});submit(h,{quantity:0.25,stopLoss:97});
  assert.throws(()=>submit(h,{quantity:0.05,stopLoss:60}),/riesgo agregado/);near(h.state().positions[0].quantity,0.25);integrity(h);
});

test('cuenta corrupta o futura nunca se sustituye por saldo inicial',()=>{
  const h=createHarness();h.run('state();writeJson(STATE_FILE,{...state(),schemaVersion:999})');assert.throws(()=>h.state(),/más nueva/);
  h.run('fs.writeFileSync(STATE_FILE,"{invalid")');assert.throws(()=>h.state(),/No se pudo leer/);
});
