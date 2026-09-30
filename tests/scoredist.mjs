import { generateLevel } from '../js/generation/LevelGenerator.js';
import { resolveRaceConfig } from '../js/config/presets.js';
import { seedFromIndex } from '../js/core/RNG.js';
for (const preset of (process.argv[2] || 'medium').split(',')) {
  const cfg = resolveRaceConfig(preset); const sc = []; const parts = {};
  for (let i = 0; i < +(process.argv[3] || 100); i++) {
    const g = generateLevel(seedFromIndex('SC', i), cfg, { forceTestRun: true }); if (!g.score) continue;
    sc.push(g.score.score);
    for (const [k, v] of Object.entries(g.score.parts)) parts[k] = (parts[k] || 0) + v;
  }
  sc.sort((a, b) => a - b); const n = sc.length;
  console.log(preset, 'n', n, 'mean', (sc.reduce((a, b) => a + b, 0) / n).toFixed(1), 'p10', sc[Math.floor(n * .1)], 'p50', sc[n >> 1], 'p90', sc[Math.floor(n * .9)], 'max', sc[n - 1], 'parts(avg)', Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +(v / n).toFixed(1)])));
}
