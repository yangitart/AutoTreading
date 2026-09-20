function balance(ledger, account) {
  return ledger.reduce((sum, movement) => sum + (movement.entries || []).filter(entry => entry.account === account).reduce((n, entry) => n + (entry.side === 'debit' ? 1 : -1) * Number(entry.amount), 0), 0);
}

// Legacy sales credited the asset at proceeds. Append a visible correction;
// original fills and journal entries remain available for audit.
function legacyCorrection(current) {
  const accounts = new Set(current.ledger.flatMap(m => m.entries || []).map(e => e.account).filter(a => a.startsWith('asset:')));
  current.positions.forEach(p => accounts.add(`asset:${p.symbol}`));
  const entries = [];
  for (const account of accounts) {
    const position = current.positions.find(p => `asset:${p.symbol}` === account);
    const expected = position ? Number(position.quantity) * Number(position.entryPrice || position.entry) : 0;
    const difference = expected - balance(current.ledger, account);
    if (Math.abs(difference) > 1e-8) entries.push({ account, side: difference > 0 ? 'debit' : 'credit', amount: Math.abs(difference) });
  }
  const net = entries.reduce((sum, e) => sum + (e.side === 'debit' ? 1 : -1) * e.amount, 0);
  if (Math.abs(net) > 1e-8) entries.push({ account: 'realized-pnl', side: net > 0 ? 'credit' : 'debit', amount: Math.abs(net) });
  return entries;
}

function accountingIssues(current) {
  const issues = [], tolerance = 1e-6, ledger = current.ledger || [];
  if (!Number.isFinite(current.cash) || current.cash < -tolerance) issues.push('Cash inválido o negativo.');
  if (!Number.isFinite(Number(current.reservedCash || 0)) || Number(current.reservedCash || 0) > current.cash + tolerance) issues.push('Reservas superiores al cash.');
  for (const movement of ledger) for (const entry of movement.entries || []) {
    if (!Number.isFinite(entry.amount) || entry.amount < 0 || !['debit', 'credit'].includes(entry.side)) issues.push('Asiento con importe o lado inválido.');
  }
  const accounts = new Set(ledger.flatMap(m => m.entries || []).map(e => e.account).filter(a => typeof a === 'string' && a.startsWith('asset:')));
  for (const p of current.positions || []) {
    accounts.add(`asset:${p.symbol}`);
    if (![p.quantity, p.entry, p.entryPrice].every(v => Number.isFinite(v) && v > 0)) issues.push(`Coste o cantidad inválida: ${p.symbol}.`);
  }
  for (const account of accounts) {
    const p = (current.positions || []).find(p => `asset:${p.symbol}` === account);
    const expected = p ? p.quantity * p.entryPrice : 0;
    if (Math.abs(balance(ledger, account) - expected) > tolerance) issues.push(`Coste base no reconcilia: ${account}.`);
  }
  if (Math.abs(-balance(ledger, 'realized-pnl') - Number(current.grossRealizedPnl || 0)) > tolerance) issues.push('P&L realizado no reconcilia con el ledger.');
  return issues;
}

module.exports = { balance, legacyCorrection, accountingIssues };
