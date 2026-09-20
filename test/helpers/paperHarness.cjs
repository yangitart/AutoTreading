const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const mainPath = path.resolve(__dirname, '../../src/main/main.js');
const localRequire = createRequire(mainPath);

function createHarness(existingFiles = new Map()) {
  const files = existingFiles, handlers = new Map(), timers = [], events = [];
  let ready;
  const fakeFs = {
    readFileSync(file) { if (!files.has(file)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return files.get(file); },
    writeFileSync(file, data) { files.set(file, data); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    mkdirSync() {}, readdirSync() { return []; }, unlinkSync(file) { files.delete(file); }
  };
  const electron = {
    app: { getPath: () => 'paper-test', whenReady: () => ({ then: fn => { ready = fn; } }), on() {}, quit() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: class { constructor() { this.webContents = { send: (...args) => events.push(args), setWindowOpenHandler() {}, on() {} }; } on() {} loadFile() {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, shell: {}, dialog: {}
  };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name === 'fs' ? fakeFs : localRequire(name), __dirname: path.dirname(mainPath), Buffer, structuredClone, console, Date, URL, AbortSignal, process: { platform: 'win32' }, setTimeout: () => ({}), clearTimeout() {}, setInterval: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearInterval() {}, fetch: async () => { throw new Error('Network disabled in tests'); } });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  const run = code => vm.runInContext(code, context);
  return { context, files, events, timers, handlers, run, ready: () => ready(), state: () => run('state()'), configure(patch) { context.patch = patch; run('writeJson(SETTINGS_FILE, {...settings(), ...patch})'); }, invoke: (name, payload) => handlers.get(name)({}, payload) };
}
const quote = (price = 100) => ({ bid: price, ask: price, last: price, fetchedAt: Date.now() });
const instrument = { symbol: 'BTCUSDT', status: 'TRADING', quoteAsset: 'USDT', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5 };
function submit(h, values = {}) { h.context.order = { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.2, price: 100, quote: quote(), instrument, ...values }; return h.run('submitPaperOrder(order)'); }
module.exports = { createHarness, quote, instrument, submit };
