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
    weapon: level.weapon, finish: level.finish, route: level.route.map((c) => [c.c, c.r, c.template]),
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
      routes.add(l.route.map((c) => c.c + ',' + c.r).join(';'));
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
  ['danger zone eliminates contestants', () => {
    const lvl = makeArena({ params: { danger: { v0: 400, accel: 0, delay: 0.2, catchGap: 1e9, catchK: 0, maxRate: 400, scale: 1 } } });
    lvl.finish = { x: 120 + 280, y: 200 + 280, w: 10, h: 10 };
    lvl.spawns = [spawn('yellow', 150, 150, 1), spawn('green', 100, 100, 2)];
    const sim = runFor(new Simulation(lvl), 5);
    return sim.contestants.every((c) => !c.alive && c.deathCause === 'danger') || 'contestants survived the purple field';
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
