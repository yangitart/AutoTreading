const { BinanceSpotClient } = require('./binanceClient');

class LiveBroker {
  constructor(credentials = {}) {
    this.mode = 'live';
    this.environment = credentials.environment || 'testnet';
    this.client = new BinanceSpotClient(credentials);
  }

  getAccount() { return this.client.getAccount(); }
  getOpenOrders(symbol) { return this.client.getOpenOrders(symbol); }
  createListenKey() { return this.client.createListenKey(); }
  keepAliveListenKey(listenKey) { return this.client.keepAliveListenKey(listenKey); }
  getOrder(order) { return this.client.getOrder(order); }

  placeOrder(order) {
    if (!['testnet', 'demo'].includes(this.environment)) throw new Error('Las órdenes live permanecen bloqueadas fuera de sandbox/testnet.');
    return this.client.placeOrder(order);
  }

  cancelOrder(order) {
    if (!['testnet', 'demo'].includes(this.environment)) throw new Error('Las cancelaciones live permanecen bloqueadas fuera de sandbox/testnet.');
    return this.client.cancelOrder(order);
  }
}

module.exports = { LiveBroker };
