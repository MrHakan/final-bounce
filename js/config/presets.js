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

// Course grid layout (logical px). Top band holds the HUD, bottom band is kept
// clear because Instagram draws captions there.
export const LAYOUT = {
  cols: 4,
  cellW: 122,
  cellH: 108,
  originX: 26,
  originY: 118,
  bottomPad: 192,
  wallT: 6,
  contestantSize: 12,
};

export const MAP_LENGTHS = {
  standard: { rows: 6 },   // fits the 9:16 frame (static camera)
  long: { rows: 10 },      // taller than the frame (follow camera)
};

export const COMPLEXITY = {
  low:    { route: [7, 8],   obstacle: 0.55, openDoor: 0.18 },
  medium: { route: [8, 11],  obstacle: 0.8,  openDoor: 0.12 },
  high:   { route: [10, 13], obstacle: 1.0,  openDoor: 0.08 },
};
export const LONG_COMPLEXITY = {
  low:    { route: [10, 13] },
  medium: { route: [13, 17] },
  high:   { route: [17, 21] },
};

export const BARRIER_DENSITY = {
  low:    { gates: [1, 2], roomBarriers: [0, 1] },   // + the starting stalls (all colours)
  medium: { gates: [2, 3], roomBarriers: [1, 2] },
  high:   { gates: [3, 4], roomBarriers: [2, 3] },
};

// Purple pursuit, in geodesic course px. rate(t) = v0 + accel * (t - delay),
// plus a catch-up term when the rearmost survivor gets too far ahead.
export const DIFFICULTIES = {
  // The purple waits for the starting-stall puzzle, then rises and accelerates.
  easy:   { v0: 5, accel: 0.55, delay: 9.0, catchGap: 300, catchK: 0.2,  maxRate: 30 },
  normal: { v0: 6, accel: 0.7,  delay: 8.0, catchGap: 260, catchK: 0.25, maxRate: 34 },
  hard:   { v0: 7, accel: 0.85, delay: 7.0, catchGap: 220, catchK: 0.3,  maxRate: 40 },
  chaos:  { v0: 8, accel: 1.0,  delay: 6.5, catchGap: 190, catchK: 0.35, maxRate: 46 },
};

export const RACE_DEFAULTS = {
  difficulty: 'normal',
  dangerSpeed: 1.0,        // multiplier on the purple schedule
  contestantSpeed: 1.0,    // multiplier on base speed
  complexity: 'medium',
  barrierDensity: 'medium',
  mapLength: 'standard',
  weaponEnabled: true,
  weaponKills: 2,          // 0 = unlimited
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
    race: { complexity: 'low', difficulty: 'normal', barrierDensity: 'low', minDuration: 14, maxDuration: 31 },
  },
  medium: {
    label: 'Medium reel (25-40s)',
    race: { complexity: 'medium', difficulty: 'normal', barrierDensity: 'medium', minDuration: 20, maxDuration: 42 },
  },
  chaos: {
    label: 'Chaos',
    race: { complexity: 'high', difficulty: 'chaos', barrierDensity: 'high', weaponKills: 0, coursePull: 1.15, contestantSpeed: 1.12, minDuration: 12, maxDuration: 40 },
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
    race: { complexity: 'medium', mapLength: 'long', difficulty: 'normal', barrierDensity: 'medium', minDuration: 25, maxDuration: 60 },
  },
};

export function resolveRaceConfig(presetId, overrides = {}) {
  const preset = PRESETS[presetId] || PRESETS.medium;
  return { ...RACE_DEFAULTS, ...preset.race, ...overrides };
}

export const VIEW_DEFAULTS = {
  camera: 'auto',          // auto | static | follow-leader | follow-pack
  particles: true,
  trails: true,
  shake: true,
  textOverlays: true,
  hud: true,
  intro: true,
  countdown: true,
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
