function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stopIsTriggered(side, stopPrice, quote = {}, fallback) {
  const stop = positiveNumber(stopPrice);
  if (!stop) return false;
  const last = positiveNumber(quote.last) || positiveNumber(fallback);
  const high = positiveNumber(quote.high);
  const low = positiveNumber(quote.low);
  if (String(side).toUpperCase() === 'BUY') return (high || last || 0) >= stop;
  return (low || last || Infinity) <= stop;
}

function protectiveExecutionPrice(side, triggerPrice, quote = {}, fallback) {
  const trigger = positiveNumber(triggerPrice) || positiveNumber(fallback);
  const open = positiveNumber(quote.open);
  if (!trigger) return null;
  // A gap beyond the protection fills at the first tradable price (the open),
  // not at the requested stop. Otherwise the stop is the simulated trigger.
  if (String(side).toUpperCase() === 'SELL') return open ? Math.min(open, trigger) : (positiveNumber(quote.bid) || positiveNumber(quote.last) || trigger);
  return open ? Math.max(open, trigger) : (positiveNumber(quote.ask) || positiveNumber(quote.last) || trigger);
}

function resolveProtectiveExit(position = {}, quote = {}, fallbackPrice, policy = 'conservative') {
  const low = positiveNumber(quote.low) || positiveNumber(quote.bid) || positiveNumber(fallbackPrice);
  const high = positiveNumber(quote.high) || positiveNumber(quote.bid) || positiveNumber(fallbackPrice);
  const open = positiveNumber(quote.open);
  const stop = positiveNumber(position.stopLoss);
  const target = positiveNumber(position.takeProfit);
  const stopHit = Boolean(stop && low && low <= stop);
  const targetHit = Boolean(target && high && high >= target);
  if (!stopHit && !targetHit) return null;

  if (stopHit && targetHit) {
    const takeFirst = policy === 'take-first';
    const triggerPrice = takeFirst ? target : stop;
    return {
      reason: takeFirst ? 'take-profit-ambiguous' : 'stop-loss-ambiguous',
      ambiguous: true,
      triggerPrice,
      executionPrice: protectiveExecutionPrice('SELL', triggerPrice, { ...quote, open }, fallbackPrice),
      gap: Boolean(open && (takeFirst ? open >= target : open <= stop))
    };
  }

  const triggerPrice = stopHit ? stop : target;
  return {
    reason: stopHit ? 'stop-loss' : 'take-profit',
    ambiguous: false,
    triggerPrice,
    executionPrice: protectiveExecutionPrice('SELL', triggerPrice, { ...quote, open }, fallbackPrice),
    gap: Boolean(open && (stopHit ? open <= stop : open >= target))
  };
}

module.exports = { stopIsTriggered, protectiveExecutionPrice, resolveProtectiveExit };
