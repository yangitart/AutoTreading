const OPEN_ORDER_STATES = new Set(['accepted', 'partial']);
const ORDER_STATUS_RANK = { accepted: 1, partial: 2, filled: 3, cancelled: 3, expired: 3, rejected: 3, failed: 3 };

function normalizeBalances(account = {}) { return (account.balances || []).map(item => ({ asset: item.asset, free: Number(item.free || 0), locked: Number(item.locked || 0), total: Number(item.free || 0) + Number(item.locked || 0) })).filter(item => item.asset && item.total !== 0); }
function normalizeAccount(account = {}) { return { environment: account.environment || null, accountType: account.accountType || null, canTrade: Boolean(account.canTrade), canWithdraw: Boolean(account.canWithdraw), canDeposit: Boolean(account.canDeposit), balances: normalizeBalances(account) }; }
function applyAccountEvent(previous = {}, event = {}) {
  const balances = new Map((previous.balances || []).map(item => [item.asset, { asset: item.asset, free: Number(item.free || 0), locked: Number(item.locked || 0) }]));
  if (event.e === 'outboundAccountPosition' && Array.isArray(event.B)) for (const item of event.B) balances.set(item.a || item.asset, { asset: item.a || item.asset, free: Number(item.f || item.free || 0), locked: Number(item.l || item.locked || 0) });
  if (event.e === 'balanceUpdate' && event.a) { const previousBalance = balances.get(event.a) || { asset: event.a, free: 0, locked: 0 }; previousBalance.free += Number(event.d || 0); balances.set(event.a, previousBalance); }
  return { ...previous, balances: normalizeBalances({ balances: [...balances.values()] }) };
}
function orderKey(order = {}) { return String(order.providerOrderId || order.clientOrderId || ''); }
function orderTime(order = {}) { return Number(order.transactTime || order.eventTime || 0) || 0; }
function mergeNormalizedOrder(previous, incoming) {
  if (!previous) return incoming;
  const oldRank = ORDER_STATUS_RANK[previous.status] || 0, newRank = ORDER_STATUS_RANK[incoming.status] || 0, oldTime = orderTime(previous), newTime = orderTime(incoming);
  if (newRank < oldRank || (newRank === oldRank && oldTime > newTime && newTime > 0)) return { ...previous, lastSeenAt: new Date().toISOString() };
  return { ...previous, ...incoming };
}
function mergeKnownOrders(existing = [], incoming = []) {
  const merged = new Map(existing.map(order => [orderKey(order), order]));
  for (const order of incoming) { const key = orderKey(order); if (key) merged.set(key, mergeNormalizedOrder(merged.get(key), order)); }
  return [...merged.values()];
}
async function reconcileKnownOrders(known = [], active = [], getOrder = async () => { throw new Error('No existe recuperador de órdenes.'); }) {
  const merged = new Map(known.filter(order => orderKey(order)).map(order => [orderKey(order), order])), activeKeys = new Set();
  for (const order of active) { const key = orderKey(order); if (!key) continue; activeKeys.add(key); merged.set(key, mergeNormalizedOrder(merged.get(key), order)); }
  const recovered = [], unresolved = [];
  for (const order of known.filter(item => ['accepted', 'partial'].includes(item.status) && orderKey(item) && !activeKeys.has(orderKey(item)))) {
    const key = orderKey(order);
    try { const incoming = await getOrder(order), next = mergeNormalizedOrder(merged.get(key), incoming); merged.set(key, next); recovered.push(next); }
    catch (error) { const next = { ...merged.get(key), reconciliationError: String(error.message || error), reconciliationAttempts: Number(merged.get(key)?.reconciliationAttempts || 0) + 1, reconciledAt: new Date().toISOString() }; merged.set(key, next); unresolved.push(next); }
  }
  return { orders: [...merged.values()], activeCount: activeKeys.size, attempted: recovered.length + unresolved.length, recovered, unresolved };
}
function reconcileBrokerSnapshot(previous = {}, account = {}, openOrders = []) {
  const nextAccount = normalizeAccount(account), nextOrders = openOrders, discrepancies = [];
  const oldBalances = new Map((previous.account?.balances || []).map(item => [item.asset, item.total]));
  for (const balance of nextAccount.balances) if (oldBalances.has(balance.asset) && Math.abs(oldBalances.get(balance.asset) - balance.total) > 0.00000001) discrepancies.push({ type: 'balance-change', asset: balance.asset, previous: oldBalances.get(balance.asset), current: balance.total });
  const oldOrders = new Map((previous.openOrders || []).map(order => [String(order.providerOrderId || order.clientOrderId), order]));
  const nextOrderKeys = new Set(nextOrders.map(order => String(order.providerOrderId || order.clientOrderId)));
  for (const [key, order] of oldOrders) if (!nextOrderKeys.has(key) && OPEN_ORDER_STATES.has(order.status)) discrepancies.push({ type: 'order-missing-from-open-orders', orderId: key, symbol: order.symbol });
  return { account: nextAccount, openOrders: nextOrders, discrepancies, reconciledAt: new Date().toISOString() };
}

module.exports = { OPEN_ORDER_STATES, ORDER_STATUS_RANK, normalizeBalances, normalizeAccount, applyAccountEvent, orderKey, mergeNormalizedOrder, mergeKnownOrders, reconcileKnownOrders, reconcileBrokerSnapshot };
