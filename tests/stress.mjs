// CLI stress test: node tests/stress.mjs [preset] [count]
// Prints the same report as testSeeds() in the developer panel.
import { testSeeds } from '../js/dev/DevTools.js';
import { resolveRaceConfig } from '../js/config/presets.js';

const preset = process.argv[2] || 'medium';
const count = +(process.argv[3] || 100);
const report = await testSeeds(count, resolveRaceConfig(preset), {
  yieldEvery: 0,
  onProgress: (i, n) => { if (i % 100 === 0 || i === n) process.stderr.write(`\r${preset}: ${i}/${n}`); },
});
process.stderr.write('\n');
console.log(JSON.stringify({ preset, ...report }, null, 2));
