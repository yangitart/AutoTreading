class SerializedMutationQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  enqueue(label, mutation) {
    const next = this.tail.then(() => mutation());
    this.tail = next.catch(() => {});
    return next;
  }
}

module.exports = { SerializedMutationQueue };
