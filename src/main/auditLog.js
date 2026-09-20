const crypto = require('crypto');

function digest(previousHash, payload, receivedAt, sequence) {
  return crypto.createHash('sha256').update(`${previousHash || 'GENESIS'}\n${sequence}\n${receivedAt}\n${JSON.stringify(payload)}`).digest('hex');
}

function appendAudit(entries = [], payload, receivedAt = new Date().toISOString()) {
  const previous = entries.at(-1), sequence = Number(previous?.sequence || 0) + 1, previousHash = previous?.hash || 'GENESIS';
  const record = { sequence, receivedAt, previousHash, payload, hash: null };
  record.hash = digest(previousHash, payload, receivedAt, sequence);
  return [...entries, record];
}

function verifyAuditChain(entries = []) {
  let previousHash = 'GENESIS';
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index], expectedSequence = index + 1, expectedHash = digest(previousHash, entry.payload, entry.receivedAt, entry.sequence);
    if (entry.sequence !== expectedSequence || entry.previousHash !== previousHash || entry.hash !== expectedHash) return { valid: false, checked: index, error: `Cadena inválida en el registro ${index + 1}.` };
    previousHash = entry.hash;
  }
  return { valid: true, checked: entries.length, lastHash: previousHash };
}

module.exports = { appendAudit, verifyAuditChain };
