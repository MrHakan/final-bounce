// Entertainment score (0-100) computed from a finished headless race.
// Rewards emergent drama; penalises dead air, dominance and broken races.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function evaluateRace(result, level, cfg) {
  const log = result.log;
  const dur = result.duration;
  const parts = {};
  const count = (type) => log.filter((e) => e.type === type).length;

  const pickup = log.find((e) => e.type === 'weaponPickup');
  parts.weapon = pickup ? (pickup.time < dur * 0.7 ? 8 : 4) : 0;
  const kills = count('kill');
  parts.kills = Math.min(2, kills) * 9;

  const dangerDeaths = log.filter((e) => e.type === 'dangerDeath');
  parts.eliminations = dangerDeaths.filter((e) => e.time > 3).length * 5;

  // Near misses only count if the contestant was still alive 1.5 s later.
  const escapes = log.filter((e) => e.type === 'nearMiss' && survived(result, e.actor, e.time + 1.5)).length;
  parts.closeCalls = Math.min(5, escapes) * 4;

  parts.leadChanges = Math.min(6, result.leadChanges) * 3;

  const colourBreaks = count('barrierBreak');
  const finalBreaks = count('finalBreak');
  parts.destruction = Math.min(12, colourBreaks * 1.5) + (finalBreaks > 0 ? 6 : 0);

  // Late-stage drama: how many contestants made it deep into the course.
  const deep = result.contestants.filter((c) => c.maxProgress > 0.75).length;
  parts.lateStage = Math.max(0, deep - 1) * 5;

  // Close finish: second-best progress when the winner crossed.
  parts.closeFinish = 0;
  if (result.winner) {
    const others = result.contestants.filter((c) => c.id !== result.winner);
    const second = Math.max(0, ...others.map((c) => (c.finished ? 1 : c.maxProgress)));
    parts.closeFinish = Math.round(clamp(1 - (1 - second) / 0.3, 0, 1) * 10);
    // Winner barely escaping purple.
    const winnerMiss = log.some((e) => e.type === 'nearMiss' && e.actor === result.winner && e.time > dur * 0.4);
    if (winnerMiss) parts.closeFinish += 6;
  }

  // Duration fit.
  const lo = cfg.minDuration, hi = cfg.maxDuration;
  parts.pacing = dur >= lo && dur <= hi ? 10 : -Math.round(Math.min(15, dur < lo ? (lo - dur) * 2 : (dur - hi)));

  // Penalties.
  const pen = {};
  const earlyDeaths = result.contestants.filter((c) => c.deathTime !== null && c.deathTime < 3).length;
  if (earlyDeaths === result.contestants.length) pen.instantWipe = -50;
  else if (earlyDeaths > 0) pen.earlyDeaths = -6 * earlyDeaths;
  if (!result.winner) pen.noWinner = -25;
  const best = Math.max(...result.contestants.map((c) => c.maxProgress));
  if (best < 0.3) pen.noProgress = -40;
  pen.stuck = -Math.min(15, count('antiStuck') * 3);
  if (result.endReason === 'timeout') pen.timeout = -20;

  // Dead air: longest gap between major beats.
  const beats = log.filter((e) => ['weaponPickup', 'kill', 'dangerDeath', 'nearMiss', 'barrierBreak', 'finalBreak', 'finish', 'leadChange'].includes(e.type)).map((e) => e.time);
  beats.unshift(0); beats.push(dur);
  let gap = 0;
  for (let i = 1; i < beats.length; i++) gap = Math.max(gap, beats[i] - beats[i - 1]);
  pen.deadAir = gap > 7 ? -Math.round(Math.min(20, (gap - 7) * 2)) : 0;

  // Dominance: winner led from the first seconds with no lead changes.
  if (result.winner && result.leadChanges === 0 && dur > 10) pen.dominance = -10;

  let score = 0;
  for (const v of Object.values(parts)) score += v;
  for (const v of Object.values(pen)) score += v;
  score = Math.round(clamp(score, 0, 100));
  return { score, parts, penalties: pen, longestQuiet: gap };
}

function survived(result, id, t) {
  const c = result.contestants.find((x) => x.id === id);
  return c && (c.deathTime === null || c.deathTime > t);
}
