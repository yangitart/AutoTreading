function createSingleFlight(task) {
  let active = null;
  const run = (...args) => {
    if (active) return active;
    active = Promise.resolve().then(() => task(...args)).finally(() => { active = null; });
    return active;
  };
  run.isRunning = () => active !== null;
  return run;
}

module.exports = { createSingleFlight };
