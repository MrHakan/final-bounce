// Bootstrap: wire the engine, audio, recorder and creator UI together.
import { EventBus } from './core/EventBus.js';
import { Game } from './core/Game.js';
import { GameLoop } from './core/GameLoop.js';
import { parseQuery } from './core/Share.js';
import { randomSeedString } from './core/RNG.js';
import { resolveRaceConfig } from './config/presets.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Recorder } from './recording/Recorder.js';
import { exportVideo, probeFormats, webCodecsSupported } from './recording/FrameExporter.js';
import { CreatorPanel } from './ui/CreatorPanel.js';
import { StatsPanel } from './ui/StatsPanel.js';
import { testSeeds } from './dev/DevTools.js';
import { runSelfTests } from './dev/SelfTests.js';
import { findInterestingRace } from './generation/RaceFinder.js';

// The canvas HUD uses bundled fonts; make sure they are ready before the first
// frame so recordings never start with fallback glyphs.
try {
  await Promise.race([
    Promise.all(['700 16px "Barlow Condensed"', '600 16px "Barlow Condensed"', '600 16px "IBM Plex Mono"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
} catch { /* fall back to system fonts */ }

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

audio.getIntensity = () => game.intensity;

// While the video exporter drives the game frame by frame the live loop stays out of the way.
const loop = new GameLoop((dt) => { game.fps = loop.fps; if (!game.exporting) game.update(dt); }, () => { if (!game.exporting) game.render(); });
loop.start();

// Developer console access.
window.race = {
  game, bus, audio, recorder, panel,
  testSeeds: (count = 100, overrides = {}) => testSeeds(count, { ...game.raceConfig, ...overrides }, {
    onProgress: (i, n) => { if (i % 50 === 0 || i === n) console.log(`testSeeds ${i}/${n}`); },
  }),
  runSelfTests,
  exportVideo: (opts) => exportVideo(game, audio, opts),
  probeFormats,
  webCodecsSupported,
  findInterestingRace: (opts) => findInterestingRace(game.raceConfig, opts),
};
