// How long does the starting-stall puzzle take? (purple disabled)
import { buildLevel } from '../js/generation/LevelGenerator.js';
import { validateStructure } from '../js/generation/LevelValidator.js';
import { Simulation } from '../js/core/Simulation.js';
import { resolveRaceConfig } from '../js/config/presets.js';
import { seedFromIndex } from '../js/core/RNG.js';
const cfg = resolveRaceConfig('medium', { dangerSpeed: 0, weaponEnabled: false });
const rows = [];
for (let i = 0; i < +(process.argv[2] || 60); i++) {
  const l = buildLevel(seedFromIndex('SP', i), cfg, 0); if (!l.ok || !validateStructure(l).ok) continue;
  const sim = new Simulation(l);
  const band0 = l.route[0];
  const inBand0 = (c) => c.x >= band0.x && c.x < band0.x + band0.w && c.y >= band0.y && c.y < band0.y + band0.h;
  const sr = l.stallRect;
  const inLanes = (c) => c.x >= sr.x && c.x <= sr.x + sr.w;
  let tLanesFree = null, tFirstOut = null, tAllOut = null, stallBreaks = [];
  while (!sim.ended && sim.time < 90) {
    sim.step();
    for (const e of sim.events) if (e.type === 'barrierBreak' && e.role === 'stall') stallBreaks.push(sim.time);
    const alive = sim.contestants.filter((c) => c.alive);
    if (tLanesFree === null && alive.length && alive.every((c) => !inLanes(c))) tLanesFree = sim.time;
    const out = alive.filter((c) => !inBand0(c)).length;
    if (out && tFirstOut === null) tFirstOut = sim.time;
    if (alive.length && out === alive.length) { tAllOut = sim.time; break; }
  }
  rows.push({ rounds: l.stall.rounds, tLanesFree, tFirstOut, tAllOut, firstBreak: stallBreaks[0], lastBreak: stallBreaks[stallBreaks.length - 1], len: l.route[0].w });
}
const q = (a, p) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : null; };
for (const k of ['firstBreak', 'lastBreak', 'tLanesFree', 'tFirstOut', 'tAllOut']) console.log(k.padEnd(11), 'p25', q(rows.map((r) => r[k]), 0.25), 'p50', q(rows.map((r) => r[k]), 0.5), 'p75', q(rows.map((r) => r[k]), 0.75), 'p90', q(rows.map((r) => r[k]), 0.9));
for (const rd of [2, 3, 4]) { const s = rows.filter((r) => r.rounds === rd); if (s.length) console.log('rounds', rd, 'n', s.length, 'lanesFree p50', q(s.map((r) => r.tLanesFree), 0.5), 'allOut p50', q(s.map((r) => r.tAllOut), 0.5)); }
