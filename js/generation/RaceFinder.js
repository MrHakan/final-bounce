// "Generate interesting race": sample candidate seeds, simulate each headless
// (no rendering), score it, keep the best. Bounded and cancellable; yields to
// the browser between candidates so the UI can show progress.
import { generateLevel } from './LevelGenerator.js';
import { randomSeedString } from '../core/RNG.js';

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export async function findInterestingRace(cfg, { candidates = 50, threshold = 70, onProgress, signal, seedSource = () => randomSeedString() } = {}) {
  let best = null;
  const tried = [];
  for (let i = 0; i < candidates; i++) {
    if (signal && signal.aborted) break;
    const seed = seedSource(i);
    const gen = generateLevel(seed, cfg, { forceTestRun: true });
    const score = gen.score ? gen.score.score : 0;
    const valid = !!gen.level && gen.accepted;
    tried.push({ seed, score, valid });
    if (gen.level && (!best || (valid && !best.valid) || (valid === best.valid && score > best.score))) best = { seed, score, valid, gen };
    onProgress && onProgress({ i: i + 1, candidates, seed, score, best });
    if (best && best.valid && best.score >= threshold) break;
    await nextFrame();
  }
  return { best, tried };
}
