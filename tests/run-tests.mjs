// Node test runner: `node tests/run-tests.mjs`
import { runSelfTests } from '../js/dev/SelfTests.js';
import { testSeeds } from '../js/dev/DevTools.js';
import { resolveRaceConfig } from '../js/config/presets.js';

const results = runSelfTests(process.argv[2] || null);
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)${r.pass ? '' : '\n      ' + r.detail}`);
  if (!r.pass) failed++;
}
if (!process.argv[2]) {
  const report = await testSeeds(+(process.env.STRESS || 60), resolveRaceConfig('medium'), { yieldEvery: 0 });
  console.log('\nStress test (medium preset):', JSON.stringify(report, null, 2));
  if (report.invalidMaps > 0) { console.log('FAIL  stress test produced invalid maps'); failed++; }
}
console.log(`\n${results.length - failed}/${results.length} self-tests passed`);
process.exit(failed ? 1 : 0);
