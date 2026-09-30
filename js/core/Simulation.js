// Deterministic race simulation. Pure logic: no DOM, no timers, no Math.random.
// One call to step() advances exactly one fixed tick (1/120 s). Rendering,
// audio and recording only *read* from it, so the same seed + config always
// produces the same race, headless or on screen, at any playback speed.
import { DT, PHYSICS, LAYOUT, contestantById } from '../config/presets.js';
import { hash2 } from './RNG.js';
import { Contestant } from '../entities/Contestant.js';
import { Weapon } from '../entities/Weapon.js';
import { FinishZone } from '../entities/FinishZone.js';
import { DangerZone } from '../entities/DangerZone.js';
import { SpatialGrid } from '../physics/SpatialGrid.js';
import { circleRect, circleCircle, contact } from '../physics/Collision.js';

// A racer is crushed when the purple reaches this fraction of its half-size
// from its centre (i.e. it could not be pushed out of the way).
const CRUSH = 0.25;

// How strongly a racer in a stall ricochets toward an open hole ahead of it.
const STALL_BIAS = 0.7;

const MAJOR = new Set(['weaponPickup', 'kill', 'dangerDeath', 'nearMiss', 'barrierBreak', 'finalBreak',
  'finish', 'leadChange', 'weaponBreak', 'weaponLost', 'antiStuck', 'orphan', 'raceEnd']);

export class Simulation {
  constructor(level) {
    this.level = level;
    this.field = level.field;
    this.params = level.params;
    this.tick = 0;
    this.time = 0;
    this.contestants = level.spawns.map((s, i) => new Contestant(contestantById(s.id), i, s, s.speed, LAYOUT.contestantSize));

    // Colliders are copied per simulation so several simulations of the same
    // level (preview, headless test, cover capture) never share mutable state.
    this.grid = new SpatialGrid(level.width, level.height, 32);
    for (const w of level.walls) { const o = { kind: 'wall', x: w.x, y: w.y, w: w.w, h: w.h }; this.grid.insert(o, o.x, o.y, o.w, o.h); }
    this.bumpers = level.bumpers.map((b) => ({ kind: 'bumper', x: b.x, y: b.y, r: b.r, hit: -1 }));
    for (const o of this.bumpers) this.grid.insert(o, o.x - o.r, o.y - o.r, 2 * o.r, 2 * o.r);
    this.barriers = level.barriers.map((b) => ({ ...b, alive: true, lastHitTick: -999 }));
    for (const b of this.barriers) this.grid.insert(b, b.x, b.y, b.w, b.h);
    this.weapon = level.weapon ? new Weapon(level.weapon.x, level.weapon.y, this.params.weaponKills) : null;
    this.finish = new FinishZone(level.finish);
    this.danger = new DangerZone(this.params.danger, this.field);

    this.events = [];   // events produced by the latest step (drained by the caller)
    this.log = [];      // highlight timeline of the whole race
    this.ended = false;
    this.endTick = null;
    this.endReason = null;
    this.winner = null;
    this.finishOrder = [];
    this.leader = null;
    this.leadChanges = 0;
    this.leaderTicks = {};
    this.samples = [];  // coarse progress samples for scoring
    this.minDangerGapByLate = {};
    this.lastNx = 0; this.lastNy = 0;
    this.stallRect = level.stallRect || null;
    // Stall columns: the brick column ahead of each lane, for hole-seeking bounces.
    this.stallGeo = level.stallGeo || null;
    this.stallCols = this.stallGeo
      ? this.stallGeo.bricks.map((b) => this.barriers.filter((bar) => bar.role === 'stall' && Math.abs(bar.x - b.x) < 0.5))
      : null;
  }

  emit(type, data) {
    const e = { type, time: this.time, tick: this.tick, ...data };
    this.events.push(e);
    if (MAJOR.has(type)) this.log.push(e);
  }

  get aliveCount() { let n = 0; for (const c of this.contestants) if (c.alive) n++; return n; }
  get activeCount() { let n = 0; for (const c of this.contestants) if (c.active) n++; return n; }

  step() {
    this.events.length = 0;
    if (this.ended) return;
    this.tick++;
    this.time = this.tick * DT;
    const cs = this.contestants, n = cs.length;

    // Purple front advances first (uses the rearmost survivor for catch-up).
    let rear = Infinity;
    for (const c of cs) if (c.active && c.courseDist < rear) rear = c.courseDist;
    this.danger.update(this.time, rear, DT);

    // Move in a rotating order so no colour is structurally processed first.
    for (let k = 0; k < n; k++) {
      const c = cs[(k + this.tick) % n];
      c.px = c.x; c.py = c.y;
      if (!c.alive || c.finished) continue;
      this.move(c);
    }

    this.interactions();
    this.pickups();

    for (let k = 0; k < n; k++) {
      const c = cs[(k + this.tick) % n];
      if (!c.active) continue;
      this.updateProgress(c);
      if (this.finish.contains(c.x, c.y)) { this.onFinish(c); continue; }
      this.checkDanger(c);
    }

    if (this.tick % 60 === 0) this.antiStuck();
    if (this.tick % 15 === 0) this.trackLeader();
    this.checkEnd();
  }

  move(c) {
    const P = PHYSICS;
    const target = c.baseSpeed * Math.min(P.maxSpeedFactor, 1 + P.speedRamp * this.time);
    c.speed = target;

    // Weak course current: only acts on contestants heading back up the course.
    const f = this.field;
    const fi = f.idxAt(c.x, c.y);
    const fx = f.flowX[fi], fy = f.flowY[fi];
    if (this.params.pull > 0 && (fx !== 0 || fy !== 0) && !this.inStall(c)) {
      const vl = Math.hypot(c.vx, c.vy) || 1;
      const dot = (c.vx * fx + c.vy * fy) / vl;
      if (dot < -0.2) {
        const k = (-0.2 - dot) / 0.8;
        c.vx += fx * this.params.pull * k * DT;
        c.vy += fy * this.params.pull * k * DT;
      }
    }
    this.normalize(c);

    const stepLen = c.speed * DT;
    const nsub = Math.max(1, Math.ceil(stepLen / (c.r * 0.5)));
    const sdt = DT / nsub;
    for (let s = 0; s < nsub; s++) {
      c.x += c.vx * sdt;
      c.y += c.vy * sdt;
      this.resolveStatic(c);
      if (!c.alive) return;
    }
  }

  // Inside the starting stalls racers move as pure billiards (no course bias),
  // so they hit the bricks on both sides of their lane.
  inStall(c) {
    const r = this.stallRect;
    return !!r && c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
  }

  normalize(c) {
    const l = Math.hypot(c.vx, c.vy);
    if (l < 1e-6) { c.vx = c.speed; c.vy = 0; return; }
    c.vx = (c.vx / l) * c.speed;
    c.vy = (c.vy / l) * c.speed;
  }

  // Prevent perfectly axis-aligned trajectories (endless ping-pong between walls).
  axisGuard(c) {
    const s = c.speed, m = Math.sin(PHYSICS.minAxisAngle) * s;
    const alt = ((c.index + this.tick) & 1) ? 1 : -1;
    if (Math.abs(c.vx) < m) {
      const sx = c.vx !== 0 ? Math.sign(c.vx) : alt;
      c.vx = sx * m;
      c.vy = (c.vy >= 0 ? 1 : -1) * Math.sqrt(s * s - m * m);
    } else if (Math.abs(c.vy) < m) {
      const sy = c.vy !== 0 ? Math.sign(c.vy) : alt;
      c.vy = sy * m;
      c.vx = (c.vx >= 0 ? 1 : -1) * Math.sqrt(s * s - m * m);
    }
  }

  resolveStatic(c) {
    const r = c.r;
    const list = this.grid.query(c.x - r - 1, c.y - r - 1, 2 * r + 2, 2 * r + 2);
    let bounced = false;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.kind === 'bumper') {
        if (!circleCircle(c.x, c.y, r, o.x, o.y, o.r)) continue;
        if (this.push(c)) { bounced = true; o.hit = this.tick; this.emit('bumper', { actor: c.id, x: o.x, y: o.y, r: o.r }); }
        continue;
      }
      if (o.kind === 'barrier') {
        if (!o.alive || !circleRect(c.x, c.y, r, o)) continue;
        const approaching = c.vx * contact.nx + c.vy * contact.ny < 0;
        if (o.color !== null && o.color === c.id) {
          // Matching colour breaks the block, but every contact is still a
          // collision: the racer bounces off it.
          o.alive = false;
          c.blocksDestroyed++;
          this.emit('barrierBreak', { actor: c.id, color: o.color, role: o.role, id: o.id, x: o.x + o.w / 2, y: o.y + o.h / 2, w: o.w, h: o.h });
          if (this.push(c)) bounced = true;
          continue;
        }
        if (o.color === null) {
          if (approaching && this.tick - o.lastHitTick > 6) {
            o.lastHitTick = this.tick;
            o.hp--;
            if (o.hp <= 0) {
              o.alive = false;
              c.blocksDestroyed++;
              this.emit('finalBreak', { actor: c.id, id: o.id, role: o.role, x: o.x + o.w / 2, y: o.y + o.h / 2, w: o.w, h: o.h });
            } else {
              this.emit('barrierDamage', { actor: c.id, id: o.id, hp: o.hp, maxHp: o.maxHp, x: o.x + o.w / 2, y: o.y + o.h / 2 });
            }
          }
          if (this.push(c)) bounced = true;
          continue;
        }
        if (this.push(c)) { bounced = true; this.emit('bounce', { actor: c.id, on: 'barrier', x: c.x, y: c.y }); }
        continue;
      }
      if (!circleRect(c.x, c.y, r, o)) continue;
      if (this.push(c)) { bounced = true; this.emit('bounce', { actor: c.id, on: 'wall', x: c.x, y: c.y }); }
    }
    if (bounced) {
      c.bounces++;
      this.bounceBias(c);
      this.normalize(c);
      this.axisGuard(c);
    }
  }

  // Inside the stalls there is no course bias (racers must hit the bricks on
  // both sides of their lane) EXCEPT once the brick column ahead has a hole:
  // then the racer ricochets toward it, so an opened puzzle does not stall.
  stallBias(c) {
    const geo = this.stallGeo;
    if (!geo) return;
    let lane = -1;
    for (let k = 0; k < geo.lanes.length; k++) if (c.x >= geo.lanes[k].x && c.x <= geo.lanes[k].x + geo.lanes[k].w) { lane = k; break; }
    if (lane < 0) return;
    let best = null, bd = Infinity;
    for (const bar of this.stallCols[lane]) {
      if (bar.alive) continue;
      const d = Math.abs(bar.y + bar.h / 2 - c.y);
      if (d < bd) { bd = d; best = bar; }
    }
    if (!best) return;
    const tx = best.x + best.w / 2 - c.x, ty = best.y + best.h / 2 - c.y;
    const tl = Math.hypot(tx, ty) || 1;
    const l = Math.hypot(c.vx, c.vy) || 1;
    const k = STALL_BIAS;
    let dx = (c.vx / l) * (1 - k) + (tx / tl) * k, dy = (c.vy / l) * (1 - k) + (ty / tl) * k;
    const away = dx * this.lastNx + dy * this.lastNy;
    if (away < 0.15) { dx += this.lastNx * (0.15 - away); dy += this.lastNy * (0.15 - away); }
    c.vx = dx; c.vy = dy;
  }

  // Course-biased ricochet: after a bounce the outgoing direction is blended
  // toward the local course direction. Motion between bounces stays straight.
  bounceBias(c) {
    if (this.inStall(c)) { this.stallBias(c); return; }
    const b = this.params.bounceBias;
    if (b <= 0) return;
    const f = this.field;
    const i = f.idxAt(c.x, c.y);
    const fx = f.flowX[i], fy = f.flowY[i];
    if (fx === 0 && fy === 0) return;
    const l = Math.hypot(c.vx, c.vy) || 1;
    let dx = (c.vx / l) * (1 - b) + fx * b, dy = (c.vy / l) * (1 - b) + fy * b;
    // Never steer back into the surface we just left.
    const nx = this.lastNx, ny = this.lastNy;
    const away = dx * nx + dy * ny;
    if (away < 0.2) { dx += nx * (0.2 - away); dy += ny * (0.2 - away); }
    c.vx = dx; c.vy = dy;
  }

  // Positional correction + reflection V' = V - 2(V.N)N using the shared contact.
  push(c) {
    this.lastNx = contact.nx; this.lastNy = contact.ny;
    c.x += contact.nx * contact.depth;
    c.y += contact.ny * contact.depth;
    const vn = c.vx * contact.nx + c.vy * contact.ny;
    if (vn < 0) {
      c.vx -= 2 * vn * contact.nx;
      c.vy -= 2 * vn * contact.ny;
      return true;
    }
    return false;
  }

  interactions() {
    const cs = this.contestants, n = cs.length;
    for (let i = 0; i < n; i++) {
      const a = cs[i];
      if (!a.active) continue;
      for (let j = i + 1; j < n; j++) {
        const b = cs[j];
        if (!b.active || !a.active) continue;
        if (!circleCircle(a.x, a.y, a.r, b.x, b.y, b.r)) continue;
        if (a.hasWeapon !== b.hasWeapon) {
          const killer = a.hasWeapon ? a : b, victim = a.hasWeapon ? b : a;
          this.kill(victim, 'kill', killer);
          continue;
        }
        const nx = contact.nx, ny = contact.ny, depth = contact.depth; // from b to a
        a.x += nx * depth * 0.5; a.y += ny * depth * 0.5;
        b.x -= nx * depth * 0.5; b.y -= ny * depth * 0.5;
        const van = a.vx * nx + a.vy * ny, vbn = b.vx * nx + b.vy * ny;
        if (van - vbn < 0) {
          // Equal-mass elastic exchange of normal components.
          a.vx += (vbn - van) * nx; a.vy += (vbn - van) * ny;
          b.vx += (van - vbn) * nx; b.vy += (van - vbn) * ny;
          this.normalize(a); this.normalize(b);
          this.axisGuard(a); this.axisGuard(b);
          this.emit('collision', { actor: a.id, target: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, armed: a.hasWeapon && b.hasWeapon });
        }
      }
    }
  }

  pickups() {
    const w = this.weapon;
    if (!w || w.state !== 'ground') return;
    const cs = this.contestants, n = cs.length;
    for (let k = 0; k < n; k++) {
      const c = cs[(k + this.tick) % n];
      if (!c.active) continue;
      const dx = c.x - w.x, dy = c.y - w.y, rr = c.r + w.pickupRadius;
      if (dx * dx + dy * dy < rr * rr) {
        w.state = 'held'; w.holder = c.id; w.pickupTime = this.time;
        c.hasWeapon = true;
        this.emit('weaponPickup', { actor: c.id, x: w.x, y: w.y });
        return;
      }
    }
  }

  updateProgress(c) {
    const f = this.field;
    const i = f.idxAt(c.x, c.y);
    const d = f.distS[i];
    if (isFinite(d)) c.courseDist = d;
    c.progress = f.progressAt(c.x, c.y);
    if (c.progress > c.maxProgress) c.maxProgress = c.progress;
  }

  // The purple field is a solid, advancing wall. Touching it only bounces a
  // racer and pushes it down the course; a racer dies when it is crushed:
  // the field keeps advancing but walls, closed gates or a dead end stop the
  // racer from being pushed any further.
  checkDanger(c) {
    const dz = this.danger;
    const f = this.field;
    let i = f.idxAt(c.x, c.y);
    let gap = f.dangerAt(c.x, c.y) - dz.dist;
    c.dangerGap = gap;
    if (dz.dist <= 0) return;
    if (gap < c.r) {
      const fx = f.pushX[i], fy = f.pushY[i];
      if (fx !== 0 || fy !== 0) {
        const push = Math.min(6, c.r - gap);
        c.x += fx * push; c.y += fy * push;
        const vn = c.vx * fx + c.vy * fy;
        if (vn < 0) {
          c.vx -= 2 * vn * fx; c.vy -= 2 * vn * fy;
          this.normalize(c); this.axisGuard(c);
          this.emit('bounce', { actor: c.id, on: 'purple', x: c.x, y: c.y });
        }
        // Walls and closed blocks push back; if they win, the gap closes.
        this.resolveStatic(c);
        if (!c.alive) return;
        gap = f.dangerAt(c.x, c.y) - dz.dist;
        c.dangerGap = gap;
      }
      if (gap < c.r * CRUSH) { this.kill(c, 'danger', null); return; }
    }
    if (gap < c.size * 1.5 && this.time - c.lastNearMiss > 2.5) {
      c.lastNearMiss = this.time;
      this.emit('nearMiss', { actor: c.id, gap, x: c.x, y: c.y });
    }
  }

  kill(c, cause, killer) {
    if (!c.alive) return;
    c.alive = false;
    c.deathTime = this.time;
    c.deathCause = cause;
    c.killedBy = killer ? killer.id : null;
    c.vx = 0; c.vy = 0;
    if (killer) {
      killer.kills++;
      this.emit('kill', { actor: killer.id, target: c.id, x: c.x, y: c.y });
      const w = this.weapon;
      if (w && w.state === 'held' && w.holder === killer.id) {
        w.killsLeft--;
        if (w.killsLeft <= 0) {
          w.state = 'gone'; killer.hasWeapon = false;
          this.emit('weaponBreak', { actor: killer.id, x: killer.x, y: killer.y });
        }
      }
    } else {
      this.emit('dangerDeath', { actor: c.id, x: c.x, y: c.y });
    }
    this.emit('eliminated', { actor: c.id, cause, by: c.killedBy, x: c.x, y: c.y });
    if (c.hasWeapon) {
      c.hasWeapon = false;
      if (this.weapon) { this.weapon.state = 'gone'; this.emit('weaponLost', { actor: c.id, x: c.x, y: c.y }); }
    }
    // A dead colour must never softlock the course: its barriers go neutral.
    let orphaned = 0;
    for (const b of this.barriers) {
      if (b.alive && b.color === c.id) { b.color = null; b.hp = 1; b.maxHp = 1; b.role = 'orphan'; orphaned++; }
    }
    if (orphaned) this.emit('orphan', { actor: c.id, count: orphaned });
  }

  onFinish(c) {
    c.finished = true;
    c.finishTime = this.time;
    c.vx = 0; c.vy = 0;
    c.progress = 1; c.maxProgress = 1;
    this.finishOrder.push(c.id);
    c.place = this.finishOrder.length;
    this.emit('finish', { actor: c.id, place: c.place, x: c.x, y: c.y, gap: this.danger.active ? c.dangerGap : Infinity });
    if (!this.winner) {
      this.winner = c.id;
      if (this.params.raceMode === 'first') this.scheduleEnd(PHYSICS.postWinSeconds, 'winner');
    }
  }

  antiStuck() {
    for (const c of this.contestants) {
      if (!c.active) continue;
      const ring = c.stuckRing;
      ring[c.stuckHead * 2] = c.x; ring[c.stuckHead * 2 + 1] = c.y;
      c.stuckHead = (c.stuckHead + 1) % 8;
      if (c.stuckCount < 8) { c.stuckCount++; continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const x = ring[i * 2], y = ring[i * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (Math.max(x1 - x0, y1 - y0) < c.size * 2.5) {
        // Deterministic nudge derived from simulation state.
        const h = hash2(this.tick, c.index + 17);
        const ang = (0.45 + 0.6 * h) * (hash2(c.index, this.tick) < 0.5 ? -1 : 1);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const vx = c.vx * cs - c.vy * sn, vy = c.vx * sn + c.vy * cs;
        c.vx = vx; c.vy = vy;
        this.normalize(c);
        c.stuckCount = 0;
        this.emit('antiStuck', { actor: c.id, x: c.x, y: c.y });
      }
    }
  }

  trackLeader() {
    let best = null;
    for (const c of this.contestants) if (c.active && (!best || c.progress > best.progress)) best = c;
    if (best) this.leaderTicks[best.id] = (this.leaderTicks[best.id] || 0) + 1;
    const cur = this.leader ? this.contestants.find((c) => c.id === this.leader) : null;
    if (best && best.id !== this.leader) {
      if (!cur || !cur.active || best.progress > cur.progress + 0.015) {
        if (cur && cur.active && this.time > 1) {
          this.leadChanges++;
          this.emit('leadChange', { actor: best.id, target: cur.id });
        }
        this.leader = best.id;
      }
    }
    if (this.tick % 60 === 0) {
      this.samples.push({ t: this.time, p: this.contestants.map((c) => (c.alive ? c.progress : -1)), d: this.danger.progress });
    }
  }

  scheduleEnd(seconds, reason) {
    if (this.endTick !== null) return;
    this.endTick = this.tick + Math.round(seconds / DT);
    this.endReason = reason;
  }

  checkEnd() {
    if (this.endTick === null) {
      if (this.activeCount === 0) this.scheduleEnd(PHYSICS.postWinSeconds, this.winner ? 'finished' : 'eliminated');
      else if (this.time >= this.params.timeout) this.scheduleEnd(0, 'timeout');
    }
    if (this.endTick !== null && this.tick >= this.endTick) {
      this.ended = true;
      this.emit('raceEnd', { winner: this.winner, reason: this.endReason });
    }
  }

  runToEnd(maxSeconds = 120) {
    const maxTicks = Math.round(maxSeconds / DT);
    while (!this.ended && this.tick < maxTicks) this.step();
    return this.result();
  }

  result() {
    const w = this.winner ? this.contestants.find((c) => c.id === this.winner) : null;
    return {
      seed: this.level.seed,
      winner: this.winner,
      winTime: w ? w.finishTime : null,
      duration: this.time,
      endTick: this.tick,
      endReason: this.endReason,
      finishOrder: this.finishOrder.slice(),
      leadChanges: this.leadChanges,
      contestants: this.contestants.map((c) => ({
        id: c.id, alive: c.alive, finished: c.finished, finishTime: c.finishTime, place: c.place,
        deathTime: c.deathTime, deathCause: c.deathCause, killedBy: c.killedBy, kills: c.kills,
        blocksDestroyed: c.blocksDestroyed, maxProgress: c.maxProgress, bounces: c.bounces,
      })),
      log: this.log.map((e) => ({ ...e })),
    };
  }
}
