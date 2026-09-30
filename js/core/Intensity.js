// Race tension (0..1): how close the purple is to a racer, how far the leader has
// climbed, whether the blade is out. It drives the score and is smoothed with the
// presentation dt, so it is identical when the exporter steps the game at a fixed
// frame rate. Pure function of the simulation state: easy to test headless.
export function targetIntensity(sim) {
  let minGap = Infinity, lead = 0;
  for (const c of sim.contestants) {
    if (!c.active) continue;
    if (c.dangerGap < minGap) minGap = c.dangerGap;
    if (c.progress > lead) lead = c.progress;
  }
  const pressure = isFinite(minGap) ? Math.max(0, Math.min(1, 1 - minGap / 160)) : 0;
  const late = Math.max(0, Math.min(1, (lead - 0.55) / 0.4));
  const armed = sim.weapon && sim.weapon.state === 'held' ? 0.15 : 0;
  return Math.min(1, 0.12 + 0.5 * pressure + 0.3 * late + armed);
}

export function smoothIntensity(current, sim, dt) {
  return current + (targetIntensity(sim) - current) * (1 - Math.exp(-dt / 0.9));
}
