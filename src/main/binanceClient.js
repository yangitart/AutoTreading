const crypto = require('crypto');

const BASE_URLS = {
  mainnet: 'https://api.binance.com',
  testnet: 'https://testnet.binance.vision',
  demo: 'https://demo-api.binance.com'
};
const STREAM_URLS = { mainnet: 'wss://stream.binance.com:9443/ws', testnet: 'wss://stream.testnet.binance.vision/ws', demo: 'wss://stream.binance.com/ws' };

function baseUrl(environment = 'testnet') { return BASE_URLS[environment] || BASE_URLS.testnet; }
function streamUrl(environment = 'testnet', listenKey) { return `${STREAM_URLS[environment] || STREAM_URLS.testnet}/${encodeURIComponent(listenKey)}`; }

function normalizeBinanceStatus(status) { return ({ NEW: 'accepted', PARTIALLY_FILLED: 'partial', FILLED: 'filled', CANCELED: 'cancelled', EXPIRED: 'expired', REJECTED: 'rejected' }[String(status || '').toUpperCase()] || 'failed'); }
function normalizeBinanceOrder(order = {}) { return { provider: 'binance', providerOrderId: order.orderId || order.i || null, clientOrderId: order.clientOrderId || order.c || null, symbol: order.symbol || order.s || null, side: order.side || order.S || null, type: order.type || order.o || null, status: normalizeBinanceStatus(order.status || order.X), quantity: Number(order.origQty || order.q || 0), executedQuantity: Number(order.executedQty || order.z || 0), price: Number(order.price || order.p || 0), averagePrice: Number(order.avgPrice || order.ap || 0), lastFillPrice: Number(order.lastExecutedPrice || order.L || 0), commission: Number(order.commission || order.n || 0), commissionAsset: order.commissionAsset || order.N || null, eventTime: order.eventTime || order.E || null, transactTime: order.transactTime || order.T || null, raw: order }; }

function signedQuery(params, secret) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])).toString();
  return { query, signature: crypto.createHmac('sha256', secret).update(query).digest('hex') };
}

class BinanceSpotClient {
  constructor({ apiKey, secret, environment = 'testnet' }) { this.apiKey = apiKey; this.secret = secret; this.environment = environment; this.base = baseUrl(environment); }

  async getServerTime() {
    const response = await fetch(`${this.base}/api/v3/time`, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Binance no responde (${response.status}).`);
    return response.json();
  }

  async getAccount() {
    if (!this.apiKey || !this.secret) throw new Error('Faltan las credenciales del broker.');
    const timestamp = Date.now(), { query, signature } = signedQuery({ omitZeroBalances: true, recvWindow: 5000, timestamp }, this.secret);
    const response = await fetch(`${this.base}/api/v3/account?${query}&signature=${signature}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'X-MBX-APIKEY': this.apiKey } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.msg || `La cuenta Binance respondió ${response.status}.`);
    return { environment: this.environment, canTrade: Boolean(payload.canTrade), canWithdraw: Boolean(payload.canWithdraw), canDeposit: Boolean(payload.canDeposit), accountType: payload.accountType, balances: payload.balances || [], serverTime: payload.serverTime || null };
  }

  async getOpenOrders(symbol) {
    if (!this.apiKey || !this.secret) throw new Error('Faltan las credenciales del broker.');
    const params = { recvWindow: 5000, timestamp: Date.now() }; if (symbol) params.symbol = String(symbol).toUpperCase();
    const { query, signature } = signedQuery(params, this.secret);
    const response = await fetch(`${this.base}/api/v3/openOrders?${query}&signature=${signature}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'X-MBX-APIKEY': this.apiKey } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.msg || `Las órdenes Binance respondieron ${response.status}.`);
    return payload;
  }

  async createListenKey() {
    if (!this.apiKey) throw new Error('Falta la API key del broker.');
    const response = await fetch(`${this.base}/api/v3/userDataStream`, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'X-MBX-APIKEY': this.apiKey } });
    const payload = await response.json(); if (!response.ok) throw new Error(payload?.msg || `No se pudo abrir User Data Stream (${response.status}).`); return payload;
  }

  async keepAliveListenKey(listenKey) {
    const response = await fetch(`${this.base}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, { method: 'PUT', signal: AbortSignal.timeout(10000), headers: { 'X-MBX-APIKEY': this.apiKey } });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload?.msg || `No se pudo renovar User Data Stream (${response.status}).`); }
    return true;
  }

  async signedRequest(method, path, params = {}) {
    if (!this.apiKey || !this.secret) throw new Error('Faltan las credenciales del broker.');
    const { query, signature } = signedQuery({ ...params, recvWindow: params.recvWindow || 5000, timestamp: params.timestamp || Date.now() }, this.secret);
    const response = await fetch(`${this.base}${path}?${query}&signature=${signature}`, { method, signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'X-MBX-APIKEY': this.apiKey } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.msg || `Binance respondió ${response.status}.`);
    return payload;
  }

  async placeOrder({ symbol, side, type = 'MARKET', quantity, price, clientOrderId }) {
    if (this.environment === 'mainnet') throw new Error('Las órdenes en mainnet están bloqueadas en esta versión.');
    const normalizedType = String(type).toUpperCase();
    if (!['MARKET', 'LIMIT'].includes(normalizedType)) throw new Error('Solo se permiten órdenes MARKET o LIMIT en sandbox.');
    const params = { symbol: String(symbol).toUpperCase(), side: String(side).toUpperCase(), type: normalizedType, quantity, newClientOrderId: clientOrderId };
    if (normalizedType === 'LIMIT') { params.price = price; params.timeInForce = 'GTC'; }
    return this.signedRequest('POST', '/api/v3/order', params);
  }

  async getOrder({ symbol, orderId, clientOrderId }) { return this.signedRequest('GET', '/api/v3/order', { symbol: String(symbol).toUpperCase(), orderId, origClientOrderId: clientOrderId }); }
  async cancelOrder({ symbol, orderId, clientOrderId }) { if (this.environment === 'mainnet') throw new Error('Las cancelaciones en mainnet están bloqueadas en esta versión.'); return this.signedRequest('DELETE', '/api/v3/order', { symbol: String(symbol).toUpperCase(), orderId, origClientOrderId: clientOrderId }); }
}

module.exports = { BinanceSpotClient, BASE_URLS, STREAM_URLS, streamUrl, signedQuery, normalizeBinanceOrder, normalizeBinanceStatus };
