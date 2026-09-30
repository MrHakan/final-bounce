// Automatic map validation: structural checks on the generated geometry plus a
// verdict on the headless test race.
import { PHYSICS, COLOR_IDS } from '../config/presets.js';

export function validateStructure(level) {
  const f = level.field;
  const problems = [];
  const r = level.grid.contestantSize / 2;

  // Spawns must be in free space, reachable, and not overlapping each other.
  for (const s of level.spawns) {
    if (!f.isFreeAt(s.x, s.y)) problems.push(`spawn ${s.id} inside geometry`);
    if (!isFinite(f.distAt(s.x, s.y))) problems.push(`spawn ${s.id} unreachable`);
  }
  for (let i = 0; i < level.spawns.length; i++) for (let j = i + 1; j < level.spawns.length; j++) {
    const a = level.spawns[i], b = level.spawns[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 2 * r + 1) problems.push('spawns overlap');
  }
  // Finish reachable from start through a contestant-sized corridor.
  if (!isFinite(f.totalLength)) problems.push('finish unreachable');
  // Weapon reachable.
  if (level.weapon && !isFinite(f.distAt(level.weapon.x, level.weapon.y))) problems.push('weapon unreachable');
  // Every door must be passable (door centre reachable in configuration space).
  for (const d of level.doors) {
    if (d.merged) continue;
    const mid = (d.a + d.b) / 2;
    const [x, y] = d.orient === 'h' ? [mid, d.pos] : [d.pos, mid];
    if (!isFinite(f.distAt(x, y))) problems.push(`door ${d.index} blocked`);
  }
  // Final barriers must exist and be reachable.
  const finals = level.barriers.filter((b) => b.role === 'final');
  if (finals.length < 3) problems.push('final plug missing');
  for (const b of finals) if (!isFinite(f.distAt(b.x + b.w / 2, b.y + b.h / 2))) { problems.push('final gate unreachable'); break; }
  // Puzzle rule: every colour owns at least one gate. (A dead colour's gates
  // turn neutral in the simulation, so this can never softlock.)
  const gateColors = new Set(level.barriers.filter((b) => b.role === 'gate' || b.role === 'stall').map((b) => b.color));
  for (const id of COLOR_IDS) if (!gateColors.has(id)) problems.push(`no ${id} gate`);
  // Geometry sanity: nothing outside the world, no degenerate pieces.
  for (const w of level.walls) {
    if (w.w <= 0 || w.h <= 0) { problems.push('degenerate wall'); break; }
    if (w.x < -1 || w.y < -1 || w.x + w.w > level.width + 1 || w.y + w.h > level.height + 1) { problems.push('wall outside world'); break; }
  }
  // Danger must not start on top of the contestants.
  if (level.params.danger.delay < 0.8) problems.push('danger delay too short');
  if (f.unreachable > f.freeCount * 0.15) problems.push('large unreachable pockets');
  return { ok: problems.length === 0, problems };
}

// Viability of the headless test race.
export function judgeRace(result, cfg) {
  const early = result.contestants.filter((c) => c.deathTime !== null && c.deathTime < 4).length;
  const best = Math.max(...result.contestants.map((c) => c.maxProgress));
  const quality = best * 50 + (result.winner ? 40 : 0) - early * 10 -
    (result.duration > cfg.maxDuration ? (result.duration - cfg.maxDuration) : 0) -
    (result.duration < cfg.minDuration ? (cfg.minDuration - result.duration) * 2 : 0);
  if (early === result.contestants.length) return { ok: false, reason: 'everyone died immediately', quality };
  if (best < 0.3) return { ok: false, reason: 'nobody progressed', quality };
  if (result.endReason === 'timeout') return { ok: false, reason: 'timeout (stuck race)', quality };
  if (!result.winner) return { ok: false, reason: 'no winner', quality };
  if (result.duration > cfg.maxDuration + PHYSICS.postWinSeconds) return { ok: false, reason: `too long (${result.duration.toFixed(1)}s)`, quality };
  if (result.duration < cfg.minDuration) return { ok: false, reason: `too short (${result.duration.toFixed(1)}s)`, quality };
  return { ok: true, reason: 'ok', quality };
}
