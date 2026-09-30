// Purple-schedule tuning: node tests/tune.mjs <preset> '<json array of DIFFICULTIES overrides>' [seeds] ['<race config overrides>']
// Uses the first generation attempt of each seed (no rejection sampling) so the
// numbers show what the raw generator + purple produce.
import { buildLevel } from '../js/generation/LevelGenerator.js';
import { validateStructure } from '../js/generation/LevelValidator.js';
import { Simulation } from '../js/core/Simulation.js';
import { resolveRaceConfig, DIFFICULTIES } from '../js/config/presets.js';
import { seedFromIndex } from '../js/core/RNG.js';

const preset = process.argv[2] || 'medium';
const combos = JSON.parse(process.argv[3] || '[{}]');
const N = +(process.argv[4] || 100);
const CFG = JSON.parse(process.argv[5] || '{}');   // race-config overrides, e.g. '{"weaponKills":1}'
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? +a[a.length >> 1].toFixed(1) : null; };
const mean = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;
const base = JSON.stringify(DIFFICULTIES);
for (const combo of combos) {
  const cfg = resolveRaceConfig(preset, CFG);
  Object.assign(DIFFICULTIES[cfg.difficulty], JSON.parse(base)[cfg.difficulty], combo);
  const m = { win: 0, n: 0, dur: [], crush: [], kill: [], stallCrush: 0, allCrush: 0, near: [], margin: [], firstDeath: [], early: 0, wipe: 0 };
  for (let i = 0; i < N; i++) {
    const l = buildLevel(seedFromIndex('TN', i), cfg, 0); if (!l.ok || !validateStructure(l).ok) continue;
    const sim = new Simulation(l); const r = sim.runToEnd(85); m.n++;
    if (r.winner) { m.win++; m.dur.push(r.duration); }
    const dead = r.contestants.filter((c) => c.deathTime !== null);
    m.crush.push(dead.filter((c) => c.deathCause === 'danger').length);
    m.kill.push(dead.filter((c) => c.deathCause === 'kill').length);
    if (dead.length) m.firstDeath.push(Math.min(...dead.map((c) => c.deathTime)));
    m.near.push(r.log.filter((e) => e.type === 'nearMiss').length);
    if (dead.length === 4) m.wipe++;
    const sr = l.route[0];
    for (const e of r.log) if (e.type === 'dangerDeath') { m.allCrush++; if (e.y >= sr.y && e.y <= sr.y + sr.h) m.stallCrush++; }
    if (r.winner) {
      const w = r.contestants.find((c) => c.id === r.winner);
      const others = r.contestants.filter((c) => c.id !== r.winner && c.alive);
      m.margin.push(others.length ? Math.min(...others.map((c) => 1 - c.maxProgress)) : 1);
    }
  }
  console.log(JSON.stringify(combo), '\n   win%', Math.round(100 * m.win / m.n), 'dur', med(m.dur), 'crush', mean(m.crush), 'kill', mean(m.kill),
    'stallShare%', m.allCrush ? Math.round(100 * m.stallCrush / m.allCrush) : '-', 'near', mean(m.near), 'firstDeath', med(m.firstDeath), 'wipe%', Math.round(100 * m.wipe / m.n));
}
