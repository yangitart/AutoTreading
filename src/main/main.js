const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID, createHash } = require('crypto');
const { streamUrl, normalizeBinanceOrder } = require('./binanceClient');
const { technicalAgent, newsAgent, liquidityAgent, validateTradeIntent, criticalAgent, portfolioAgent, consensusAgent, agentTrace } = require('./agentOrchestrator');
const { reconcileBrokerSnapshot, applyAccountEvent, mergeNormalizedOrder, orderKey, reconcileKnownOrders } = require('./brokerContract');
const { appendAudit, verifyAuditChain } = require('./auditLog');
const { PaperBroker } = require('./paperBroker');
const { LiveBroker } = require('./liveBroker');
const { stopIsTriggered, protectiveExecutionPrice, resolveProtectiveExit } = require('./protection');
const { evaluateAnalyses } = require('./agentEvaluation');
const { SerializedMutationQueue } = require('./mutationQueue');
const { buildResearchReport } = require('./researchReport');
const { createSingleFlight } = require('./singleFlight');
const { createAutomationRun, updateAutomationRun, recoverStaleAutomation } = require('./automationJournal');
const { DEFAULT_NEWS_FEEDS, sanitizeNewsFeeds, newsFetchQuality } = require('./newsQuality');
const { resetDailyRisk } = require('./riskCalendar');
const { reservationForOrder, releaseForFill, releaseAll } = require('./cashReservation');
const { buildAutomationPreflight } = require('./automationPreflight');
const { safeAutomationStartup } = require('./automationStartup');
const { PROMPT_VERSION, TRADE_INTENT_SCHEMA, promptForMarket: buildLlmPrompt, parseLlmIntent: parseLlmIntentContract } = require('./llmContract');
const { intervalMilliseconds: marketIntervalMilliseconds, normalizeCandleRow, closedCandles, mergeCandleSeries, floorToStep, roundToStep, validateCandleSeries: validateMarketCandles } = require('./marketQuality');
const { classifyMarketRegime, summarizeRegimes } = require('./backtestAnalysis');
const { normalizeDepthSnapshot, applyDepthDiff, depthFreshness, availableNotional, consumeNotional } = require('./depthQuality');
const { monteCarloStress: runMonteCarloStress } = require('./monteCarlo');
const { legacyCorrection, accountingIssues } = require('./paperAccounting');
const { freshQuote } = require('./quoteQuality');

if (app.requestSingleInstanceLock && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
const DATA_DIR = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STATE_FILE = path.join(DATA_DIR, 'paper-state.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'paper-sessions.json');
const BROKER_EVENTS_FILE = path.join(DATA_DIR, 'broker-events.json');
const LIVE_STATE_FILE = path.join(DATA_DIR, 'live-state.json');
const LIVE_LEDGER_FILE = path.join(DATA_DIR, 'live-ledger.json');
const LIVE_ORDERS_FILE = path.join(DATA_DIR, 'live-orders.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MARKET_CACHE_DIR = path.join(DATA_DIR, 'market-cache');
const EXPERIMENTS_FILE = path.join(DATA_DIR, 'experiments.json');

const defaults = {
  settings: { endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', provider: 'openai', mode: 'paper', accountCurrency: 'USDT', initialCash: 100, feeRate: 0.001, slippageBps: 10, backtestSpreadBps: 2, maxOrderPct: 25, maxExposurePct: 75, maxAssetExposurePct: 35, maxPortfolioRiskPct: 3, maxSpreadBps: 50, maxTradesPerDay: 20, maxDataAgeMs: 15000, maxDrawdownPct: 10, maxDailyLossPct: 3, partialFillPct: 100, executionLatencyMs: 0, limitOrderTtlMin: 60, liquidityNotionalPerTick: 0, intrabarPolicy: 'conservative', automationEnabled: false, automationIntervalMin: 15, automationTimeframe: '15m', automationSymbols: ['BTCUSDT'], minConfidence: 60, riskPerTradePct: 1, requireStopForAuto: true, llmDailyCallBudget: 24, llmDailyBudgetUsd: 1, llmInputCostPer1kUsd: 0.0002, llmOutputCostPer1kUsd: 0.0012, llmFailurePauseThreshold: 3 },
  state: { schemaVersion: 3, sessionId: null, startedAt: null, initialCash: 100, cash: 100, currency: 'USDT', positions: [], orders: [], trades: [], ledger: [], equityHistory: [], analyses: [], alerts: [], realizedPnl: 0, grossRealizedPnl: 0, netRealizedPnl: 0, feesPaid: 0, slippagePaid: 0, dailyLoss: 0, dailyLossDate: null, peakEquity: 100, paused: false, pauseReason: null, marketHealth: { status: 'unknown', lastTickAt: null, lastDisconnectAt: null }, benchmark: { symbol: 'BTCUSDT', startPrice: null, currentPrice: null, cashValue: 100, buyAndHoldValue: 100, buyAndHoldReturnPct: 0 }, lastAnalysis: null, llmUsage: { date: null, calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, invalidResponses: 0, consecutiveFailures: 0, lastError: null, lastCallAt: null }, automation: { lastRunAt: null, lastRunId: null, lastDecision: null, lastError: null, pausedReason: null } }
};

let mainWindow = null;
const marketStreams = new Map();
let automationTimer = null;
let automationStartApproved = false;
let automationEpoch = 0;
let automationStarting = false;
let brokerSyncTimer = null;
let brokerSnapshot = { status: 'not-configured', lastSyncAt: null, error: null, account: null, openOrders: [], orders: [], discrepancies: [], recovery: { activeCount: 0, attempted: 0, recovered: 0, unresolved: 0, unresolvedKeys: [] }, sandboxArmedUntil: null, stream: 'disconnected', ...readJson(LIVE_STATE_FILE, {}), stream: 'disconnected' };
let paperBroker = null;
const paperMutationQueue = new SerializedMutationQueue();
let brokerStream = { socket: null, keepAlive: null, reconnectTimer: null, connecting: false, listenKey: null };
let appQuitting = false;
const MARKET_ENDPOINTS = ['https://data-api.binance.vision/api/v3', 'https://api.binance.com/api/v3'];
const MARKET_INTERVALS = new Set(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const instrumentCache = new Map();
const depthSnapshots = new Map();
const SETTINGS_SCHEMA_VERSION = 2;
const STATE_SCHEMA_VERSION = 5;
defaults.settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
defaults.settings.newsFeeds = DEFAULT_NEWS_FEEDS;
defaults.state.schemaVersion = STATE_SCHEMA_VERSION;
defaults.state.automation = { ...defaults.state.automation, status: 'idle', heartbeatAt: null, startedAt: null, finishedAt: null, durationMs: null };
defaults.state.automation.history = [];
defaults.state.automation.progress = [];
defaults.state.reservedCash = 0;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    if (file === STATE_FILE || file === SETTINGS_FILE) throw new Error(`No se pudo leer ${path.basename(file)}. Conserva el archivo y restaura un respaldo: ${error.message}`);
    return structuredClone(fallback);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, String(value), 'utf8');
  fs.renameSync(temp, file);
}
function marketCacheFile(symbol, interval) { return path.join(MARKET_CACHE_DIR, `${String(symbol).toUpperCase()}-${String(interval).replace(/[^a-z0-9]/gi, '_')}.json`); }

function protect(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no está disponible en este equipo.');
  return safeStorage.encryptString(value).toString('base64');
}

function unprotect(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function migrateSettings(raw) {
  const current = raw && typeof raw === 'object' ? { ...raw } : {}, fromVersion = Number(current.schemaVersion) || 0, migrationHistory = Array.isArray(current.migrationHistory) ? [...current.migrationHistory] : [];
  if (fromVersion > SETTINGS_SCHEMA_VERSION) throw new Error('La configuración requiere una versión más nueva.');
  let changed = fromVersion !== SETTINGS_SCHEMA_VERSION;
  if (fromVersion < 1) { current.provider ||= 'openai'; current.mode = 'paper'; migrationHistory.push({ from: fromVersion, to: 1, at: new Date().toISOString() }); }
  if (fromVersion < 2) { if (!current.model || current.model === 'gpt-4o-mini') current.model = 'gpt-5.6-luna'; if (!Number(current.llmInputCostPer1kUsd)) current.llmInputCostPer1kUsd = 0.0002; if (!Number(current.llmOutputCostPer1kUsd)) current.llmOutputCostPer1kUsd = 0.0012; migrationHistory.push({ from: Math.max(fromVersion, 1), to: 2, at: new Date().toISOString() }); }
  current.schemaVersion = SETTINGS_SCHEMA_VERSION;
  current.migrationHistory = migrationHistory;
  return { current, changed };
}

function migrateState(raw, backup = true) {
  const current = raw && typeof raw === 'object' ? structuredClone(raw) : {}, fromVersion = Number(current.schemaVersion) || 0, migrationHistory = Array.isArray(current.migrationHistory) ? current.migrationHistory : [];
  if (fromVersion > STATE_SCHEMA_VERSION) throw new Error('La cuenta requiere una versión más nueva de la aplicación.');
  let changed = fromVersion !== STATE_SCHEMA_VERSION;
  if (fromVersion < 3) { current.llmUsage ||= structuredClone(defaults.state.llmUsage); current.automation ||= structuredClone(defaults.state.automation); migrationHistory.push({ from: fromVersion, to: 3, at: new Date().toISOString() }); }
  if (fromVersion < 4) {
    current.protection ||= { status: 'unknown', lastCheckAt: null, protectedPositions: 0, waitingForFreshQuote: false };
    for (const position of Array.isArray(current.positions) ? current.positions : []) { position.entryPrice ||= Number(position.entry) || null; position.stopLoss ||= null; position.takeProfit ||= null; }
    migrationHistory.push({ from: Math.max(fromVersion, 3), to: 4, at: new Date().toISOString() });
  }
  if (fromVersion < 5) {
    if (current.ledger?.length) {
      if (backup) writeJson(path.join(BACKUP_DIR, `paper-${Date.now()}-before-ledger-v5.json`), { state: raw, reason: 'before-ledger-v5' });
      const entries = legacyCorrection(current);
      if (entries.length) postLedger(current, { type: 'accounting-migration', note: 'V5: activos a coste base y P&L realizado explícito.' }, entries);
    }
    current.llmTotalCostUsd = Number(current.llmTotalCostUsd ?? current.llmUsage?.estimatedCostUsd ?? 0);
    migrationHistory.push({ from: Math.max(fromVersion, 4), to: 5, at: new Date().toISOString() });
  }
  current.schemaVersion = STATE_SCHEMA_VERSION;
  current.migrationHistory = migrationHistory;
  return { current, changed };
}

function settings() { const migrated = migrateSettings(readJson(SETTINGS_FILE, defaults.settings)); const current = { ...defaults.settings, ...migrated.current }; if (!current.automationEnabled) automationStartApproved = false; if (!automationStartApproved) current.automationEnabled = false; if (migrated.changed) writeJson(SETTINGS_FILE, current); return current; }
function state() { const migrated = migrateState(readJson(STATE_FILE, defaults.state)), current = { ...defaults.state, ...migrated.current }; current.positions = Array.isArray(current.positions) ? current.positions : []; current.orders = Array.isArray(current.orders) ? current.orders : []; current.trades = Array.isArray(current.trades) ? current.trades : []; current.ledger = Array.isArray(current.ledger) ? current.ledger : []; current.equityHistory = Array.isArray(current.equityHistory) ? current.equityHistory : []; current.analyses = Array.isArray(current.analyses) ? current.analyses : []; current.alerts = Array.isArray(current.alerts) ? current.alerts : []; current.marketHealth = { ...defaults.state.marketHealth, ...(current.marketHealth || {}) }; current.protection = { status: 'unknown', lastCheckAt: null, protectedPositions: 0, waitingForFreshQuote: false, ...(current.protection || {}) }; current.llmUsage = { ...defaults.state.llmUsage, ...(current.llmUsage || {}) }; current.automation = { ...defaults.state.automation, ...(current.automation || {}) }; current.automation.history = Array.isArray(current.automation.history) ? current.automation.history : []; current.automation.progress = Array.isArray(current.automation.progress) ? current.automation.progress : []; current.currency = current.currency || settings().accountCurrency || 'USDT'; current.sessionId ||= randomUUID(); current.startedAt ||= new Date().toISOString(); if (!current.ledger.length && current.initialCash > 0) { postLedger(current, { type: 'initial-capital' }, [{ account: 'cash', side: 'debit', amount: current.initialCash }, { account: 'equity', side: 'credit', amount: current.initialCash }]); migrated.changed = true; } if (migrated.changed) writeJson(STATE_FILE, current); return current; }
function apiKey() { return unprotect(readJson(SECRETS_FILE, {}).llmApiKey); }
function brokerCredentials() { const saved = readJson(SECRETS_FILE, {}); return { apiKey: unprotect(saved.binanceApiKey), secret: unprotect(saved.binanceSecret), environment: settings().brokerEnvironment || 'testnet' }; }

function addStateAlert(current, type, severity, message, meta = {}) {
  const now = new Date().toISOString(), key = `${type}:${message}`;
  const recent = current.alerts?.find(item => item.key === key && Date.now() - new Date(item.createdAt).getTime() < 60000);
  if (recent) return false;
  current.alerts ||= []; current.alerts.unshift({ id: randomUUID(), key, type, severity, message: String(message), meta, createdAt: now }); current.alerts = current.alerts.slice(0, 100); mainWindow?.webContents.send('paper:alert', current.alerts[0]); return true;
}
function addAlert(type, severity, message, meta = {}) { const current = state(); if (!addStateAlert(current, type, severity, message, meta)) return current; writeJson(STATE_FILE, current); return current; }
function numericSetting(value, fallback) { const number = Number(value); return value === undefined || value === null || value === '' || !Number.isFinite(number) ? fallback : number; }
function saveNewsFeeds(value) { const current = settings(), newsFeeds = sanitizeNewsFeeds(value, DEFAULT_NEWS_FEEDS); writeJson(SETTINGS_FILE, { ...current, newsFeeds }); return settings(); }
function applyAccountCurrency(value, fallback) { const requested = ['USD', 'USDT', 'USDC'].includes(value) ? value : fallback, paper = state(); if (paper.currency !== requested && (paper.positions.length || paper.trades.length || paper.orders.length)) throw new Error('Cambia la moneda solo con la cuenta paper vacía; reinicia la simulación primero.'); if (paper.currency !== requested) { paper.currency = requested; writeJson(STATE_FILE, paper); } return requested; }

const PAPER_ORDER_STATES = new Set(['created', 'accepted', 'partial', 'filled', 'cancelled', 'expired', 'rejected', 'failed']);
function paperReservationIssues(candidate = {}) {
  const tolerance = 0.000001, reservedFromOrders = (candidate.orders || []).filter(order => ['created', 'accepted', 'partial'].includes(order.status) && String(order.side).toUpperCase() === 'BUY').reduce((sum, order) => sum + Math.max(0, Number(order.reservedCash || 0)), 0), reservedCash = Number(candidate.reservedCash || 0), issues = [];
  if (reservedCash < -tolerance) issues.push('Cash reservado negativo.');
  if (Math.abs(reservedFromOrders - reservedCash) > tolerance) issues.push(`Cash reservado no coincide con las órdenes (${reservedFromOrders.toFixed(6)} vs ${reservedCash.toFixed(6)}).`);
  return issues;
}

function verifyPaperIntegrity(candidate = state()) {
  const issues = paperReservationIssues(candidate), cashTolerance = 0.000001, cashFromLedger = (candidate.ledger || []).reduce((sum, movement) => sum + (movement.entries || []).filter(entry => entry.account === 'cash').reduce((subtotal, entry) => subtotal + (entry.side === 'debit' ? 1 : -1) * Number(entry.amount || 0), 0), 0), feesFromLedger = (candidate.ledger || []).reduce((sum, movement) => sum + (movement.entries || []).filter(entry => entry.account === 'fees' && entry.side === 'debit').reduce((subtotal, entry) => subtotal + Number(entry.amount || 0), 0), 0);
  for (const movement of candidate.ledger || []) { const debit = (movement.entries || []).filter(entry => entry.side === 'debit').reduce((sum, entry) => sum + Number(entry.amount || 0), 0), credit = (movement.entries || []).filter(entry => entry.side === 'credit').reduce((sum, entry) => sum + Number(entry.amount || 0), 0); if (Math.abs(debit - credit) > cashTolerance) issues.push(`Asiento ${movement.id || 'sin-id'} desbalanceado.`); }
  if (Math.abs(cashFromLedger - Number(candidate.cash || 0)) > cashTolerance) issues.push(`Cash no coincide con el ledger (${cashFromLedger.toFixed(6)} vs ${Number(candidate.cash || 0).toFixed(6)}).`);
  if (Math.abs(feesFromLedger - Number(candidate.feesPaid || 0)) > cashTolerance) issues.push(`Comisiones no coinciden con el ledger (${feesFromLedger.toFixed(6)} vs ${Number(candidate.feesPaid || 0).toFixed(6)}).`);
  const orderKeys = new Set(); for (const order of candidate.orders || []) { if (!PAPER_ORDER_STATES.has(order.status)) issues.push(`Estado de orden inválido: ${order.status}.`); if (order.clientOrderId) { if (orderKeys.has(order.clientOrderId)) issues.push(`clientOrderId duplicado: ${order.clientOrderId}.`); orderKeys.add(order.clientOrderId); } }
  const positionKeys = new Set(); for (const position of candidate.positions || []) { if (positionKeys.has(position.symbol)) issues.push(`Posición duplicada: ${position.symbol}.`); positionKeys.add(position.symbol); if (!(Number(position.quantity) > 0)) issues.push(`Cantidad de posición inválida: ${position.symbol}.`); }
  issues.push(...accountingIssues(candidate));
  return { valid: issues.length === 0, issues: [...new Set(issues)].slice(0, 20), checkedAt: new Date().toISOString(), ledgerEntries: (candidate.ledger || []).length, orderCount: (candidate.orders || []).length, positionCount: (candidate.positions || []).length, tradeCount: (candidate.trades || []).length };
}
function validatePaperState(candidate) {
  if (!candidate || typeof candidate !== 'object') return { valid: false, error: 'El respaldo no contiene una cuenta.' };
  if (Number(candidate.schemaVersion || 0) > defaults.state.schemaVersion) return { valid: false, error: 'El respaldo requiere una versión más nueva de la aplicación.' };
  if (!Number.isFinite(Number(candidate.initialCash)) || Number(candidate.initialCash) <= 0 || !Number.isFinite(Number(candidate.cash)) || Number(candidate.cash) < -0.00000001) return { valid: false, error: 'Capital o cash inválido.' };
  if (!Array.isArray(candidate.positions) || !Array.isArray(candidate.orders) || !Array.isArray(candidate.trades) || !Array.isArray(candidate.ledger)) return { valid: false, error: 'Faltan colecciones de cuenta obligatorias.' };
  if (candidate.positions.some(item => !item.symbol || !(Number(item.quantity) > 0))) return { valid: false, error: 'Existe una posición inválida.' };
  if (candidate.orders.some(item => !PAPER_ORDER_STATES.has(item.status))) return { valid: false, error: 'Existe una orden con estado inválido.' };
  for (const entry of candidate.ledger) { if (!Array.isArray(entry.entries)) return { valid: false, error: 'Existe un asiento contable inválido.' }; const debit = entry.entries.filter(item => item.side === 'debit').reduce((sum, item) => sum + Number(item.amount || 0), 0), credit = entry.entries.filter(item => item.side === 'credit').reduce((sum, item) => sum + Number(item.amount || 0), 0); if (Math.abs(debit - credit) > 0.00000001) return { valid: false, error: 'El libro contable del respaldo no está balanceado.' }; }
  const integrity = verifyPaperIntegrity(candidate); if (!integrity.valid) return { valid: false, error: integrity.issues.join('; ') };
  return { valid: true };
}
function backupPaperSnapshot(reason, current = state()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), file = path.join(BACKUP_DIR, `paper-${stamp}-${String(reason || 'snapshot').replace(/[^a-z0-9_-]/gi, '-')}.json`);
  writeJson(file, { version: 1, createdAt: new Date().toISOString(), reason, settings: settings(), state: current, sessions: readJson(SESSIONS_FILE, []) });
  if (typeof fs.readdirSync === 'function' && typeof fs.unlinkSync === 'function') { const backups = fs.readdirSync(BACKUP_DIR).filter(name => /^paper-.*\.json$/i.test(name)).sort(); for (const old of backups.slice(0, Math.max(0, backups.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, old)); }
  return file;
}
function listPaperBackups() { if (typeof fs.readdirSync !== 'function') return []; try { return fs.readdirSync(BACKUP_DIR).filter(name => /^paper-.*\.json$/i.test(name)).sort().reverse().map(name => ({ name, path: path.join(BACKUP_DIR, name) })); } catch { return []; } }
async function restorePaperBackup() {
  if (!dialog?.showOpenDialog) throw new Error('La restauración no está disponible en este entorno.');
  const selection = await dialog.showOpenDialog({ title: 'Restaurar respaldo paper', properties: ['openFile'], filters: [{ name: 'Respaldo JSON', extensions: ['json'] }] });
  if (selection.canceled || !selection.filePaths?.[0]) return null;
  let payload; try { payload = JSON.parse(fs.readFileSync(selection.filePaths[0], 'utf8')); } catch { throw new Error('No se pudo leer el respaldo seleccionado.'); }
  const candidate = { ...structuredClone(defaults.state), ...(payload.state || payload) };
  if (![candidate.positions,candidate.orders,candidate.trades,candidate.ledger].every(Array.isArray)) throw new Error('El respaldo contiene colecciones inválidas.');
  const restored = { ...candidate, ...migrateState(candidate, false).current }, validation = validatePaperState(restored);
  if (!validation.valid) throw new Error(`Respaldo rechazado: ${validation.error}`);
  if (!restored.ledger.length) postLedger(restored, { type: 'initial-capital' }, [{ account: 'cash', side: 'debit', amount: restored.initialCash }, { account: 'equity', side: 'credit', amount: restored.initialCash }]);
  return paperMutationQueue.enqueue('paper-restore', () => {
    stopPaperAutomation('Restauración de cuenta');
    backupPaperSnapshot('before-restore');
    restored.paused = true; restored.pauseReason = 'Cuenta restaurada: revisa posiciones antes de reanudar.';
    restored.automation = { ...restored.automation, status: 'paused' };
    writeJson(STATE_FILE, restored);
    writeJson(SETTINGS_FILE, { ...settings(), ...(payload.settings || {}), accountCurrency: restored.currency, mode: 'paper', automationEnabled: false });
    subscribeMarket(restored.positions.map(p => p.symbol));
    return state();
  });
}

function usageToday(current) {
  const today = new Date().toISOString().slice(0, 10);
  if (current.llmUsage.date !== today) current.llmUsage = { ...defaults.state.llmUsage, date: today };
  return current.llmUsage;
}

function reserveLlmCall(config) {
  const current = state(), usage = usageToday(current), callLimit = Math.max(1, Number(config.llmDailyCallBudget) || 24), costLimit = Math.max(0, Number(config.llmDailyBudgetUsd) || 0);
  if (usage.calls >= callLimit) throw new Error(`Presupuesto diario del LLM agotado (${callLimit} llamadas).`);
  if (costLimit > 0 && Number(usage.estimatedCostUsd || 0) >= costLimit) throw new Error(`Presupuesto diario del LLM agotado (${costLimit.toFixed(2)} USD).`);
  usage.calls += 1; usage.lastCallAt = new Date().toISOString(); usage.lastError = null; writeJson(STATE_FILE, current); return usage;
}

function estimateLlmCallCost(usagePayload, config) {
  const inputTokens = Number(usagePayload?.prompt_tokens ?? usagePayload?.input_tokens ?? 0) || 0;
  const outputTokens = Number(usagePayload?.completion_tokens ?? usagePayload?.output_tokens ?? 0) || 0;
  const inputRate = Math.max(0, Number(config.llmInputCostPer1kUsd) || 0), outputRate = Math.max(0, Number(config.llmOutputCostPer1kUsd) || 0);
  return inputTokens / 1000 * inputRate + outputTokens / 1000 * outputRate;
}

function recordLlmOutcome({ usagePayload = null, error = null, invalid = false } = {}) {
  const current = state(), config = settings(), usage = usageToday(current);
  const inputTokens = Number(usagePayload?.prompt_tokens ?? usagePayload?.input_tokens ?? 0) || 0;
  const outputTokens = Number(usagePayload?.completion_tokens ?? usagePayload?.output_tokens ?? 0) || 0;
  usage.inputTokens += inputTokens; usage.outputTokens += outputTokens;
  const callCostUsd = estimateLlmCallCost(usagePayload, config);
  usage.estimatedCostUsd += callCostUsd;
  current.llmTotalCostUsd = Number(current.llmTotalCostUsd || 0) + callCostUsd;
  if (error) { usage.consecutiveFailures = Number(usage.consecutiveFailures || 0) + 1; usage.lastError = String(error.message || error); }
  else { usage.consecutiveFailures = 0; usage.lastError = null; }
  if (invalid) usage.invalidResponses = Number(usage.invalidResponses || 0) + 1;
  if (error && usage.consecutiveFailures >= Math.max(1, Number(config.llmFailurePauseThreshold) || 3) && config.automationEnabled) {
    writeJson(SETTINGS_FILE, { ...config, automationEnabled: false });
    current.automation = { ...(current.automation || {}), pausedReason: 'Auto-Paper pausado tras fallos repetidos del proveedor LLM', lastError: usage.lastError };
  }
  writeJson(STATE_FILE, current); return { ...usage, callCostUsd };
}

function postLedger(current, meta, entries) {
  if (entries.some(entry => !Number.isFinite(entry.amount) || entry.amount < 0 || !['debit', 'credit'].includes(entry.side))) throw new Error('Asiento contable inválido.');
  const debit = entries.filter(entry => entry.side === 'debit').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const credit = entries.filter(entry => entry.side === 'credit').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  if (Math.abs(debit - credit) > 0.00000001) throw new Error('El movimiento contable no está balanceado.');
  current.ledger.push({ id: randomUUID(), sessionId: current.sessionId, ...meta, entries, createdAt: new Date().toISOString() });
}

function equity(current) { return current.cash + current.positions.reduce((sum, item) => sum + item.quantity * (item.bid || item.mark || item.entry), 0); }

function recordEquity(current) {
  const value = equity(current);
  current.peakEquity = Math.max(Number(current.peakEquity) || current.initialCash || 0, value);
  const maxDrawdown = Math.max(1, Number(settings().maxDrawdownPct) || 10) / 100;
  if (current.peakEquity > 0 && value < current.peakEquity * (1 - maxDrawdown)) { const wasPaused = current.paused; current.paused = true; current.pauseReason = `Drawdown máximo de ${(maxDrawdown * 100).toFixed(1)}% alcanzado`; if (!wasPaused) addStateAlert(current, 'drawdown', 'critical', current.pauseReason, { equity: value, peakEquity: current.peakEquity }); }
  const last = current.equityHistory.at(-1);
  const exposure = current.positions.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.bid || item.mark || item.entry || 0), 0);
  if (!last || Date.now() - new Date(last.time).getTime() >= 60000 || current.trades.length !== Number(last.fillCount || 0)) current.equityHistory.push({ time: new Date().toISOString(), value, cash: Number(current.cash) || 0, exposure, fillCount: current.trades.length });
  else if (current.equityHistory.length > 1) { last.value = value; last.cash = Number(current.cash) || 0; last.exposure = exposure; }
}

async function refreshPaper() {
  for (const symbol of new Set(['BTCUSDT', ...state().positions.map(p => p.symbol)])) {
    try { const quote = await fetchQuote(symbol); await markToMarket(symbol, quote.last, quote); }
    catch (error) { recordProtectionOffline(symbol, error); }
  }
  return state();
}

function markToMarket(symbol, price, quote = {}) {
  return paperMutationQueue.enqueue('market-tick', () => applyMarketTick(symbol, price, quote));
}

function applyMarketTick(symbol, price, quote = {}) {
  if (!freshQuote(quote, settings().maxDataAgeMs) || !(Number.isFinite(price) && price > 0)) return;
  const current = state();
  current.marketHealth = { ...(current.marketHealth || {}), status: 'live', lastTickAt: new Date().toISOString(), lastSymbol: symbol, transport: quote.transport || 'rest', symbols: { ...(current.marketHealth?.symbols || {}), [symbol]: { status: 'live', fetchedAt: quote.fetchedAt, transport: quote.transport || 'rest' } } };
  const protectedPositions = current.positions.filter(item => Number(item.stopLoss) > 0 || Number(item.takeProfit) > 0).length;
  current.protection = { ...(current.protection || {}), status: protectedPositions ? 'armed' : 'not-needed', lastCheckAt: new Date().toISOString(), protectedPositions, waitingForFreshQuote: false };
  const position = current.positions.find(item => item.symbol === symbol);
  current.benchmark ||= { symbol: 'BTCUSDT', startPrice: null, currentPrice: null };
  if (symbol === current.benchmark.symbol) { current.benchmark.startPrice ||= price; current.benchmark.currentPrice = price; current.benchmark.cashValue = current.initialCash; current.benchmark.buyAndHoldValue = current.benchmark.startPrice ? current.initialCash * price / current.benchmark.startPrice : current.initialCash; current.benchmark.buyAndHoldReturnPct = current.benchmark.startPrice ? (price - current.benchmark.startPrice) / current.benchmark.startPrice * 100 : 0; }
  let protectiveExit = null;
  if (position) {
    position.mark = price; position.bid = Number(quote.bid) || position.bid || price; position.ask = Number(quote.ask) || position.ask || price; position.markAt = new Date().toISOString();
    protectiveExit = resolveProtectiveExit(position, { ...quote, bid: position.bid }, price, settings().intrabarPolicy || 'conservative');
    if (protectiveExit?.ambiguous) addStateAlert(current, 'ambiguous-protection', 'warning', `Stop y take-profit tocaron el mismo rango en ${symbol}; se aplicó política ${settings().intrabarPolicy || 'conservative'}.`, { symbol, policy: settings().intrabarPolicy || 'conservative' });
    recordEquity(current); writeJson(STATE_FILE, current);
  } else if (symbol === current.benchmark.symbol) {
    recordEquity(current); writeJson(STATE_FILE, current);
  }
  else writeJson(STATE_FILE, current);
  let nextState = state();
  if (protectiveExit && position?.quantity > 0) {
    try {
      const exitPrice = Number(protectiveExit.executionPrice) > 0 ? protectiveExit.executionPrice : price;
      nextState = executePaperTrade({ symbol, side: 'SELL', quantity: position.quantity, price: exitPrice, quote: { ...quote, bid: exitPrice, last: exitPrice }, source: 'risk-exit', exitReason: protectiveExit.reason, protectionGap: Boolean(protectiveExit.gap) });
    } catch (error) {
      const failedExit = state();
      addStateAlert(failedExit, 'protection-fill-failed', 'critical', `No se pudo ejecutar la protección de ${symbol}: ${error.message}`, { symbol, reason: protectiveExit.reason });
      writeJson(STATE_FILE, failedExit);
      nextState = failedExit;
    }
  }
  processPendingOrders(symbol, { ...quote, last: price });
  nextState = state();
  mainWindow?.webContents.send('market:tick', { symbol, price, bid: quote.bid, ask: quote.ask, fetchedAt: quote.fetchedAt, transport: quote.transport || 'rest', time: new Date().toISOString(), state: nextState });
}

function recordProtectionOffline(symbol, error = null) {
  const current = state(), protectedCount = current.positions.filter(item => Number(item.stopLoss) > 0 || Number(item.takeProfit) > 0).length;
  const prior = current.marketHealth?.symbols?.[symbol];
  if (prior?.fetchedAt && Date.now() - prior.fetchedAt < settings().maxDataAgeMs) return;
  const symbols = { ...(current.marketHealth?.symbols || {}), [symbol]: { ...prior, status: 'offline' } };
  current.marketHealth = { ...current.marketHealth, symbols, status: Object.values(symbols).some(s => s.status === 'live' && Date.now() - s.fetchedAt < settings().maxDataAgeMs) ? 'degraded' : 'offline' };
  current.protection = { ...(current.protection || {}), status: protectedCount ? 'waiting-for-feed' : 'unavailable', lastCheckAt: new Date().toISOString(), protectedPositions: protectedCount, waitingForFreshQuote: protectedCount > 0 };
  if (protectedCount) addStateAlert(current, 'protection-unavailable', 'critical', `Feed sin datos para ${symbol}; las protecciones permanecen armadas y esperan una cotización fresca.`, { symbol, protectedPositions: protectedCount, error: error?.message || null });
  writeJson(STATE_FILE, current);
  mainWindow?.webContents.send('paper:state', current);
}

function subscribeMarket(symbols) {
  for (const value of [...new Set(symbols.map(item => String(item).trim().toUpperCase()))]) {
    if (!/^[A-Z0-9]{5,15}$/.test(value) || marketStreams.has(value)) continue;
    const stream = { closed: false, socket: null, poller: null, reconnectTimer: null, failures: 0, depthSnapshot: null, depthBuffer: [], depthResyncing: false };
    marketStreams.set(value, stream);
    // Independent REST watchdog: a present but broken websocket must not
    // disable fresh quotes, valuation or protective exits.
    const poll = async () => {
      if (stream.closed || stream.polling) return;
      const previous = state().marketHealth?.symbols?.[value];
      if (previous?.transport === 'websocket' && Date.now() - previous.fetchedAt < 5000) return;
      stream.polling = true;
      try {
        const quote = await fetchQuote(value);
        if (!stream.closed) await markToMarket(value, quote.last, { ...quote, transport: 'rest' });
        await fetchDepth(value).catch(() => null);
      } catch (error) { if (!stream.closed) recordProtectionOffline(value, error); }
      finally { stream.polling = false; }
    };
    stream.poller = setInterval(poll, 3000);
    poll();
    const connect = () => {
      if (stream.closed) return;
      if (typeof WebSocket === 'undefined') {
        return;
      }
      const scheduleReconnect = () => {
        recordProtectionOffline(value);
        if (stream.closed || stream.reconnectTimer) return;
        // REST can remain healthy while websocket reconnects.
        const delay = Math.min(30000, 3000 * 2 ** Math.min(stream.failures, 4));
        stream.reconnectTimer = setTimeout(() => { stream.reconnectTimer = null; connect(); }, delay);
      };
      let socket;
      const resyncDepth = async () => {
        if (stream.depthResyncing || stream.closed) return;
        stream.depthResyncing = true; stream.depthSnapshot = null;
        try {
          let snapshot = await fetchDepth(value, 20, { force: true });
          const buffered = stream.depthBuffer.splice(0).sort((a, b) => Number(a.u) - Number(b.u));
          for (const event of buffered) { const applied = applyDepthDiff(snapshot, event, 20, Date.now()); if (applied.needsResync) throw new Error(applied.reason || 'Secuencia de profundidad no sincronizable.'); if (applied.status === 'fresh') snapshot = applied.snapshot; }
          stream.depthSnapshot = snapshot; depthSnapshots.set(value, snapshot);
        } catch (error) {
          stream.depthBuffer = []; const stale = depthSnapshots.get(value); if (stale) depthSnapshots.set(value, { ...stale, status: 'stale', dataQuality: { ...(stale.dataQuality || {}), status: 'stale', reason: error.message } }); stream.failures += 1;
          try { if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) socket.close(); } catch { /* reconnect handler records the outage */ }
          scheduleReconnect();
        } finally { stream.depthResyncing = false; }
      };
      try { socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${value.toLowerCase()}@miniTicker/${value.toLowerCase()}@bookTicker/${value.toLowerCase()}@depth@100ms`); }
      catch { stream.failures += 1; scheduleReconnect(); return; }
      stream.socket = socket;
      resyncDepth();
      socket.onopen = () => { stream.failures = 0; };
      socket.onmessage = event => { try { const envelope = JSON.parse(event.data); const data = envelope.data || envelope; if (data.e === 'depthUpdate' || (data.U !== undefined && data.u !== undefined && Array.isArray(data.b) && Array.isArray(data.a))) { if (!stream.depthSnapshot) { stream.depthBuffer.push(data); if (stream.depthBuffer.length > 1000) stream.depthBuffer.shift(); } else { const applied = applyDepthDiff(stream.depthSnapshot, data, 20, Date.now()); if (applied.needsResync) { stream.depthSnapshot = null; stream.depthBuffer = []; stream.failures += 1; try { socket.close(); } catch {} scheduleReconnect(); } else if (applied.status === 'fresh') { stream.depthSnapshot = applied.snapshot; depthSnapshots.set(value, applied.snapshot); } } return; } const bid = Number(data.b), ask = Number(data.a), price = (bid + ask) / 2; if (bid > 0 && ask >= bid) markToMarket(value, price, { bid, ask, last: price, fetchedAt: Date.now(), transport: 'websocket' }).catch(error => recordProtectionOffline(value, error)); } catch { /* ignore malformed stream messages */ } };
      socket.onerror = () => { stream.failures += 1; socket.onerror = null; try { if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(); } catch { /* the close event will schedule recovery */ } scheduleReconnect(); };
      socket.onclose = () => { stream.socket = null; if (stream.depthSnapshot) { const stale = { ...stream.depthSnapshot, status: 'stale', dataQuality: { ...(stream.depthSnapshot.dataQuality || {}), status: 'stale' } }; stream.depthSnapshot = stale; depthSnapshots.set(value, stale); } if (!appQuitting) scheduleReconnect(); };
    };
    connect();
  }
  return true;
}

async function fetchCandles(symbol, interval = '1h', limit = 100, options = {}) {
  const normalized = String(symbol).trim().toUpperCase();
  if (!/^[A-Z0-9]{5,15}$/.test(normalized)) throw new Error('Símbolo inválido. Usa, por ejemplo, BTCUSDT.');
  if (!MARKET_INTERVALS.has(interval)) throw new Error(`Intervalo no soportado: ${interval}.`);
  const requestedLimit = Math.min(1000, Math.max(50, Number(limit) || 100)), cached = readJson(marketCacheFile(normalized, interval), null), cachedCandles = Array.isArray(cached?.candles) ? cached.candles : [], intervalMs = marketIntervalMilliseconds(interval), cachedLatest = cachedCandles.reduce((latest, candle) => !latest || Number(candle?.time) > Number(latest.time) ? candle : latest, null), incrementalEligible = Boolean(cachedLatest && intervalMs && Date.now() - Number(cachedLatest.time) > intervalMs * 1.5);
  let lastError = null;
  for (const base of MARKET_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const incremental = incrementalEligible && attempt === 0 && cached?.source === base, startTime = incremental ? Number(cachedLatest.time) + intervalMs : null, url = `${base}/klines?symbol=${encodeURIComponent(normalized)}&interval=${encodeURIComponent(interval)}&limit=${requestedLimit}${startTime ? `&startTime=${startTime}` : ''}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
        if (response.status === 429 || response.status >= 500) throw new Error(`Mercado temporalmente no disponible (${response.status}).`);
        if (!response.ok) throw new Error(`Mercado no disponible (${response.status}).`);
        const rows = await response.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error('El mercado no devolvió velas.');
        const incoming = rows.map(row => normalizeCandleRow(row)), candles = incremental ? mergeCandleSeries(cachedCandles, incoming, requestedLimit) : incoming, dataQuality = validateMarketCandles(candles, interval), closed = closedCandles(candles);
        if (!dataQuality.valid) throw new Error(`Datos de mercado inválidos: ${dataQuality.issues.join('; ')}`);
        const result = { symbol: normalized, interval, source: base, fetchedAt: Date.now(), stale: false, candles, closedCandles: closed, recoveredCandleCount: incremental ? Math.max(0, candles.length - cachedCandles.length) : 0, dataQuality, features: calculateFeatures(closed) }; try { writeJson(marketCacheFile(normalized, interval), result); } catch { /* cache failure must not block market access */ } return result;
      } catch (error) { lastError = error; if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 400)); }
    }
  }
  if (options.allowStale) {
    const cached = readJson(marketCacheFile(normalized, interval), null);
    if (cached?.candles?.length) { const cachedClosed = cached.closedCandles || closedCandles(cached.candles), stale = { ...cached, source: 'local-cache', stale: true, closedCandles: cachedClosed, dataQuality: { ...(cached.dataQuality || {}), valid: true, status: 'stale', closedCandleCount: cachedClosed.length, warnings: [...new Set([...(cached.dataQuality?.warnings || []), `Proveedor no disponible: ${lastError?.message || 'sin respuesta'}.`])] }, features: calculateFeatures(cachedClosed) }; addAlert('market-cache', 'warning', `Mostrando ${normalized} ${interval} desde caché local; las órdenes permanecen bloqueadas.`); return stale; }
  }
  throw new Error(lastError?.message || 'No se pudo conectar al mercado.');
}

function backtestStrategyName(strategy) { return ({ 'sma20-50': 'SMA 20/50 baseline', 'ema12-26': 'EMA 12/26 trend', 'rsi-reversion': 'RSI 14 mean reversion' }[strategy] || 'SMA 20/50 baseline'); }
function backtestSignal(strategy, candles, index) {
  const averageAt = (end, period) => candles.slice(end - period + 1, end + 1).reduce((sum, candle) => sum + candle.close, 0) / period;
  if (strategy === 'ema12-26') {
    const values = candles.slice(0, index + 1).map(candle => candle.close), fast = ema(values, 12), slow = ema(values, 26), previous = values.slice(0, -1), previousFast = ema(previous, 12), previousSlow = ema(previous, 26);
    return previousFast <= previousSlow && fast > slow ? 'BUY' : previousFast >= previousSlow && fast < slow ? 'SELL' : 'HOLD';
  }
  if (strategy === 'rsi-reversion') {
    const values = candles.slice(0, index + 1).map(candle => candle.close), value = rsi(values, 14);
    return value <= 30 ? 'BUY' : value >= 70 ? 'SELL' : 'HOLD';
  }
  const fast = averageAt(index, 20), slow = averageAt(index, 50), previousFast = averageAt(index - 1, 20), previousSlow = averageAt(index - 1, 50);
  return previousFast <= previousSlow && fast > slow ? 'BUY' : previousFast >= previousSlow && fast < slow ? 'SELL' : 'HOLD';
}
function backtestSegmentSummary(key, start, end, candles, equityHistory, trades, startingCash) {
  const startTime = new Date(candles[start].time).toISOString(), endTime = new Date(candles[end].time).toISOString(), inRange = equityHistory.filter(item => item.time >= startTime && item.time <= endTime), startEquity = inRange[0]?.value ?? startingCash, endEquity = inRange.at(-1)?.value ?? startEquity, startPrice = candles[start].close, endPrice = candles[end].close, segmentTrades = trades.filter(item => item.createdAt >= startTime && item.createdAt <= endTime);
  return { key, startAt: startTime, endAt: endTime, candles: end - start + 1, strategyStart: startEquity, strategyEnd: endEquity, returnPct: startEquity ? (endEquity - startEquity) / startEquity * 100 : 0, cashReturnPct: 0, buyAndHoldReturnPct: startPrice ? (endPrice - startPrice) / startPrice * 100 : 0, buyAndHoldEnd: startPrice ? startingCash * endPrice / startPrice : startingCash, tradeCount: segmentTrades.length };
}
function monteCarloStress(trades = [], initialCash, benchmarkFinal, seed, iterations = 200) {
  const outcomes = trades.filter(trade => trade.side === 'SELL').map(trade => Number(trade.netPnl ?? trade.realizedPnl)).filter(Number.isFinite);
  if (!outcomes.length) return { status: 'unavailable', iterations: 0, reason: 'Se necesita al menos un trade cerrado.' };
  let value = parseInt(String(seed).slice(0, 8), 16) >>> 0; const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }, finals = [], drawdowns = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) { let equityValue = initialCash, peak = initialCash, maxDrawdown = 0; for (let tradeIndex = 0; tradeIndex < outcomes.length; tradeIndex += 1) { equityValue += outcomes[Math.floor(random() * outcomes.length)]; peak = Math.max(peak, equityValue); maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equityValue) / peak * 100 : 0); } finals.push(equityValue); drawdowns.push(maxDrawdown); }
  finals.sort((a, b) => a - b); drawdowns.sort((a, b) => a - b); const percentile = (values, quantile) => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * quantile)))];
  return { status: 'completed', iterations, trades: outcomes.length, finalP5: percentile(finals, 0.05), finalP50: percentile(finals, 0.5), finalP95: percentile(finals, 0.95), drawdownP50: percentile(drawdowns, 0.5), drawdownP95: percentile(drawdowns, 0.95), positiveProbability: finals.filter(finalValue => finalValue > initialCash).length / finals.length * 100, beatBenchmarkProbability: Number.isFinite(benchmarkFinal) ? finals.filter(finalValue => finalValue > benchmarkFinal).length / finals.length * 100 : null, method: 'bootstrap con reemplazo y semilla determinista' };
}

async function runBacktest({ symbol, interval, initialCash, strategy = 'sma20-50' }) {
  const startingCash = Number(initialCash);
  if (!Number.isFinite(startingCash) || startingCash <= 0) throw new Error('El capital del backtest debe ser mayor que cero.');
  const selectedStrategy = ['sma20-50', 'ema12-26', 'rsi-reversion'].includes(strategy) ? strategy : 'sma20-50';
  const market = await fetchCandles(symbol, interval, 1000), candles = market.closedCandles || closedCandles(market.candles), warmup = 50;
  if (candles.length < 60) throw new Error('Se necesitan al menos 60 velas para el backtest.');
  const config = settings(), feeRate = Math.max(0, Number(config.feeRate) || 0), slippageBps = Math.max(0, Number(config.slippageBps) || 0), slippage = slippageBps / 10000, spreadBps = Math.max(0, Number(config.backtestSpreadBps) || 2), spread = spreadBps / 10000, intervalMs = marketIntervalMilliseconds(interval) || 3600000, latencyMs = Math.max(0, Number(config.executionLatencyMs) || 0), latencyBars = Math.max(1, Math.ceil(latencyMs / intervalMs)), fillFraction = Math.min(1, Math.max(0.01, Number(config.partialFillPct) || 100) / 100), liquidity = Math.max(0, Number(config.liquidityNotionalPerTick) || 0);
  const datasetFingerprint = createHash('sha256').update(JSON.stringify({ symbol: market.symbol, interval, strategy: selectedStrategy, candleTimes: candles.map(candle => candle.time), costs: { feeRate, slippageBps, spreadBps, latencyMs, fillFraction, liquidity } })).digest('hex').slice(0, 24);
  let cash = startingCash, position = null, grossRealizedPnl = 0, netRealizedPnl = 0;
  const trades = [], pending = [], equityHistory = [{ time: new Date(candles[warmup].time).toISOString(), value: startingCash }], source = selectedStrategy;
  const fillPrice = (candle, side) => candle.open * (side === 'BUY' ? 1 + spread / 2 + slippage : 1 - spread / 2 - slippage);
  const buy = (candle, fraction = fillFraction) => { const price = fillPrice(candle, 'BUY'), capacity = cash / (price * (1 + feeRate)), liquidityQty = liquidity ? liquidity / price : Infinity, quantity = Math.min(capacity, liquidityQty) * fraction; if (!(quantity > 0)) return; const notional = quantity * price, fee = notional * feeRate; cash -= notional + fee; position = { quantity, entryPrice: price, entry: (notional + fee) / quantity, openedAt: candle.time }; trades.push({ id: randomUUID(), symbol: market.symbol, side: 'BUY', quantity, price, notional, fee, slippageCost: Math.abs(price - candle.open) * quantity, grossPnl: null, netPnl: null, realizedPnl: null, createdAt: new Date(candle.time).toISOString(), source }); };
  const sell = (candle, reason, fraction = fillFraction) => { if (!position) return; const quantity = Math.min(position.quantity, position.quantity * fraction), price = fillPrice(candle, 'SELL'), notional = quantity * price, fee = notional * feeRate, entryPrice = Number(position.entryPrice || position.entry), entryFee = Math.max(0, Number(position.entry || entryPrice) - entryPrice) * quantity, grossPnl = (price - entryPrice) * quantity, realizedPnl = grossPnl - fee - entryFee; cash += notional - fee; grossRealizedPnl += grossPnl; netRealizedPnl += realizedPnl; trades.push({ id: randomUUID(), symbol: market.symbol, side: 'SELL', quantity, price, notional, fee, slippageCost: Math.abs(price - candle.open) * quantity, grossPnl, netPnl: realizedPnl, realizedPnl, createdAt: new Date(candle.time).toISOString(), exitReason: reason, source }); position.quantity -= quantity; if (position.quantity <= 0.0000000001) position = null; };
  for (let index = warmup; index < candles.length; index += 1) {
    for (let pendingIndex = pending.length - 1; pendingIndex >= 0; pendingIndex -= 1) { const order = pending[pendingIndex]; if (order.fillIndex !== index) continue; if (order.action === 'BUY' && !position) buy(candles[index]); if (order.action === 'SELL' && position) sell(candles[index], 'signal'); pending.splice(pendingIndex, 1); }
    const action = backtestSignal(selectedStrategy, candles, index);
    if (action === 'BUY' && !position && !pending.some(item => item.action === 'BUY')) pending.push({ action, fillIndex: index + latencyBars });
    if (action === 'SELL' && position && !pending.some(item => item.action === 'SELL')) pending.push({ action, fillIndex: index + latencyBars });
    const value = cash + (position ? position.quantity * candles[index].close : 0); equityHistory.push({ time: new Date(candles[index].time).toISOString(), value });
  }
  if (position) sell(candles.at(-1), 'end-of-test', 1);
  const finalValue = cash, sample = candles.length - warmup, trainLength = Math.max(1, Math.floor(sample * 0.6)), validationLength = Math.max(1, Math.floor(sample * 0.2)), trainEnd = Math.min(candles.length - 1, warmup + trainLength - 1), validationEnd = Math.min(candles.length - 1, trainEnd + validationLength), segments = [backtestSegmentSummary('train', warmup, trainEnd, candles, equityHistory, trades, startingCash), backtestSegmentSummary('validation', trainEnd + 1, validationEnd, candles, equityHistory, trades, startingCash), backtestSegmentSummary('test', validationEnd + 1, candles.length - 1, candles, equityHistory, trades, startingCash)];
  const walkTrainLength = Math.max(30, Math.floor(sample * 0.4)), walkTestLength = Math.max(10, Math.floor(sample * 0.1)), walkForward = [];
  for (let start = warmup; start + walkTrainLength + walkTestLength <= candles.length; start += walkTestLength) { const testStart = start + walkTrainLength, testEnd = testStart + walkTestLength - 1, fold = backtestSegmentSummary(`walk-forward-${walkForward.length + 1}`, testStart, testEnd, candles, equityHistory, trades, startingCash); walkForward.push({ ...fold, regime: classifyMarketRegime(candles, testStart, testEnd), trainStartAt: new Date(candles[start].time).toISOString(), trainEndAt: new Date(candles[testStart - 1].time).toISOString(), testStartAt: new Date(candles[testStart].time).toISOString(), testEndAt: new Date(candles[testEnd].time).toISOString() }); }
  const startPrice = candles[warmup].close, endPrice = candles.at(-1).close, buyAndHoldEnd = startPrice ? startingCash * endPrice / startPrice : startingCash;
  return { strategy: backtestStrategyName(selectedStrategy), strategyId: selectedStrategy, symbol: market.symbol, interval: market.interval, period: { startAt: new Date(candles[warmup].time).toISOString(), endAt: new Date(candles.at(-1).time).toISOString() }, datasetFingerprint, seed: datasetFingerprint, dataQuality: market.dataQuality, assumptions: { startingCash, feeRate, slippageBps, spreadBps, executionLatencyMs: latencyMs, latencyBars, partialFillPct: fillFraction * 100, liquidityNotionalPerTick: liquidity || null, fill: latencyMs ? 'apertura tras latencia simulada' : 'siguiente candle open', longOnly: true, parameterSelection: 'estrategia congelada; los folds no se seleccionan por rendimiento', monteCarloIterations: 200, monteCarloCostMultipliers: [1, 1.5, 2] }, initialCash: startingCash, cash: finalValue, positions: [], trades, equityHistory, grossRealizedPnl, netRealizedPnl, realizedPnl: netRealizedPnl, feesPaid: trades.reduce((sum, item) => sum + Number(item.fee || 0), 0), slippagePaid: trades.reduce((sum, item) => sum + Number(item.slippageCost || 0), 0), benchmark: { symbol: market.symbol, startPrice, currentPrice: endPrice }, benchmarks: { cash: { finalValue: startingCash, returnPct: 0 }, buyAndHold: { finalValue: buyAndHoldEnd, returnPct: startPrice ? (endPrice - startPrice) / startPrice * 100 : 0 } }, monteCarlo: runMonteCarloStress(trades, startingCash, buyAndHoldEnd, datasetFingerprint), splits: segments, walkForward, regimeSummary: summarizeRegimes(walkForward), outOfSample: segments.at(-1), createdAt: new Date().toISOString() };
}

function saveBacktestExperiment(report) {
  const saved = { ...report, experimentId: randomUUID(), savedAt: new Date().toISOString() }, experiments = readJson(EXPERIMENTS_FILE, []);
  experiments.unshift(saved); writeJson(EXPERIMENTS_FILE, experiments.slice(0, 100)); return saved;
}
function listBacktestExperiments() {
  return readJson(EXPERIMENTS_FILE, []).map(item => ({ experimentId: item.experimentId, savedAt: item.savedAt || item.createdAt, strategy: item.strategy, symbol: item.symbol, interval: item.interval, finalValue: item.cash, returnPct: item.initialCash ? (Number(item.cash) - Number(item.initialCash)) / Number(item.initialCash) * 100 : null, buyAndHoldReturnPct: item.benchmarks?.buyAndHold?.returnPct ?? null, testReturnPct: item.outOfSample?.returnPct ?? null, trades: (item.trades || []).filter(trade => trade.side === 'SELL').length })).filter(item => item.experimentId).slice(0, 50);
}
async function compareBacktests(query = {}) { const reports = []; for (const strategy of ['sma20-50', 'ema12-26', 'rsi-reversion']) reports.push(saveBacktestExperiment(await runBacktest({ ...query, strategy }))); return { symbol: reports[0]?.symbol || query.symbol, interval: reports[0]?.interval || query.interval, initialCash: reports[0]?.initialCash || query.initialCash, reports, createdAt: new Date().toISOString(), selection: 'manual; no se elige automáticamente por el mejor resultado' }; }

async function fetchQuote(symbol) {
  const normalized = String(symbol).trim().toUpperCase();
  if (!/^[A-Z0-9]{5,15}$/.test(normalized)) throw new Error('Símbolo inválido.');
  let lastError = null;
  for (const base of MARKET_ENDPOINTS) {
    try {
      const response = await fetch(`${base}/ticker/bookTicker?symbol=${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Cotización no disponible (${response.status}).`);
      const payload = await response.json(); const bid = Number(payload.bidPrice), ask = Number(payload.askPrice);
      if (!(bid > 0 && ask >= bid)) throw new Error('El mercado devolvió un bid/ask inválido.');
      return { symbol: normalized, bid, ask, last: (bid + ask) / 2, fetchedAt: Date.now(), source: base };
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || 'No se pudo obtener bid/ask.');
}

async function fetchDepth(symbol, limit = 20, options = {}) {
  const normalized = String(symbol).trim().toUpperCase();
  const liveSnapshot = depthSnapshots.get(normalized), liveFresh = liveSnapshot && depthFreshness(liveSnapshot, Date.now(), Number(settings().maxDataAgeMs) || 15000);
  if (!options.force && liveFresh?.status === 'fresh' && liveFresh.bids?.length && liveFresh.asks?.length) return depthFreshness(normalizeDepthSnapshot({ bids: liveFresh.bids.slice(0, Number(limit) || 20), asks: liveFresh.asks.slice(0, Number(limit) || 20), lastUpdateId: liveFresh.lastUpdateId }, normalized, limit, liveFresh.source, liveFresh.fetchedAt), Date.now(), Number(settings().maxDataAgeMs) || 15000);
  if (!/^[A-Z0-9]{5,15}$/.test(normalized)) throw new Error('Símbolo inválido.');
  let lastError = null;
  for (const base of MARKET_ENDPOINTS) {
    try {
      const response = await fetch(`${base}/depth?symbol=${encodeURIComponent(normalized)}&limit=${Math.min(100, Math.max(5, Number(limit) || 20))}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Profundidad no disponible (${response.status}).`);
      const payload = await response.json();
      const snapshot = normalizeDepthSnapshot(payload, normalized, limit, base, Date.now());
      depthSnapshots.set(normalized, snapshot);
      return snapshot;
      if (!bids.length || !asks.length || bids[0][0] > asks[0][0]) throw new Error('Order book inválido.');
      const bidLiquidity = bids.reduce((sum, level) => sum + level[0] * level[1], 0), askLiquidity = asks.reduce((sum, level) => sum + level[0] * level[1], 0), mid = (bids[0][0] + asks[0][0]) / 2;
      return { symbol: normalized, limit: Number(limit) || 20, bids, asks, bestBid: bids[0][0], bestAsk: asks[0][0], spreadBps: mid > 0 ? (asks[0][0] - bids[0][0]) / mid * 10000 : null, bidLiquidity, askLiquidity, imbalance: bidLiquidity + askLiquidity ? (bidLiquidity - askLiquidity) / (bidLiquidity + askLiquidity) : 0, lastUpdateId: payload.lastUpdateId || null, fetchedAt: Date.now(), source: base };
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || 'No se pudo obtener el order book.');
}

async function fetchInstrument(symbol) {
  const normalized = String(symbol).trim().toUpperCase();
  if (!/^[A-Z0-9]{5,15}$/.test(normalized)) throw new Error('Símbolo inválido.');
  const cached = instrumentCache.get(normalized);
  if (cached && Date.now() - cached.fetchedAt < 3600000) return cached;
  let lastError = null;
  for (const base of MARKET_ENDPOINTS) {
    try {
      const response = await fetch(`${base}/exchangeInfo?symbol=${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Reglas del instrumento no disponibles (${response.status}).`);
      const payload = await response.json(), info = payload.symbols?.[0];
      if (!info) throw new Error(`El símbolo ${normalized} no existe en el mercado.`);
      const filters = Object.fromEntries((info.filters || []).map(filter => [filter.filterType, filter]));
      const instrument = { symbol: normalized, status: info.status, baseAsset: info.baseAsset, quoteAsset: info.quoteAsset, tickSize: Number(filters.PRICE_FILTER?.tickSize) || null, stepSize: Number(filters.LOT_SIZE?.stepSize) || null, minQty: Number(filters.LOT_SIZE?.minQty) || 0, maxQty: Number(filters.LOT_SIZE?.maxQty) || null, minNotional: Number(filters.NOTIONAL?.minNotional || filters.MIN_NOTIONAL?.minNotional) || 0, fetchedAt: Date.now() };
      instrument.pricePrecision = Number(info.quotePrecision) || null; instrument.quantityPrecision = Number(info.baseAssetPrecision) || null;
      if (instrument.status !== 'TRADING') throw new Error(`${normalized} no está habilitado para operar (${instrument.status}).`);
      instrumentCache.set(normalized, instrument); return instrument;
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || `No se pudieron obtener las reglas de ${normalized}.`);
}

function freshDepthNotional(symbol, side) {
  const snapshot = depthSnapshots.get(String(symbol).trim().toUpperCase()), fresh = snapshot && depthFreshness(snapshot, Date.now(), Number(settings().maxDataAgeMs) || 15000);
  return fresh?.status === 'fresh' ? availableNotional(fresh, side) : null;
}

function consumeFreshDepth(symbol, side, notional) {
  const normalized = String(symbol).trim().toUpperCase(), snapshot = depthSnapshots.get(normalized), fresh = snapshot && depthFreshness(snapshot, Date.now(), Number(settings().maxDataAgeMs) || 15000);
  if (fresh?.status === 'fresh') depthSnapshots.set(normalized, consumeNotional(fresh, side, notional));
}

function decodeXml(value) { return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
function parseRss(xml, source) { return [...String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(match => { const item = match[0], get = tag => decodeXml(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]); return { title: get('title'), description: get('description'), link: get('link'), publishedAt: get('pubDate') || get('published'), source }; }).filter(item => item.title && item.link); }
async function fetchNews(symbol) {
  const all = [], feeds = sanitizeNewsFeeds(settings().newsFeeds || DEFAULT_NEWS_FEEDS), failedFeeds = [];
  for (const feed of feeds) {
    try { const response = await fetch(feed, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }); if (!response.ok) { failedFeeds.push({ feed, error: `HTTP ${response.status}` }); continue; } all.push(...parseRss(await response.text(), new URL(feed).hostname)); } catch (error) { failedFeeds.push({ feed, error: error.message }); /* news is optional context */ }
  }
  const unique = [...new Map(all.map(item => [item.link, item])).values()].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return { ...newsAgent(unique, symbol), feeds: feeds.map(feed => new URL(feed).hostname), quality: newsFetchQuality(feeds, failedFeeds), fetchedAt: Date.now() };
}

function stepAligned(value, step) { return !step || Math.abs(value / step - Math.round(value / step)) < 0.00000001; }
function validateInstrumentOrder(order, instrument) {
  if (!instrument) return;
  if (instrument.tickSize && order.stopPrice && !stepAligned(Number(order.stopPrice), instrument.tickSize)) throw new Error(`Precio stop inválido; usa múltiplos de ${instrument.tickSize}.`);
  if (instrument.stepSize && !stepAligned(Number(order.quantity), instrument.stepSize)) throw new Error(`Cantidad inválida para ${instrument.symbol}; usa múltiplos de ${instrument.stepSize}.`);
  if (instrument.minQty && Number(order.quantity) < instrument.minQty) throw new Error(`Cantidad mínima para ${instrument.symbol}: ${instrument.minQty}.`);
  if (instrument.maxQty && Number(order.quantity) > instrument.maxQty) throw new Error(`Cantidad máxima para ${instrument.symbol}: ${instrument.maxQty}.`);
  if (instrument.tickSize && order.limitPrice && !stepAligned(Number(order.limitPrice), instrument.tickSize)) throw new Error(`Precio límite inválido; usa múltiplos de ${instrument.tickSize}.`);
  if (instrument.minNotional && Number(order.quantity) * Number(order.limitPrice || order.price) < instrument.minNotional) throw new Error(`La orden no alcanza el mínimo nocional de ${instrument.minNotional}.`);
}

function quotePrice(side, quote, fallback) {
  const value = side === 'BUY' ? Number(quote?.ask) : Number(quote?.bid);
  return value > 0 ? value : fallback;
}

function optionalPrice(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }

function sma(values, period) { return values.length < period ? null : values.slice(-period).reduce((sum, value) => sum + value, 0) / period; }
function ema(values, period) { if (values.length < period) return null; let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period; const multiplier = 2 / (period + 1); for (const value of values.slice(period)) result = (value - result) * multiplier + result; return result; }
function rsi(values, period = 14) { if (values.length <= period) return null; let gain = 0, loss = 0; for (let index = 1; index <= period; index += 1) { const change = values[index] - values[index - 1]; gain += Math.max(0, change); loss += Math.max(0, -change); } let averageGain = gain / period, averageLoss = loss / period; for (let index = period + 1; index < values.length; index += 1) { const change = values[index] - values[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period; } return averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss)); }
function atr(candles, period = 14) { if (candles.length <= period) return null; const ranges = candles.slice(1).map((candle, index) => Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index].close), Math.abs(candle.low - candles[index].close))); return sma(ranges, period); }
function calculateFeatures(candles) { const closes = candles.map(candle => candle.close), volumes = candles.map(candle => candle.volume), last = closes.at(-1), previous = closes.at(-2), fast = ema(closes, 12), slow = ema(closes, 26), averageVolume = sma(volumes, 20); return { lastClose: last, change1: previous ? (last - previous) / previous * 100 : null, change20: closes.length > 20 ? (last - closes.at(-21)) / closes.at(-21) * 100 : null, sma20: sma(closes, 20), sma50: sma(closes, 50), ema12: fast, ema26: slow, rsi14: rsi(closes), atr14: atr(candles), averageVolume, volumeRatio: averageVolume ? volumes.at(-1) / averageVolume : null, trend: fast && slow ? (fast > slow ? 'bullish' : 'bearish') : 'unknown' }; }
function intervalMilliseconds(interval) { const match = String(interval).match(/^(\d+)([smhdwM])$/); if (!match) return null; const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 }; return Number(match[1]) * units[match[2]]; }
function validateCandleSeries(candles, interval) {
  const issues = [], warnings = [], intervalMs = intervalMilliseconds(interval), now = Date.now();
  candles.forEach((candle, index) => {
    if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) issues.push(`Vela ${index} contiene valores no numéricos.`);
    if (candle.time > now + 120000) issues.push(`Vela ${index} tiene timestamp futuro.`);
    if (!(candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) && candle.low > 0)) issues.push(`Vela ${index} tiene OHLC inconsistente.`);
    if (index > 0) {
      const delta = candle.time - candles[index - 1].time;
      if (delta <= 0) issues.push('El histórico contiene timestamps duplicados o fuera de orden.');
      else if (intervalMs && delta > intervalMs * 2.5) warnings.push(`Hueco de ${(delta / intervalMs).toFixed(1)} intervalos entre velas ${index - 1} y ${index}.`);
    }
  });
  return { valid: issues.length === 0, status: issues.length ? 'invalid' : warnings.length ? 'degraded' : 'ok', candleCount: candles.length, issues: [...new Set(issues)].slice(0, 8), warnings: [...new Set(warnings)].slice(0, 8) };
}

function limitIsMarketable(side, limitPrice, quote, fallback) {
  const market = quotePrice(side, quote, fallback);
  return side === 'BUY' ? market <= limitPrice : market >= limitPrice;
}

function enqueuePaperOrder(current, { symbol, side, quantity, type, limitPrice = null, stopPrice = null, requestedPrice, instrument = null, source, stopLoss, takeProfit, clientOrderId = null, eligibleAt = Date.now() }) {
  const createdAt = new Date().toISOString(), ttl = type === 'limit' ? Math.max(1, Number(settings().limitOrderTtlMin) || 60) * 60000 : 0;
  const config = settings(), reservedCash = reservationForOrder({ side, quantity, requestedPrice, feeRate: config.feeRate, slippageBps: config.slippageBps });
  if (reservedCash > Math.max(0, Number(current.cash || 0) - Number(current.reservedCash || 0)) + 0.00000001) throw new Error('Saldo paper insuficiente para reservar la orden pendiente.');
  const order = { id: randomUUID(), sessionId: current.sessionId, clientOrderId, symbol: String(symbol).trim().toUpperCase(), side: String(side).toUpperCase(), type, quantity: Number(quantity), filledQuantity: 0, remainingQuantity: Number(quantity), requestedPrice: Number(requestedPrice), limitPrice: optionalPrice(limitPrice), stopPrice: optionalPrice(stopPrice), stepSize: instrument?.stepSize || null, tickSize: instrument?.tickSize || null, stopLoss: optionalPrice(stopLoss), takeProfit: optionalPrice(takeProfit), status: 'created', source: source || 'manual', createdAt, eligibleAt: new Date(eligibleAt).toISOString(), expiresAt: ttl ? new Date(Date.now() + ttl).toISOString() : null, triggered: false, fillAttempts: 0, events: [{ status: 'created', at: createdAt }] };
  order.liquidityMode = freshDepthNotional(symbol, side) > 0 ? 'order-book' : Number(settings().liquidityNotionalPerTick) > 0 ? 'configured' : 'unbounded';
  order.reservedCash = reservedCash;
  current.reservedCash = Number(current.reservedCash || 0) + reservedCash;
  order.status = 'accepted'; order.events.push({ status: 'accepted', at: new Date().toISOString() }); current.orders.unshift(order); writeJson(STATE_FILE, current); return current;
}

function submitPaperOrder({ symbol, side, quantity, price, orderType = 'market', limitPrice, stopPrice, quote = {}, instrument = null, source, stopLoss, takeProfit, clientOrderId = null }) {
  symbol = String(symbol).trim().toUpperCase(); side = String(side).toUpperCase(); quantity = Number(quantity);
  if (!/^[A-Z0-9]{5,15}$/.test(symbol) || !['BUY', 'SELL'].includes(side) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error('Orden inválida.');
  if (!freshQuote(quote, settings().maxDataAgeMs)) throw new Error('La orden requiere un bid/ask fresco.');
  for (const level of [stopLoss, takeProfit]) if (level != null && (!Number.isFinite(Number(level)) || Number(level) <= 0)) throw new Error('Protección inválida.');
  const type = String(orderType).toLowerCase();
  if (!['market', 'limit', 'stop-market', 'stop-limit'].includes(type)) throw new Error('Tipo de orden no soportado.');
  const requestedLimit = Number(limitPrice);
  const requestedStop = Number(stopPrice);
  if (['limit', 'stop-limit'].includes(type) && (!Number.isFinite(requestedLimit) || requestedLimit <= 0)) throw new Error('La orden limit necesita un precio válido.');
  if (type.startsWith('stop') && (!Number.isFinite(requestedStop) || requestedStop <= 0)) throw new Error('La orden stop necesita un precio disparador válido.');
  const fallback = Number(price);
  validateInstrumentOrder({ quantity, price: type === 'stop-market' ? requestedStop : fallback, limitPrice: ['limit', 'stop-limit'].includes(type) ? requestedLimit : null, stopPrice: type.startsWith('stop') ? requestedStop : null }, instrument);
  const current = state();
  if (instrument?.quoteAsset && current.currency && instrument.quoteAsset !== current.currency) throw new Error(`Moneda incompatible: la cuenta usa ${current.currency} y ${String(symbol).trim().toUpperCase()} cotiza en ${instrument.quoteAsset}.`);
  if (clientOrderId) { const existing = current.orders.find(order => order.clientOrderId === clientOrderId); if (existing) return current; }
  const config = settings();
  if (!verifyPaperIntegrity(current).valid) throw new Error('La cuenta no supera la verificación contable.');
  if (current.paused && side === 'BUY') throw new Error(`Paper trading pausado${current.pauseReason ? `: ${current.pauseReason}` : '.'}`);
  const reference = ['limit', 'stop-limit'].includes(type) ? requestedLimit : type === 'stop-market' ? requestedStop : quotePrice(side, quote, Number(price));
  if (side === 'SELL') {
    const held = current.positions.find(p => p.symbol === symbol)?.quantity || 0;
    const reserved = current.orders.filter(o => o.symbol === symbol && o.side === 'SELL' && ['accepted', 'partial'].includes(o.status)).reduce((n, o) => n + Number(o.remainingQuantity), 0);
    if (quantity > held - reserved + 1e-10) throw new Error('Cantidad no disponible: existen ventas pendientes o saldo insuficiente.');
  }
  const effectiveStop = optionalPrice(roundToStep(stopLoss, instrument?.tickSize));
  if (side === 'BUY' && ((effectiveStop && effectiveStop >= reference) || (takeProfit && Number(takeProfit) <= reference))) throw new Error('Los niveles de protección no son coherentes con la entrada.');
  riskGuard({ current, config, symbol, side, quantity, fillPrice: reference * (1 + (type.includes('limit') ? 0 : config.slippageBps / 10000)), quote, source, protectiveStop: effectiveStop });
  const latency = Math.max(0, Number(settings().executionLatencyMs) || 0);
  if (latency > 0) return enqueuePaperOrder(current, { symbol, side, quantity, type, stopPrice: type.startsWith('stop') ? requestedStop : null, limitPrice: ['limit', 'stop-limit'].includes(type) ? requestedLimit : null, requestedPrice: ['limit', 'stop-limit'].includes(type) ? requestedLimit : fallback, instrument, source, stopLoss, takeProfit, clientOrderId, eligibleAt: Date.now() + latency });
  if (type.startsWith('stop')) return enqueuePaperOrder(current, { symbol, side, quantity, type, stopPrice: requestedStop, limitPrice: type === 'stop-limit' ? requestedLimit : null, requestedPrice: type === 'stop-limit' ? requestedLimit : requestedStop, instrument, source, stopLoss, takeProfit, clientOrderId });
  if (type === 'limit' && !limitIsMarketable(String(side).toUpperCase(), requestedLimit, quote, fallback)) {
    return enqueuePaperOrder(current, { symbol, side, quantity, type, limitPrice: requestedLimit, requestedPrice: requestedLimit, instrument, source, stopLoss, takeProfit, clientOrderId });
  }
  const bookNotional = freshDepthNotional(symbol, side), configuredNotional = Number(settings().liquidityNotionalPerTick) || 0;
  if (type === 'market' && (bookNotional > 0 || configuredNotional > 0 || config.partialFillPct < 100)) { enqueuePaperOrder(current, { symbol, side, quantity, type, requestedPrice: quotePrice(side, quote, fallback), instrument, source, stopLoss, takeProfit, clientOrderId }); processPendingOrders(symbol, { ...quote, last: fallback }); return state(); }
  const executionPrice = type === 'limit' ? (String(side).toUpperCase() === 'BUY' ? Math.min(requestedLimit, quotePrice('BUY', quote, fallback)) : Math.max(requestedLimit, quotePrice('SELL', quote, fallback))) : quotePrice(String(side).toUpperCase(), quote, fallback);
  return executePaperTrade({ symbol, side, quantity, price: executionPrice, quote, orderType: type, limitPrice: type === 'limit' ? requestedLimit : null, source, stopLoss, takeProfit, instrument, clientOrderId });
}

function processPendingOrders(symbol, quote = {}) {
  const config = settings(), now = Date.now(), current = state();
  if (!freshQuote(quote, config.maxDataAgeMs)) return;
  const pending = current.orders.filter(order => order.symbol === symbol && ['market', 'limit', 'stop-market', 'stop-limit'].includes(order.type) && ['accepted', 'partial'].includes(order.status));
  for (const order of pending) {
    if (state().paused && order.side === 'BUY') continue;
    if (order.expiresAt && now >= new Date(order.expiresAt).getTime()) { const expired = state(), stored = expired.orders.find(item => item.id === order.id); if (stored && ['accepted', 'partial'].includes(stored.status)) { expired.reservedCash = Math.max(0, Number(expired.reservedCash || 0) - releaseAll(stored)); stored.reservedCash = 0; stored.status = 'expired'; stored.expiredAt = new Date().toISOString(); stored.events ||= []; stored.events.push({ status: 'expired', at: stored.expiredAt }); writeJson(STATE_FILE, expired); } continue; }
    if (order.eligibleAt && now < new Date(order.eligibleAt).getTime()) continue;
    if (order.type.startsWith('stop') && !order.triggered && !stopIsTriggered(order.side, Number(order.stopPrice), quote, Number(quote.last))) continue;
    if (order.type.startsWith('stop') && !order.triggered) { const triggered = state(), stored = triggered.orders.find(item => item.id === order.id); if (stored) { stored.triggered = true; stored.triggeredAt = new Date().toISOString(); stored.events ||= []; stored.events.push({ status: 'triggered', at: stored.triggeredAt }); writeJson(STATE_FILE, triggered); } }
    if (['limit', 'stop-limit'].includes(order.type) && !limitIsMarketable(order.side, Number(order.limitPrice), quote, Number(quote.last))) continue;
    const remaining = Math.max(0, Number(order.quantity) - Number(order.filledQuantity || 0));
    const requestedFill = remaining * Math.min(100, Math.max(1, Number(config.partialFillPct) || 100)) / 100;
    const referencePrice = ['limit', 'stop-limit'].includes(order.type) ? Number(order.limitPrice) : quotePrice(order.side, quote, Number(order.requestedPrice));
    const configuredNotional = Number(config.liquidityNotionalPerTick), bookNotional = freshDepthNotional(order.symbol, order.side), availableNotionalForFill = [configuredNotional, bookNotional].filter(value => value > 0).reduce((minimum, value) => Math.min(minimum, value), Infinity), liquidityQuantity = availableNotionalForFill < Infinity && referencePrice > 0 ? availableNotionalForFill / referencePrice : Infinity;
    if (order.liquidityMode === 'order-book' && !(bookNotional > 0)) continue;
    const fillCandidate = Math.min(requestedFill, liquidityQuantity);
    const fillQuantity = Math.min(remaining, floorToStep(Math.min(remaining <= (order.stepSize || 1e-8) * 2 ? remaining : requestedFill, liquidityQuantity), order.stepSize));
    if (!(fillQuantity > 0)) continue;
    const executableType = order.type === 'stop-market' ? 'market' : order.type === 'stop-limit' ? 'limit' : order.type;
    const stopMarketPrice = order.type === 'stop-market' ? protectiveExecutionPrice(order.side, order.stopPrice, quote, order.requestedPrice) : null;
    const executionQuote = stopMarketPrice ? { ...quote, last: stopMarketPrice, ...(order.side === 'BUY' ? { ask: stopMarketPrice } : { bid: stopMarketPrice }) } : quote;
    const price = stopMarketPrice || (executableType === 'market' ? quotePrice(order.side, executionQuote, Number(order.requestedPrice)) : order.side === 'BUY' ? Math.min(Number(order.limitPrice), quotePrice('BUY', executionQuote, Number(order.limitPrice))) : Math.max(Number(order.limitPrice), quotePrice('SELL', executionQuote, Number(order.limitPrice))));
    try { executePaperTrade({ symbol: order.symbol, side: order.side, quantity: fillQuantity, price, quote: executionQuote, orderType: executableType, orderTypeLabel: order.type, limitPrice: order.limitPrice, source: order.source, stopLoss: order.stopLoss, takeProfit: order.takeProfit, protectionGap: Boolean(stopMarketPrice && quote.open && ((order.side === 'BUY' && quote.open >= Number(order.stopPrice)) || (order.side === 'SELL' && quote.open <= Number(order.stopPrice)))), orderId: order.id, clientOrderId: order.clientOrderId }); } catch (error) { const failed = state(), stored = failed.orders.find(item => item.id === order.id); if (stored) { stored.fillAttempts = Number(stored.fillAttempts || 0) + 1; if (stored.fillAttempts >= 5) { stored.status = 'failed'; stored.failedAt = new Date().toISOString(); stored.failureReason = error.message; stored.events ||= []; stored.events.push({ status: 'failed', reason: error.message, at: stored.failedAt }); addStateAlert(failed, 'order-failed', 'critical', `Orden ${stored.symbol} marcada como fallida tras ${stored.fillAttempts} intentos: ${error.message}`, { orderId: stored.id }); } else addStateAlert(failed, 'order-fill-failed', 'warning', error.message, { orderId: order.id, attempt: stored.fillAttempts }); writeJson(STATE_FILE, failed); } /* retry while the order remains pending */ }
    const latest = state(), failedOrder = latest.orders.find(item => item.id === order.id);
    if (failedOrder?.status === 'failed' && Number(failedOrder.reservedCash || 0) > 0) { latest.reservedCash = Math.max(0, Number(latest.reservedCash || 0) - releaseAll(failedOrder)); failedOrder.reservedCash = 0; writeJson(STATE_FILE, latest); }
  }
}

function higherTimeframe(interval) { return ({ '1s': '1m', '1m': '15m', '3m': '15m', '5m': '1h', '15m': '1h', '30m': '4h', '1h': '4h', '2h': '1d', '4h': '1d', '6h': '1d', '8h': '1d', '12h': '1d', '1d': '1w', '3d': '1w', '1w': '1M' }[interval] || '1d');
}

async function analyzeMarket({ symbol, interval, automationRunId = null }) {
  const analysisSession = state().sessionId;
  const key = apiKey();
  if (automationRunId) reportAutomationProgress(automationRunId, symbol, 'market-data', 'running', 'Consultando velas cerradas, cotización, profundidad y noticias.', 'market-data');
  if (!key) throw new Error('Configura primero tu API key del LLM en Configuración.');
  const superiorInterval = higherTimeframe(interval), [market, superiorMarket, news, orderBook] = await Promise.all([fetchCandles(symbol, interval), fetchCandles(symbol, superiorInterval).catch(() => null), fetchNews(symbol), fetchDepth(symbol).catch(() => null)]);
  const analysisCandles = market.closedCandles || closedCandles(market.candles);
  if (!analysisCandles.length) throw new Error('No hay velas cerradas suficientes para analizar el mercado.');
  market.candles = analysisCandles;
  market.news = news.items;
  market.orderBook = orderBook || { status: 'unavailable' };
  market.higherTimeframe = superiorMarket ? { interval: superiorMarket.interval, dataQuality: superiorMarket.dataQuality, features: superiorMarket.features, price: (superiorMarket.closedCandles || closedCandles(superiorMarket.candles)).at(-1)?.close } : { interval: superiorInterval, status: 'unavailable' };
  if (automationRunId) { reportAutomationProgress(automationRunId, symbol, 'market-data', 'completed', `Datos listos: ${market.closedCandles?.length || market.candles.length} velas cerradas.`, 'market-data'); reportAutomationProgress(automationRunId, symbol, 'news-agent', news.quality?.status === 'offline' ? 'degraded' : 'completed', `${news.relevantCount || 0} titulares relevantes; ${news.recentCount || 0} recientes.`, 'news-agent'); reportAutomationProgress(automationRunId, symbol, 'liquidity-agent', market.orderBook.status === 'stale' ? 'degraded' : market.orderBook.status === 'unavailable' ? 'unavailable' : 'completed', market.orderBook.status === 'unavailable' ? 'Profundidad no disponible.' : `Order book ${market.orderBook.status || 'fresh'}.`, 'liquidity-agent'); reportAutomationProgress(automationRunId, symbol, 'llm-analyst', 'running', 'Enviando snapshot verificable al modelo.', 'llm-analyst'); }
  const config = settings(), currentPrice = market.candles.at(-1).close;
  reserveLlmCall(config);
  let usageRecorded = false, payload = null;
  try {
    const endpoint = config.endpoint.replace(/\/$/, '');
    const usesLatestOpenAiModel = config.endpoint.includes('api.openai.com') && (/^gpt-5\.6-/.test(config.model) || config.model === 'gpt-6-astra');
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.model,
        max_completion_tokens: 1600,
        ...(usesLatestOpenAiModel ? { reasoning_effort: 'low' } : { temperature: 0.1 }),
        messages: [
          { role: 'system', content: 'Eres un analista cuantitativo prudente. Tu salida debe ser JSON estricto.' },
          { role: 'user', content: buildLlmPrompt(market) }
        ],
        ...(config.endpoint.includes('api.openai.com') ? { response_format: { type: 'json_schema', json_schema: TRADE_INTENT_SCHEMA } } : {})
      }),
      signal: AbortSignal.timeout(60000)
    });
    try { payload = await response.json(); } catch { throw new Error('El proveedor LLM devolvió una respuesta ilegible.'); }
    if (!response.ok) throw new Error(payload?.error?.message || `El proveedor LLM respondió ${response.status}.`);
    if (state().sessionId !== analysisSession) { usageRecorded = true; throw new Error('La sesión cambió durante el análisis.'); }
    if (automationRunId) reportAutomationProgress(automationRunId, symbol, 'llm-analyst', 'completed', 'Respuesta recibida; validando intención estructurada.', 'llm-analyst');
    let analysis;
    try { analysis = parseLlmIntentContract(payload?.choices?.[0]?.message || {}); } catch (parseError) {
      const error = parseError;
      recordLlmOutcome({ usagePayload: payload?.usage, error, invalid: true }); usageRecorded = true; throw error;
    }
    const technical = technicalAgent(market.features), validation = validateTradeIntent(analysis, currentPrice);
    if (automationRunId) reportAutomationProgress(automationRunId, symbol, 'intent-validator', validation.valid ? 'completed' : 'rejected', validation.valid ? 'Schema y niveles coherentes.' : validation.errors.join('; '), 'intent-validator');
    if (!validation.valid) {
      const error = new Error(`La intención del LLM fue rechazada: ${validation.errors.join('; ')}`); recordLlmOutcome({ usagePayload: payload.usage, error, invalid: true }); usageRecorded = true; throw error;
    }
    const usage = recordLlmOutcome({ usagePayload: payload.usage }); usageRecorded = true;
    const candidate = { ...validation.normalized, thesis: String(analysis.thesis || ''), symbol: market.symbol, interval: market.interval, price: currentPrice };
    const technicalHigher = superiorMarket ? technicalAgent(superiorMarket.features) : { name: 'technical-agent-higher-timeframe', score: 0, bias: 'neutral' }, liquidity = liquidityAgent(market.orderBook);
    const critical = criticalAgent(candidate, technical, news, market.features, currentPrice, technicalHigher, liquidity);
    const portfolio = portfolioAgent(state(), candidate, currentPrice, config);
    const consensus = consensusAgent(candidate, technical, news, critical, portfolio, technicalHigher, liquidity);
    if (automationRunId) { reportAutomationProgress(automationRunId, symbol, 'technical-agent', 'completed', `Sesgo ${technical.bias}, score ${technical.score}.`, 'technical-agent'); reportAutomationProgress(automationRunId, symbol, 'critical-agent', critical.veto ? 'rejected' : critical.status, critical.veto ? critical.issues.join('; ') : 'Tesis y beneficio/riesgo revisados.', 'critical-agent'); reportAutomationProgress(automationRunId, symbol, 'portfolio-agent', portfolio.veto ? 'rejected' : portfolio.status, portfolio.veto ? portfolio.issues.join('; ') : `Exposición ${portfolio.exposurePct.toFixed(1)}%.`, 'portfolio-agent'); reportAutomationProgress(automationRunId, symbol, 'consensus-agent', consensus.status, consensus.rationale, 'consensus-agent'); }
    const result = { ...candidate, decision: consensus.decision, confidence: consensus.confidence, intentVersion: '1.0', dataQuality: market.dataQuality, features: market.features, higherTimeframe: market.higherTimeframe, technicalHigherAgent: technicalHigher, orderBook: market.orderBook, liquidityAgent: liquidity, marketSnapshot: market.candles.slice(-60), news: news.items, newsAgent: news, technicalAgent: technical, criticalAgent: critical, portfolioAgent: portfolio, consensus, agentTrace: agentTrace(technical, validation, news, critical, portfolio, consensus, technicalHigher, liquidity), model: config.model, promptVersion: PROMPT_VERSION, llmUsage: usage, estimatedCostUsd: Number(usage.callCostUsd || 0), createdAt: new Date().toISOString() };
    const current = state(); current.lastAnalysis = result; current.analyses.unshift({ id: randomUUID(), ...result, candleTimes: market.candles.slice(-60).map(candle => candle.time) }); current.analyses = current.analyses.slice(0, 100); writeJson(STATE_FILE, current);
    return result;
  } catch (error) {
    if (automationRunId) reportAutomationProgress(automationRunId, symbol, 'analysis', 'failed', error.message, 'automation');
    if (!usageRecorded) recordLlmOutcome({ usagePayload: payload?.usage, error });
    throw error;
  }
}

function riskGuard({ current, config, symbol, side, quantity, fillPrice, quote, source, protectiveStop, orderId = null }) {
  if (!freshQuote(quote, config.maxDataAgeMs)) throw new Error('El dato de mercado está obsoleto o no contiene bid/ask válido.');
  // A long-only SELL reduces exposure, including during pause/drawdown/kill.
  // Quantity and cash invariants still apply in the execution engine.
  if (side === 'SELL') return;
  if (current.paused) throw new Error('Nuevas entradas pausadas.');
  resetDailyRisk(current);
  const bid = optionalPrice(quote?.bid), ask = optionalPrice(quote?.ask);
  if (bid && ask && bid > 0) { const spreadBps = (ask - bid) / ((ask + bid) / 2) * 10000; if (spreadBps > (Number(config.maxSpreadBps) || 50)) throw new Error(`Spread demasiado alto (${spreadBps.toFixed(1)} bps).`); }
  const today = new Date().toISOString().slice(0, 10), fillsToday = current.trades.filter(trade => String(trade.createdAt || '').slice(0, 10) === today).length;
  if (fillsToday >= (Number(config.maxTradesPerDay) || 20)) throw new Error('Límite diario de operaciones alcanzado.');
  if (current.dailyLoss <= -(current.initialCash * Math.max(0, Number(config.maxDailyLossPct) || 3) / 100)) throw new Error('La pérdida diaria máxima está activa.');
  const accountValue = equity(current), notional = quantity * fillPrice, currentExposure = current.positions.reduce((sum, position) => sum + position.quantity * (position.bid || position.mark || position.entry), 0), assetExposure = current.positions.filter(position => position.symbol === symbol).reduce((sum, position) => sum + position.quantity * (position.bid || position.mark || position.entry), 0), existingStopRisk = current.positions.reduce((sum, position) => sum + (Number(position.stopLoss) > 0 && Number(position.entry) > Number(position.stopLoss) ? (Number(position.entry) - Number(position.stopLoss)) * Number(position.quantity) : 0), 0), newStopRisk = side === 'BUY' && protectiveStop ? Math.max(0, (fillPrice - protectiveStop) * quantity) : 0;
  if (side === 'BUY') {
    const adjustedExistingRisk = current.positions.reduce((sum, position) => {
      const stop = position.symbol === symbol && protectiveStop ? protectiveStop : Number(position.stopLoss);
      return sum + (stop > 0 ? Math.max(0, Number(position.entry) - stop) * position.quantity : 0);
    }, 0);
    const pending = current.orders.filter(o => o.id !== orderId && o.side === 'BUY' && ['accepted', 'partial'].includes(o.status));
    const pendingTotal = pending.reduce((n, o) => n + o.remainingQuantity * o.requestedPrice, 0);
    const pendingAsset = pending.filter(o => o.symbol === symbol).reduce((n, o) => n + o.remainingQuantity * o.requestedPrice, 0);
    const pendingRisk = pending.reduce((n, o) => n + (o.stopLoss ? Math.max(0, o.requestedPrice - o.stopLoss) : o.requestedPrice) * o.remainingQuantity, 0);
    if (currentExposure + pendingTotal + notional > accountValue * config.maxExposurePct / 100 || assetExposure + pendingAsset + notional > accountValue * config.maxAssetExposurePct / 100) throw new Error('La exposición de posiciones y órdenes pendientes supera el límite.');
    if (protectiveStop && adjustedExistingRisk + pendingRisk + newStopRisk > accountValue * config.maxPortfolioRiskPct / 100) throw new Error('El riesgo agregado incluyendo órdenes pendientes supera el límite.');
    if (notional > accountValue * (Math.max(1, Number(config.maxOrderPct) || 25) / 100)) throw new Error(`La orden supera el límite de ${config.maxOrderPct}% por operación.`);
    if (assetExposure + notional > accountValue * (Math.max(1, Number(config.maxAssetExposurePct) || 35) / 100)) throw new Error(`La exposición de ${symbol} superaría el límite por activo.`);
    if (currentExposure + notional > accountValue * (Math.max(1, Number(config.maxExposurePct) || 75) / 100)) throw new Error('La exposición total superaría el límite de la cuenta.');
    if (source === 'paper-auto' && config.requireStopForAuto && !protectiveStop) throw new Error('Auto-Paper exige un stop loss válido.');
    if (protectiveStop && (fillPrice - protectiveStop) * quantity > accountValue * (Math.max(0.1, Number(config.riskPerTradePct) || 1) / 100)) throw new Error('La pérdida calculada hasta el stop supera el riesgo por operación.');
    if (adjustedExistingRisk + newStopRisk > accountValue * (Math.max(0.1, Number(config.maxPortfolioRiskPct) || 3) / 100)) throw new Error('El riesgo agregado de los stops supera el límite de cartera.');
  }
}

function executePaperTrade({ symbol, side, quantity, price, quote = {}, orderType = 'market', orderTypeLabel = orderType, limitPrice = null, source, stopLoss, takeProfit, instrument = null, exitReason, protectionGap = false, clientOrderId = null, orderId: suppliedOrderId = null }) {
  const normalizedSide = String(side).toUpperCase();
  const normalizedSymbol = String(symbol).trim().toUpperCase();
  const current = state();
  const existingPosition = current.positions.find(item => item.symbol === normalizedSymbol), existingOrder = current.orders.find(item => item.id === suppliedOrderId), orderInstrument = instrument || existingOrder || { tickSize: existingPosition?.tickSize || null, stepSize: existingPosition?.stepSize || null };
  const qty = floorToStep(Number(quantity), orderInstrument.stepSize), entry = Number(price);
  if (!['BUY', 'SELL'].includes(normalizedSide) || !/^[A-Z0-9]{5,15}$/.test(normalizedSymbol) || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entry) || entry <= 0) throw new Error('Orden inválida.');
  const config = settings();
  if (resetDailyRisk(current)) writeJson(STATE_FILE, current);
  const reservationRelease = existingOrder?.side === 'BUY' ? releaseForFill(existingOrder, qty) : 0;
  if (reservationRelease > 0) { current.reservedCash = Math.max(0, Number(current.reservedCash || 0) - reservationRelease); existingOrder.reservedCash = Math.max(0, Number(existingOrder.reservedCash || 0) - reservationRelease); }
  let realizedPnl = null, grossPnl = null;
  const riskExit = source === 'risk-exit';
  if (current.paused && normalizedSide === 'BUY') throw new Error(`Paper trading pausado${current.pauseReason ? `: ${current.pauseReason}` : '.'}`);
  current.initialCash = Number(current.initialCash) || Number(config.initialCash) || 100;
  const marketPrice = quotePrice(normalizedSide, quote, entry);
  const executionBase = orderType === 'limit' ? entry : marketPrice;
  const slippage = orderType === 'limit' ? 0 : Math.max(0, Number(config.slippageBps) || 0) / 10000;
  const fillPrice = roundToStep(executionBase * (normalizedSide === 'BUY' ? 1 + slippage : 1 - slippage), orderInstrument.tickSize);
  if (!Number.isFinite(fillPrice) || fillPrice <= 0 || config.feeRate >= 1) throw new Error('Costes o precio de ejecución inválidos.');
  const protectiveStop = optionalPrice(roundToStep(stopLoss, orderInstrument.tickSize)), protectiveTarget = optionalPrice(roundToStep(takeProfit, orderInstrument.tickSize));
  if (normalizedSide === 'BUY' && protectiveStop && protectiveStop >= fillPrice) throw new Error('El stop loss debe quedar por debajo del precio de compra.');
  if (normalizedSide === 'BUY' && protectiveTarget && protectiveTarget <= fillPrice) throw new Error('El take profit debe quedar por encima del precio de compra.');
  const notional = qty * fillPrice;
  const fee = notional * Math.max(0, Number(config.feeRate) || 0), slippageCost = Math.abs(fillPrice - entry) * qty;
  const position = existingPosition;
  const currentEquity = equity(current);
  riskGuard({ current, config, symbol: normalizedSymbol, side: normalizedSide, quantity: qty, fillPrice, quote, source, protectiveStop, orderId: suppliedOrderId });
  if (normalizedSide === 'BUY' && current.peakEquity && currentEquity < current.peakEquity * (1 - Math.max(0, Number(config.maxDrawdownPct) || 10) / 100)) throw new Error('El límite de drawdown está activo; revisa el sistema antes de seguir operando.');
  const orderId = suppliedOrderId || randomUUID();
  const createdAt = new Date().toISOString();
  const order = existingOrder || current.orders.find(item => item.id === orderId) || { id: orderId, sessionId: current.sessionId, clientOrderId, symbol: normalizedSymbol, side: normalizedSide, type: orderTypeLabel, quantity: qty, filledQuantity: 0, remainingQuantity: qty, requestedPrice: entry, reservedCash: 0, status: 'created', source: source || 'manual', createdAt, events: [{ status: 'created', at: createdAt }] };
  if (!current.orders.includes(order)) current.orders.unshift(order);
  order.type = orderTypeLabel; order.executionType = orderType; order.limitPrice = optionalPrice(limitPrice); order.stopLoss = protectiveStop; order.takeProfit = protectiveTarget;
  if (order.status === 'created') { order.status = 'accepted'; order.events.push({ status: 'accepted', at: new Date().toISOString() }); }
  if (normalizedSide === 'BUY') {
    if (Number(current.cash || 0) - Number(current.reservedCash || 0) < notional + fee) throw new Error('Saldo paper insuficiente incluyendo comisión y reservas pendientes.');
    if (current.cash < notional + fee) throw new Error('Saldo paper insuficiente incluyendo comisión.');
    current.cash -= notional + fee; current.feesPaid = (current.feesPaid || 0) + fee; current.slippagePaid = (current.slippagePaid || 0) + slippageCost;
    postLedger(current, { type: 'fill', orderId, symbol: normalizedSymbol, side: normalizedSide }, [{ account: `asset:${normalizedSymbol}`, side: 'debit', amount: notional }, { account: 'fees', side: 'debit', amount: fee }, { account: 'cash', side: 'credit', amount: notional + fee }]);
    if (position) { const total = position.quantity + qty, previousEntryPrice = Number(position.entryPrice || position.entry); position.entryPrice = ((previousEntryPrice * position.quantity) + fillPrice * qty) / total; position.entry = ((position.entry * position.quantity) + notional + fee) / total; position.quantity = total; position.mark = fillPrice; position.bid = optionalPrice(quote.bid) || fillPrice; position.ask = optionalPrice(quote.ask) || fillPrice; position.tickSize ||= orderInstrument.tickSize || null; position.stepSize ||= orderInstrument.stepSize || null; if (protectiveStop) position.stopLoss = protectiveStop; if (protectiveTarget) position.takeProfit = protectiveTarget; }
    else current.positions.push({ symbol: normalizedSymbol, quantity: qty, entryPrice: fillPrice, entry: (notional + fee) / qty, mark: fillPrice, bid: optionalPrice(quote.bid) || fillPrice, ask: optionalPrice(quote.ask) || fillPrice, tickSize: orderInstrument.tickSize || null, stepSize: orderInstrument.stepSize || null, stopLoss: protectiveStop, takeProfit: protectiveTarget });
  } else {
    if (!position || position.quantity < qty) throw new Error('No hay una posición paper suficiente para vender.');
    const entryPrice = Number(position.entryPrice || position.entry), entryFeeAllocation = Math.max(0, Number(position.entry || entryPrice) - entryPrice) * qty;
    grossPnl = (fillPrice - entryPrice) * qty; realizedPnl = grossPnl - fee - entryFeeAllocation;
    current.cash += notional - fee; current.realizedPnl = (current.realizedPnl || 0) + realizedPnl; current.grossRealizedPnl = (current.grossRealizedPnl || 0) + grossPnl; current.netRealizedPnl = (current.netRealizedPnl || 0) + realizedPnl; current.feesPaid = (current.feesPaid || 0) + fee; current.slippagePaid = (current.slippagePaid || 0) + slippageCost;
    postLedger(current, { type: 'fill', orderId, symbol: normalizedSymbol, side: normalizedSide }, [{ account: 'cash', side: 'debit', amount: notional - fee }, { account: 'fees', side: 'debit', amount: fee }, { account: `asset:${normalizedSymbol}`, side: 'credit', amount: entryPrice * qty }, { account: 'realized-pnl', side: grossPnl >= 0 ? 'credit' : 'debit', amount: Math.abs(grossPnl) }]);
    position.quantity = Math.max(0, Number((position.quantity - qty).toFixed(12)));
    if (position.quantity <= 1e-12) current.positions = current.positions.filter(item => item !== position);
  }
  order.filledQuantity = Number(order.filledQuantity || 0) + qty; order.remainingQuantity = Math.max(0, Number(order.quantity || qty) - order.filledQuantity); order.fillPrice = fillPrice; order.filledAt = new Date().toISOString(); order.fee = Number(order.fee || 0) + fee; order.exitReason = exitReason || null; order.protectionGap = Boolean(order.protectionGap || protectionGap); order.status = order.remainingQuantity > 0.0000000001 ? 'partial' : 'filled'; order.events.push({ status: order.status, quantity: qty, at: order.filledAt, ...(protectionGap ? { protectionGap: true } : {}) });
  current.trades.unshift({ id: orderId, symbol: normalizedSymbol, side: normalizedSide, quantity: qty, requestedPrice: entry, price: fillPrice, notional, fee, slippage, slippageCost, grossPnl, netPnl: realizedPnl, realizedPnl, exitReason: exitReason || null, protectionGap: Boolean(protectionGap), source: source || 'manual', mode: 'paper', createdAt: new Date().toISOString() });
  const today = new Date().toISOString().slice(0, 10);
  current.dailyLoss = current.dailyLossDate === today ? Number(current.dailyLoss || 0) + Math.min(0, Number(realizedPnl || 0)) : Math.min(0, Number(realizedPnl || 0));
  current.dailyLossDate = today;
  if (current.dailyLoss <= -(current.initialCash * Math.max(0, Number(config.maxDailyLossPct) || 3) / 100)) { current.paused = true; current.pauseReason = 'Pérdida diaria máxima alcanzada'; }
  recordEquity(current);
  writeJson(STATE_FILE, current);
  consumeFreshDepth(normalizedSymbol, normalizedSide, notional);
  return current;
}

function resetPaper(startingCash) {
  const amount = Number(startingCash);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El capital inicial debe ser mayor que cero.');
  stopPaperAutomation('Nueva sesión paper');
  const previous = state();
  backupPaperSnapshot('before-reset', previous);
  if (previous.trades.length || previous.equityHistory.length > 1) {
    const sessions = readJson(SESSIONS_FILE, []);
    sessions.unshift({ sessionId: previous.sessionId, startedAt: previous.startedAt, endedAt: new Date().toISOString(), initialCash: previous.initialCash, endingEquity: equity(previous), realizedPnl: previous.realizedPnl || 0, feesPaid: previous.feesPaid || 0, trades: previous.trades.length, maxEquity: previous.peakEquity || equity(previous) });
    writeJson(SESSIONS_FILE, sessions.slice(0, 100));
  }
  const current = { ...structuredClone(defaults.state), schemaVersion: STATE_SCHEMA_VERSION, sessionId: randomUUID(), startedAt: new Date().toISOString(), initialCash: amount, cash: amount, currency: settings().accountCurrency || 'USDT', peakEquity: amount, benchmark: { ...structuredClone(defaults.state.benchmark), cashValue: amount, buyAndHoldValue: amount, buyAndHoldReturnPct: 0 }, protection: { status: 'armed', lastCheckAt: new Date().toISOString(), protectedPositions: 0, waitingForFreshQuote: false } };
  postLedger(current, { type: 'initial-capital' }, [{ account: 'cash', side: 'debit', amount }, { account: 'equity', side: 'credit', amount }]);
  recordEquity(current); writeJson(STATE_FILE, current); return current;
}

function setPaperPause(paused, reason = null) {
  if (paused) stopPaperAutomation(reason || 'Pausado manualmente');
  const current = state(), wasPaused = current.paused; current.paused = Boolean(paused); current.pauseReason = current.paused ? (reason || 'Pausado manualmente') : null; current.automation = { ...(current.automation || {}), status: current.paused ? 'paused' : settings().automationEnabled ? 'idle' : 'stopped', pausedReason: current.paused ? current.pauseReason : null, heartbeatAt: new Date().toISOString() }; if (current.paused && !wasPaused) addStateAlert(current, 'paper-paused', 'warning', current.pauseReason); writeJson(STATE_FILE, current); mainWindow?.webContents.send('automation:update', current.automation); return current;
}

function killPaper() {
  automationEpoch += 1;
  const current = state(), pending = current.orders.filter(order => ['created', 'accepted', 'partial'].includes(order.status));
  if (pending.length) { current.reservedCash = Math.max(0, Number(current.reservedCash || 0) - pending.reduce((sum, order) => sum + releaseAll(order), 0)); for (const order of pending) order.reservedCash = 0; }
  current.paused = true; current.pauseReason = 'Kill switch activado'; current.automation = { ...(current.automation || {}), status: 'stopped', pausedReason: current.pauseReason, heartbeatAt: new Date().toISOString() }; writeJson(SETTINGS_FILE, { ...settings(), automationEnabled: false }); addStateAlert(current, 'paper-kill', 'critical', current.pauseReason); current.orders = current.orders.map(order => ['created', 'accepted', 'partial'].includes(order.status) ? { ...order, status: 'cancelled', cancelledAt: new Date().toISOString(), reservedCash: 0, events: [...(order.events || []), { status: 'cancelled', at: new Date().toISOString() }] } : order); writeJson(STATE_FILE, current); mainWindow?.webContents.send('automation:update', current.automation); return current;
}

function saveBrokerCredentials({ apiKey: brokerApiKey, secret, environment = 'testnet' }) {
  if (!['testnet', 'demo', 'mainnet'].includes(environment)) throw new Error('Entorno de broker no válido.');
  if (!String(brokerApiKey || '').trim() || !String(secret || '').trim()) throw new Error('La API key y el secret del broker son obligatorios.');
  const saved = readJson(SECRETS_FILE, {}); saved.binanceApiKey = protect(String(brokerApiKey).trim()); saved.binanceSecret = protect(String(secret).trim()); writeJson(SECRETS_FILE, saved);
  const current = settings(); writeJson(SETTINGS_FILE, { ...current, brokerEnvironment: environment }); disarmSandbox('credentials-change'); stopBrokerStream(); startBrokerStream().catch(() => {}); return { environment, configured: true };
}

async function testBrokerConnection() {
  const current = await reconcileBroker();
  if (current.status !== 'connected') throw new Error(current.error || 'No se pudo conectar el broker.');
  return { environment: current.account.environment, accountType: current.account.accountType, canTrade: current.account.canTrade, balanceCount: current.account.balances.length, openOrderCount: current.openOrders.length, serverTime: current.account.serverTime || null, liveOrdersEnabled: false };
}

async function brokerPreflight() {
  const credentials = brokerCredentials();
  if (credentials.apiKey && credentials.secret && (brokerSnapshot.status !== 'connected' || !brokerSnapshot.lastSyncAt || Date.now() - new Date(brokerSnapshot.lastSyncAt).getTime() > 30000)) await reconcileBroker();
  const current = brokerSnapshot, environment = credentials.environment, account = current.account, audit = current.audit || auditStatus(), checks = [
    { id: 'credentials', label: 'Credenciales separadas', ok: Boolean(credentials.apiKey && credentials.secret), detail: credentials.apiKey && credentials.secret ? 'Guardadas en almacenamiento seguro.' : 'Faltan API key y secret del broker.' },
    { id: 'environment', label: 'Entorno permitido', ok: ['testnet', 'demo', 'mainnet'].includes(environment), detail: environment === 'mainnet' ? 'Mainnet configurado en lectura; las órdenes están bloqueadas.' : `Entorno seleccionado: ${environment}.` },
    { id: 'account', label: 'Cuenta reconciliada', ok: current.status === 'connected' && Boolean(account), detail: current.status === 'connected' ? 'REST respondió y la cuenta está disponible.' : (current.error || 'Sin reconciliación válida.') },
    { id: 'permissions', label: 'Permiso de trading', ok: Boolean(account?.canTrade), detail: account?.canTrade ? 'El proveedor declara canTrade.' : 'La cuenta no declara permiso de trading.' },
    { id: 'discrepancies', label: 'Sin discrepancias', ok: !(current.discrepancies || []).length, detail: current.discrepancies?.length ? `${current.discrepancies.length} discrepancias requieren revisión.` : 'Balances y órdenes sin diferencias detectadas.' },
    { id: 'recovery', label: 'Recuperación resuelta', ok: !(current.recovery?.unresolved || 0), detail: current.recovery?.unresolved ? `${current.recovery.unresolved} órdenes no resueltas.` : 'No hay órdenes pendientes de recuperación.' },
    { id: 'audit', label: 'Auditoría íntegra', ok: audit.brokerEvents?.valid !== false && audit.liveLedger?.valid !== false, detail: audit.brokerEvents?.valid === false || audit.liveLedger?.valid === false ? 'La cadena hash requiere revisión.' : 'Cadenas de broker y ledger verificadas.' },
    { id: 'stream', label: 'User Data Stream', ok: current.stream === 'connected', detail: `Estado: ${current.stream || 'desconectado'}.` }
  ];
  const required = new Set(['credentials', 'environment', 'account', 'permissions', 'discrepancies', 'recovery', 'audit']), readyForSandbox = ['testnet', 'demo'].includes(environment) && checks.filter(item => required.has(item.id)).every(item => item.ok), readyForLive = false;
  return { environment, readyForSandbox, readyForLive, liveOrdersEnabled: false, checks, evaluatedAt: new Date().toISOString() };
}

async function armSandbox() {
  const preflight = await brokerPreflight();
  if (!preflight.readyForSandbox) throw new Error(`Sandbox no está listo: ${preflight.checks.filter(check => !check.ok).map(check => check.label).join(', ')}.`);
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString(); brokerSnapshot = { ...brokerSnapshot, sandboxArmedUntil: expiresAt, error: null }; writeJson(LIVE_STATE_FILE, brokerSnapshot); saveBrokerEvent({ type: 'sandbox-arm', expiresAt, environment: preflight.environment }); brokerSnapshot = { ...brokerSnapshot, audit: auditStatus() }; writeJson(LIVE_STATE_FILE, brokerSnapshot); return { armed: true, environment: preflight.environment, expiresAt };
}
function sandboxIsArmed() { return Boolean(brokerSnapshot.sandboxArmedUntil && Date.now() < new Date(brokerSnapshot.sandboxArmedUntil).getTime()); }
function disarmSandbox(reason = 'manual') { if (!brokerSnapshot.sandboxArmedUntil) return; saveBrokerEvent({ type: 'sandbox-disarm', reason, environment: brokerCredentials().environment }); brokerSnapshot = { ...brokerSnapshot, sandboxArmedUntil: null, audit: auditStatus() }; writeJson(LIVE_STATE_FILE, brokerSnapshot); }

async function reconcileBroker() {
  const credentials = brokerCredentials();
  if (!credentials.apiKey || !credentials.secret) { brokerSnapshot = { ...brokerSnapshot, status: 'not-configured', error: 'No hay credenciales de broker guardadas.' }; return brokerSnapshot; }
  try { const client = new LiveBroker(credentials); const [account, openOrders] = await Promise.all([client.getAccount(), client.getOpenOrders()]); const activeOrders = openOrders.map(normalizeBinanceOrder), recovered = await reconcileLiveOrders(client, activeOrders), reconciled = reconcileBrokerSnapshot(brokerSnapshot, account, activeOrders); brokerSnapshot = { ...brokerSnapshot, ...reconciled, orders: recovered.orders, recovery: recovered.recovery, status: 'connected', lastSyncAt: reconciled.reconciledAt, error: null, audit: auditStatus() }; writeJson(LIVE_STATE_FILE, brokerSnapshot); }
  catch (error) { brokerSnapshot = { ...brokerSnapshot, status: 'error', lastSyncAt: new Date().toISOString(), error: error.message }; addAlert('broker-disconnected', 'warning', `Broker desconectado: ${error.message}`); }
  mainWindow?.webContents.send('broker:update', brokerSnapshot); return brokerSnapshot;
}

async function reconcileLiveOrders(client, activeOrders) {
  const known = readJson(LIVE_ORDERS_FILE, []), result = await reconcileKnownOrders(known, activeOrders, async order => { const request = { symbol: order.symbol, orderId: order.providerOrderId || undefined, clientOrderId: order.providerOrderId ? undefined : order.clientOrderId }, recovered = normalizeBinanceOrder(await client.getOrder(request)); saveBrokerEvent({ type: 'reconciliation-order', order: recovered }); if (['partial', 'filled'].includes(recovered.status)) saveLiveLedger({ type: 'reconciliation-execution', order: recovered }); return recovered; });
  const orders = result.orders.slice(0, 500), recovery = { activeCount: result.activeCount, attempted: result.attempted, recovered: result.recovered.length, unresolved: result.unresolved.length, unresolvedKeys: result.unresolved.map(orderKey) }; writeJson(LIVE_ORDERS_FILE, orders); return { orders, recovery };
}
function upsertLiveOrder(order) { const normalized = normalizeBinanceOrder(order), key = orderKey(normalized); if (!key) return normalized; const known = readJson(LIVE_ORDERS_FILE, []), existing = known.find(item => orderKey(item) === key), merged = mergeNormalizedOrder(existing, normalized), next = [merged, ...known.filter(item => orderKey(item) !== key)]; writeJson(LIVE_ORDERS_FILE, next.slice(0, 500)); return merged; }

function loadAudit(file, legacyProperty = 'event') {
  const stored = readJson(file, []);
  if (!stored.length || stored[0]?.hash) return stored;
  const upgraded = stored.reduce((entries, item) => appendAudit(entries, item[legacyProperty] ?? item, item.receivedAt || new Date().toISOString()), []);
  writeJson(file, upgraded); return upgraded;
}
function saveBrokerEvent(event) { const events = loadAudit(BROKER_EVENTS_FILE); if (events.at(-1) && JSON.stringify(events.at(-1).payload) === JSON.stringify(event)) return events.at(-1); const next = appendAudit(events, event); writeJson(BROKER_EVENTS_FILE, next); return next.at(-1); }
function saveLiveLedger(event) { const entries = loadAudit(LIVE_LEDGER_FILE); if (entries.at(-1) && JSON.stringify(entries.at(-1).payload) === JSON.stringify(event)) return entries.at(-1); const next = appendAudit(entries, event); writeJson(LIVE_LEDGER_FILE, next); return next.at(-1); }
function auditStatus() { return { brokerEvents: verifyAuditChain(loadAudit(BROKER_EVENTS_FILE)), liveLedger: verifyAuditChain(loadAudit(LIVE_LEDGER_FILE)) }; }
function applyBrokerOrderEvent(payload) {
  const order = normalizeBinanceOrder(payload); if (!order.providerOrderId && !order.clientOrderId) return;
  const open = new Map((brokerSnapshot.openOrders || []).map(item => [String(item.providerOrderId || item.clientOrderId), item]));
  const key = String(order.providerOrderId || order.clientOrderId);
  if (['accepted', 'partial'].includes(order.status)) open.set(key, order); else open.delete(key);
  const known = new Map((brokerSnapshot.orders || []).map(item => [orderKey(item), item])); known.set(key, mergeNormalizedOrder(known.get(key), order));
  brokerSnapshot = { ...brokerSnapshot, status: 'connected', lastEventAt: new Date().toISOString(), lastEvent: order, openOrders: [...open.values()], orders: [...known.values()].slice(0, 500), discrepancies: [], audit: auditStatus() }; writeJson(LIVE_STATE_FILE, brokerSnapshot);
  saveBrokerEvent(order); if (['partial', 'filled'].includes(order.status)) saveLiveLedger({ type: 'execution', order }); mainWindow?.webContents.send('broker:update', brokerSnapshot);
}
function applyBrokerAccountEvent(payload) {
  const account = applyAccountEvent(brokerSnapshot.account || {}, payload); saveBrokerEvent(payload); brokerSnapshot = { ...brokerSnapshot, status: 'connected', account, lastEventAt: new Date().toISOString(), lastEvent: payload, audit: auditStatus() }; writeJson(LIVE_STATE_FILE, brokerSnapshot); mainWindow?.webContents.send('broker:update', brokerSnapshot);
}
function scheduleBrokerStreamReconnect() {
  if (appQuitting || brokerStream.reconnectTimer || !brokerCredentials().apiKey) return;
  brokerStream.reconnectTimer = setTimeout(() => { brokerStream.reconnectTimer = null; startBrokerStream().catch(() => {}); }, 5000);
}
async function startBrokerStream() {
  if (brokerStream.socket || brokerStream.connecting || typeof WebSocket === 'undefined') return false;
  const credentials = brokerCredentials(); if (!credentials.apiKey || !credentials.secret) return false;
  brokerStream.connecting = true;
  try {
    const client = new LiveBroker(credentials), response = await client.createListenKey();
    brokerStream.listenKey = response.listenKey;
    const socket = new WebSocket(streamUrl(credentials.environment, response.listenKey)); brokerStream.socket = socket;
    socket.onopen = () => { brokerStream.connecting = false; brokerSnapshot = { ...brokerSnapshot, stream: 'connected', lastEventAt: brokerSnapshot.lastEventAt || null }; mainWindow?.webContents.send('broker:update', brokerSnapshot); };
    socket.onmessage = message => { try { const payload = JSON.parse(message.data); if (payload.e === 'executionReport') applyBrokerOrderEvent(payload); else if (payload.e === 'outboundAccountPosition' || payload.e === 'balanceUpdate') applyBrokerAccountEvent(payload); } catch { /* ignore malformed account events */ } };
    socket.onerror = () => { socket.onerror = null; try { socket.close(); } catch { /* close event schedules recovery */ } };
    socket.onclose = () => { brokerStream.socket = null; brokerStream.connecting = false; if (brokerStream.keepAlive) clearInterval(brokerStream.keepAlive); brokerStream.keepAlive = null; brokerSnapshot = { ...brokerSnapshot, stream: 'disconnected' }; mainWindow?.webContents.send('broker:update', brokerSnapshot); scheduleBrokerStreamReconnect(); };
    brokerStream.keepAlive = setInterval(() => client.keepAliveListenKey(response.listenKey).catch(() => { try { socket.close(); } catch {} }), 25 * 60000);
    return true;
  } catch (error) { brokerStream.connecting = false; brokerSnapshot = { ...brokerSnapshot, stream: 'error', error: error.message }; addAlert('broker-stream-error', 'warning', `User Data Stream con error: ${error.message}`); mainWindow?.webContents.send('broker:update', brokerSnapshot); scheduleBrokerStreamReconnect(); return false; }
}
function stopBrokerStream() { if (brokerStream.reconnectTimer) clearTimeout(brokerStream.reconnectTimer); if (brokerStream.keepAlive) clearInterval(brokerStream.keepAlive); brokerStream.socket?.close(); brokerStream = { socket: null, keepAlive: null, reconnectTimer: null, connecting: false, listenKey: null }; }

function paperClient() { if (!paperBroker) paperBroker = new PaperBroker({ submitOrder: submitPaperOrder, cancelOrder: cancelPaperOrder, snapshot: state }); return paperBroker; }
function liveClient() { return new LiveBroker(brokerCredentials()); }
async function placeSandboxOrder(order) {
  const environment = settings().brokerEnvironment || 'testnet';
  if (!['testnet', 'demo'].includes(environment)) throw new Error('Solo testnet y demo permiten pruebas de órdenes desde esta versión.');
  if (order?.confirmSandbox !== true) throw new Error('La orden sandbox necesita confirmación explícita.');
  if (!sandboxIsArmed()) throw new Error('Arma el entorno sandbox por 15 minutos antes de enviar órdenes.');
  const symbol = String(order.symbol || '').trim().toUpperCase(), side = String(order.side || '').toUpperCase(), type = String(order.type || 'MARKET').toUpperCase(), quantity = Number(order.quantity), price = Number(order.price);
  if (!/^[A-Z0-9]{5,15}$/.test(symbol) || !['BUY', 'SELL'].includes(side) || !['MARKET', 'LIMIT'].includes(type) || !(quantity > 0) || (type === 'LIMIT' && !(price > 0))) throw new Error('Orden sandbox inválida.');
  const preflight = await brokerPreflight(); if (!preflight.readyForSandbox) throw new Error(`Sandbox no está listo: ${preflight.checks.filter(check => !check.ok).map(check => check.label).join(', ')}.`);
  const clientOrderId = String(order.clientOrderId || randomUUID()), existing = readJson(LIVE_ORDERS_FILE, []).find(item => item.clientOrderId === clientOrderId); if (existing) return { ...existing.raw, ...existing, idempotent: true };
  const [instrument, quote] = await Promise.all([fetchInstrument(symbol), type === 'MARKET' ? fetchQuote(symbol) : Promise.resolve(null)]), referencePrice = type === 'LIMIT' ? price : quote.last;
  validateInstrumentOrder({ quantity, price: referencePrice, limitPrice: type === 'LIMIT' ? price : null }, instrument);
  const request = { symbol, side, type, quantity, price: type === 'LIMIT' ? price : undefined, clientOrderId }, response = await liveClient().placeOrder(request);
  const normalized = upsertLiveOrder({ ...response, symbol, side, type, origQty: quantity, clientOrderId: response.clientOrderId || clientOrderId }); saveBrokerEvent({ type: 'sandbox-command', action: 'place', request, response: normalized }); return response;
}
async function getSandboxOrder(order) { const request = order || {}, response = await liveClient().getOrder(request), normalized = upsertLiveOrder(response); saveBrokerEvent({ type: 'sandbox-command', action: 'get-order', request: { symbol: request.symbol, orderId: request.orderId, clientOrderId: request.clientOrderId }, response: normalized }); return response; }
async function cancelSandboxOrder(order) { if ((settings().brokerEnvironment || 'testnet') === 'mainnet') throw new Error('Las cancelaciones en mainnet están bloqueadas en esta versión.'); const request = order || {}, response = await liveClient().cancelOrder(request), normalized = upsertLiveOrder(response); saveBrokerEvent({ type: 'sandbox-command', action: 'cancel', request: { symbol: request.symbol, orderId: request.orderId, clientOrderId: request.clientOrderId }, response: normalized }); return response; }

async function killSandbox() {
  const environment = settings().brokerEnvironment || 'testnet';
  if (!['testnet', 'demo'].includes(environment)) throw new Error('El kill switch de broker solo está disponible para sandbox/testnet.');
  const client = liveClient(), pending = readJson(LIVE_ORDERS_FILE, []).filter(order => ['accepted', 'partial'].includes(order.status) && order.symbol && (order.providerOrderId || order.clientOrderId)), results = [];
  for (const order of pending) {
    const request = { symbol: order.symbol, orderId: order.providerOrderId || undefined, clientOrderId: order.providerOrderId ? undefined : order.clientOrderId };
    try { const response = await client.cancelOrder(request), normalized = upsertLiveOrder(response); saveBrokerEvent({ type: 'sandbox-kill', action: 'cancel', request, response: normalized }); results.push({ key: orderKey(order), status: 'cancelled' }); }
    catch (error) { saveBrokerEvent({ type: 'sandbox-kill-error', action: 'cancel', request, error: error.message }); results.push({ key: orderKey(order), status: 'failed', error: error.message }); }
  }
  disarmSandbox('kill-switch'); const broker = await reconcileBroker(); return { environment, attempted: pending.length, cancelled: results.filter(item => item.status === 'cancelled').length, failed: results.filter(item => item.status === 'failed').length, results, broker };
}

async function exportPaperReport() {
  const current = state();
  const result = await dialog.showSaveDialog({ title: 'Exportar reporte paper', defaultPath: path.join(app.getPath('documents'), `llm-trader-paper-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'Reporte JSON', extensions: ['json'] }] });
  if (result.canceled) return null;
  writeJson(result.filePath, { version: 2, exportedAt: new Date().toISOString(), product: 'LLM Trader', mode: 'paper', schemaVersion: current.schemaVersion, experiment: { sessionId: current.sessionId, startedAt: current.startedAt, endedAt: new Date().toISOString(), initialCash: current.initialCash, analysisCount: current.analyses.length, latestAnalysisId: current.analyses[0]?.id || null }, settings: settings(), state: current, sessions: readJson(SESSIONS_FILE, []) });
  return result.filePath;
}

function csvCell(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
async function exportPaperCsv() {
  const current = state(), result = await dialog.showSaveDialog({ title: 'Exportar datos paper CSV', defaultPath: path.join(app.getPath('documents'), `llm-trader-paper-${new Date().toISOString().slice(0, 10)}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (result.canceled) return null;
  const header = ['recordType', 'timestamp', 'symbol', 'side', 'quantity', 'requestedPrice', 'price', 'notional', 'fee', 'slippageCost', 'grossPnl', 'netPnl', 'equity', 'exitReason', 'source'];
  const rows = [header, ...(current.equityHistory || []).map(item => ['equity', item.time, '', '', '', '', '', '', '', '', '', '', item.value, '', '']), ...(current.trades || []).map(item => ['trade', item.createdAt, item.symbol, item.side, item.quantity, item.requestedPrice, item.price, item.notional, item.fee, item.slippageCost, item.grossPnl, item.netPnl ?? item.realizedPnl, '', item.exitReason, item.source])];
  writeText(result.filePath, `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`); return result.filePath;
}

function cancelPaperOrder(orderId) {
  const current = state(); const order = current.orders.find(item => item.id === orderId);
  if (!order) throw new Error('Orden no encontrada.');
  if (!['created', 'accepted', 'partial'].includes(order.status)) throw new Error('La orden ya no se puede cancelar.');
  current.reservedCash = Math.max(0, Number(current.reservedCash || 0) - releaseAll(order)); order.reservedCash = 0;
  order.status = 'cancelled'; order.cancelledAt = new Date().toISOString(); order.events ||= []; order.events.push({ status: 'cancelled', at: order.cancelledAt }); writeJson(STATE_FILE, current); return current;
}

function autoQuantity(analysis, current, config) {
  const entry = Number(analysis.entry || analysis.price), stop = Number(analysis.stopLoss);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  const riskCapital = equity(current) * Math.max(0.1, Number(config.riskPerTradePct) || 1) / 100;
  const distance = Math.abs(entry - stop);
  const riskQuantity = Number.isFinite(stop) && distance > 0 ? riskCapital / distance : 0;
  const costMultiplier = 1 + Math.max(0, Number(config.feeRate) || 0) + Math.max(0, Number(config.slippageBps) || 0) / 10000 + Math.max(0, Number(config.maxSpreadBps) || 50) / 10000, allocationQuantity = equity(current) * (Math.max(1, Number(config.maxOrderPct) || 25) / 100) / (entry * costMultiplier);
  const cashQuantity = current.cash / (entry * (1 + (Number(config.feeRate) || 0) + (Number(config.slippageBps) || 0) / 10000));
  return Math.max(0, Math.min(riskQuantity || allocationQuantity, allocationQuantity, cashQuantity));
}

function stopPaperAutomation(reason = 'Auto-Paper detenido manualmente') {
  automationEpoch += 1;
  const current = state(); writeJson(SETTINGS_FILE, { ...settings(), automationEnabled: false }); current.automation = { ...(current.automation || {}), status: 'stopped', pausedReason: reason, heartbeatAt: new Date().toISOString() }; writeJson(STATE_FILE, current); mainWindow?.webContents.send('automation:update', current.automation); return current;
}

function addAutomationRunEvent(current, runId, event) {
  current.automation ||= {};
  current.automation.history = updateAutomationRun(current.automation.history || [], runId, { event });
  return current;
}

function reportAutomationProgress(runId, symbol, phase, status, detail, agent = phase) {
  if (!String(runId).startsWith('preflight-') && !state().automation?.history?.some(run => run.runId === runId)) return;
  const current = state(), event = { runId, symbol: symbol || null, phase, agent, status, detail: String(detail || ''), at: new Date().toISOString() };
  const journalEvent = { action: 'progress', symbol: event.symbol, phase: event.phase, agent: event.agent, status: event.status, detail: event.detail, at: event.at };
  const history = Array.isArray(current.automation?.history) && current.automation.history.some(run => run.runId === runId)
    ? updateAutomationRun(current.automation.history, runId, { event: journalEvent })
    : (current.automation?.history || []);
  current.automation = { ...(current.automation || {}), heartbeatAt: event.at, history, progress: [...(current.automation?.progress || []), event].slice(-80) };
  writeJson(STATE_FILE, current);
  mainWindow?.webContents.send('automation:progress', event);
  return event;
}

async function runAutomationPreflight() {
  const current = state(), config = settings(), symbols = Array.isArray(config.automationSymbols) ? config.automationSymbols : [], marketChecks = {};
  await Promise.all(symbols.map(async symbol => {
    const normalized = String(symbol).trim().toUpperCase();
    try {
      const timeframe = ['15m', '1h', '4h', '1d'].includes(config.automationTimeframe) ? config.automationTimeframe : '15m', [quote, instrument, market] = await Promise.all([fetchQuote(normalized), fetchInstrument(normalized), fetchCandles(normalized, timeframe, 60)]), quoteFresh = Number.isFinite(Number(quote.fetchedAt)) && Date.now() - Number(quote.fetchedAt) <= Math.max(1000, Number(config.maxDataAgeMs) || 15000), closed = market.closedCandles || closedCandles(market.candles), marketValid = Boolean(market.dataQuality?.valid) && closed.length >= 50;
      marketChecks[normalized] = { ok: true, quoteFresh, marketValid, instrumentTrading: instrument.status === 'TRADING', currencyCompatible: instrument.quoteAsset === current.currency, detail: quoteFresh && marketValid ? 'Cotización fresca y velas cerradas válidas.' : 'Feed obsoleto o insuficiente.', instrumentDetail: `${instrument.status} · cotiza en ${instrument.quoteAsset}.` };
    } catch (error) { marketChecks[normalized] = { ok: false, error: error.message, quoteFresh: false, marketValid: false, instrumentTrading: false, currencyCompatible: false }; }
  }));
  return buildAutomationPreflight({ config, current, apiKeyPresent: Boolean(apiKey()), integrity: verifyPaperIntegrity(current), marketChecks, todayUsage: usageToday(current) });
}

async function startPaperAutomation() {
  if (automationStarting || paperAutomationSingleFlight.isRunning()) return { started: false, state: state(), preflight: { ready: false, checks: [{ ok: false, label: 'Corrida activa', detail: 'Espera a que finalice.' }] } };
  automationStarting = true;
  const epoch = automationEpoch;
  try {
  const runId = `preflight-${Date.now()}`;
  reportAutomationProgress(runId, null, 'preflight', 'running', 'Comprobando configuración, cuenta, feed, instrumentos, presupuesto y riesgo.', 'preflight');
  const preflight = await runAutomationPreflight();
  if (epoch !== automationEpoch) return { started: false, preflight, state: state() };
  const current = state();
  current.automation = { ...(current.automation || {}), preflight, status: preflight.ready ? 'starting' : 'paused', pausedReason: preflight.ready ? null : 'Preflight rechazado; revisa los requisitos.', heartbeatAt: new Date().toISOString(), progress: [...(current.automation?.progress || []), { runId, phase: 'preflight', agent: 'preflight', status: preflight.ready ? 'completed' : 'rejected', detail: preflight.ready ? 'Todos los requisitos están listos.' : preflight.checks.filter(item => !item.ok).map(item => `${item.label}: ${item.detail}`).join(' | '), at: new Date().toISOString() }].slice(-80) };
  writeJson(STATE_FILE, current);
  mainWindow?.webContents.send('automation:update', current.automation);
  mainWindow?.webContents.send('automation:progress', current.automation.progress.at(-1));
  if (!preflight.ready) { addStateAlert(current, 'automation-preflight', 'warning', 'Auto-Paper no inició: el preflight rechazó uno o más requisitos.', { checks: preflight.checks.filter(item => !item.ok) }); writeJson(STATE_FILE, current); return { started: false, preflight, state: current }; }
  const launchSettings = { ...settings(), automationEnabled: true };
  automationStartApproved = true;
  writeJson(SETTINGS_FILE, launchSettings);
  runPaperAutomation(true).catch(error => { const failed = state(); failed.automation = { ...(failed.automation || {}), status: 'completed-with-errors', lastError: error.message, heartbeatAt: new Date().toISOString() }; addStateAlert(failed, 'automation-start-failed', 'critical', error.message); writeJson(STATE_FILE, failed); mainWindow?.webContents.send('automation:update', failed.automation); });
  return { started: true, preflight, state: state() };
  } finally { automationStarting = false; }
}

async function runPaperAutomation(force = false) {
  return paperAutomationSingleFlight(force);
}

async function runPaperAutomationCycle(force = false) {
  const epoch = automationEpoch, sessionId = state().sessionId;
  const isCurrent = () => epoch === automationEpoch && state().sessionId === sessionId && settings().automationEnabled && !state().paused;
  const config = settings();
  if (config.mode !== 'paper' || !config.automationEnabled || !apiKey()) return;
  let current = state();
  if (current.paused) { current.automation = { ...(current.automation || {}), status: 'paused', pausedReason: current.pauseReason || 'Paper pausado', heartbeatAt: new Date().toISOString() }; writeJson(STATE_FILE, current); mainWindow?.webContents.send('automation:update', current.automation); return; }
  const now = Date.now();
  const cooldown = Math.max(5, Number(config.automationIntervalMin) || 15) * 60000;
  if (!force && current.automation?.lastRunAt && now - new Date(current.automation.lastRunAt).getTime() < cooldown) return;
  const runId = randomUUID(), runStartedAt = Date.now(), runStartedIso = new Date(runStartedAt).toISOString();
  const journalRun = createAutomationRun(runId, config.automationSymbols || ['BTCUSDT'], runStartedIso);
  current.automation = { ...(current.automation || {}), status: 'running', heartbeatAt: runStartedIso, startedAt: runStartedIso, lastRunAt: runStartedIso, lastRunId: runId, lastError: null, history: [journalRun, ...(current.automation?.history || [])].slice(0, 50) };
  writeJson(STATE_FILE, current);
  mainWindow?.webContents.send('automation:update', current.automation);
  const heartbeatTimer = setInterval(() => { const heartbeat = state(); if (heartbeat.automation?.lastRunId !== runId || heartbeat.automation?.status !== 'running') return; heartbeat.automation = { ...(heartbeat.automation || {}), heartbeatAt: new Date().toISOString() }; writeJson(STATE_FILE, heartbeat); mainWindow?.webContents.send('automation:update', heartbeat.automation); }, 15000);
  for (const symbol of config.automationSymbols || ['BTCUSDT']) {
    try {
      if (!isCurrent()) break;
      const result = await analyzeMarket({ symbol, interval: config.automationTimeframe || '15m', automationRunId: runId });
      if (!isCurrent()) break;
      current = state();
      current.automation = { ...(current.automation || {}), status: 'running', heartbeatAt: new Date().toISOString(), lastRunAt: new Date().toISOString(), lastDecision: `${result.symbol}:${result.decision}`, lastError: null };
      addAutomationRunEvent(current, runId, { symbol: result.symbol, action: 'decision', decision: result.decision, confidence: Number(result.confidence) || 0 });
      reportAutomationProgress(runId, result.symbol, 'decision', 'completed', `${result.decision} con confianza ${Number(result.confidence) || 0}%.`, 'consensus-agent');
      if (!['BUY', 'SELL'].includes(result.decision) || Number(result.confidence) < (Number(config.minConfidence) || 60)) { addAutomationRunEvent(current, runId, { symbol: result.symbol, action: 'skipped', reason: 'confidence-or-hold' }); writeJson(STATE_FILE, current); reportAutomationProgress(runId, result.symbol, 'execution', 'rejected', 'Sin orden: HOLD o confianza inferior al mínimo.', 'risk-governor'); continue; }
      const recent = current.trades.find(item => item.symbol === result.symbol);
      if (recent && now - new Date(recent.createdAt).getTime() < cooldown) { addAutomationRunEvent(current, runId, { symbol: result.symbol, action: 'skipped', reason: 'cooldown' }); writeJson(STATE_FILE, current); reportAutomationProgress(runId, result.symbol, 'execution', 'rejected', 'Orden retenida por cooldown.', 'risk-governor'); continue; }
      const position = current.positions.find(item => item.symbol === result.symbol);
      const quantity = result.decision === 'SELL' ? (position?.quantity || 0) : autoQuantity(result, current, config);
      if (quantity > 0) {
        reportAutomationProgress(runId, result.symbol, 'execution', 'running', 'Validando cotización, lote, saldo y riesgo.', 'risk-governor');
        const [liveQuote, instrument] = await Promise.all([fetchQuote(result.symbol), fetchInstrument(result.symbol)]);
        if (!isCurrent()) break;
        const normalizedQuantity = floorToStep(quantity, instrument.stepSize);
        if (!(normalizedQuantity > 0)) throw new Error('El tamaño calculado no alcanza el lote mínimo del instrumento.');
        await paperMutationQueue.enqueue('paper-auto-order', () => {
          if (!isCurrent()) return;
          current = paperClient().submitOrder({ symbol: result.symbol, side: result.decision, quantity: normalizedQuantity, price: liveQuote.last, quote: liveQuote, instrument, orderType: 'market', stopLoss: result.stopLoss, takeProfit: result.takeProfit, source: 'paper-auto', clientOrderId: `auto-${result.symbol}-${runId}` });
          addAutomationRunEvent(current, runId, { symbol: result.symbol, action: 'submitted', side: result.decision, quantity: normalizedQuantity });
          writeJson(STATE_FILE, current);
        });
        if (isCurrent()) reportAutomationProgress(runId, result.symbol, 'execution', 'completed', `${result.decision} ${normalizedQuantity} enviada al broker paper.`, 'risk-governor');
      }
      else { addAutomationRunEvent(current, runId, { symbol: result.symbol, action: 'skipped', reason: 'no-position-or-size' }); writeJson(STATE_FILE, current); reportAutomationProgress(runId, result.symbol, 'execution', 'rejected', 'Sin orden: no existe posición vendible o el tamaño permitido es cero.', 'risk-governor'); }
    } catch (error) {
      if (!isCurrent()) break;
      current = state(); current.automation = { ...(current.automation || {}), status: 'running', heartbeatAt: new Date().toISOString(), lastRunAt: new Date().toISOString(), lastRunId: runId, lastError: error.message }; addAutomationRunEvent(current, runId, { symbol, action: 'failed', error: error.message }); reportAutomationProgress(runId, symbol, 'automation', 'failed', error.message, 'automation'); addStateAlert(current, 'automation-failed', 'warning', error.message, { runId, symbol }); writeJson(STATE_FILE, current);
    }
  }
  clearInterval(heartbeatTimer); current = state();
  if (current.sessionId !== sessionId) return;
  const finishedAt = new Date().toISOString(), finalStatus = !isCurrent() ? 'stopped' : current.automation?.lastError ? 'completed-with-errors' : 'idle'; current.automation = { ...(current.automation || {}), status: finalStatus, heartbeatAt: finishedAt, finishedAt, durationMs: Date.now() - runStartedAt, history: updateAutomationRun(current.automation?.history || [], runId, { status: finalStatus, finishedAt, durationMs: Date.now() - runStartedAt }) }; writeJson(STATE_FILE, current); mainWindow?.webContents.send('automation:update', current.automation);
}

const paperAutomationSingleFlight = createSingleFlight(runPaperAutomationCycle);

function recoverStaleAutomationState() {
  const current = state(), recovery = recoverStaleAutomation(current.automation?.history || [], Date.now(), 120000);
  if (!recovery.recovered) return current;
  current.automation = { ...(current.automation || {}), status: 'interrupted', pausedReason: 'La aplicación se cerró durante una corrida; requiere revisión manual.', heartbeatAt: new Date().toISOString(), history: recovery.history };
  addStateAlert(current, 'automation-interrupted', 'critical', current.automation.pausedReason, { runId: current.automation.lastRunId });
  writeJson(STATE_FILE, current);
  return current;
}

function enforceSafeAutomationStartup() {
  const current = state(), safe = safeAutomationStartup(settings(), current.automation);
  writeJson(SETTINGS_FILE, safe.settings);
  current.automation = safe.automation;
  writeJson(STATE_FILE, current);
  return current;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 1040, minHeight: 680, backgroundColor: '#0b1020',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0b1020', symbolColor: '#c9d4ff', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { mainWindow = null; });
  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('app:snapshot', () => { const current = state(); return { settings: settings(), state: current, integrity: verifyPaperIntegrity(current), sessions: readJson(SESSIONS_FILE, []), broker: brokerSnapshot, hasApiKey: Boolean(apiKey()) }; });
  ipcMain.handle('settings:save', (_event, value) => { const current = settings(), numeric = (key, fallback) => numericSetting(value[key], fallback); writeJson(SETTINGS_FILE, { ...current, mode: 'paper', accountCurrency: applyAccountCurrency(value.accountCurrency, current.accountCurrency), endpoint: String(value.endpoint || '').trim(), model: String(value.model || '').trim(), initialCash: numeric('initialCash', current.initialCash) > 0 ? numeric('initialCash', current.initialCash) : current.initialCash, feeRate: Math.max(0, numeric('feeRate', current.feeRate)), slippageBps: Math.max(0, numeric('slippageBps', current.slippageBps)), backtestSpreadBps: Math.min(1000, Math.max(0, numeric('backtestSpreadBps', current.backtestSpreadBps))), executionLatencyMs: Math.min(600000, Math.max(0, numeric('executionLatencyMs', current.executionLatencyMs))), limitOrderTtlMin: Math.min(10080, Math.max(1, numeric('limitOrderTtlMin', current.limitOrderTtlMin))), liquidityNotionalPerTick: Math.min(1000000, Math.max(0, numeric('liquidityNotionalPerTick', current.liquidityNotionalPerTick))), intrabarPolicy: ['conservative', 'take-first'].includes(value.intrabarPolicy) ? value.intrabarPolicy : current.intrabarPolicy, maxOrderPct: Math.min(100, Math.max(1, numeric('maxOrderPct', current.maxOrderPct))), maxDrawdownPct: Math.min(100, Math.max(1, numeric('maxDrawdownPct', current.maxDrawdownPct))), maxPortfolioRiskPct: Math.min(100, Math.max(0.1, numeric('maxPortfolioRiskPct', current.maxPortfolioRiskPct))), automationEnabled: Boolean(value.automationEnabled), automationIntervalMin: Math.max(5, numeric('automationIntervalMin', current.automationIntervalMin)), automationTimeframe: ['15m', '1h', '4h', '1d'].includes(value.automationTimeframe) ? value.automationTimeframe : current.automationTimeframe, automationSymbols: String(value.automationSymbols || 'BTCUSDT').split(',').map(item => item.trim().toUpperCase()).filter(item => /^[A-Z0-9]{5,15}$/.test(item)).slice(0, 10), minConfidence: Math.min(100, Math.max(0, numeric('minConfidence', current.minConfidence))), riskPerTradePct: Math.min(5, Math.max(0.1, numeric('riskPerTradePct', current.riskPerTradePct))), llmDailyCallBudget: Math.min(1000, Math.max(1, numeric('llmDailyCallBudget', current.llmDailyCallBudget))), llmDailyBudgetUsd: Math.min(10000, Math.max(0, numeric('llmDailyBudgetUsd', current.llmDailyBudgetUsd))), llmInputCostPer1kUsd: Math.min(1000, Math.max(0, numeric('llmInputCostPer1kUsd', current.llmInputCostPer1kUsd))), llmOutputCostPer1kUsd: Math.min(1000, Math.max(0, numeric('llmOutputCostPer1kUsd', current.llmOutputCostPer1kUsd))), llmFailurePauseThreshold: Math.min(20, Math.max(1, numeric('llmFailurePauseThreshold', current.llmFailurePauseThreshold))) }); return settings(); });
  ipcMain.handle('settings:partialFill', (_event, value) => { const current = settings(); writeJson(SETTINGS_FILE, { ...current, partialFillPct: Math.min(100, Math.max(1, Number(value) || current.partialFillPct)) }); return settings(); });
  ipcMain.handle('settings:risk', (_event, value) => { const current = settings(); writeJson(SETTINGS_FILE, { ...current, maxExposurePct: Math.min(100, Math.max(1, Number(value.maxExposurePct) || current.maxExposurePct)), maxAssetExposurePct: Math.min(100, Math.max(1, Number(value.maxAssetExposurePct) || current.maxAssetExposurePct)), maxSpreadBps: Math.max(1, Number(value.maxSpreadBps) || current.maxSpreadBps), maxTradesPerDay: Math.max(1, Number(value.maxTradesPerDay) || current.maxTradesPerDay), maxDataAgeMs: Math.max(1000, Number(value.maxDataAgeMs) || current.maxDataAgeMs) }); return settings(); });
  ipcMain.handle('settings:news-feeds', (_event, value) => saveNewsFeeds(value));
  ipcMain.handle('secrets:saveKey', (_event, value) => { const key = String(value || '').trim(); if (!key) throw new Error('La API key está vacía.'); writeJson(SECRETS_FILE, { ...readJson(SECRETS_FILE, {}), llmApiKey: protect(key) }); return true; });
  ipcMain.handle('market:load', (_event, query) => fetchCandles(query.symbol, query.interval, query.limit, { allowStale: true }));
  ipcMain.handle('market:depth', (_event, query) => fetchDepth(query.symbol, query.limit));
  ipcMain.handle('market:instrument', (_event, symbol) => fetchInstrument(symbol));
  ipcMain.handle('paper:refresh', () => refreshPaper());
  ipcMain.handle('market:subscribe', (_event, symbols) => subscribeMarket(Array.isArray(symbols) ? symbols : []));
  ipcMain.handle('paper:reset', (_event, amount) => paperMutationQueue.enqueue('paper-reset', () => resetPaper(amount)));
  ipcMain.handle('paper:listBackups', () => listPaperBackups());
  ipcMain.handle('paper:restoreBackup', () => restorePaperBackup());
  ipcMain.handle('paper:verify', () => verifyPaperIntegrity(state()));
  ipcMain.handle('paper:pause', () => paperMutationQueue.enqueue('paper-pause', () => setPaperPause(true)));
  ipcMain.handle('paper:resume', () => paperMutationQueue.enqueue('paper-resume', () => setPaperPause(false)));
  ipcMain.handle('paper:kill', () => paperMutationQueue.enqueue('paper-kill', () => killPaper()));
  ipcMain.handle('paper:runAutomation', () => startPaperAutomation());
  ipcMain.handle('paper:automation-start', () => startPaperAutomation());
  ipcMain.handle('paper:automation-stop', () => stopPaperAutomation());
  ipcMain.handle('paper:cancel', (_event, orderId) => paperMutationQueue.enqueue('paper-cancel', () => paperClient().cancelOrder(String(orderId || ''))));
  ipcMain.handle('paper:export', () => exportPaperReport());
  ipcMain.handle('paper:exportCsv', () => exportPaperCsv());
  ipcMain.handle('research:backtest', (_event, query) => runBacktest(query || {}).then(saveBacktestExperiment));
  ipcMain.handle('research:compare', (_event, query) => compareBacktests(query || {}));
  ipcMain.handle('research:experiments', () => listBacktestExperiments());
  ipcMain.handle('research:evaluate-agents', () => { const current = state(); return evaluateAnalyses(current.analyses || [], current.initialCash); });
  ipcMain.handle('research:report', () => { const current = state(); return buildResearchReport({ analyses: current.analyses || [], backtests: readJson(EXPERIMENTS_FILE, []), initialCash: current.initialCash }); });
  ipcMain.handle('broker:saveCredentials', (_event, value) => saveBrokerCredentials(value || {}));
  ipcMain.handle('broker:testConnection', () => testBrokerConnection());
  ipcMain.handle('broker:preflight', () => brokerPreflight());
  ipcMain.handle('broker:armSandbox', () => armSandbox());
  ipcMain.handle('broker:reconcile', () => reconcileBroker());
  ipcMain.handle('broker:placeSandboxOrder', (_event, order) => placeSandboxOrder(order || {}));
  ipcMain.handle('broker:getSandboxOrder', (_event, order) => getSandboxOrder(order || {}));
  ipcMain.handle('broker:cancelSandboxOrder', (_event, order) => cancelSandboxOrder(order || {}));
  ipcMain.handle('broker:killSandbox', () => killSandbox());
  ipcMain.handle('llm:analyze', (_event, query) => analyzeMarket(query));
  ipcMain.handle('paper:execute', async (_event, order) => {
    if (!order || !/^[A-Z0-9]{5,15}$/.test(String(order.symbol).toUpperCase()) || !['BUY', 'SELL'].includes(order.side) || !Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) throw new Error('Orden inválida.');
    const sessionId = state().sessionId;
    const clientOrderId = String(order.clientOrderId || randomUUID());
    try {
      const [quote, instrument] = await Promise.all([fetchQuote(order.symbol), fetchInstrument(order.symbol)]);
      const result = await paperMutationQueue.enqueue('paper-order', () => {
        if (state().sessionId !== sessionId) throw new Error('La sesión cambió; vuelve a revisar la orden.');
        return paperClient().submitOrder({ ...order, source: 'terminal-manual', price: quote.last, quote, instrument, clientOrderId });
      });
      subscribeMarket([order.symbol]);
      return result;
    } catch (error) {
      const current = state();
      if (!current.orders.some(item => item.clientOrderId === clientOrderId)) { const rejectedAt = new Date().toISOString(); current.orders.unshift({ id: randomUUID(), sessionId: current.sessionId, clientOrderId, symbol: String(order.symbol || '').toUpperCase(), side: String(order.side || '').toUpperCase(), type: String(order.orderType || 'market'), quantity: Number(order.quantity) || 0, status: 'rejected', reason: error.message, source: order.source || 'manual', createdAt: rejectedAt, events: [{ status: 'rejected', reason: error.message, at: rejectedAt }] }); addStateAlert(current, 'order-rejected', 'warning', error.message, { symbol: order.symbol, side: order.side, clientOrderId }); writeJson(STATE_FILE, current); }
      throw error;
    }
  });
  ipcMain.handle('app:openData', () => shell.openPath(DATA_DIR));
  recoverStaleAutomationState();
  enforceSafeAutomationStartup();
  createWindow();
  subscribeMarket(['BTCUSDT', ...state().positions.map(p => p.symbol), ...state().orders.filter(o => ['accepted', 'partial'].includes(o.status)).map(o => o.symbol)]);
  automationTimer = setInterval(() => runPaperAutomation().catch(() => {}), 60000);
  brokerSyncTimer = setInterval(() => reconcileBroker().catch(() => {}), 30000);
  startBrokerStream().catch(() => {});
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => { appQuitting = true; if (automationTimer) clearInterval(automationTimer); if (brokerSyncTimer) clearInterval(brokerSyncTimer); stopBrokerStream(); for (const stream of marketStreams.values()) { stream.closed = true; stream.socket?.close(); if (stream.poller) clearInterval(stream.poller); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
