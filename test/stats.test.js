const test=require('node:test');const assert=require('node:assert/strict');
const {computeTradingStats}=require('../src/renderer/stats');
test('P&L diario conserva movimientos entre días y ratios sin muestra son N/D',()=>{
 const data={initialCash:100,cash:110,currency:'USDT',positions:[],equityHistory:[{time:'2026-01-01T00:00:00Z',value:100},{time:'2026-01-01T23:00:00Z',value:105},{time:'2026-01-02T23:00:00Z',value:110}],llmTotalCostUsd:2};
 const s=computeTradingStats(data);assert.deepEqual(s.dailyPnl.map(d=>d.pnl),[5,5]);assert.equal(s.sharpe,null);assert.equal(s.winRate,null);assert.equal(s.llmCost,2);assert.equal(s.netAfterLlmPct,null);
});
test('profit factor y expectancy usan neto y agrupan fills de la misma salida',()=>{
 const data={initialCash:100,cash:103,positions:[],trades:[{id:'a',side:'SELL',realizedPnl:2,grossPnl:3,createdAt:'2026-01-01'},{id:'a',side:'SELL',realizedPnl:2,grossPnl:3,createdAt:'2026-01-01'},{id:'b',side:'SELL',realizedPnl:-1,grossPnl:0,createdAt:'2026-01-02'}]};
 const s=computeTradingStats(data);assert.equal(s.trades,2);assert.equal(s.profitFactor,4);assert.equal(s.expectancy,1.5);assert.equal(s.winRate,50);
});
