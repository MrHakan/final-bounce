// Central configuration. Anything in RACE_DEFAULTS influences the simulation
// and is part of the replay key (seed + race config). Presentation settings
// (camera, particles, audio...) live in VIEW_DEFAULTS and never affect physics.

export const SIM_HZ = 120;
export const DT = 1 / SIM_HZ;

// Logical resolution. The canvas renders at 2x (1080x1920).
export const VIEW_W = 540;
export const VIEW_H = 960;
export const RENDER_SCALE = 2;

export const CONTESTANTS = [
  { id: 'red',    name: 'RED',    color: '#e63946', light: '#f4a3a9', dark: '#7d1a22', pitch: 0 },
  { id: 'blue',   name: 'BLUE',   color: '#1bb3d9', light: '#9adcec', dark: '#0d5a6e', pitch: 3 },
  { id: 'yellow', name: 'YELLOW', color: '#f5c518', light: '#fae38f', dark: '#7c620a', pitch: 7 },
  { id: 'green',  name: 'GREEN',  color: '#3cb44b', light: '#a3dcaa', dark: '#1d5a25', pitch: 10 },
];
export const COLOR_IDS = CONTESTANTS.map((c) => c.id);
export const contestantById = (id) => CONTESTANTS.find((c) => c.id === id);

// Course layout constants (logical px). The top band holds the HUD, the bottom
// band stays clear because Instagram draws captions there.
export const LAYOUT = {
  wallT: 6,             // side walls
  slabT: 12,            // floors / ceilings between halls
  contestantSize: 12,
  topMargin: 118,
  bottomMargin: 132,
};

// The tower: number of set-piece halls between the stalls and the finish, and
// how many brick gates (besides the stalls and the final plug) close the way.
// Everything else (stalls, plug, finish) is always present.
export const TOWER = {
  standard: {
    mid:   { low: 2, medium: 3, high: 4 },
    gates: { low: [1, 1], medium: [1, 2], high: [2, 3] },
  },
  long: {
    mid:   { low: 5, medium: 7, high: 9 },
    gates: { low: [2, 3], medium: [3, 4], high: [4, 5] },
    // A long race lasts ~1.7x longer, so the purple's time-based ramp is flattened.
    purple: { accel: 0.35, rate: 0.9 },
  },
  width: [380, 470],     // tower width range
};

// Purple pursuit, in geodesic course px. rate(t) = v0 + accel * (t - delay),
// plus a catch-up term when the rearmost survivor gets too far ahead.
export const DIFFICULTIES = {
  // The purple crawls while the racers are still locked in their lanes, then
  // closes in on the LAST racer: base rate + a catch-up term that grows with
  // the distance between the front and the rearmost survivor.
  //   delay   : seconds before the flood starts to rise
  //   v0/accel: base rate (px/s) and its growth per second
  //   catchGap: how far ahead of the front the last racer may be before the
  //             front speeds up; catchK: px/s gained per px beyond that
  easy:   { v0: 8,    accel: 0.4,  delay: 9,   catchGap: 60, catchK: 0.8, maxRate: 130 },
  normal: { v0: 11,   accel: 0.6,  delay: 7.5, catchGap: 40, catchK: 1.2, maxRate: 170 },
  hard:   { v0: 12.5, accel: 0.75, delay: 7,   catchGap: 34, catchK: 1.4, maxRate: 185 },
  chaos:  { v0: 14,   accel: 0.9,  delay: 6.5, catchGap: 30, catchK: 1.5, maxRate: 200 },
};

export const RACE_DEFAULTS = {
  difficulty: 'normal',
  dangerSpeed: 1.0,        // multiplier on the purple schedule
  contestantSpeed: 1.0,    // multiplier on base speed
  complexity: 'medium',
  barrierDensity: 'medium',
  mapLength: 'standard',
  weaponEnabled: true,
  weaponKills: 1,          // 0 = unlimited
  raceMode: 'first',       // 'first' | 'survivors'
  coursePull: 1.0,         // strength of the course current (0 = pure billiards)
  finalHp: 0,              // 0 = auto (1-4 by difficulty/generation)
  validateRace: true,      // headless test-run candidate layouts and reject bad ones
  minDuration: 12,
  maxDuration: 45,
};

export const PHYSICS = {
  baseSpeed: 165,
  speedVariation: 0.02,    // +-2% per contestant
  speedRamp: 0.004,        // +0.4% per second
  maxSpeedFactor: 1.18,
  pull: 140,               // px/s^2 course current (only on backward-heading racers)
  bounceBias: 0.35,        // ricochet blend toward the course direction
  minAxisAngle: 0.12,      // rad; keeps contestants from endless axis-aligned ping-pong
  postWinSeconds: 0.6,
  timeout: 75,
};

export const PRESETS = {
  short: {
    label: 'Short reel (20-30s)',
    race: { complexity: 'low', difficulty: 'normal', dangerSpeed: 1.2, barrierDensity: 'low', minDuration: 14, maxDuration: 31 },
  },
  medium: {
    label: 'Medium reel (25-40s)',
    race: { complexity: 'medium', difficulty: 'normal', barrierDensity: 'medium', minDuration: 20, maxDuration: 42 },
  },
  chaos: {
    label: 'Chaos',
    race: { complexity: 'high', difficulty: 'chaos', barrierDensity: 'high', coursePull: 1.15, contestantSpeed: 1.1, minDuration: 14, maxDuration: 42 },
  },
  close: {
    label: 'Close race',
    race: { complexity: 'medium', difficulty: 'hard', barrierDensity: 'medium', weaponKills: 1, raceMode: 'first', minDuration: 18, maxDuration: 40 },
  },
  pursuit: {
    label: 'Hard pursuit',
    race: { complexity: 'medium', difficulty: 'hard', dangerSpeed: 1.2, barrierDensity: 'low', minDuration: 15, maxDuration: 38 },
  },
  long: {
    label: 'Long course (follow cam)',
    race: { complexity: 'medium', mapLength: 'long', difficulty: 'normal', barrierDensity: 'medium', minDuration: 30, maxDuration: 72 },
  },
};

export function resolveRaceConfig(presetId, overrides = {}) {
  const preset = PRESETS[presetId] || PRESETS.medium;
  return { ...RACE_DEFAULTS, ...preset.race, ...overrides };
}

export const VIEW_DEFAULTS = {
  camera: 'auto',          // auto | static | follow-leader | follow-pack
  closeCam: true,          // auto camera follows the racers up close on every map (optional)
  particles: true,
  trails: true,
  shake: true,
  textOverlays: true,
  hud: true,
  hook: true,              // non-blocking title over the first seconds of the race
  intro: false,            // blocking 'WHO WILL SURVIVE?' card with the four names
  cta: 'WHO WINS THE NEXT ONE?',  // small line on the result card ('' to hide)
  countdown: false,
  safeArea: false,
  debug: false,
  deathMarkers: false,
  speed: 1,
};

// Short URL keys for shareable race links.
export const URL_KEYS = {
  difficulty: 'd', dangerSpeed: 'ds', contestantSpeed: 'cs', complexity: 'cx',
  barrierDensity: 'bd', mapLength: 'ml', weaponEnabled: 'w', weaponKills: 'wk',
  raceMode: 'rm', coursePull: 'cp', finalHp: 'hp', validateRace: 'v',
  minDuration: 'dmin', maxDuration: 'dmax',
};
