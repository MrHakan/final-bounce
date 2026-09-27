// Reusable section generators. Each template decorates one route cell given its
// entry/exit connectors. Templates only *propose* geometry: every piece goes
// through ctx.fits(), which keeps door approaches clear and forbids gaps that
// are too narrow for a contestant (no one-pixel corridors).
import { makeWall, makeBumper } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';

export const MIN_GAP = 20;

export function createCellContext(cell, rng, t, intensity) {
  const inner = { x0: cell.x + t / 2, y0: cell.y + t / 2, x1: cell.x + cell.w - t / 2, y1: cell.y + cell.h - t / 2 };
  const keepOut = [];
  for (const side of [cell.entrySide, cell.exitSide]) {
    if (!side) continue;
    const d = cell.doors[side];
    if (!d) continue;
    const depth = 24, pad = 7;
    if (side === 'N') keepOut.push({ x: d.a - pad, y: inner.y0 - 2, w: d.b - d.a + 2 * pad, h: depth });
    if (side === 'S') keepOut.push({ x: d.a - pad, y: inner.y1 - depth + 2, w: d.b - d.a + 2 * pad, h: depth });
    if (side === 'W') keepOut.push({ x: inner.x0 - 2, y: d.a - pad, w: depth, h: d.b - d.a + 2 * pad });
    if (side === 'E') keepOut.push({ x: inner.x1 - depth + 2, y: d.a - pad, w: depth, h: d.b - d.a + 2 * pad });
  }
  const placed = []; // {type:'rect'|'circle', ...}
  const out = { walls: [], bumpers: [], barriers: [], weapon: null };

  const rectGap = (a, b) => {
    const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
    const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
    if (dx === 0 && dy === 0) return -1; // overlap
    return Math.hypot(dx, dy);
  };
  const circleRectGap = (c, r) => {
    const px = Math.max(r.x, Math.min(c.x, r.x + r.w)), py = Math.max(r.y, Math.min(c.y, r.y + r.h));
    return Math.hypot(c.x - px, c.y - py) - c.r;
  };
  const shapeGap = (a, b) => {
    if (a.type === 'rect' && b.type === 'rect') return rectGap(a, b);
    if (a.type === 'circle' && b.type === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
    return a.type === 'circle' ? circleRectGap(a, b) : circleRectGap(b, a);
  };
  const bbox = (s) => s.type === 'rect' ? s : { x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r };

  // attach: which inner sides the shape may touch/overlap ('N','S','E','W').
  const fits = (s, attach = '', group = null) => {
    const b = bbox(s);
    const edges = { W: b.x - inner.x0, E: inner.x1 - (b.x + b.w), N: b.y - inner.y0, S: inner.y1 - (b.y + b.h) };
    for (const k of ['N', 'S', 'E', 'W']) {
      const g = edges[k];
      if (attach.includes(k)) { if (g > 0.5 && g < MIN_GAP) return false; continue; }
      if (g < MIN_GAP) return false;
    }
    for (const k of keepOut) if (rectGap(b, k) < 0) return false;
    for (const p of placed) {
      if (group !== null && p.group === group) continue;
      const g = shapeGap(s, p);
      if (g < MIN_GAP) return false;
    }
    return true;
  };

  const ctx = {
    cell, rng, t, inner, intensity, out, keepOut,
    iw: inner.x1 - inner.x0, ih: inner.y1 - inner.y0,
    cx: (inner.x0 + inner.x1) / 2, cy: (inner.y0 + inner.y1) / 2,
    axis: cell.entrySide === 'N' || cell.entrySide === 'S' ? 'v' : 'h',
    fits,
    // Commit a batch atomically: either every shape fits or nothing is placed.
    commit(shapes) {
      for (const s of shapes) if (!fits(s.shape, s.attach || '', s.group ?? null)) return false;
      for (const s of shapes) {
        placed.push({ ...s.shape, group: s.group ?? null });
        const g = s.shape;
        if (s.as === 'bumper') out.bumpers.push(makeBumper(g.x, g.y, g.r));
        else if (s.as === 'barrier') out.barriers.push(makeBarrier(g.x, g.y, g.w, g.h, s.color, s.hp || 1, s.role || 'room'));
        else out.walls.push(makeWall(g.x, g.y, g.w, g.h, 'obstacle'));
      }
      return true;
    },
    // Build a rect from along/cross coordinates relative to the travel axis.
    axisRect(alongStart, alongLen, crossStart, crossLen) {
      return ctx.axis === 'v'
        ? { type: 'rect', x: crossStart, y: alongStart, w: crossLen, h: alongLen }
        : { type: 'rect', x: alongStart, y: crossStart, w: alongLen, h: crossLen };
    },
    alongRange() { return ctx.axis === 'v' ? [inner.y0, inner.y1] : [inner.x0, inner.x1]; },
    crossRange() { return ctx.axis === 'v' ? [inner.x0, inner.x1] : [inner.y0, inner.y1]; },
    crossSides() { return ctx.axis === 'v' ? ['W', 'E'] : ['N', 'S']; },
  };
  return ctx;
}

const rect = (x, y, w, h) => ({ type: 'rect', x, y, w, h });
const circle = (x, y, r) => ({ type: 'circle', x, y, r });

export const TEMPLATES = {
  EMPTY() { return true; },

  ARENA(ctx) {
    const { rng } = ctx;
    const r = rng.range(10, 15);
    for (let i = 0; i < 8; i++) {
      const x = ctx.cx + rng.range(-12, 12), y = ctx.cy + rng.range(-10, 10);
      if (ctx.commit([{ shape: circle(x, y, r), as: 'bumper' }])) return true;
    }
    return true;
  },

  PINBALL(ctx) {
    const { rng, inner } = ctx;
    const want = rng.int(3, 3 + Math.round(2 * ctx.intensity));
    let n = 0;
    for (let i = 0; i < 40 && n < want; i++) {
      const r = rng.range(6.5, 9.5);
      const x = rng.range(inner.x0 + 22 + r, inner.x1 - 22 - r);
      const y = rng.range(inner.y0 + 22 + r, inner.y1 - 22 - r);
      if (ctx.commit([{ shape: circle(x, y, r), as: 'bumper' }])) n++;
    }
    return n >= 2;
  },

  PILLARS(ctx) {
    const { rng, inner } = ctx;
    const want = rng.int(2, 4);
    let n = 0;
    for (let i = 0; i < 40 && n < want; i++) {
      const s = rng.range(10, 17);
      const x = rng.range(inner.x0 + 20, inner.x1 - 20 - s);
      const y = rng.range(inner.y0 + 20, inner.y1 - 20 - s);
      if (ctx.commit([{ shape: rect(x, y, s, s) }])) n++;
    }
    return n >= 1;
  },

  ZIGZAG(ctx) {
    const { rng, t } = ctx;
    const [a0, a1] = ctx.alongRange(), [c0, c1] = ctx.crossRange();
    const cw = c1 - c0, al = a1 - a0;
    const [sideA, sideB] = ctx.crossSides();
    const first = rng.chance(0.5);
    const shapes = [];
    const positions = [0.36, 0.66];
    positions.forEach((p, k) => {
      const len = cw * rng.range(0.36, 0.46);
      const along = a0 + al * p + rng.range(-3, 3) - t / 2;
      const fromStart = (k === 0) === first;
      const cs = fromStart ? c0 - t / 2 : c1 - len;
      shapes.push({ shape: ctx.axisRect(along, t, cs, len + t / 2), attach: fromStart ? sideA : sideB, group: 'zz' + k });
    });
    return ctx.commit(shapes);
  },

  PARALLEL_LANES(ctx) {
    const { rng, t } = ctx;
    const [a0, a1] = ctx.alongRange(), [c0, c1] = ctx.crossRange();
    const cw = c1 - c0;
    const k = cw > 110 && rng.chance(0.45) ? 2 : 1;
    const len = (a1 - a0) - 52;
    const shapes = [];
    for (let i = 1; i <= k; i++) {
      const pos = c0 + (cw * i) / (k + 1) + rng.range(-5, 5) - t / 2;
      shapes.push({ shape: ctx.axisRect(a0 + 26, len, pos, t) });
    }
    return ctx.commit(shapes);
  },

  CHOKEPOINT(ctx) {
    const { rng, t } = ctx;
    const [a0, a1] = ctx.alongRange(), [c0, c1] = ctx.crossRange();
    const [sideA, sideB] = ctx.crossSides();
    const gap = rng.range(34, 44);
    const along = (a0 + a1) / 2 + rng.range(-6, 6) - t / 2;
    const gs = rng.range(c0 + 22, c1 - 22 - gap);
    return ctx.commit([
      { shape: ctx.axisRect(along, t, c0 - t / 2, gs - c0 + t / 2), attach: sideA, group: 'ck' },
      { shape: ctx.axisRect(along, t, gs + gap, c1 - gs - gap + t / 2), attach: sideB, group: 'ck' },
    ]);
  },

  FUNNEL(ctx) {
    const { rng, t } = ctx;
    const [a0, a1] = ctx.alongRange(), [c0, c1] = ctx.crossRange();
    const [sideA, sideB] = ctx.crossSides();
    const al = a1 - a0;
    const entryIsStart = ctx.cell.entrySide === 'N' || ctx.cell.entrySide === 'W';
    const at = (p) => entryIsStart ? a0 + al * p : a1 - al * p;
    const centre = (c0 + c1) / 2 + rng.range(-12, 12);
    const rows = [[0.38, 62], [0.7, 38]];
    const shapes = [];
    rows.forEach(([p, gap], k) => {
      const along = at(p) - t / 2;
      const g0 = centre - gap / 2, g1 = centre + gap / 2;
      shapes.push({ shape: ctx.axisRect(along, t, c0 - t / 2, g0 - c0 + t / 2), attach: sideA, group: 'fn' + k });
      shapes.push({ shape: ctx.axisRect(along, t, g1, c1 - g1 + t / 2), attach: sideB, group: 'fn' + k });
    });
    return ctx.commit(shapes);
  },

  CORNER(ctx) {
    // Deflector block in the inside corner of a turn + optional bumper outside.
    const { rng, inner, cell } = ctx;
    const s = rng.range(20, 30);
    const sides = cell.entrySide + cell.exitSide;
    const north = sides.includes('N'), west = sides.includes('W');
    const x = west ? inner.x0 - 3 : inner.x1 - s + 3;
    const y = north ? inner.y0 - 3 : inner.y1 - s + 3;
    const placed = ctx.commit([{ shape: rect(x, y, s, s), attach: (north ? 'N' : 'S') + (west ? 'W' : 'E') }]);
    if (rng.chance(0.6)) {
      const r = rng.range(8, 11);
      const bx = west ? inner.x1 - 28 : inner.x0 + 28, by = north ? inner.y1 - 28 : inner.y0 + 28;
      ctx.commit([{ shape: circle(bx, by, r), as: 'bumper' }]);
    }
    return placed;
  },

  POWERUP_ROOM(ctx) {
    const { rng } = ctx;
    for (let i = 0; i < 12; i++) {
      const wx = ctx.cx + rng.range(-8, 8), wy = ctx.cy + rng.range(-8, 8);
      if (!ctx.fits(circle(wx, wy, 12))) continue;
      ctx.out.weapon = { x: wx, y: wy };
      // Guard ring of bumpers makes the blade a contested pinball target.
      const n = rng.int(2, 4), off = rng.range(0, Math.PI * 2), dist = rng.range(32, 38);
      for (let k = 0; k < n; k++) {
        const a = off + (k * Math.PI * 2) / n;
        ctx.commit([{ shape: circle(wx + Math.cos(a) * dist, wy + Math.sin(a) * dist, rng.range(6, 8)), as: 'bumper' }]);
      }
      return true;
    }
    return false;
  },
};

// Coloured blocks standing inside a room: obstacles for everyone except their colour.
export function addRoomBarriers(ctx, colors, count) {
  const { rng, inner } = ctx;
  let n = 0;
  for (let i = 0; i < 40 && n < count; i++) {
    const s = rng.range(16, 22);
    const x = rng.range(inner.x0 + 20, inner.x1 - 20 - s);
    const y = rng.range(inner.y0 + 20, inner.y1 - 20 - s);
    const color = colors[(n + rng.int(0, colors.length - 1)) % colors.length];
    if (ctx.commit([{ shape: rect(x, y, s, s), as: 'barrier', color, role: 'room' }])) n++;
  }
  return n;
}

export function pickTemplate(rng, cell, stage, intensity) {
  if (!rng.chance(0.25 + 0.75 * intensity)) return rng.chance(0.5) ? 'EMPTY' : 'ARENA';
  const straight = cell.shape === 'STRAIGHT';
  const w = straight
    ? { ZIGZAG: 1.6, PARALLEL_LANES: 2, CHOKEPOINT: 1.6, FUNNEL: 1.6, PINBALL: 2.4, PILLARS: 1.6, ARENA: 1 }
    : { CORNER: 3, PINBALL: 2.4, PILLARS: 2, ARENA: 1.2 };
  if (stage === 'CHAOS') { if (w.PINBALL) w.PINBALL *= 1.6; if (w.CHOKEPOINT) w.CHOKEPOINT *= 1.5; }
  if (stage === 'PURSUIT') { if (w.FUNNEL) w.FUNNEL *= 1.6; if (w.PARALLEL_LANES) w.PARALLEL_LANES *= 1.5; }
  if (stage === 'BOUNCE') { if (w.PINBALL) w.PINBALL *= 1.4; if (w.ZIGZAG) w.ZIGZAG *= 1.3; }
  return rng.weighted(Object.entries(w));
}
