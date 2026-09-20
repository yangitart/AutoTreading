const DEFAULT_NEWS_FEEDS = ['https://www.coindesk.com/arc/outboundfeeds/rss/', 'https://cointelegraph.com/rss'];

function sanitizeNewsFeeds(value, fallback = DEFAULT_NEWS_FEEDS) {
  const candidates = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const feeds = [...new Set(candidates.map(item => String(item).trim()).filter(item => /^https:\/\/[^\s]{4,240}$/i.test(item)))].slice(0, 8);
  return feeds.length ? feeds : [...fallback];
}

function newsFetchQuality(feeds, failedFeeds, fetchedAt = Date.now()) {
  const configured = feeds.length, failed = failedFeeds.length;
  return { status: configured && failed === configured ? 'offline' : failed ? 'degraded' : 'fresh', configuredFeeds: configured, successfulFeeds: configured - failed, failedFeeds: failedFeeds.map(item => ({ feed: item.feed, error: item.error })), fetchedAt };
}

module.exports = { DEFAULT_NEWS_FEEDS, sanitizeNewsFeeds, newsFetchQuality };
