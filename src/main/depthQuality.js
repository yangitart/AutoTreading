function normalizeLevels(levels = [], side) {
  const normalized = levels.map(level => [Number(level?.[0]), Number(level?.[1])]).filter(level => level[0] > 0 && level[1] > 0);
  normalized.sort((a, b) => side === 'bid' ? b[0] - a[0] : a[0] - b[0]);
  return normalized;
}

function normalizeDepthSnapshot(payload = {}, symbol, limit = 20, source = null, fetchedAt = Date.now()) {
  const bids = normalizeLevels(payload.bids, 'bid'), asks = normalizeLevels(payload.asks, 'ask');
  if (!bids.length || !asks.length || bids[0][0] >= asks[0][0]) throw new Error('Order book inválido: faltan niveles o el spread no es positivo.');
  const bestBid = bids[0][0], bestAsk = asks[0][0], mid = (bestBid + bestAsk) / 2, bidLiquidity = bids.reduce((sum, level) => sum + level[0] * level[1], 0), askLiquidity = asks.reduce((sum, level) => sum + level[0] * level[1], 0), totalLiquidity = bidLiquidity + askLiquidity;
  return { symbol: String(symbol).trim().toUpperCase(), limit: Number(limit) || 20, bids, asks, bestBid, bestAsk, spreadBps: mid > 0 ? (bestAsk - bestBid) / mid * 10000 : null, bidLiquidity, askLiquidity, imbalance: totalLiquidity ? (bidLiquidity - askLiquidity) / totalLiquidity : 0, lastUpdateId: payload.lastUpdateId || null, fetchedAt, ageMs: 0, status: 'fresh', dataQuality: { valid: true, status: 'fresh', bidLevels: bids.length, askLevels: asks.length, timeZone: 'UTC' }, source };
}

function depthFreshness(snapshot = {}, now = Date.now(), maxAgeMs = 15000) {
  const ageMs = Number.isFinite(Number(snapshot.fetchedAt)) ? Math.max(0, now - Number(snapshot.fetchedAt)) : Infinity;
  return { ...snapshot, ageMs, status: ageMs <= maxAgeMs ? 'fresh' : 'stale', dataQuality: { ...(snapshot.dataQuality || {}), status: ageMs <= maxAgeMs ? 'fresh' : 'stale', ageMs } };
}

function availableNotional(snapshot = {}, side) {
  const levels = String(side).toUpperCase() === 'BUY' ? snapshot.asks : snapshot.bids;
  return (levels || []).reduce((sum, level) => sum + Number(level?.[0] || 0) * Number(level?.[1] || 0), 0);
}

function consumeNotional(snapshot = {}, side, notional = 0) {
  const levels = (String(side).toUpperCase() === 'BUY' ? snapshot.asks : snapshot.bids || []).map(level => [Number(level[0]), Number(level[1])]);
  let remaining = Math.max(0, Number(notional) || 0);
  for (const level of levels) {
    if (!(remaining > 0)) break;
    const consumed = Math.min(level[1], remaining / level[0]);
    level[1] = Math.max(0, level[1] - consumed); remaining -= consumed * level[0];
  }
  const bids = String(side).toUpperCase() === 'BUY' ? snapshot.bids : levels, asks = String(side).toUpperCase() === 'BUY' ? levels : snapshot.asks;
  try { return normalizeDepthSnapshot({ bids, asks, lastUpdateId: snapshot.lastUpdateId }, snapshot.symbol, snapshot.limit, snapshot.source, snapshot.fetchedAt); } catch { return { ...snapshot, status: 'stale', dataQuality: { ...(snapshot.dataQuality || {}), status: 'stale' } }; }
}

function applyDepthDiff(snapshot, event, limit = 20, now = Date.now()) {
  const previousId = Number(snapshot?.lastUpdateId), firstId = Number(event?.U), finalId = Number(event?.u);
  if (!(previousId >= 0 && firstId >= 0 && finalId >= firstId)) return { snapshot, status: 'invalid', needsResync: true, reason: 'Evento de profundidad sin secuencia válida.' };
  if (finalId <= previousId) return { snapshot, status: 'ignored', needsResync: false };
  if (firstId > previousId + 1) return { snapshot: { ...snapshot, status: 'gap', dataQuality: { ...(snapshot.dataQuality || {}), status: 'gap' } }, status: 'gap', needsResync: true, reason: `Salto de secuencia ${previousId}→${firstId}.` };
  const bids = new Map((snapshot.bids || []).map(level => [String(level[0]), [Number(level[0]), Number(level[1])]])), asks = new Map((snapshot.asks || []).map(level => [String(level[0]), [Number(level[0]), Number(level[1])]]));
  for (const [price, quantity] of event.b || []) { const key = String(Number(price)); if (Number(quantity) > 0) bids.set(key, [Number(price), Number(quantity)]); else bids.delete(key); }
  for (const [price, quantity] of event.a || []) { const key = String(Number(price)); if (Number(quantity) > 0) asks.set(key, [Number(price), Number(quantity)]); else asks.delete(key); }
  try { return { snapshot: normalizeDepthSnapshot({ bids: [...bids.values()], asks: [...asks.values()], lastUpdateId: finalId }, snapshot.symbol, limit, 'websocket-depth', now), status: 'fresh', needsResync: false }; } catch (error) { return { snapshot: { ...snapshot, status: 'invalid' }, status: 'invalid', needsResync: true, reason: error.message }; }
}

module.exports = { normalizeLevels, normalizeDepthSnapshot, depthFreshness, availableNotional, consumeNotional, applyDepthDiff };
