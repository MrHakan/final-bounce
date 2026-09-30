// Set pieces: what happens inside one hall of the tower.
//
// A hall is a horizontal band. Racers enter through a door in its floor at one
// end (the start end) and leave through a door in its ceiling at the other end,
// so the course snakes upward. Pieces are written in (u, v) coordinates:
//   u = distance from the START end along the hall (0 .. len)
//   v = distance from the ceiling (0 .. h)
// which keeps every piece independent of the hall's direction.
//
// Every shape goes through fits(): walls, other shapes and the door approaches
// keep at least MIN_GAP of clear space, so no gap is ever too narrow for a
// racer (12 px) and nothing sits in a doorway.
import { makeWall, makeBumper } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';

export const MIN_GAP = 20;
export const GATE_W = 12;   // thickness of a brick gate (along u)

export class BandCtx {
  // band: { x0, y0, x1, y1 (interior), dir (+1 flows right, -1 left),
  //         entry: {a, b} door x-range in the floor, exit: {a, b} in the ceiling }
  constructor(band, rng) {
    this.band = band;
    this.rng = rng;
    this.dir = band.dir;
    this.len = band.x1 - band.x0;
    this.h = band.y1 - band.y0;
    this.placed = [];
    this.out = { walls: [], bumpers: [], barriers: [], weapon: null };
    const pad = 8, depth = 26;
    this.keepOut = [];
    if (band.entry) this.keepOut.push({ x: band.entry.a - pad, y: band.y1 - depth, w: band.entry.b - band.entry.a + 2 * pad, h: depth + 2 });
    if (band.exit) this.keepOut.push({ x: band.exit.a - pad, y: band.y0 - 2, w: band.exit.b - band.exit.a + 2 * pad, h: depth });
  }

  // ---- (u, v) helpers -> world shapes ----
  rect(u, v, wu, hv) {
    const b = this.band;
    return { type: 'rect', x: this.dir > 0 ? b.x0 + u : b.x1 - u - wu, y: b.y0 + v, w: wu, h: hv };
  }

  circle(u, v, r) {
    const b = this.band;
    return { type: 'circle', x: this.dir > 0 ? b.x0 + u : b.x1 - u, y: b.y0 + v, r };
  }

  // ---- collision / clearance ----
  bbox(s) { return s.type === 'rect' ? s : { x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }; }

  gap(a, b) {
    if (a.type === 'rect' && b.type === 'rect') {
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
      return dx === 0 && dy === 0 ? -1 : Math.hypot(dx, dy);
    }
    if (a.type === 'circle' && b.type === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
    const c = a.type === 'circle' ? a : b, r = a.type === 'circle' ? b : a;
    const px = Math.max(r.x, Math.min(c.x, r.x + r.w)), py = Math.max(r.y, Math.min(c.y, r.y + r.h));
    return Math.hypot(c.x - px, c.y - py) - c.r;
  }

  // attach: world sides the shape may touch/overlap ('N' ceiling, 'S' floor, 'W', 'E').
  fits(shape, attach = '', group = null) {
    const b = this.band;
    const bb = this.bbox(shape);
    const edges = { W: bb.x - b.x0, E: b.x1 - (bb.x + bb.w), N: bb.y - b.y0, S: b.y1 - (bb.y + bb.h) };
    for (const k of ['N', 'S', 'E', 'W']) {
      const g = edges[k];
      if (attach.includes(k)) { if (g > 0.5 && g < MIN_GAP) return false; continue; }
      if (g < MIN_GAP) return false;
    }
    for (const k of this.keepOut) if (this.gap(bb, k) < 0) return false;
    for (const p of this.placed) {
      if (group !== null && p.group === group) continue;
      if (this.gap(shape, p) < MIN_GAP) return false;
    }
    return true;
  }

  // Place several shapes atomically: all fit, or nothing is placed.
  commit(items) {
    for (const it of items) if (!this.fits(it.shape, it.attach || '', it.group ?? null)) return false;
    for (const it of items) {
      this.placed.push({ ...it.shape, group: it.group ?? null });
      const g = it.shape;
      if (it.as === 'bumper') this.out.bumpers.push(makeBumper(g.x, g.y, g.r));
      else if (it.as === 'barrier') this.out.barriers.push(makeBarrier(g.x, g.y, g.w, g.h, it.color ?? null, it.hp || 1, it.role || 'gate'));
      else this.out.walls.push(makeWall(g.x, g.y, g.w, g.h, 'obstacle'));
    }
    return true;
  }
}

const rnd = (ctx, a, b) => ctx.rng.range(a, b);

export const PIECES = {
  EMPTY() { return true; },

  // Pinball field: a diamond "plinko" grid or scattered bumpers of mixed size.
  SCATTER(ctx, p = {}) {
    const { len, h } = ctx;
    let n = 0;
    if ((p.style || (ctx.rng.chance(0.65) ? 'plinko' : 'random')) === 'plinko') {
      const r = rnd(ctx, 6.5, 8);
      const rows = h >= 118 ? 3 : 2;
      const lo = MIN_GAP + r + 1, hi = h - MIN_GAP - r - 1;
      const vs = rows === 3 ? [lo, h / 2, hi] : [lo + (hi - lo) * 0.1, hi - (hi - lo) * 0.1];
      const sp = rnd(ctx, 40, 48);
      const cols = Math.floor((len * 0.72) / sp);
      const u0 = len * 0.2 + rnd(ctx, 0, 10);
      for (let i = 0; i < cols; i++) {
        const picks = rows === 3 ? (i % 2 ? [1] : [0, 2]) : [i % 2];
        for (const j of picks) {
          const rr = r + rnd(ctx, -0.8, 1.4);
          if (ctx.commit([{ shape: ctx.circle(u0 + i * sp, vs[j], rr), as: 'bumper' }])) n++;
        }
      }
    } else {
      const want = p.count ?? ctx.rng.int(7, 10);
      for (let i = 0; i < 140 && n < want; i++) {
        const r = rnd(ctx, 6, p.big ? 12 : 10);
        if (ctx.commit([{ shape: ctx.circle(rnd(ctx, 34 + r, len - 34 - r), rnd(ctx, MIN_GAP + r, h - MIN_GAP - r), r), as: 'bumper' }])) n++;
      }
    }
    return n >= 4;
  },

  PILLARS(ctx, p = {}) {
    const { len, h } = ctx;
    const want = p.count ?? ctx.rng.int(3, 5);
    let n = 0;
    for (let i = 0; i < 90 && n < want; i++) {
      const s = rnd(ctx, 12, 20);
      if (ctx.commit([{ shape: ctx.rect(rnd(ctx, 34, len - 34 - s), rnd(ctx, MIN_GAP, h - MIN_GAP - s), s, s) }])) n++;
    }
    return n >= 2;
  },

  // Alternating baffles from ceiling and floor: the racers must snake through.
  SLALOM(ctx, p = {}) {
    const { len, h } = ctx;
    const n = p.count ?? Math.max(3, Math.min(6, Math.round(len / 62)));
    let fromCeiling = ctx.rng.chance(0.5);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const u = len * (0.24 + 0.62 * (i + 0.5) / n);
      const gapH = rnd(ctx, 40, 52);
      const stub = h - gapH;
      if (stub < 20) continue;
      const shape = ctx.rect(u, fromCeiling ? 0 : h - stub, 6, stub);
      if (ctx.commit([{ shape, attach: fromCeiling ? 'N' : 'S' }])) placed++;
      fromCeiling = !fromCeiling;
    }
    // Texture: a small bumper in the open lane between some baffles.
    if (p.accents !== false) {
      for (let i = 0; i < 4; i++) {
        const u = len * (0.3 + 0.55 * (i + 0.5) / 4) + rnd(ctx, -10, 10);
        ctx.commit([{ shape: ctx.circle(u, h * rnd(ctx, 0.35, 0.65), rnd(ctx, 5.5, 7)), as: 'bumper' }]);
      }
    }
    return placed >= 2;
  },

  // A long divider splits the hall into two lanes joined at both ends.
  LANES(ctx, p = {}) {
    const { len, h } = ctx;
    if (h < 84) return false;
    const v = h * rnd(ctx, 0.44, 0.56) - 3;
    const L = len * rnd(ctx, 0.5, 0.62);
    const u0 = len * rnd(ctx, 0.2, 0.3);
    if (!ctx.commit([{ shape: ctx.rect(u0, v, L, 6) }])) return false;
    // Different character in each lane: one gets a bumper, the other stays clean.
    const lane = ctx.rng.chance(0.5);
    const cy = lane ? v / 2 : v + 6 + (h - v - 6) / 2;
    ctx.commit([{ shape: ctx.circle(u0 + L * rnd(ctx, 0.35, 0.65), cy, 6.5), as: 'bumper' }]);
    return true;
  },

  // Two converging baffle pairs: a wide mouth, then a tight neck.
  FUNNEL(ctx, p = {}) {
    const { len, h } = ctx;
    const stages = [[len * rnd(ctx, 0.42, 0.5), rnd(ctx, 58, 68)], [len * rnd(ctx, 0.64, 0.74), rnd(ctx, 36, 42)]];
    const items = [];
    stages.forEach(([u, g], k) => {
      const vc = Math.max(g / 2 + 14, Math.min(h - g / 2 - 14, h / 2 + rnd(ctx, -14, 14)));
      items.push({ shape: ctx.rect(u, 0, 6, vc - g / 2), attach: 'N', group: 'f' + k });
      items.push({ shape: ctx.rect(u, vc + g / 2, 6, h - vc - g / 2), attach: 'S', group: 'f' + k });
    });
    return ctx.commit(items);
  },

  // Blade in the middle of a ring of bumpers: the contested room.
  ARMORY(ctx, p = {}) {
    const { len, h } = ctx;
    for (let i = 0; i < 14; i++) {
      const u = len * rnd(ctx, 0.42, 0.58), v = h * rnd(ctx, 0.44, 0.56);
      if (!ctx.fits(ctx.circle(u, v, 12))) continue;
      const w = ctx.circle(u, v, 0);
      ctx.out.weapon = { x: w.x, y: w.y };
      const n = ctx.rng.int(3, 4), off = rnd(ctx, 0, Math.PI * 2), dist = rnd(ctx, 34, 40);
      for (let k = 0; k < n; k++) {
        const a = off + (k * Math.PI * 2) / n;
        ctx.commit([{ shape: ctx.circle(u + Math.cos(a) * dist, v + Math.sin(a) * dist, rnd(ctx, 6, 8)), as: 'bumper' }]);
      }
      // Cover: a couple of pillars so the blade holder cannot see everything.
      for (let k = 0; k < 6; k++) {
        const sz = rnd(ctx, 12, 18);
        ctx.commit([{ shape: ctx.rect(rnd(ctx, 34, len - 34 - sz), rnd(ctx, MIN_GAP, h - MIN_GAP - sz), sz, sz) }]);
      }
      return true;
    }
    return false;
  },
};

// A full-height wall of same-colour bricks: only that colour can open it.
// Each brick breaks on its own, so one hit opens a racer-sized hole.
export function placeGate(ctx, color, uFrac) {
  const { len, h } = ctx;
  const n = h >= 100 ? 3 : 2;
  const bh = h / n;
  const items = [];
  for (let i = 0; i < n; i++) {
    const attach = (i === 0 ? 'N' : '') + (i === n - 1 ? 'S' : '');
    items.push({ shape: ctx.rect(0, 0, GATE_W, bh), attach, group: 'gate', as: 'barrier', color, hp: 1, role: 'gate' });
  }
  for (let t = 0; t < 12; t++) {
    const u = len * (uFrac + (t % 2 ? 1 : -1) * 0.02 * Math.ceil(t / 2));
    const clamped = Math.max(60, Math.min(len - 60, u));
    items.forEach((it, i) => { it.shape = ctx.rect(clamped, i * bh, GATE_W, bh); });
    if (ctx.commit(items)) return clamped;
  }
  return null;
}
