// Procedural course generation pipeline:
//   1. route skeleton (self-avoiding walk over the grid)   -> RouteGenerator
//   2. doors between consecutive cells, solid walls elsewhere
//   3. stage labels along the route (colour, bounce, power, pursuit, chaos, final)
//   4. section templates per cell                           -> SectionTemplates
//   5. colour gates, weapon, room barriers, final grey gate, finish, spawns
//   6. bounded mutation pass
//   7. course field (geodesic progress, purple field, flow) -> CourseField
//   8. structural validation + headless test race           -> LevelValidator
// Rejected layouts are retried with the next attempt stream of the same seed,
// so "seed -> level" stays a pure function.
import { RNG } from '../core/RNG.js';
import {
  LAYOUT, VIEW_W, MAP_LENGTHS, COMPLEXITY, LONG_COMPLEXITY, BARRIER_DENSITY, DIFFICULTIES,
  PHYSICS, COLOR_IDS, resolveRaceConfig,
} from '../config/presets.js';
import { generateRoute, classifyRoute, ROUTE_STYLES, DIRS } from './RouteGenerator.js';
import { createCellContext, TEMPLATES, pickTemplate, addRoomBarriers } from './SectionTemplates.js';
import { makeWall } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';
import { buildCourseField } from './CourseField.js';
import { validateStructure, judgeRace } from './LevelValidator.js';
import { evaluateRace } from './EntertainmentEvaluator.js';
import { Simulation } from '../core/Simulation.js';

const GATE_T = 8;

function stageFor(i, n, weaponIndex) {
  if (i === 0) return 'START';
  if (i === n - 1) return 'FINISH';
  if (i === n - 2) return 'FINAL_GATE';
  if (i === weaponIndex) return 'POWER';
  const f = i / (n - 1);
  if (f < 0.3) return 'COLOR';
  if (f < 0.5) return 'BOUNCE';
  if (f < 0.75) return 'PURSUIT';
  return 'CHAOS';
}

// Shared edge between two orthogonally adjacent cells.
function sharedEdge(a, b, L) {
  const { originX: ox, originY: oy, cellW, cellH } = L;
  if (a.r === b.r) {
    const c = Math.max(a.c, b.c);
    return { orient: 'v', pos: ox + c * cellW, start: oy + a.r * cellH, len: cellH, sideA: b.c > a.c ? 'E' : 'W' };
  }
  const r = Math.max(a.r, b.r);
  return { orient: 'h', pos: oy + r * cellH, start: ox + a.c * cellW, len: cellW, sideA: b.r > a.r ? 'S' : 'N' };
}

export function buildLevel(seed, cfg, attempt) {
  const rng = new RNG(`${seed}#${attempt}`);
  const L = LAYOUT;
  const t = L.wallT;
  const long = cfg.mapLength === 'long';
  const rows = (MAP_LENGTHS[cfg.mapLength] || MAP_LENGTHS.standard).rows;
  const cols = L.cols;
  const cx = COMPLEXITY[cfg.complexity] || COMPLEXITY.medium;
  const routeLen = long ? (LONG_COMPLEXITY[cfg.complexity] || LONG_COMPLEXITY.medium).route : cx.route;
  const width = VIEW_W;
  const height = L.originY + rows * L.cellH + L.bottomPad;

  const style = rng.pick(ROUTE_STYLES);
  const path = generateRoute(rng.fork('route'), cols, rows, routeLen[0], routeLen[1], style);
  if (!path) return { ok: false, reason: 'route generation failed' };
  classifyRoute(path);
  const N = path.length;

  const route = path.map((p, i) => ({
    index: i, c: p.c, r: p.r, dir: p.dir,
    x: L.originX + p.c * L.cellW, y: L.originY + p.r * L.cellH, w: L.cellW, h: L.cellH,
    entrySide: p.entrySide, exitSide: p.exitSide, shape: p.shape, doors: {}, stage: '', template: '',
  }));

  // Weapon placement: a contested room in the first half of the course.
  const weaponIndex = cfg.weaponEnabled ? Math.max(1, Math.min(N - 3, Math.round(N * rng.range(0.3, 0.55)))) : -1;
  for (const cell of route) cell.stage = stageFor(cell.index, N, weaponIndex);

  // Colour gates: one solid single-colour gate per chosen door, and every
  // colour gets at least one gate, so the racers depend on each other to open
  // the course (puzzle). Gates prefer to be spread out along the route.
  const dens = BARRIER_DENSITY[cfg.barrierDensity] || BARRIER_DENSITY.medium;
  const candidates = [];
  for (let i = 0; i <= N - 3; i++) candidates.push(i);
  const gateCount = Math.min(candidates.length, Math.max(COLOR_IDS.length, rng.int(dens.gates[0], dens.gates[1])));
  const gateDoors = new Set();
  const gateOrder = rng.shuffle(candidates.slice());
  for (const minSpacing of [2, 1]) {
    for (const i of gateOrder) {
      if (gateDoors.size >= gateCount) break;
      if (gateDoors.has(i)) continue;
      let ok = true;
      for (const g of gateDoors) if (Math.abs(g - i) < minSpacing) ok = false;
      if (ok) gateDoors.add(i);
    }
  }
  if (gateDoors.size < COLOR_IDS.length) return { ok: false, reason: 'route too short for one gate per colour' };
  // Colours along the route: each colour once (shuffled), extras random.
  const gateColor = new Map();
  const firstColors = rng.shuffle(COLOR_IDS.slice());
  [...gateDoors].sort((a, b) => a - b).forEach((di, k) => gateColor.set(di, k < firstColors.length ? firstColors[k] : rng.pick(COLOR_IDS)));
  const finalDoor = N - 2;

  // Doors between consecutive cells.
  const doors = [];
  for (let i = 0; i < N - 1; i++) {
    const a = route[i], b = route[i + 1];
    const e = sharedEdge(a, b, L);
    const maxW = e.len - 2 * t - 4;
    let w;
    if (i === 0 && !gateDoors.has(0)) w = rng.range(maxW * 0.75, maxW); // quick exit from the start room
    else if (gateDoors.has(i)) w = rng.range(Math.min(66, maxW), maxW);
    else if (i === finalDoor) w = rng.range(62, Math.min(86, maxW));
    else if (i > 0 && rng.chance(cx.openDoor)) w = maxW; // merged room
    else w = rng.range(Math.min(52, maxW), maxW);
    const s0 = e.start + t + 2, s1 = e.start + e.len - t - 2 - w;
    const pos = w >= maxW ? e.start + t + 2 : rng.range(s0, s1);
    const door = { index: i, orient: e.orient, pos: e.pos, a: pos, b: pos + w, w };
    doors.push(door);
    a.doors[e.sideA] = door;
    b.doors[DIRS[e.sideA].opp] = door;
  }

  // Walls: every route-cell boundary, with door gaps. Shared edges deduplicated.
  const walls = [];
  const seen = new Set();
  for (const cell of route) {
    for (const side of ['N', 'S', 'W', 'E']) {
      const horizontal = side === 'N' || side === 'S';
      const gc = side === 'E' ? cell.c + 1 : cell.c, gr = side === 'S' ? cell.r + 1 : cell.r;
      const key = (horizontal ? 'h' : 'v') + gc + ':' + gr;
      if (seen.has(key)) continue;
      seen.add(key);
      const door = cell.doors[side];
      if (horizontal) {
        const y = cell.y + (side === 'S' ? cell.h : 0) - t / 2;
        const x0 = cell.x - t / 2, x1 = cell.x + cell.w + t / 2;
        if (door) {
          if (door.a - x0 > 0.5) walls.push(makeWall(x0, y, door.a - x0, t));
          if (x1 - door.b > 0.5) walls.push(makeWall(door.b, y, x1 - door.b, t));
        } else walls.push(makeWall(x0, y, x1 - x0, t));
      } else {
        const x = cell.x + (side === 'E' ? cell.w : 0) - t / 2;
        const y0 = cell.y - t / 2, y1 = cell.y + cell.h + t / 2;
        if (door) {
          if (door.a - y0 > 0.5) walls.push(makeWall(x, y0, t, door.a - y0));
          if (y1 - door.b > 0.5) walls.push(makeWall(x, door.b, t, y1 - door.b));
        } else walls.push(makeWall(x, y0, t, y1 - y0));
      }
    }
  }

  const bumpers = [];
  const barriers = [];
  let weapon = null;

  // Dynamic balancing: short routes get busier rooms.
  let intensity = cx.obstacle;
  if (N <= 8) intensity = Math.min(1, intensity + 0.15);

  const trng = rng.fork('templates');
  const roomBarrierTotal = rng.int(dens.roomBarriers[0], dens.roomBarriers[1]);
  const roomBarrierCells = new Set();
  const midCells = route.filter((c) => c.index > 0 && c.index < N - 2 && c.index !== weaponIndex).map((c) => c.index);
  trng.shuffle(midCells);
  for (let i = 0; i < Math.min(roomBarrierTotal, midCells.length); i++) roomBarrierCells.add(midCells[i]);

  for (const cell of route) {
    if (cell.index === 0 || cell.index === N - 1) { cell.template = cell.index === 0 ? 'START' : 'FINISH'; continue; }
    const ctx = createCellContext(cell, trng, t, intensity);
    if (cell.index === weaponIndex) {
      cell.template = 'POWERUP_ROOM';
      TEMPLATES.POWERUP_ROOM(ctx);
      weapon = ctx.out.weapon;
    } else if (cell.index === N - 2) {
      cell.template = trng.chance(0.5) ? 'PILLARS' : 'ARENA';
      TEMPLATES[cell.template](ctx);
    } else {
      let name = pickTemplate(trng, cell, cell.stage, intensity);
      if (!TEMPLATES[name](ctx)) {
        name = trng.chance(0.5) ? 'PINBALL' : 'PILLARS';
        TEMPLATES[name](ctx);
      }
      cell.template = name;
    }
    if (roomBarrierCells.has(cell.index)) {
      if (addRoomBarriers(ctx, COLOR_IDS, trng.int(1, 2)) > 0) cell.template += '+COLOR';
    }
    walls.push(...ctx.out.walls);
    bumpers.push(...ctx.out.bumpers);
    barriers.push(...ctx.out.barriers);
  }
  if (cfg.weaponEnabled && !weapon) return { ok: false, reason: 'weapon could not be placed' };

  // Colour gates: a single solid block filling the whole doorway.
  for (const di of gateDoors) {
    const d = doors[di];
    const color = gateColor.get(di);
    if (d.orient === 'h') barriers.push(makeBarrier(d.a, d.pos - GATE_T / 2, d.w, GATE_T, color, 1, 'gate'));
    else barriers.push(makeBarrier(d.pos - GATE_T / 2, d.a, GATE_T, d.w, color, 1, 'gate'));
  }

  // Final neutral gate before the finish room.
  const fd = doors[finalDoor];
  const finishCell = route[N - 1];
  const k = fd.w >= 70 ? 3 : 2;
  const colorCount = barriers.filter((b) => b.color).length;
  const layers = (cfg.difficulty === 'hard' || cfg.difficulty === 'chaos' ? rng.chance(0.5) : rng.chance(0.2)) ? 2 : 1;
  let hp = cfg.finalHp > 0 ? cfg.finalHp : ({ easy: 1, normal: 1, hard: 2, chaos: 2 }[cfg.difficulty] || 1) + rng.int(0, 1);
  if (cfg.finalHp <= 0 && (colorCount > 8 || layers === 2)) hp -= 1; // many barriers -> weaker final wall
  hp = Math.max(1, Math.min(4, hp));
  const intoFinish = finishCell.entrySide; // side of finish cell where the door is
  const inwardSign = intoFinish === 'N' || intoFinish === 'W' ? 1 : -1;
  const segF = fd.w / k;
  for (let layer = 0; layer < layers; layer++) {
    const off = layer * (GATE_T + 1) * inwardSign;
    for (let s = 0; s < k; s++) {
      const a = fd.a + s * segF;
      if (fd.orient === 'h') barriers.push(makeBarrier(a, fd.pos - GATE_T / 2 + off, segF, GATE_T, null, hp, 'final'));
      else barriers.push(makeBarrier(fd.pos - GATE_T / 2 + off, a, GATE_T, segF, null, hp, 'final'));
    }
  }
  barriers.forEach((b, i) => { b.id = i; });

  // Finish zone: the far part of the last cell.
  const fi = { x0: finishCell.x + t / 2, y0: finishCell.y + t / 2, x1: finishCell.x + finishCell.w - t / 2, y1: finishCell.y + finishCell.h - t / 2 };
  const band = 34;
  let finish;
  if (intoFinish === 'N') finish = { x: fi.x0, y: fi.y0 + band, w: fi.x1 - fi.x0, h: fi.y1 - fi.y0 - band };
  else if (intoFinish === 'S') finish = { x: fi.x0, y: fi.y0, w: fi.x1 - fi.x0, h: fi.y1 - fi.y0 - band };
  else if (intoFinish === 'W') finish = { x: fi.x0 + band, y: fi.y0, w: fi.x1 - fi.x0 - band, h: fi.y1 - fi.y0 };
  else finish = { x: fi.x0, y: fi.y0, w: fi.x1 - fi.x0 - band, h: fi.y1 - fi.y0 };

  // Bounded mutation: jitter free-standing bumpers a little (keeps >=16px clearance).
  const mrng = rng.fork('mutate');
  for (const b of bumpers) { b.x += mrng.range(-1.5, 1.5); b.y += mrng.range(-1.5, 1.5); b.r = Math.max(5.5, b.r + mrng.range(-0.8, 0.8)); }

  const startCell = route[0];
  const startPoint = { x: startCell.x + startCell.w / 2, y: startCell.y + startCell.h / 2 };

  const level = {
    ok: true, seed, attempt, config: { ...cfg }, style,
    width, height, rows, cols, grid: { ...L, rows },
    route, doors, walls, bumpers, barriers, weapon, finish, startPoint,
    gateDoors: [...gateDoors], finalDoor, weaponIndex, spawns: [], field: null, params: null,
  };

  const field = buildCourseField(level, L.contestantSize / 2);
  if (!field.ok) return { ok: false, reason: field.reason };
  level.field = field;

  // Fair spawn: 2x2 formation, colours randomly assigned to slots, heading
  // roughly down the course with seeded variation.
  const srng = rng.fork('spawn');
  const slots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const order = srng.shuffle(COLOR_IDS.slice());
  const fiS = field.idxAt(startPoint.x, startPoint.y);
  const base = Math.atan2(field.flowY[fiS], field.flowX[fiS]);
  level.spawns = order.map((id, i) => {
    const sp = PHYSICS.baseSpeed * cfg.contestantSpeed * (1 + srng.range(-PHYSICS.speedVariation, PHYSICS.speedVariation));
    return {
      id,
      x: startPoint.x + slots[i][0] * 13,
      y: startPoint.y + slots[i][1] * 13,
      angle: base + srng.range(-0.75, 0.75),
      speed: sp,
    };
  });

  // Dynamic balancing of the purple schedule: longer routes get a slightly
  // slower field so a good run can still escape.
  const ref = long ? 1500 : 850;
  const lenScale = Math.max(0.85, Math.min(1.12, 1 - 0.18 * (field.totalLength - ref) / ref));
  level.params = {
    danger: { ...(DIFFICULTIES[cfg.difficulty] || DIFFICULTIES.normal), scale: lenScale * cfg.dangerSpeed },
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
