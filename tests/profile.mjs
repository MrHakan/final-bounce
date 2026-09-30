// Race-quality profile: node tests/profile.mjs [preset] [count]
// Prints where time goes and where racers die, so level changes can be judged with data.
import { generateLevel } from '../js/generation/LevelGenerator.js';
import { resolveRaceConfig } from '../js/config/presets.js';
import { seedFromIndex } from '../js/core/RNG.js';

const preset = process.argv[2] || 'medium';
const n = +(process.argv[3] || 100);
const cfg = resolveRaceConfig(preset);
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? +a[a.length >> 1].toFixed(1) : null; };
const mean = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;
const acc = { dur: [], deaths: [], crush: [], kills: [], near: [], lead: [], quiet: [], gaps: [], winMargin: [], firstDeath: [], bandDeath: {}, attempts: [], score: [] };
let noWin = 0, tot = 0;
for (let i = 0; i < n; i++) {
  const g = generateLevel(seedFromIndex('PROF', i), cfg, { forceTestRun: true });
  if (!g.level || !g.result) continue;
  tot++;
  const r = g.result;
  acc.attempts.push(g.attempts);
  acc.dur.push(r.duration);
  if (!r.winner) noWin++;
  const dead = r.contestants.filter((c) => c.deathTime !== null);
  acc.deaths.push(dead.length);
  acc.crush.push(dead.filter((c) => c.deathCause === 'danger').length);
  acc.kills.push(dead.filter((c) => c.deathCause === 'kill').length);
  acc.near.push(r.log.filter((e) => e.type === 'nearMiss').length);
  acc.lead.push(r.leadChanges);
  acc.score.push(g.score.score);
  acc.quiet.push(g.score.longestQuiet);
  if (dead.length) acc.firstDeath.push(Math.min(...dead.map((c) => c.deathTime)));
  for (const e of r.log) if (e.type === 'dangerDeath' || e.type === 'kill') {
    const cell = g.level.route.findIndex((c) => e.x >= c.x && e.x < c.x + c.w && e.y >= c.y && e.y < c.y + c.h);
    const k = (g.level.route[cell] && (g.level.route[cell].kind || g.level.route[cell].template)) || '?';
    acc.bandDeath[k + ':' + e.type] = (acc.bandDeath[k + ':' + e.type] || 0) + 1;
  }
}
console.log(JSON.stringify({
  preset, races: tot, noWinner: noWin, avgAttempts: mean(acc.attempts),
  duration: { median: med(acc.dur), mean: mean(acc.dur) },
  perRace: { deaths: mean(acc.deaths), crushed: mean(acc.crush), kills: mean(acc.kills), nearMisses: mean(acc.near), leadChanges: mean(acc.lead) },
  firstDeathMedian: med(acc.firstDeath), longestQuietMedian: med(acc.quiet), scoreMean: mean(acc.score),
  deathsByPlace: acc.bandDeath,
}, null, 1));
