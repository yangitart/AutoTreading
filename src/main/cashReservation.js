function reservationForOrder({ side, quantity, requestedPrice, feeRate = 0, slippageBps = 0 }) {
  if (String(side).toUpperCase() !== 'BUY') return 0;
  const qty = Number(quantity), price = Number(requestedPrice), fee = Math.max(0, Number(feeRate) || 0), slippage = Math.max(0, Number(slippageBps) || 0) / 10000;
  return Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0 ? Math.ceil(qty * price * (1 + fee) * (1 + slippage) * 1000000000000) / 1000000000000 : 0;
}

function releaseForFill(order = {}, fillQuantity) {
  const remaining = Math.max(0, Number(order.quantity || 0) - Number(order.filledQuantity || 0)), reserved = Math.max(0, Number(order.reservedCash || 0)), quantity = Math.max(0, Number(fillQuantity) || 0);
  if (!(remaining > 0) || !(reserved > 0)) return 0;
  return Math.min(reserved, reserved * Math.min(1, quantity / remaining));
}

function releaseAll(order = {}) { return Math.max(0, Number(order.reservedCash || 0)); }

module.exports = { reservationForOrder, releaseForFill, releaseAll };
