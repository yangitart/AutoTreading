const { freshQuote } = require('./quoteQuality');
const DEFAULT_LIVE_LIMITS = Object.freeze({quoteAsset:'USDT',symbols:['BTCUSDT','ETHUSDT','SOLUSDT'],maxOrderNotional:25,maxDailyBuyNotional:100,maxOpenOrders:5,maxSpreadBps:50,maxPriceDeviationPct:2,maxAssetExposurePct:35,maxTotalExposurePct:75,maxDrawdownPct:10,maxDailyLossPct:3});
function validateLimits(input={}) {
  const limits={...DEFAULT_LIVE_LIMITS,...input};
  if(!['USDT','USDC'].includes(limits.quoteAsset))throw new Error('Selecciona USDT o USDC como moneda de límites.');
  limits.symbols=[...new Set((Array.isArray(limits.symbols)?limits.symbols:String(limits.symbols).split(',')).map(s=>String(s).trim().toUpperCase()))];
  if(!limits.symbols.length||limits.symbols.length>10||limits.symbols.some(s=>!(/^[A-Z0-9]{5,20}$/).test(s)||!s.endsWith(limits.quoteAsset)))throw new Error('Símbolos o moneda de límites inválidos.');
  for(const key of Object.keys(DEFAULT_LIVE_LIMITS).filter(k=>typeof DEFAULT_LIVE_LIMITS[k]==='number')){limits[key]=Number(limits[key]);if(!Number.isFinite(limits[key])||limits[key]<=0)throw new Error(`Límite inválido: ${key}.`);}
  if(limits.maxOrderNotional>10000||limits.maxDailyBuyNotional>100000||limits.maxOpenOrders>20||!Number.isInteger(limits.maxOpenOrders)||['maxAssetExposurePct','maxTotalExposurePct','maxDrawdownPct','maxDailyLossPct','maxPriceDeviationPct'].some(k=>limits[k]>100))throw new Error('Los límites exceden el alcance de esta versión spot.');
  return limits;
}
function normalizeRequest(order={}) {
  const result={symbol:String(order.symbol||'').trim().toUpperCase(),side:String(order.side||'').toUpperCase(),type:String(order.type||'').toUpperCase(),quantity:Number(order.quantity),price:order.type==='MARKET'?null:Number(order.price)};
  if(!/^[A-Z0-9]{5,20}$/.test(result.symbol)||!['BUY','SELL'].includes(result.side)||!['MARKET','LIMIT'].includes(result.type)||!Number.isFinite(result.quantity)||result.quantity<=0||(result.type==='LIMIT'&&(!Number.isFinite(result.price)||result.price<=0)))throw new Error('Símbolo, lado, cantidad o precio inválido.');
  if(result.type==='MARKET')result.price=null;
  return result;
}
function aligned(value,step){return !Number(step)||Math.abs(value/Number(step)-Math.round(value/Number(step)))<1e-7;}
function validateLiveOrder({order,instrument,quote,state,limits,now=Date.now()}) {
  if(!freshQuote(quote,10000,now))throw new Error('La cotización del broker está obsoleta.');
  if(instrument.symbol!==order.symbol||instrument.status!=='TRADING'||instrument.isSpotTradingAllowed===false||!instrument.orderTypes?.includes(order.type))throw new Error('El instrumento no admite esta orden spot.');
  if(instrument.quoteAsset!==limits.quoteAsset||!limits.symbols.includes(order.symbol))throw new Error('Activo fuera del universo o moneda autorizados.');
  const filters=Object.fromEntries((instrument.filters||[]).map(f=>[f.filterType,f]));
  for(const key of ['LOT_SIZE',...(order.type==='MARKET'?['MARKET_LOT_SIZE']:[])]){
    const f=filters[key];if(!f)continue;
    if(!aligned(order.quantity,f.stepSize)||order.quantity<Number(f.minQty||0)||(Number(f.maxQty)>0&&order.quantity>Number(f.maxQty)))throw new Error(`Cantidad fuera de ${key}; lote ${f.stepSize}, mínimo ${f.minQty}.`);
  }
  if(order.type==='LIMIT'){
    const f=filters.PRICE_FILTER;if(f&&(!aligned(order.price,f.tickSize)||order.price<Number(f.minPrice||0)||(Number(f.maxPrice)>0&&order.price>Number(f.maxPrice))))throw new Error(`Precio fuera de tick/rango del instrumento (${f.tickSize}).`);
  }
  const market=order.side==='BUY'?quote.ask:quote.bid,price=order.type==='LIMIT'?order.price:market,notional=price*order.quantity,spread=(quote.ask-quote.bid)/((quote.ask+quote.bid)/2)*10000;
  for(const key of ['MIN_NOTIONAL','NOTIONAL']){
    const f=filters[key];if(!f)continue;
    if((order.type==='LIMIT'||f.applyToMarket===true||f.applyMinToMarket===true)&&notional<Number(f.minNotional||0))throw new Error(`Nocional inferior al mínimo (${f.minNotional} ${limits.quoteAsset}).`);
    if((order.type==='LIMIT'||f.applyMaxToMarket===true)&&Number(f.maxNotional)>0&&notional>Number(f.maxNotional))throw new Error('Nocional superior al máximo del instrumento.');
  }
  if(notional>limits.maxOrderNotional+1e-8)throw new Error(`Supera el límite por orden de ${limits.maxOrderNotional} ${limits.quoteAsset}.`);
  if(spread>limits.maxSpreadBps)throw new Error('Spread superior al límite autorizado.');
  if(order.type==='LIMIT'&&Math.abs(price/market-1)*100>limits.maxPriceDeviationPct)throw new Error('Precio límite demasiado alejado del mercado.');
  const open=state.orders.filter(o=>['accepted','partial','cancelling','unknown'].includes(o.status));
  if(open.length>=limits.maxOpenOrders)throw new Error('Límite de órdenes abiertas alcanzado.');
  const balances=state.account.balances,free=asset=>Number(balances.find(b=>b.asset===asset)?.free||0);
  if(order.side==='BUY'&&notional*1.01>free(instrument.quoteAsset))throw new Error('Saldo libre insuficiente, incluyendo margen para costes.');
  if(order.side==='SELL'&&order.quantity>free(instrument.baseAsset)+1e-12)throw new Error('Saldo libre del activo insuficiente; solo se admiten ventas spot.');
  if(order.side==='BUY'){
    if(state.unpricedAssets?.length)throw new Error('No se puede medir exposición: hay activos sin cotización.');
    const today=new Date(now).toISOString().slice(0,10),daily=state.commands.filter(c=>c.order.side==='BUY'&&c.createdAt.slice(0,10)===today&&c.status!=='rejected').reduce((n,c)=>n+Number(c.notional||0),0);
    if(daily+notional>limits.maxDailyBuyNotional)throw new Error('Límite diario de compras alcanzado.');
    const metrics=state.metrics||{};
    if(metrics.drawdownPct>=limits.maxDrawdownPct||metrics.dailyLossPct>=limits.maxDailyLossPct)throw new Error('Límite de pérdida diaria o drawdown activo.');
    const pending=open.filter(o=>o.side==='BUY').reduce((n,o)=>n+Math.max(0,o.quantity-o.executedQuantity)*(o.price||market),0);
    const pendingAsset=open.filter(o=>o.side==='BUY'&&o.symbol===order.symbol).reduce((n,o)=>n+Math.max(0,o.quantity-o.executedQuantity)*(o.price||market),0);
    const asset=Number(state.valuations?.[instrument.baseAsset]||0),equity=Number(metrics.equity||0),exposure=Number(metrics.exposure||0);
    if(!(equity>0)||exposure+pending+notional>equity*limits.maxTotalExposurePct/100||asset+pendingAsset+notional>equity*limits.maxAssetExposurePct/100)throw new Error('La compra supera los límites de exposición.');
  }
  return {notional,referencePrice:market,spreadBps:spread,baseAsset:instrument.baseAsset,quoteAsset:instrument.quoteAsset,feeBufferPct:1};
}
module.exports={DEFAULT_LIVE_LIMITS,validateLimits,normalizeRequest,validateLiveOrder};
