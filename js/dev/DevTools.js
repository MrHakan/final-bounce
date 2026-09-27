// Developer statistics: generation stress test and colour fairness.
// testSeeds(1000) -> valid/invalid maps, retries, durations, stuck races,
// no-winner races, wins by colour, average entertainment score.
import { generateLevel } from '../generation/LevelGenerator.js';
import { seedFromIndex } from '../core/RNG.js';
import { COLOR_IDS } from '../config/presets.js';

export async function testSeeds(count = 100, cfg, { onProgress, prefix = 'STRESS', yieldEvery = 5, signal } = {}) {
  const t0 = (globalThis.performance || Date).now();
  const r = {
    count: 0, validMaps: 0, invalidMaps: 0, generationRetries: 0, acceptedRaces: 0,
    totalDuration: 0, races: 0, stuckRaces: 0, noWinnerRaces: 0, antiStuckEvents: 0,
    winsByColor: Object.fromEntries(COLOR_IDS.map((c) => [c, 0])), totalScore: 0,
    rejectReasons: {}, kills: 0, weaponPickups: 0,
  };
  for (let i = 0; i < count; i++) {
    if (signal && signal.aborted) break;
    const seed = seedFromIndex(prefix, i);
    const g = generateLevel(seed, cfg, { forceTestRun: true });
    r.count++;
    r.generationRetries += g.attempts - 1;
    for (const rej of g.rejected) {
      const k = rej.reason.replace(/\s*\(.*\)/, '');
      r.rejectReasons[k] = (r.rejectReasons[k] || 0) + 1;
    }
    if (!g.level) { r.invalidMaps++; continue; }
    r.validMaps++;
    if (g.accepted) r.acceptedRaces++;
    const res = g.result;
    if (res) {
      r.races++;
      r.totalDuration += res.duration;
      if (res.endReason === 'timeout') r.stuckRaces++;
      if (!res.winner) r.noWinnerRaces++; else r.winsByColor[res.winner]++;
      const stuck = res.log.filter((e) => e.type === 'antiStuck').length;
      r.antiStuckEvents += stuck;
      r.kills += res.log.filter((e) => e.type === 'kill').length;
      if (res.log.some((e) => e.type === 'weaponPickup')) r.weaponPickups++;
      r.totalScore += g.score.score;
    }
    if (onProgress) onProgress(i + 1, count);
    if (yieldEvery && (i + 1) % yieldEvery === 0) await new Promise((res2) => setTimeout(res2, 0));
  }
  const n = Math.max(1, r.races);
  return {
    seeds: r.count,
    validMaps: r.validMaps,
    invalidMaps: r.invalidMaps,
    acceptedFirstPass: r.acceptedRaces,
    generationRetries: r.generationRetries,
    avgRetries: +(r.generationRetries / Math.max(1, r.count)).toFixed(2),
    averageRaceDuration: +(r.totalDuration / n).toFixed(1),
    stuckRaces: r.stuckRaces,
    noWinnerRaces: r.noWinnerRaces,
    winsByColor: r.winsByColor,
    winShare: Object.fromEntries(Object.entries(r.winsByColor).map(([k, v]) => [k, +((100 * v) / Math.max(1, n - r.noWinnerRaces)).toFixed(1)])),
    averageEntertainmentScore: +(r.totalScore / n).toFixed(1),
    antiStuckPerRace: +(r.antiStuckEvents / n).toFixed(2),
    killsPerRace: +(r.kills / n).toFixed(2),
    weaponPickupRate: +((100 * r.weaponPickups) / n).toFixed(1),
    rejectReasons: r.rejectReasons,
    ms: Math.round((globalThis.performance || Date).now() - t0),
  };
}
