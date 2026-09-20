const test = require('node:test');
const assert = require('node:assert/strict');
const { intervalMilliseconds, normalizeCandleRow, closedCandles, mergeCandleSeries, floorToStep, roundToStep, validateCandleSeries } = require('../src/main/marketQuality');

test('normaliza timestamps Binance en UTC y distingue la vela abierta', () => {
  const now = 1_000_000;
  const candle = normalizeCandleRow([900_000, '100', '110', '95', '105', '20', 1_100_000], now);
  assert.equal(candle.timeZone, 'UTC');
  assert.equal(candle.isClosed, false);
  assert.equal(closedCandles([candle]).length, 0);
  assert.equal(intervalMilliseconds('1h'), 3600000);
});

test('acepta closeTime futuro como vela abierta y devuelve estado degradado', () => {
  const candle = normalizeCandleRow([900_000, '100', '110', '95', '105', '20', 1_100_000], 1_000_000);
  const quality = validateCandleSeries([candle], '1m', 1_000_000);
  assert.equal(quality.valid, true);
  assert.equal(quality.status, 'degraded');
});

test('una vela abierta válida se reporta degraded sin contaminar el conteo cerrado', () => {
  const candle = normalizeCandleRow([900_000, '100', '110', '95', '105', '20', 1_100_000], 1_000_000);
  const quality = validateCandleSeries([candle], '1m', 1_000_000);
  assert.equal(quality.valid, true);
  assert.equal(quality.status, 'degraded');
  assert.equal(quality.closedCandleCount, 0);
});

test('rechaza una vela cuyo closeTime es anterior a la apertura', () => {
  const candle = normalizeCandleRow([900_000, '100', '110', '95', '105', '20', 800_000], 1_000_000);
  const quality = validateCandleSeries([candle], '1m', 1_000_000);
  assert.equal(quality.valid, false);
  assert.match(quality.issues.join(' '), /closeTime anterior/);
});

test('fusiona caché e incremental sin duplicar velas y normaliza pasos de precisión', () => {
  const merged = mergeCandleSeries([{ time: 1, close: 100 }, { time: 2, close: 101 }], [{ time: 2, close: 102 }, { time: 3, close: 103 }], 10);
  assert.deepEqual(merged.map(candle => candle.close), [100, 102, 103]);
  assert.equal(floorToStep(1.239, 0.01), 1.23);
  assert.equal(roundToStep(100.006, 0.01), 100.01);
});
