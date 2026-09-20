function safeAutomationStartup(settings = {}, automation = {}, now = Date.now()) {
  const reason = 'Inicio seguro: Auto-Paper permanece pausado hasta ejecutar el preflight.';
  return { settings: { ...settings, automationEnabled: false }, automation: { ...automation, status: 'paused', pausedReason: reason, heartbeatAt: new Date(now).toISOString() } };
}

module.exports = { safeAutomationStartup };
