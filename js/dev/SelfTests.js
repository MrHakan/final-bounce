// Deterministic self-tests. Runs in Node (tests/run-tests.mjs, CI) and in the
// browser (developer panel). No DOM required.
import { generateLevel } from '../generation/LevelGenerator.js';
import { validateStructure } from '../generation/LevelValidator.js';
import { buildCourseField } from '../generation/CourseField.js';
import { Simulation } from '../core/Simulation.js';
import { RNG, seedFromIndex } from '../core/RNG.js';
import { LAYOUT, DT, resolveRaceConfig } from '../config/presets.js';
import { makeWall } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';
import { recordingSupport } from '../recording/Recorder.js';
import { stallRounds } from '../generation/StartStalls.js';
import { MIN_GAP } from '../generation/Pieces.js';
import { smoothIntensity } from '../core/Intensity.js';
import { levelFor, rootFor, scheduleStep } from '../audio/Music.js';
import { normalize } from '../audio/OfflineMixer.js';

// Synthetic single-room arena for rule tests.
export function makeArena({ w = 300, h = 300, walls = [], barriers = [], bumpers = [], spawns, finish, weapon = null, params = {} } = {}) {
  const x0 = 120, y0 = 200, t = LAYOUT.wallT;
  const route = [{ index: 0, c: 0, r: 0, x: x0, y: y0, w, h, entrySide: null, exitSide: null, doors: {}, stage: 'START', template: 'TEST', shape: 'START' }];
  const boundary = [
    makeWall(x0 - t / 2, y0 - t / 2, w + t, t), makeWall(x0 - t / 2, y0 + h - t / 2, w + t, t),
    makeWall(x0 - t / 2, y0 - t / 2, t, h + t), makeWall(x0 + w - t / 2, y0 - t / 2, t, h + t),
  ];
  const level = {
    seed: 'TEST', attempt: 0, width: 540, height: 960, route, doors: [],
    walls: boundary.concat(walls), bumpers, barriers: barriers.map((b, i) => ({ ...b, id: i })), weapon,
    finish: finish || { x: x0 + w - 40, y: y0 + h - 40, w: 30, h: 30 },
    startPoint: { x: x0 + 30, y: y0 + 30 }, grid: { ...LAYOUT }, config: {}, style: 'test',
  };
  level.field = buildCourseField(level, LAYOUT.contestantSize / 2);
  if (!level.field.ok) throw new Error('test arena invalid: ' + level.field.reason);
  level.spawns = spawns;
  level.params = {
    danger: { v0: 0, accel: 0, delay: 999, catchGap: 1e9, catchK: 0, maxRate: 0, scale: 1 },
    pull: 0, bounceBias: 0, weaponKills: 2, raceMode: 'first', timeout: 60, ...params,
  };
  return level;
}

const spawn = (id, x, y, angle, speed = 165) => ({ id, x: 120 + x, y: 200 + y, angle, speed });

function fingerprint(level) {
  const r = (v) => Math.round(v * 100) / 100;
  return JSON.stringify({
    walls: level.walls.map((w) => [r(w.x), r(w.y), r(w.w), r(w.h)]),
    bumpers: level.bumpers.map((b) => [r(b.x), r(b.y), r(b.r)]),
    barriers: level.barriers.map((b) => [r(b.x), r(b.y), b.color, b.hp]),
    spawns: level.spawns.map((s) => [s.id, r(s.x), r(s.y), r(s.angle), r(s.speed)]),
    weapon: level.weapon, finish: level.finish, route: level.route.map((c) => [r(c.x), r(c.y), r(c.w), c.kind]),
  });
}

function runFor(sim, seconds) { const n = Math.round(seconds / DT); for (let i = 0; i < n && !sim.ended; i++) sim.step(); return sim; }

export const TESTS = [
  ['same seed -> same map', () => {
    const cfg = resolveRaceConfig('medium');
    const a = generateLevel('SAME01', cfg), b = generateLevel('SAME01', cfg);
    return fingerprint(a.level) === fingerprint(b.level) || 'fingerprints differ';
  }],
  ['same seed -> same winner and duration', () => {
    const cfg = resolveRaceConfig('medium');
    const a = generateLevel('SAME02', cfg).level, b = generateLevel('SAME02', cfg).level;
    const ra = new Simulation(a).runToEnd(90), rb = new Simulation(b).runToEnd(90);
    return (ra.winner === rb.winner && ra.endTick === rb.endTick) || `${ra.winner}/${ra.endTick} vs ${rb.winner}/${rb.endTick}`;
  }],
  ['same seed -> same major event timeline', () => {
    const cfg = resolveRaceConfig('chaos');
    const lvl = generateLevel('SAME03', cfg).level;
    const la = new Simulation(lvl).runToEnd(90).log, lb = new Simulation(lvl).runToEnd(90).log;
    const s = (log) => log.map((e) => `${e.tick}:${e.type}:${e.actor || ''}:${e.target || ''}`).join('|');
    return (la.length > 0 && s(la) === s(lb)) || 'timelines differ';
  }],
  ['physics independent of frame rate', () => {
    const lvl = generateLevel('FPS001', resolveRaceConfig('short')).level;
    const run = (frameDt) => {
      const sim = new Simulation(lvl); let acc = 0; let guard = 0;
      while (!sim.ended && guard++ < 1e6) { acc += frameDt; while (acc >= DT && !sim.ended) { sim.step(); acc -= DT; } }
      return sim.result();
    };
    const a = run(1 / 30), b = run(1 / 144), c = run(1 / 59.94);
    return (a.endTick === b.endTick && b.endTick === c.endTick && a.winner === b.winner && b.winner === c.winner) || 'results depend on frame dt';
  }],
  ['different seeds -> meaningful map variation', () => {
    const cfg = resolveRaceConfig('medium');
    const prints = new Set();
    const routes = new Set();
    for (let i = 0; i < 12; i++) {
      const l = generateLevel(seedFromIndex('VAR', i), cfg, { maxAttempts: 3 }).level;
      prints.add(fingerprint(l));
      routes.add(l.layout + '|' + l.route.map((c) => Math.round(c.x) + ',' + Math.round(c.w)).join(';'));
    }
    return (prints.size === 12 && routes.size >= 10) || `unique maps ${prints.size}/12, unique routes ${routes.size}/12`;
  }],
  ['contestant cannot pass through walls (even at 6x speed)', () => {
    // A thin wall sealing the arena into two halves; nobody may ever reach the right half.
    const wall = makeWall(120 + 150, 200 - 3, 4, 306);
    const spawns = [];
    const rng = new RNG('walls');
    for (const id of ['red', 'blue', 'yellow', 'green']) spawns.push(spawn(id, rng.range(30, 120), rng.range(40, 260), rng.range(-0.6, 0.6), 1000));
    const lvl = makeArena({ walls: [wall], finish: { x: 130, y: 476, w: 12, h: 12 } });
    lvl.spawns = spawns;
    const sim = new Simulation(lvl);
    for (let i = 0; i < 1200 && !sim.ended; i++) {
      sim.step();
      for (const c of sim.contestants) {
        if (c.x > 120 + 150) return `${c.id} crossed the wall at tick ${sim.tick}`;
        if (c.x < 120 || c.x > 420 || c.y < 200 || c.y > 500) return `${c.id} escaped the arena`;
      }
    }
    return true;
  }],
  ['colour barrier breaks only for its colour', () => {
    const bar = makeBarrier(120 + 140, 200, 10, 300, 'red', 1, 'gate');
    const lvlBlue = makeArena({ barriers: [bar] }); lvlBlue.spawns = [spawn('blue', 60, 150, 0.2)];
    const s1 = runFor(new Simulation(lvlBlue), 3);
    if (!s1.barriers[0].alive) return 'blue broke a red barrier';
    if (s1.contestants[0].x > 120 + 140) return 'blue passed through a red barrier';
    const lvlRed = makeArena({ barriers: [bar] }); lvlRed.spawns = [spawn('red', 60, 150, 0.2)];
    const s2 = runFor(new Simulation(lvlRed), 3);
    return (!s2.barriers[0].alive && s2.contestants[0].blocksDestroyed === 1) || 'red did not break its barrier';
  }],
  ['neutral final barrier accepts all colours', () => {
    for (const id of ['red', 'blue', 'yellow', 'green']) {
      const bar = makeBarrier(120 + 140, 200, 10, 300, null, 2, 'final');
      const lvl = makeArena({ barriers: [bar] }); lvl.spawns = [spawn(id, 60, 150, 0.1)];
      const sim = runFor(new Simulation(lvl), 8);
      if (sim.barriers[0].alive) return `${id} could not break a grey block`;
      if (!sim.log.some((e) => e.type === 'finalBreak' && e.actor === id)) return 'no finalBreak event';
    }
    return true;
  }],
  ['orphaned colour barriers turn neutral', () => {
    const bar = makeBarrier(120 + 200, 200, 10, 300, 'green', 1, 'gate');
    const lvl = makeArena({ barriers: [bar], params: { danger: { v0: 5000, accel: 0, delay: 0, catchGap: 1e9, catchK: 0, maxRate: 5000, scale: 1 } } });
    lvl.spawns = [spawn('green', 40, 150, 0)];
    const sim = runFor(new Simulation(lvl), 0.5);
    return (!sim.contestants[0].alive && sim.barriers[0].color === null && sim.barriers[0].hp === 1) || 'barrier not orphaned';
  }],
  ['weapon ownership: first touch equips, others cannot take it', () => {
    const lvl = makeArena({ weapon: { x: 120 + 150, y: 200 + 150 } });
    lvl.spawns = [spawn('red', 100, 150, 0), spawn('blue', 250, 60, Math.PI / 2 + 0.3)];
    const sim = runFor(new Simulation(lvl), 1.5);
    const red = sim.contestants[0];
    if (!red.hasWeapon || sim.weapon.holder !== 'red') return 'red did not equip the weapon';
    if (sim.contestants[1].hasWeapon) return 'blue also holds a weapon';
    return sim.log.filter((e) => e.type === 'weaponPickup').length === 1 || 'multiple pickups';
  }],
  ['armed collision eliminates the unarmed target', () => {
    const lvl = makeArena({ weapon: { x: 120 + 60, y: 200 + 150 } });
    lvl.spawns = [spawn('red', 40, 150, 0), spawn('blue', 200, 150, Math.PI)];
    const sim = runFor(new Simulation(lvl), 2);
    const blue = sim.contestants[1], red = sim.contestants[0];
    return (red.alive && !blue.alive && blue.deathCause === 'kill' && blue.killedBy === 'red' && red.kills === 1) || 'kill not resolved';
  }],
  ['purple crushes racers against a gate they cannot open', () => {
    // A green gate seals the arena; only red/yellow race, so nobody can open it.
    const gate = makeBarrier(120 + 200, 197, 8, 306, 'green', 1, 'gate');
    const lvl = makeArena({ barriers: [gate], finish: { x: 120 + 240, y: 200 + 130, w: 40, h: 40 },
      params: { danger: { v0: 60, accel: 0, delay: 0.2, catchGap: 1e9, catchK: 0, maxRate: 60, scale: 1 } } });
    lvl.spawns = [spawn('yellow', 60, 150, 1), spawn('red', 100, 100, 2)];
    const sim = runFor(new Simulation(lvl), 12);
    return sim.contestants.every((c) => !c.alive && c.deathCause === 'danger') || 'racers were not crushed';
  }],
  ['touching purple bounces (it only kills by crushing)', () => {
    const lvl = makeArena({ finish: { x: 120 + 250, y: 200 + 130, w: 40, h: 40 },
      params: { danger: { v0: 40, accel: 0, delay: 0.1, catchGap: 1e9, catchK: 0, maxRate: 40, scale: 1 } } });
    lvl.spawns = [spawn('blue', 70, 150, Math.PI + 0.3)];
    const sim = new Simulation(lvl);
    let touched = false;
    for (let i = 0; i < 900 && !sim.ended; i++) { sim.step(); if (sim.events.some((e) => e.type === 'bounce' && e.on === 'purple')) touched = true; }
    return (touched && sim.contestants[0].alive) || `touched=${touched} alive=${sim.contestants[0].alive}`;
  }],
  ['matching colour breaks its block and still bounces', () => {
    const bar = makeBarrier(120 + 140, 200, 10, 300, 'red', 1, 'gate');
    const lvl = makeArena({ barriers: [bar] }); lvl.spawns = [spawn('red', 60, 150, 0)];
    const sim = new Simulation(lvl);
    for (let i = 0; i < 240; i++) {
      sim.step();
      if (!sim.barriers[0].alive) return (sim.contestants[0].vx < 0) || 'red kept going after breaking its block';
    }
    return 'block never broke';
  }],
  ['starting stalls are solvable and chained (every racer needs another)', () => {
    for (let i = 0; i < 40; i++) {
      const l = generateLevel(seedFromIndex('STALL', i), resolveRaceConfig('medium', { validateRace: false })).level;
      const { lanes, bricks } = l.stall;
      const rounds = stallRounds(lanes, bricks);
      if (rounds < 2) return `seed ${i}: rounds=${rounds}`;
      if (bricks[3] === lanes[3]) return `seed ${i}: exit brick belongs to its neighbour`;
      if (l.barriers.filter((b) => b.role === 'stall').length !== 12) return `seed ${i}: expected 12 stall bricks`;
      if (new Set(l.spawns.map((sp) => Math.round(sp.x))).size !== 4) return `seed ${i}: racers not in separate lanes`;
    }
    // The example from the reference: RED BLUE YELLOW GREEN lanes, bricks Y B G R.
    return stallRounds(['red', 'blue', 'yellow', 'green'], ['yellow', 'blue', 'green', 'red']) === 3 || 'reference stall not solved in 3 rounds';
  }],
  ['every course has a gate of every colour', () => {
    for (const p of ['short', 'medium', 'chaos']) for (let i = 0; i < 15; i++) {
      const l = generateLevel(seedFromIndex('GATES' + p, i), resolveRaceConfig(p, { validateRace: false })).level;
      const colors = new Set(l.barriers.filter((b) => b.role === 'gate' || b.role === 'stall').map((b) => b.color));
      if (colors.size < 4) return `${p} seed ${i}: gate colours ${[...colors].join(',')}`;
    }
    return true;
  }],
  ['finish detection ends the race (FIRST WINS)', () => {
    const lvl = makeArena({ finish: { x: 120 + 220, y: 200 + 100, w: 60, h: 100 } });
    lvl.spawns = [spawn('blue', 60, 150, 0), spawn('red', 60, 40, Math.PI / 2 + 0.4)];
    const sim = new Simulation(lvl);
    sim.runToEnd(20);
    return (sim.winner === 'blue' && sim.contestants[0].finished && sim.ended && sim.endReason === 'winner') || `winner=${sim.winner} reason=${sim.endReason}`;
  }],
  ['recording support detection handles unsupported browsers', () => {
    const none = recordingSupport({});
    if (none.ok || !none.reason) return 'empty environment reported as supported';
    function FakeCanvas() {}
    FakeCanvas.prototype.captureStream = () => null;
    const noCodec = recordingSupport({ HTMLCanvasElement: FakeCanvas, MediaRecorder: { isTypeSupported: () => false } });
    if (noCodec.ok || noCodec.mimes.length) return 'no-codec environment reported as supported';
    const webm = recordingSupport({ HTMLCanvasElement: FakeCanvas, MediaRecorder: { isTypeSupported: (m) => m.startsWith('video/webm') } });
    return (webm.ok && webm.mimes[0] === 'video/webm;codecs=vp9,opus') || 'codec preference order wrong';
  }],

  ['tower structure: stalls at the bottom, finish on top, plug before the finish', () => {
    const KINDS = new Set(['STALLS', 'SCATTER', 'SLALOM', 'PILLARS', 'LANES', 'FUNNEL', 'ARMORY', 'SPRINT', 'FINISH']);
    for (const p of ['short', 'medium', 'chaos', 'long']) for (let i = 0; i < 12; i++) {
      const l = generateLevel(seedFromIndex('TW' + p, i), resolveRaceConfig(p, { validateRace: false })).level;
      const r = l.route;
      if (r[0].kind !== 'STALLS' || r[r.length - 1].kind !== 'FINISH') return `${p} ${i}: bad ends`;
      if (r.some((c) => !KINDS.has(c.kind))) return `${p} ${i}: unknown hall kind`;
      for (let k = 1; k < r.length; k++) if (!(r[k].y + r[k].h <= r[k - 1].y + 1)) return `${p} ${i}: hall ${k} is not above hall ${k - 1}`;
      // Each door must lie inside the x-range of both halls it joins, and halls flow in alternating directions.
      for (const d of l.doors) {
        const lo = r[d.index - 1], hi = r[d.index];
        if (d.a < Math.max(lo.x, hi.x) || d.b > Math.min(lo.x + lo.w, hi.x + hi.w)) return `${p} ${i}: door ${d.index} outside a hall`;
        if (lo.dir === hi.dir) return `${p} ${i}: halls ${d.index - 1}/${d.index} do not alternate`;
      }
      if (l.barriers.filter((b) => b.role === 'final').length !== l.plug.blocks) return `${p} ${i}: plug block count`;
      if (l.weaponIndex < 1 && l.config.weaponEnabled) return `${p} ${i}: no armory hall`;
      const mids = r.length - 2;
      const want = { short: [2, 2], medium: [3, 3], chaos: [4, 4], long: [7, 7] }[p];
      if (mids < want[0] || mids > want[1]) return `${p} ${i}: ${mids} halls`;
    }
    return true;
  }],
  ['set pieces keep clear gaps between obstacles (racers never get wedged)', () => {
    for (let i = 0; i < 40; i++) {
      const l = generateLevel(seedFromIndex('CLR', i), resolveRaceConfig('chaos', { validateRace: false })).level;
      for (let a = 0; a < l.bumpers.length; a++) for (let b = a + 1; b < l.bumpers.length; b++) {
        const A = l.bumpers[a], B = l.bumpers[b];
        const gap = Math.hypot(A.x - B.x, A.y - B.y) - A.r - B.r;
        if (gap < MIN_GAP - 0.6) return `seed ${i}: bumpers ${gap.toFixed(1)}px apart`;
      }
    }
    return true;
  }],
  ['purple pushes along its own front normal (regression: no crush with room above)', () => {
    // Inside a stall lane the course flow points sideways at brick height, but the
    // purple rises from the bottom, so its push must point up the lane.
    for (let i = 0; i < 15; i++) {
      const l = generateLevel(seedFromIndex('PSH', i), resolveRaceConfig('medium', { validateRace: false })).level;
      const f = l.field, sr = l.stallRect, y0 = sr.y, H = sr.h;
      let n = 0, up = 0;
      for (const lane of l.stallGeo.lanes) {
        for (let fy = 0.3; fy <= 0.85; fy += 0.05) {
          const idx = f.idxAt(lane.x + lane.w / 2, y0 + H * fy);
          if (!f.free[idx]) continue;
          n++;
          if (f.pushY[idx] < -0.6) up++;
        }
      }
      if (n < 20 || up / n < 0.95) return `seed ${i}: only ${up}/${n} lane samples push upward`;
    }
    return true;
  }],
  ['the purple moves a racer along ITS normal, not along the course flow', () => {
    // Find, in real stall lanes, a free spot where the course flow and the purple's
    // normal disagree (flow points sideways at brick height, purple rises upward).
    // Put the purple's front onto a racer there and check which way it is shoved.
    let tested = 0;
    for (let i = 0; i < 12 && tested < 6; i++) {
      const l = generateLevel(seedFromIndex('NRM', i), resolveRaceConfig('medium', { validateRace: false })).level;
      const f = l.field, sr = l.stallRect;
      const spots = [];
      for (const lane of l.stallGeo.lanes) {
        for (let fy = 0.2; fy <= 0.8; fy += 0.02) {
          const x = lane.x + lane.w / 2, y = sr.y + sr.h * fy;
          const idx = f.idxAt(x, y);
          if (!f.free[idx] || !f.isFreeAt(x, y - 5) || !f.isFreeAt(x, y + 5)) continue;
          const dot = f.flowX[idx] * f.pushX[idx] + f.flowY[idx] * f.pushY[idx];
          if (dot < 0.3 && f.pushY[idx] < -0.7) spots.push({ x, y, idx });
        }
      }
      if (!spots.length) continue;
      const sp = spots[Math.floor(spots.length / 2)];
      const sim = new Simulation(l);
      const c = sim.contestants[0];
      c.x = sp.x; c.y = sp.y; c.px = sp.x; c.py = sp.y; c.vx = 0; c.vy = 0.001;
      sim.danger.dist = f.danger[sp.idx] + 1;           // the front has just passed the racer
      sim.checkDanger(c);
      const dx = c.x - sp.x, dy = c.y - sp.y, len = Math.hypot(dx, dy);
      if (!c.alive) return `seed ${i}: racer crushed with free space above it`;
      if (len < 0.5) return `seed ${i}: racer not moved at all`;
      const cos = (dx * f.pushX[sp.idx] + dy * f.pushY[sp.idx]) / len;
      if (cos < 0.9) return `seed ${i}: shoved with cos ${cos.toFixed(2)} to the purple's normal (flow=(${f.flowX[sp.idx].toFixed(2)},${f.flowY[sp.idx].toFixed(2)}), push=(${f.pushX[sp.idx].toFixed(2)},${f.pushY[sp.idx].toFixed(2)}))`;
      // Sweep: the front now rises through the lane at 1.5 px/tick (a fast purple). The
      // racer is pushed up ahead of it and must survive until it is nearly at the ceiling.
      const sim2 = new Simulation(l);
      const c2 = sim2.contestants[0];
      const lane = l.stallGeo.lanes.find((ln) => sp.x >= ln.x && sp.x <= ln.x + ln.w);
      c2.x = c2.px = lane.x + lane.w / 2; c2.y = c2.py = sr.y + sr.h * 0.8; c2.vx = 0; c2.vy = 0.001;
      sim2.danger.dist = 0;
      for (let t = 0; t < 400 && c2.y - sr.y > 24; t++) {
        sim2.danger.dist += 1.5;
        sim2.checkDanger(c2);
        if (!c2.alive) return `seed ${i}: sweep crushed the racer at ${(c2.y - sr.y).toFixed(0)}px below the ceiling (front ${sim2.danger.dist.toFixed(0)})`;
      }
      tested++;
    }
    return tested >= 3 || `only ${tested} suitable lane spots found`;
  }],
  ['tension curve is deterministic, bounded and rises toward the finish', () => {
    const lvl = generateLevel('TEN001', resolveRaceConfig('medium')).level;
    const run = () => {
      const sim = new Simulation(lvl); let v = 0.12; const out = [];
      while (!sim.ended && sim.tick < 120 * 80) { sim.step(); if (sim.tick % 4 === 0) { v = smoothIntensity(v, sim, 4 / 120); out.push(v); } }
      return out;
    };
    const a = run(), b = run();
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) return 'not deterministic';
    if (a.some((x) => x < 0 || x > 1 || !isFinite(x))) return 'out of range';
    const k = Math.floor(a.length / 5), mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
    return mean(a.slice(-k)) > mean(a.slice(0, k)) + 0.05 || `start ${mean(a.slice(0, k)).toFixed(2)} end ${mean(a.slice(-k)).toFixed(2)}`;
  }],
  ['score: intensity levels, seeded key, layered arrangement', () => {
    if ([0.05, 0.3, 0.6, 0.9].map(levelFor).join() !== '0,1,2,3') return 'level thresholds';
    const roots = new Set();
    for (let i = 0; i < 40; i++) { const r = rootFor('K' + i); if (r < 43 || r > 49) return 'root out of range'; roots.add(r); }
    if (roots.size < 4) return 'key does not vary with the seed';
    if (rootFor('SAME') !== rootFor('SAME')) return 'key not deterministic';
    // Count the nodes one bar creates at each level with a recording mock: more layers = more voices.
    const voices = (level, seed) => {
      let n = 0;
      const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
      const node = () => ({ connect() {}, start() { n++; }, stop() {}, frequency: param(), gain: param(), Q: param(), detune: param(), type: '' });
      const ctx = { createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node };
      const e = { ctx, music: {}, noise: {}, rand: () => 0.3, rumble: null, intensityNow: 0.5 };
      for (let bar = 0; bar < 4; bar++) for (let st = 0; st < 16; st++) scheduleStep(e, 10 + bar * 2 + st * 0.1, st, bar, level, rootFor(seed), seed);
      return n;
    };
    const v = [0, 1, 2, 3].map((lv) => voices(lv, 'ARR'));
    if (!(v[0] < v[1] && v[1] < v[2] && v[2] < v[3])) return `voices per level ${v.join(',')} are not increasing`;
    return voices(2, 'ARR') === voices(2, 'ARR') || 'not deterministic';
  }],
  ['audio normalisation reaches the target loudness and never clips', () => {
    const mk = (amp) => { const L = new Float32Array(48000), R = new Float32Array(48000); for (let i = 0; i < L.length; i++) { L[i] = amp * Math.sin(i * 0.05); R[i] = amp * Math.sin(i * 0.05 + 1); } return { numberOfChannels: 2, length: L.length, getChannelData: (c) => (c ? R : L) }; };
    for (const amp of [0.02, 0.1, 0.9, 3]) {
      const buf = mk(amp);
      normalize(buf);
      let peak = 0, sum = 0;
      for (const ch of [buf.getChannelData(0), buf.getChannelData(1)]) for (const x of ch) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      if (peak > 0.92 + 1e-6) return `amp ${amp}: peak ${peak}`;
      const rms = Math.sqrt(sum / (2 * 48000));
      const inRms = amp / Math.SQRT2;                      // rms of the input sine
      const want = Math.min(0.1, inRms * 3.2);             // target loudness, limited by the max gain
      if (amp <= 0.1 && rms < want * 0.9) return `amp ${amp}: rms ${rms.toFixed(3)} below ${want.toFixed(3)}`;
    }
    return true;
  }],
  ['generated maps pass structural validation (30 seeds, all presets)', () => {
    for (const p of ['short', 'medium', 'chaos', 'long']) {
      for (let i = 0; i < 30; i++) {
        const g = generateLevel(seedFromIndex('VAL' + p, i), resolveRaceConfig(p, { validateRace: false }));
        if (!g.level) return `${p} seed ${i}: no valid map`;
        const v = validateStructure(g.level);
        if (!v.ok) return `${p} seed ${i}: ${v.problems.join(', ')}`;
      }
    }
    return true;
  }],
];

export function runSelfTests(filter = null) {
  const results = [];
  for (const [name, fn] of TESTS) {
    if (filter && !name.includes(filter)) continue;
    const t0 = Date.now();
    let pass = false, detail = '';
    try {
      const r = fn();
      pass = r === true;
      if (!pass) detail = String(r);
    } catch (e) { detail = 'threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e); }
    results.push({ name, pass, detail, ms: Date.now() - t0 });
  }
  return results;
}
