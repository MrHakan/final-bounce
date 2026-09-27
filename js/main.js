// Bootstrap: wire the engine, audio, recorder and creator UI together.
import { EventBus } from './core/EventBus.js';
import { Game } from './core/Game.js';
import { GameLoop } from './core/GameLoop.js';
import { parseQuery } from './core/Share.js';
import { randomSeedString } from './core/RNG.js';
import { resolveRaceConfig } from './config/presets.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Recorder } from './recording/Recorder.js';
import { CreatorPanel } from './ui/CreatorPanel.js';
import { StatsPanel } from './ui/StatsPanel.js';
import { testSeeds } from './dev/DevTools.js';
import { runSelfTests } from './dev/SelfTests.js';
import { findInterestingRace } from './generation/RaceFinder.js';

const bus = new EventBus();
const canvas = document.getElementById('race');
const game = new Game(canvas, bus);
const audio = new AudioEngine();
audio.attach(bus);
const recorder = new Recorder(canvas, audio);

bus.on('state:change', ({ state }) => { if (state === 'COUNTDOWN' && game.view.intro) bus.emit('race:intro', {}); });

const panel = new CreatorPanel({ game, bus, audio, recorder });
new StatsPanel(document.getElementById('stats'), bus, game);

const q = parseQuery(location.search);
const presetId = q.preset || 'medium';
panel.init(presetId);
const cfg = resolveRaceConfig(presetId, q.overrides);
try {
  game.generate(q.seed || randomSeedString(), cfg, presetId);
} catch (err) {
  console.error(err);
  game.generate(randomSeedString(), resolveRaceConfig('medium'), 'medium');
}

const loop = new GameLoop((dt) => { game.fps = loop.fps; game.update(dt); }, () => game.render());
loop.start();

// Developer console access.
window.race = {
  game, bus, audio, recorder, panel,
  testSeeds: (count = 100, overrides = {}) => testSeeds(count, { ...game.raceConfig, ...overrides }, {
    onProgress: (i, n) => { if (i % 50 === 0 || i === n) console.log(`testSeeds ${i}/${n}`); },
  }),
  runSelfTests,
  findInterestingRace: (opts) => findInterestingRace(game.raceConfig, opts),
};
