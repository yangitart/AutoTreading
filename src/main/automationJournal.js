function createAutomationRun(runId, symbols = [], startedAt = new Date().toISOString()) {
  return { runId, startedAt, symbols: [...symbols], status: 'running', events: [] };
}

function updateAutomationRun(history = [], runId, changes = {}) {
  return history.map(run => {
    if (run.runId !== runId) return run;
    const { event, ...fields } = changes, events = event ? [...(run.events || []), { ...event, at: event.at || new Date().toISOString() }].slice(-100) : run.events || [];
    return { ...run, ...fields, events };
  });
}

function recoverStaleAutomation(history = [], now = Date.now(), maxAgeMs = 120000) {
  let recovered = false;
  const next = history.map(run => {
    const heartbeat = new Date(run.heartbeatAt || run.startedAt || 0).getTime();
    if (run.status !== 'running' || !Number.isFinite(heartbeat) || now - heartbeat <= maxAgeMs) return run;
    recovered = true;
    return { ...run, status: 'interrupted', interruptedAt: new Date(now).toISOString(), events: [...(run.events || []), { action: 'interrupted', reason: 'No hubo heartbeat antes de recuperar el estado.', at: new Date(now).toISOString() }].slice(-100) };
  });
  return { recovered, history: next };
}

module.exports = { createAutomationRun, updateAutomationRun, recoverStaleAutomation };
