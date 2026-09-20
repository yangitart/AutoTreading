function intervalMilliseconds(interval) {
  const match = String(interval).match(/^(\d+)([smhdwM])$/);
  if (!match) return null;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 };
  return Number(match[1]) * units[match[2]];
}

function normalizeCandleRow(row, now = Date.now()) {
  const time = Number(row?.[0]), closeTime = Number(row?.[6]);
  return { time, closeTime: Number.isFinite(closeTime) ? closeTime : null, timeZone: 'UTC', open: Number(row?.[1]), high: Number(row?.[2]), low: Number(row?.[3]), close: Number(row?.[4]), volume: Number(row?.[5]), isClosed: Number.isFinite(closeTime) ? closeTime <= now : true };
}

function closedCandles(candles = []) { return candles.filter(candle => candle?.isClosed !== false); }

function mergeCandleSeries(existing = [], incoming = [], limit = 1000) {
  const merged = new Map();
  for (const candle of [...existing, ...incoming]) if (Number.isFinite(Number(candle?.time))) merged.set(Number(candle.time), candle);
  return [...merged.values()].sort((a, b) => a.time - b.time).slice(-Math.min(1000, Math.max(1, Number(limit) || 1000)));
}

function floorToStep(value, step) {
  const number = Number(value), increment = Number(step);
  if (!Number.isFinite(number) || !(increment > 0)) return number;
  return Math.floor((number + increment * 0.000000001) / increment) * increment;
}

function roundToStep(value, step) {
  const number = Number(value), increment = Number(step);
  if (!Number.isFinite(number) || !(increment > 0)) return number;
  return Math.round(number / increment) * increment;
}

function validateCandleSeries(candles, interval, now = Date.now()) {
  const issues = [], warnings = [], intervalMs = intervalMilliseconds(interval);
  candles.forEach((candle, index) => {
    if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) issues.push(`Vela ${index} contiene valores no numéricos.`);
    if (candle.time > now + 120000) issues.push(`Vela ${index} tiene timestamp futuro.`);
    if (Number.isFinite(candle.closeTime)) {
      if (candle.closeTime < candle.time) issues.push(`Vela ${index} tiene closeTime anterior a su apertura.`);
      if (candle.isClosed === false) warnings.push('La última vela aún no está cerrada; no se usa para señales ni backtests.');
    } else warnings.push(`Vela ${index} no tiene closeTime; se conserva por compatibilidad, pero su cierre no puede verificarse.`);
    if (!(candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) && candle.low > 0)) issues.push(`Vela ${index} tiene OHLC inconsistente.`);
    if (index > 0) {
      const delta = candle.time - candles[index - 1].time;
      if (delta <= 0) issues.push('El histórico contiene timestamps duplicados o fuera de orden.');
      else if (intervalMs && delta > intervalMs * 2.5) warnings.push(`Hueco de ${(delta / intervalMs).toFixed(1)} intervalos entre velas ${index - 1} y ${index}.`);
    }
  });
  const closedCount = closedCandles(candles).length, latest = candles.at(-1), freshnessReference = latest?.isClosed === false ? Number(latest.time) : Number(latest?.closeTime || latest?.time), freshnessMs = Number.isFinite(freshnessReference) ? Math.max(0, now - freshnessReference) : null;
  return { valid: issues.length === 0, status: issues.length ? 'invalid' : warnings.length ? 'degraded' : 'ok', candleCount: candles.length, closedCandleCount: closedCount, freshnessMs, timeZone: 'UTC', issues: [...new Set(issues)].slice(0, 8), warnings: [...new Set(warnings)].slice(0, 8) };
}

module.exports = { intervalMilliseconds, normalizeCandleRow, closedCandles, mergeCandleSeries, floorToStep, roundToStep, validateCandleSeries };
