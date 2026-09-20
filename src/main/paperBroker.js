const PAPER_MODE = 'paper';

class PaperBroker {
  constructor(implementation = {}) {
    this.mode = PAPER_MODE;
    this.implementation = implementation;
  }

  submitOrder(order) {
    if (typeof this.implementation.submitOrder !== 'function') throw new Error('PaperBroker no está configurado.');
    return this.implementation.submitOrder(order);
  }

  cancelOrder(orderId) {
    if (typeof this.implementation.cancelOrder !== 'function') throw new Error('PaperBroker no está configurado.');
    return this.implementation.cancelOrder(orderId);
  }

  snapshot() {
    if (typeof this.implementation.snapshot !== 'function') throw new Error('PaperBroker no está configurado.');
    return this.implementation.snapshot();
  }
}

module.exports = { PaperBroker, PAPER_MODE };
