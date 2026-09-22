const crypto = require('crypto');

const BASE_URLS = Object.freeze({ mainnet: 'https://api.binance.com', testnet: 'https://testnet.binance.vision', demo: 'https://demo-api.binance.com' });
const STREAM_URLS = { mainnet: 'wss://stream.binance.com:9443/ws', testnet: 'wss://stream.testnet.binance.vision/ws', demo: 'wss://demo-stream.binance.com/ws' };
function baseUrl(environment = 'testnet') { if (!Object.hasOwn(BASE_URLS, environment)) throw new Error('Entorno Binance inválido.'); return BASE_URLS[environment]; }
function streamUrl(environment, listenKey) { baseUrl(environment); return `${STREAM_URLS[environment]}/${encodeURIComponent(listenKey)}`; }
function signedQuery(params, secret) {
  const query = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => [k,String(v)])).toString();
  return { query, signature: crypto.createHmac('sha256',secret).update(query).digest('hex') };
}
function normalizeBinanceStatus(status) { return ({ NEW:'accepted',PENDING_NEW:'accepted',PARTIALLY_FILLED:'partial',FILLED:'filled',CANCELED:'cancelled',EXPIRED:'expired',EXPIRED_IN_MATCH:'expired',REJECTED:'rejected',PENDING_CANCEL:'cancelling' })[String(status).toUpperCase()] || 'unknown'; }
function normalizeBinanceOrder(o = {}) {
  const executedQuantity = Number(o.executedQty ?? o.z ?? 0), quoteQuantity = Number(o.cummulativeQuoteQty ?? o.Z ?? 0);
  return { provider:'binance',providerOrderId:o.orderId??o.i??null,clientOrderId:o.clientOrderId??o.c??null,symbol:o.symbol??o.s??null,side:o.side??o.S??null,type:o.type??o.o??null,status:normalizeBinanceStatus(o.status??o.X),quantity:Number(o.origQty??o.q??0),executedQuantity,quoteQuantity,price:Number(o.price??o.p??0),averagePrice:executedQuantity>0?quoteQuantity/executedQuantity:0,commission:Number(o.commission??o.n??0),commissionAsset:o.commissionAsset??o.N??null,eventTime:o.updateTime??o.eventTime??o.E??o.transactTime??o.T??null,transactTime:o.transactTime??o.T??o.time??null };
}
class BrokerError extends Error {
  constructor(message, { code=null, status=null, ambiguous=false, retryAfterMs=0 }={}) { super(message); Object.assign(this,{code,status,ambiguous,retryAfterMs}); }
}
function decimal(value) { const n=Number(value); if(!Number.isFinite(n)||n<=0)throw new Error('Número de orden inválido.'); return n.toFixed(12).replace(/\.?0+$/,''); }

class BinanceSpotClient {
  constructor({ apiKey, secret, environment='testnet', fetchImpl=globalThis.fetch, now=Date.now, allowMainnet=false }={}) {
    Object.assign(this,{apiKey,secret,environment,fetchImpl,now,allowMainnet}); this.base=baseUrl(environment);this.offset=0;this.syncedAt=null;this.retryAt=0;
  }
  async request(method, route, params={}, signed=false) {
    if(this.now()<this.retryAt)throw new BrokerError('Binance solicita esperar antes de reintentar.',{status:429,retryAfterMs:this.retryAt-this.now()});
    let query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)])).toString();
    if(signed){
      if(!this.apiKey||!this.secret)throw new BrokerError('Faltan credenciales del broker.');
      if(this.syncedAt===null||this.now()-this.syncedAt>60000)await this.syncTime();
      const signature=signedQuery({...params,recvWindow:5000,timestamp:Math.round(this.now()+this.offset)},this.secret);query=`${signature.query}&signature=${signature.signature}`;
    }
    const mutating=method!=='GET';let response;
    try{response=await this.fetchImpl(`${this.base}${route}${query?'?'+query:''}`,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(signed?{'X-MBX-APIKEY':this.apiKey}:{})}});}
    catch{throw new BrokerError('No se recibió respuesta de Binance. Consulta el estado antes de reintentar.',{ambiguous:mutating});}
    let data;try{data=await response.json();}catch{throw new BrokerError(`Respuesta ilegible de Binance (${response.status}).`,{status:response.status,ambiguous:mutating});}
    if(!response.ok){
      const retryAfterMs=[418,429].includes(response.status)?Math.max(1000,Number(response.headers?.get('retry-after')||60)*1000):0;
      this.retryAt=this.now()+retryAfterMs;
      const message=response.status===451?'Binance no está disponible desde esta ubicación (HTTP 451).':String(data.msg||`Binance respondió ${response.status}.`).slice(0,300);
      throw new BrokerError(message,{code:data.code,status:response.status,ambiguous:mutating&&(response.status>=500||[-1006,-1007].includes(data.code)),retryAfterMs});
    }
    return data;
  }
  async syncTime(){const start=this.now(),data=await this.request('GET','/api/v3/time');if(!Number.isFinite(data.serverTime))throw new BrokerError('Hora del servidor inválida.');this.offset=data.serverTime-(start+this.now())/2;this.syncedAt=this.now();return data;}
  getServerTime(){return this.request('GET','/api/v3/time');}
  async getAccount(){const p=await this.request('GET','/api/v3/account',{omitZeroBalances:true},true);return {...p,environment:this.environment};}
  getOpenOrders(symbol){return this.request('GET','/api/v3/openOrders',{symbol},true);}
  getOrder({symbol,orderId,clientOrderId}){return this.request('GET','/api/v3/order',{symbol,orderId,origClientOrderId:orderId?undefined:clientOrderId},true);}
  getTrades({symbol,orderId}){return this.request('GET','/api/v3/myTrades',{symbol,orderId,limit:1000},true);}
  getPermissions(){return this.request('GET','/sapi/v1/account/apiRestrictions',{},true);}
  async getInstrument(symbol){const p=await this.request('GET','/api/v3/exchangeInfo',{symbol});const i=p.symbols?.find(i=>i.symbol===symbol);if(!i)throw new BrokerError('Instrumento no disponible en este entorno.');return i;}
  async getQuote(symbol){const p=await this.request('GET','/api/v3/ticker/bookTicker',{symbol});return {symbol,bid:Number(p.bidPrice),ask:Number(p.askPrice),fetchedAt:this.now(),environment:this.environment};}
  async placeOrder({symbol,side,type='MARKET',quantity,price,clientOrderId}){
    if(this.environment==='mainnet'&&!this.allowMainnet)throw new Error('Adaptador mainnet sin autorización.');
    if(!/^[A-Z0-9]{5,20}$/.test(symbol)||!['BUY','SELL'].includes(side)||!['MARKET','LIMIT'].includes(type)||!/^lt-[a-zA-Z0-9_-]{1,32}$/.test(clientOrderId))throw new Error('Orden del broker inválida.');
    return this.request('POST','/api/v3/order',{symbol,side,type,quantity:decimal(quantity),newClientOrderId:clientOrderId,newOrderRespType:'FULL',...(type==='LIMIT'?{price:decimal(price),timeInForce:'GTC'}:{})},true);
  }
  cancelOrder({symbol,orderId,clientOrderId}){
    if(this.environment==='mainnet'&&!this.allowMainnet)throw new Error('Adaptador mainnet sin autorización.');
    return this.request('DELETE','/api/v3/order',{symbol,orderId,origClientOrderId:orderId?undefined:clientOrderId},true);
  }
}
module.exports={BinanceSpotClient,BrokerError,BASE_URLS,STREAM_URLS,baseUrl,streamUrl,signedQuery,normalizeBinanceOrder,normalizeBinanceStatus,decimal};
