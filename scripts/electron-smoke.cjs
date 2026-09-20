// Development-only integration check. Uses a fresh profile and virtual money.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-trader-qa-'));
const output = path.resolve(__dirname, '../artifacts');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile);
const errors=[];
app.on('web-contents-created', (_e, contents) => {
  contents.on('console-message', (_event, details) => { if(details.level==='error')errors.push(details.message); });
  contents.on('render-process-gone', (_event, details)=>errors.push(JSON.stringify(details)));
});
require('../src/main/main.js');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try {
    const window=BrowserWindow.getAllWindows()[0];window.setSize(1440,1080);
    while(window.webContents.isLoading())await wait(100);
    let ready=false;
    for(let i=0;i<45;i++){
      ready=await window.webContents.executeJavaScript('Boolean(typeof snapshot!=="undefined" && snapshot && terminal.instrument && terminal.quotes.BTCUSDT && document.querySelector("#sessionOverview")?.children.length===3)');
      if(ready)break;await wait(1000);
    }
    assert.ok(ready,'Terminal did not receive a fresh public quote/instrument within 45 seconds');
    const initial=await window.webContents.executeJavaScript('window.traderAPI.snapshot()');
    assert.equal(initial.state.cash,100);assert.equal(initial.state.automation.status,'paused');assert.equal(initial.integrity.valid,true);
    fs.writeFileSync(path.join(output,'terminal.png'),(await window.webContents.capturePage()).toPNG());
    const trade=await window.webContents.executeJavaScript(`(async()=>{
      const i=await window.traderAPI.loadInstrument('BTCUSDT'),q=terminal.quotes.BTCUSDT;
      const quantity=Number((Math.ceil(Math.max(i.minQty,i.minNotional*1.1/q.ask)/i.stepSize)*i.stepSize).toFixed(12));
      const buy=await window.traderAPI.executePaper({symbol:'BTCUSDT',side:'BUY',quantity,clientOrderId:'smoke-buy'});
      const position=buy.positions.find(p=>p.symbol==='BTCUSDT');if(!position)throw new Error('Buy did not fill');
      await window.traderAPI.pausePaper();
      const sell=await window.traderAPI.executePaper({symbol:'BTCUSDT',side:'SELL',quantity:position.quantity,clientOrderId:'smoke-sell'});
      snapshot.state=sell;
      return {buyCount:buy.trades.length,sellCount:sell.trades.length,positions:sell.positions.length,cash:sell.cash,integrity:await window.traderAPI.verifyPaper()};
    })()`);
    assert.equal(trade.positions,0);assert.equal(trade.sellCount,2);assert.equal(trade.integrity.valid,true);
    const pages={};
    for(const page of ['research','agents','settings','dashboard']){
      pages[page]=await window.webContents.executeJavaScript(`navigate('${page}'); document.querySelector('#page').textContent.length`);
      assert.ok(pages[page]>100,`Empty ${page}`);
    }
    const ui=await window.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,hasResume:document.querySelector('#pauseEntries').textContent,orders:(terminal.tab='orders',updateTerminal(),document.querySelector('#ledgerContent').textContent)})`);
    assert.equal(ui.overflow,false);assert.match(ui.hasResume,/Reanudar/);
    await window.webContents.executeJavaScript(`document.querySelector('.portfolio-panel').scrollIntoView({block:'end',behavior:'instant'})`);
    fs.writeFileSync(path.join(output,'orders.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`terminal.tab='performance';updateTerminal()`);
    fs.writeFileSync(path.join(output,'performance.png'),(await window.webContents.capturePage()).toPNG());
    window.setSize(1100,840);
    await window.webContents.executeJavaScript(`terminal.tab='positions';updateTerminal();scrollTo({top:0,behavior:'instant'})`);
    const narrow=await window.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,ticket:Boolean(document.querySelector('#submitTicket'))})`);
    assert.equal(narrow.overflow,false);assert.equal(narrow.ticket,true);
    fs.writeFileSync(path.join(output,'terminal-compact.png'),(await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors,[]);
    const result={ok:true,checkedAt:new Date().toISOString(),profile,transport:initial.state.marketHealth.symbols.BTCUSDT.transport,trade,pages,ui,rendererErrors:errors};
    fs.writeFileSync(path.join(output,'smoke-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit();
  }catch(error){console.error(error.stack);fs.writeFileSync(path.join(output,'smoke-result.json'),JSON.stringify({ok:false,error:error.stack,rendererErrors:errors},null,2));app.exit(1);}
});
