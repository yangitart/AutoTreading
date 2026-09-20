function freshQuote(quote, maxAgeMs = 15000, now = Date.now()) {
  return Boolean(quote && Number.isFinite(quote.bid) && quote.bid > 0 && Number.isFinite(quote.ask) && quote.ask >= quote.bid && Number.isFinite(quote.fetchedAt) && now - quote.fetchedAt >= -1000 && now - quote.fetchedAt <= maxAgeMs);
}
module.exports = { freshQuote };
