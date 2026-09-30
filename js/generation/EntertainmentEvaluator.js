// Entertainment score (0-100) computed from a finished headless race.
//
// Every part is capped so a single noisy stat cannot saturate the score, and
// the raw parts are stretched (x1.25 - 15) so that a typical race scores
// 55-70 and only races with tension, conflict AND a dramatic finish reach 80+.
//
//   pacing     0-8   fits the preset's target duration
//   tension    0-20  near misses that were survived, and how close the closest was
//   conflict   0-21  blade pickup, kills, racers crushed after the opening
//   finish     0-16  runner-up close behind, winner barely ahead of the purple
//   turnover   0-8   the lead changed hands
//   puzzle     0-6   gates opened, the plug dug through
//   depth      0-8   several racers made it deep into the tower
//
// Penalties: instant wipes, no winner, stalled racers, dead air, one racer
// leading wire to wire.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function evaluateRace(result, level, cfg) {
  const log = result.log;
  const dur = result.duration;
  const parts = {};
  const ofType = (t) => log.filter((e) => e.type === t);

  // pacing
  const lo = cfg.minDuration, hi = cfg.maxDuration;
  const off = dur < lo ? lo - dur : dur > hi ? dur - hi : 0;
  parts.pacing = Math.round(clamp(8 - off * 0.8, 0, 8));

  // tension
  const misses = ofType('nearMiss');
  const escapes = misses.filter((e) => survived(result, e.actor, e.time + 1.5));
  const closest = escapes.length ? Math.min(...escapes.map((e) => e.gap)) : Infinity;
  parts.tension = Math.min(14, escapes.length * 1.5) + (closest <= 6 ? 6 : closest <= 12 ? 3 : 0);

  // conflict
  const pickup = log.find((e) => e.type === 'weaponPickup');
  const crushed = ofType('dangerDeath').filter((e) => e.time > 4).length;
  parts.conflict = (pickup ? (pickup.time < dur * 0.6 ? 6 : 3) : 0) + Math.min(2, ofType('kill').length) * 5 + Math.min(2, crushed) * 2.5;

  // finish
  parts.finish = 0;
  if (result.winner) {
    const others = result.contestants.filter((c) => c.id !== result.winner);
    const second = Math.max(0, ...others.map((c) => (c.finished ? 1 : c.alive ? c.maxProgress : 0)));
    parts.finish += Math.round(clamp(1 - (1 - second) / 0.25, 0, 1) * 10);
    const win = ofType('finish').find((e) => e.place === 1);
    if (win && win.gap !== undefined) parts.finish += win.gap < 60 ? 6 : win.gap < 140 ? 3 : 0;
  }

  // turnover
  parts.turnover = Math.min(8, Math.floor(result.leadChanges / 2));

  // puzzle
  const gateBreaks = ofType('barrierBreak').filter((e) => e.role === 'gate' || e.role === 'stall').length;
  const plugBreaks = ofType('finalBreak').length;
  parts.puzzle = Math.min(3, gateBreaks * 0.75) + Math.min(3, plugBreaks * 1.5);

  // depth
  const deep = result.contestants.filter((c) => c.maxProgress > 0.75).length;
  parts.depth = Math.max(0, deep - 1) * 4;

  // penalties
  const pen = {};
  const earlyDeaths = result.contestants.filter((c) => c.deathTime !== null && c.deathTime < 3).length;
  if (earlyDeaths === result.contestants.length) pen.instantWipe = -50;
  else if (earlyDeaths > 0) pen.earlyDeaths = -6 * earlyDeaths;
  if (!result.winner) pen.noWinner = -25;
  const best = Math.max(...result.contestants.map((c) => c.maxProgress));
  if (best < 0.3) pen.noProgress = -40;
  pen.stuck = -Math.min(15, ofType('antiStuck').length * 3);
  if (result.endReason === 'timeout') pen.timeout = -20;

  // Dead air: the longest stretch without a notable event.
  const beats = log.filter((e) => ['weaponPickup', 'kill', 'dangerDeath', 'nearMiss', 'barrierBreak', 'finalBreak', 'finish'].includes(e.type)).map((e) => e.time);
  beats.unshift(0); beats.push(dur);
  let gap = 0;
  for (let i = 1; i < beats.length; i++) gap = Math.max(gap, beats[i] - beats[i - 1]);
  pen.deadAir = gap > 5 ? -Math.round(Math.min(20, (gap - 5) * 3)) : 0;

  // One racer in front from the first seconds to the last.
  if (result.winner && result.leadChanges <= 1 && dur > 10) pen.dominance = -10;

  let score = 0;
  for (const v of Object.values(parts)) score += v;
  for (const v of Object.values(pen)) score += v;
  // Stretch: typical races land around 60, the best ones in the 80s.
  score = Math.round(clamp(score * 1.25 - 15, 0, 100));
  return { score, parts, penalties: pen, longestQuiet: gap };
}

function survived(result, id, t) {
  const c = result.contestants.find((x) => x.id === id);
  return c && (c.deathTime === null || c.deathTime > t);
}
