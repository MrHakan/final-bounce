// Procedural course generation: "the flooded tower".
//
// The course climbs. Racers start in four locked lanes at the bottom, the
// purple rises from below like a flood, and they must fight their way up a
// serpentine tower of halls to a finish room at the top.
//
//   1. PLAN     a sequence of purposeful halls (director, intensity curve)
//   2. GEOMETRY stacked bands whose ends alternate left/right (the snake),
//               floor/ceiling slabs with a door at every turn
//   3. CONTENT  starting stalls (colour puzzle), a set piece per hall,
//               brick gates, the blade armory, the grey plug before the finish
//   4. FIELD    geodesic course field (progress, purple threshold, flow)
//   5. CHECKS   structural validation + a headless test race; rejected layouts
//               are retried with the next attempt stream of the same seed, so
//               seed -> level stays a pure function.
import { RNG } from '../core/RNG.js';
import { LAYOUT, VIEW_W, TOWER, DIFFICULTIES, PHYSICS, COLOR_IDS, resolveRaceConfig } from '../config/presets.js';
import { BandCtx, PIECES, placeGate } from './Pieces.js';
import { makeWall } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';
import { buildCourseField } from './CourseField.js';
import { chooseStallColors, stallLayout, buildStalls, STALL_USED } from './StartStalls.js';
import { validateStructure, judgeRace } from './LevelValidator.js';
import { evaluateRace } from './EntertainmentEvaluator.js';
import { Simulation } from '../core/Simulation.js';

const T_SIDE = LAYOUT.wallT;
const T_SLAB = LAYOUT.slabT;
const BLOCK_T = 12;            // thickness of one layer of the grey plug

// Interior height range and minimum length of every hall kind.
const KIND = {
  STALLS:  { h: [128, 142], min: 250 },
  SCATTER: { h: [108, 128], min: 260 },
  SLALOM:  { h: [100, 118], min: 300 },
  PILLARS: { h: [96, 114],  min: 240 },
  LANES:   { h: [98, 114],  min: 320 },
  FUNNEL:  { h: [102, 120], min: 300 },
  ARMORY:  { h: [140, 160], min: 300 },
  SPRINT:  { h: [44, 50],   min: 300 },
  FINISH:  { h: [80, 80],   min: 170 },
};

// Which halls are drawn from where along the course (the intensity curve):
// early = let the pack regroup, middle = obstacles, late = pressure.
const BAGS = {
  early: [['SCATTER', 3], ['SLALOM', 2.4], ['PILLARS', 1.2], ['LANES', 1.4]],
  mid:   [['SLALOM', 2], ['LANES', 2], ['FUNNEL', 2], ['SCATTER', 2], ['PILLARS', 1]],
  late:  [['FUNNEL', 3], ['SLALOM', 2], ['LANES', 1.5], ['SCATTER', 1.2]],
};

function planTower(rng, cfg) {
  const long = cfg.mapLength === 'long';
  const conf = TOWER[long ? 'long' : 'standard'];
  const m = conf.mid[cfg.complexity] ?? conf.mid.medium;
  const kinds = new Array(m).fill(null);

  if (cfg.weaponEnabled) kinds[Math.min(m - 1, Math.floor(rng.range(0.1, 0.5) * m))] = 'ARMORY';
  // The sprint corridor: a narrow run right before the final plug.
  if (m >= 2 && kinds[m - 1] === null && rng.chance(0.85)) kinds[m - 1] = 'SPRINT';
  // Long courses get a second sprint around the two-thirds mark.
  if (long && m >= 6) {
    const i = Math.floor(m * rng.range(0.5, 0.7));
    if (kinds[i] === null && kinds[i - 1] !== 'SPRINT' && kinds[i + 1] !== 'SPRINT') kinds[i] = 'SPRINT';
  }
  let prev = null;
  for (let i = 0; i < m; i++) {
    if (kinds[i]) { prev = kinds[i]; continue; }
    const f = (i + 0.5) / m;
    const bag = (f < 0.35 ? BAGS.early : f < 0.7 ? BAGS.mid : BAGS.late).filter(([k]) => k !== prev);
    kinds[i] = rng.weighted(bag);
    prev = kinds[i];
  }

  // Gates: every sprint corridor is closed by one (that is where the purple
  // catches the slow), the rest are spread over the other halls.
  const [gmin, gmax] = conf.gates[cfg.barrierDensity] ?? conf.gates.medium;
  const want = rng.int(gmin, gmax);
  const gates = new Set();
  for (let i = 0; i < m; i++) if (kinds[i] === 'SPRINT' && gates.size < want && rng.chance(0.9)) gates.add(i);
  const others = rng.shuffle(kinds.map((k, i) => i).filter((i) => kinds[i] !== 'ARMORY' && kinds[i] !== 'SPRINT'));
  for (const spacing of [2, 1]) {
    for (const i of others) {
      if (gates.size >= want) break;
      if (gates.has(i)) continue;
      if ([...gates].some((g) => Math.abs(g - i) < spacing)) continue;
      gates.add(i);
    }
  }
  const colors = rng.shuffle(COLOR_IDS.slice());
  let ci = 0;
  const specs = [{ kind: 'STALLS' }];
  kinds.forEach((kind, i) => {
    const spec = { kind, gate: null, gateAt: 0 };
    if (gates.has(i)) {
      spec.gate = colors[ci++ % colors.length];
      spec.gateAt = kind === 'SPRINT' ? rng.range(0.66, 0.78) : rng.range(0.42, 0.6);
    }
    specs.push(spec);
  });
  specs.push({ kind: 'FINISH' });
  return specs;
}

function dangerParams(cfg, lenScale, long) {
  const d = { ...(DIFFICULTIES[cfg.difficulty] || DIFFICULTIES.normal) };
  const k = long ? TOWER.long.purple : null;
  if (k) { d.accel *= k.accel; d.v0 *= k.rate; d.maxRate *= k.rate; }
  d.scale = lenScale * cfg.dangerSpeed;
  return d;
}

export function buildLevel(seed, cfg, attempt) {
  const rng = new RNG(`${seed}#${attempt}`);
  const long = cfg.mapLength === 'long';
  const specs = planTower(rng.fork('plan'), cfg);
  const n = specs.length;

  // ---------- geometry ----------
  const Wt = Math.round(rng.range(TOWER.width[0], TOWER.width[1]));
  const Xmin = VIEW_W / 2 - Wt / 2, Xmax = VIEW_W / 2 + Wt / 2;
  specs.forEach((s) => { s.inner = Math.round(rng.range(KIND[s.kind].h[0], KIND[s.kind].h[1])); });

  const layers = cfg.difficulty === 'chaos' ? 3 : cfg.difficulty === 'hard' ? 2 : rng.chance(0.5) ? 2 : 1;
  const slabT = new Array(n + 1).fill(T_SLAB);
  slabT[n - 1] = layers * BLOCK_T;               // the plug lives inside this slab

  const hc = specs.map((s, k) => s.inner + (slabT[k] + slabT[k + 1]) / 2);   // centre-to-centre
  const total = hc.reduce((a, b) => a + b, 0);
  const height = Math.ceil(LAYOUT.topMargin + total + LAYOUT.bottomMargin);
  const yb = [height - LAYOUT.bottomMargin];      // yb[j]: centre line of boundary j (0 = floor of hall 0)
  for (let k = 0; k < n; k++) yb.push(yb[k] - hc[k]);

  const inset = T_SIDE / 2 + 6;
  const bands = [];
  let dir = rng.chance(0.5) ? 1 : -1;
  let anchor = null;
  for (let k = 0; k < n; k++) {
    const spec = specs[k];
    let len;
    // Stall hall: four lanes plus a compact exit lane (the door sits right beside the last brick column).
    if (k === 0) len = STALL_USED + Math.round(rng.range(78, 96));
    else {
      const avail = dir > 0 ? Xmax - anchor : anchor - Xmin;
      len = Math.round(avail * rng.range(0.78, 1));
      len = Math.max(len, Math.min(KIND[spec.kind].min, avail));
      if (spec.kind === 'FINISH') len = Math.min(len, Math.round(rng.range(170, 230)));
    }
    let L, R;
    if (k === 0) { if (dir > 0) { L = Xmin; R = L + len; } else { R = Xmax; L = R - len; } }
    else if (dir > 0) { L = anchor; R = L + len; } else { R = anchor; L = R - len; }
    if (len < 170) return { ok: false, reason: 'hall too short' };
    bands.push({
      k, kind: spec.kind, dir, L, R, len, yTop: yb[k + 1], yBot: yb[k],
      x0: L + T_SIDE / 2, x1: R - T_SIDE / 2, y0: yb[k + 1] + slabT[k + 1] / 2, y1: yb[k] - slabT[k] / 2,
    });
    anchor = dir > 0 ? R : L;
    dir = -dir;
  }

  // Doors: boundary j (1..n-1) joins hall j-1 and hall j at hall j-1's exit end.
  const doors = [];
  for (let j = 1; j < n; j++) {
    const below = bands[j - 1], above = bands[j];
    let dw;
    if (j === n - 1) dw = Math.round(rng.range(54, 66) / 3) * 3;           // plug: 3 blocks across
    else dw = Math.round(rng.range(52, 72));
    dw = Math.min(dw, Math.floor(Math.min(below.len, above.len) * 0.4));
    if (j === 1) dw = Math.min(dw, below.len - STALL_USED - 2 * inset - 6);
    const b = below.dir > 0 ? below.R - inset : below.L + inset + dw;
    const a = b - dw;
    doors.push({ index: j, orient: 'h', pos: yb[j], a, b, w: dw });
    below.exit = { a, b };
    above.entry = { a, b };
  }

  // ---------- walls ----------
  const walls = [];
  for (const b of bands) {
    const yTop = b.yTop - slabT[b.k + 1] / 2, yBot = b.yBot + slabT[b.k] / 2;
    walls.push(makeWall(b.L - T_SIDE / 2, yTop, T_SIDE, yBot - yTop));
    walls.push(makeWall(b.R - T_SIDE / 2, yTop, T_SIDE, yBot - yTop));
  }
  for (let j = 0; j <= n; j++) {
    const adj = [bands[j - 1], bands[j]].filter(Boolean);
    const xa = Math.min(...adj.map((b) => b.L)) - T_SIDE / 2, xb = Math.max(...adj.map((b) => b.R)) + T_SIDE / 2;
    const y = yb[j] - slabT[j] / 2, h = slabT[j];
    const door = j >= 1 && j <= n - 1 ? doors[j - 1] : null;
    if (door) {
      walls.push(makeWall(xa, y, door.a - xa, h));
      walls.push(makeWall(door.b, y, xb - door.b, h));
    } else walls.push(makeWall(xa, y, xb - xa, h));
  }

  // ---------- content ----------
  const bumpers = [];
  const barriers = [];
  let weapon = null;

  // Starting stalls.
  const stall0 = bands[0];
  const stall = stallLayout({ x0: stall0.x0, y0: stall0.y0, x1: stall0.x1, y1: stall0.y1, dir: stall0.dir });
  const stallColors = chooseStallColors(rng.fork('stalls'));
  const stallParts = buildStalls(stall, stallColors, rng.fork('stall-geo'), T_SLAB);
  walls.push(...stallParts.walls);
  barriers.push(...stallParts.barriers);

  // One set piece per hall.
  const crng = rng.fork('content');
  for (let k = 1; k < n - 1; k++) {
    const b = bands[k], spec = specs[k];
    const ctx = new BandCtx({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, dir: b.dir, entry: b.entry, exit: b.exit }, crng);
    if (spec.gate) {
      const u = placeGate(ctx, spec.gate, spec.gateAt);
      if (u === null) return { ok: false, reason: 'gate could not be placed' };
      b.gateU = u;
    }
    const ok = PIECES[spec.kind === 'SPRINT' ? 'EMPTY' : spec.kind](ctx, {});
    if (!ok) { PIECES.SCATTER(ctx, { style: 'random' }) || PIECES.PILLARS(ctx, {}); b.fallback = true; }
    if (spec.kind === 'ARMORY') {
      if (!ctx.out.weapon) return { ok: false, reason: 'weapon could not be placed' };
      weapon = ctx.out.weapon;
    }
    walls.push(...ctx.out.walls);
    bumpers.push(...ctx.out.bumpers);
    barriers.push(...ctx.out.barriers);
  }
  if (cfg.weaponEnabled && !weapon) return { ok: false, reason: 'weapon could not be placed' };

  // The grey plug: layers x 3 blocks filling the shaft into the finish room.
  const plugDoor = doors[n - 2];
  let hp = cfg.finalHp > 0 ? cfg.finalHp : { easy: 1, normal: 1, hard: 2, chaos: 2 }[cfg.difficulty] ?? 1;
  hp = Math.max(1, Math.min(4, hp));
  const cols = 3, bw = plugDoor.w / cols;
  const plugTop = yb[n - 1] - slabT[n - 1] / 2;
  for (let layer = 0; layer < layers; layer++) {
    for (let c = 0; c < cols; c++) barriers.push(makeBarrier(plugDoor.a + c * bw, plugTop + layer * BLOCK_T, bw, BLOCK_T, null, hp, 'final'));
  }
  barriers.forEach((bar, i) => { bar.id = i; });

  // Finish room at the top.
  const fin = bands[n - 1];
  const finish = { x: fin.x0, y: fin.y0, w: fin.x1 - fin.x0, h: fin.y1 - fin.y0 - 34 };

  const spawnRng = rng.fork('spawn');
  const level = {
    ok: true, seed, attempt, config: { ...cfg }, style: 'tower',
    layout: specs.map((s) => s.kind).join('>'),
    width: VIEW_W, height, grid: { ...LAYOUT },
    route: bands.map((b, i) => ({ index: i, x: b.L, y: b.yTop, w: b.R - b.L, h: b.yBot - b.yTop, kind: b.kind, stage: b.kind, dir: b.dir, gate: specs[i].gate || null })),
    doors, walls, bumpers, barriers, weapon, finish,
    startPoint: { x: stallParts.spawns[0].x, y: stallParts.spawns[0].y },
    finalDoor: n - 1, weaponIndex: specs.findIndex((s) => s.kind === 'ARMORY'),
    spawns: [], field: null, params: null,
    dangerSources: stallParts.dangerSources,
    stallRect: stall0.dir > 0
      ? { x: stall0.x0, y: stall0.y0, w: STALL_USED, h: stall0.y1 - stall0.y0 }
      : { x: stall0.x1 - STALL_USED, y: stall0.y0, w: STALL_USED, h: stall0.y1 - stall0.y0 },
    stall: { ...stallColors, bricksTop: true },
    stallGeo: { lanes: stall.lanes, bricks: stall.bricks },
    plug: { layers, hp, blocks: layers * cols },
  };

  const field = buildCourseField(level, LAYOUT.contestantSize / 2);
  if (!field.ok) return { ok: false, reason: field.reason };
  level.field = field;

  // Spawns: one racer per stall lane (lane order is part of the puzzle).
  level.spawns = stallParts.spawns.map((sp) => ({
    ...sp,
    speed: PHYSICS.baseSpeed * cfg.contestantSpeed * (1 + spawnRng.range(-PHYSICS.speedVariation, PHYSICS.speedVariation)),
  }));

  // Purple schedule: longer courses get a slightly slower field so a good run
  // can still escape.
  const ref = long ? 2600 : 1150;
  const lenScale = Math.max(0.85, Math.min(1.12, 1 - 0.18 * (field.totalLength - ref) / ref));
  level.params = {
    danger: dangerParams(cfg, lenScale, long),
    pull: PHYSICS.pull * cfg.coursePull,
    bounceBias: Math.min(0.85, PHYSICS.bounceBias * cfg.coursePull),
    weaponKills: cfg.weaponKills,
    raceMode: cfg.raceMode,
    timeout: PHYSICS.timeout,
  };
  return level;
}

export function configKey(cfg) {
  return JSON.stringify(Object.keys(cfg).sort().map((k) => [k, cfg[k]]));
}

// Full pipeline: returns the first acceptable layout for this seed (or the
// best rejected one when every attempt fails, flagged as such).
export function generateLevel(seed, cfgIn, opts = {}) {
  const cfg = cfgIn.difficulty ? cfgIn : resolveRaceConfig('medium', cfgIn);
  const maxAttempts = opts.maxAttempts || 14;
  const rejected = [];
  let best = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const level = buildLevel(seed, cfg, attempt);
    if (!level.ok) { rejected.push({ attempt, reason: level.reason }); continue; }
    const s = validateStructure(level);
    if (!s.ok) { rejected.push({ attempt, reason: s.problems.join('; ') }); continue; }
    if (!cfg.validateRace && !opts.forceTestRun) {
      return { level, attempts: attempt + 1, rejected, result: null, score: null, accepted: true };
    }
    const sim = new Simulation(level);
    const result = sim.runToEnd(PHYSICS.timeout + 5);
    const verdict = judgeRace(result, cfg);
    const score = evaluateRace(result, level, cfg);
    const entry = { level, attempts: attempt + 1, rejected, result, score, verdict, accepted: verdict.ok };
    if (verdict.ok) return entry;
    rejected.push({ attempt, reason: verdict.reason });
    if (!best || verdict.quality > best.verdict.quality) best = entry;
  }
  if (best) return { ...best, attempts: maxAttempts, accepted: false };
  return { level: null, attempts: maxAttempts, rejected, result: null, score: null, accepted: false };
}
