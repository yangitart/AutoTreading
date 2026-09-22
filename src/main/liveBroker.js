const { BinanceSpotClient } = require('./binanceClient');

class LiveBroker {
  constructor(credentials = {}) {
    this.mode = 'live';
    this.environment = credentials.environment || 'testnet';
    this.client = new BinanceSpotClient(credentials);
  }

  getAccount() { return this.client.getAccount(); }
  getOpenOrders(symbol) { return this.client.getOpenOrders(symbol); }
  getOrder(order) { return this.client.getOrder(order); }
  getTrades(order) { return this.client.getTrades(order); }
  getPermissions() { return this.client.getPermissions(); }
  getInstrument(symbol) { return this.client.getInstrument(symbol); }
  getQuote(symbol) { return this.client.getQuote(symbol); }

  placeOrder(order) {
    return this.client.placeOrder(order);
  }

  cancelOrder(order) {
    return this.client.cancelOrder(order);
  }
}

module.exports = { LiveBroker };
