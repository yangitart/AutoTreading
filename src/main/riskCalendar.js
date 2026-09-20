function resetDailyRisk(current = {}, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (current.dailyLossDate === today) return false;
  current.dailyLoss = 0;
  current.dailyLossDate = today;
  return true;
}

module.exports = { resetDailyRisk };
