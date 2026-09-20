const SYMBOL_PATTERN = /^[A-Z0-9]{5,15}$/;

function check(label, ok, detail) { return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, ok: Boolean(ok), detail: String(detail) }; }

function buildAutomationPreflight({ config = {}, current = {}, apiKeyPresent = false, integrity = { valid: false }, marketChecks = {}, todayUsage = {} } = {}) {
  const checks = [
    check('Entorno paper', config.mode === 'paper', config.mode === 'paper' ? 'El automatizador solo puede ejecutar en paper.' : 'El modo actual no es paper.'),
    check('API key LLM', apiKeyPresent, apiKeyPresent ? 'Clave disponible solo en el proceso principal.' : 'Falta configurar la API key del LLM.'),
    check('Endpoint LLM', /^https:\/\/[^\s]+$/i.test(String(config.endpoint || '')), /^https:\/\/[^\s]+$/i.test(String(config.endpoint || '')) ? 'Endpoint HTTPS válido.' : 'El endpoint debe ser HTTPS.'),
    check('Modelo LLM', Boolean(String(config.model || '').trim()), String(config.model || '').trim() ? `Modelo ${config.model}.` : 'Falta configurar el modelo.'),
    check('Cuenta paper', Number(current.initialCash) > 0 && Number(current.cash) >= 0 && integrity.valid, integrity.valid ? 'Cash, posiciones, órdenes y ledger son íntegros.' : 'La cuenta paper requiere revisión de integridad.'),
    check('Cuenta sin pausa', !current.paused, current.paused ? `Paper pausado: ${current.pauseReason || 'sin razón'}.` : 'La cuenta paper permite nuevas entradas.'),
    check('Moneda de liquidación', ['USD', 'USDT', 'USDC'].includes(current.currency) && current.currency === config.accountCurrency, current.currency === config.accountCurrency ? `Cuenta y configuración usan ${current.currency}.` : 'La moneda de la cuenta no coincide con la configuración.'),
    check('Costes de ejecución', Number(config.feeRate) >= 0 && Number(config.slippageBps) >= 0, 'Comisión y slippage son valores no negativos.'),
    check('Límites de exposición', Number(config.maxOrderPct) > 0 && Number(config.maxOrderPct) <= 100 && Number(config.maxExposurePct) > 0 && Number(config.maxExposurePct) <= 100 && Number(config.maxAssetExposurePct) > 0 && Number(config.maxAssetExposurePct) <= 100, 'Orden y exposiciones están dentro de 0–100%.'),
    check('Ejecución paper', Number(config.partialFillPct) >= 1 && Number(config.partialFillPct) <= 100 && Number(config.maxDataAgeMs) >= 1000 && ['conservative', 'take-first'].includes(config.intrabarPolicy), 'Fill parcial, frescura y política intrabar son válidos.'),
    check('Sin corrida activa', !['running', 'starting'].includes(current.automation?.status), ['running', 'starting'].includes(current.automation?.status) ? 'Ya existe una corrida en curso.' : 'No existe otra corrida activa.'),
    check('Riesgo por operación', Number(config.riskPerTradePct) > 0 && Number(config.riskPerTradePct) <= 5, 'El riesgo por trade está dentro de 0–5%.'),
    check('Stop obligatorio', config.requireStopForAuto === true, config.requireStopForAuto === true ? 'Auto-Paper exige stop protector.' : 'Auto-Paper debe exigir stop protector.'),
    check('Presupuesto diario', Number(todayUsage.calls || 0) < Math.max(1, Number(config.llmDailyCallBudget) || 24) && (Number(config.llmDailyBudgetUsd) <= 0 || Number(todayUsage.estimatedCostUsd || 0) < Number(config.llmDailyBudgetUsd)), 'Quedan llamadas y presupuesto LLM disponibles.')
  ];
  const symbols = Array.isArray(config.automationSymbols) ? config.automationSymbols : [];
  checks.push(check('Símbolos configurados', symbols.length > 0 && symbols.every(symbol => SYMBOL_PATTERN.test(String(symbol))), symbols.length ? `${symbols.length} símbolo(s) configurado(s).` : 'No hay símbolos válidos configurados.'));
  for (const symbol of symbols) {
    const result = marketChecks[String(symbol).toUpperCase()] || {};
    checks.push(check(`Feed ${symbol}`, result.ok && result.quoteFresh && result.marketValid, result.ok ? result.detail : (result.error || 'No hay cotización y velas cerradas válidas.')));
    checks.push(check(`Instrumento ${symbol}`, result.ok && result.instrumentTrading && result.currencyCompatible, result.ok ? result.instrumentDetail : (result.error || 'No se pudieron validar reglas del instrumento.')));
  }
  return { ready: checks.every(item => item.ok), checkedAt: new Date().toISOString(), checks, symbols, marketChecks };
}

module.exports = { SYMBOL_PATTERN, buildAutomationPreflight };
