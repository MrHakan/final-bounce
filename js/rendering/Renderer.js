// Canvas 2D renderer. Draws at 1080x1920 (2x the 540x960 logical space).
// Only the simulation, the HUD strip and short gameplay messages are drawn
// here; creator UI lives in the DOM and is never part of the recorded canvas.
//
// Visual language: dark charcoal surround, pale grey floor with a faint grid,
// cream walls with thin charcoal outlines, flat saturated squares, a stepped
// purple field. No glow, no gradients, no decoration without a gameplay job.
import { VIEW_W, VIEW_H, RENDER_SCALE, CONTESTANTS, contestantById } from '../config/presets.js';
import { TILE } from '../generation/CourseField.js';
import { PIP } from './Camera.js';

export const PALETTE = {
  void: '#15171c',
  voidLine: 'rgba(255,255,255,0.022)',
  floor: '#c8cdd3',
  grid: 'rgba(28,36,48,0.075)',
  wall: '#eee6d6',
  ink: '#16171b',
  purple: '#3a1462',
  purpleEdge: '#6a34ab',
  grey: '#8f99a7',
  greyLight: '#a3acb8',
  greyDark: '#76808e',
  steel: '#e7eaee',
  handle: '#2b2522',
  text: '#ece8df',
  muted: '#8a909a',
  hudBg: '#1d2027',
  hudLine: '#2d313a',
  track: '#262a32',
  checkA: '#f1f1ee',
  checkB: '#474b53',
};

export const FONT_LABEL = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

const GRID = 24;
const TRAIL_LEN = 8;
const ease = (t) => 1 - (1 - t) * (1 - t); // quick ease-out, no overshoot
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = VIEW_W * RENDER_SCALE;
    canvas.height = VIEW_H * RENDER_SCALE;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.level = null;
    this.trails = CONTESTANTS.map(() => ({ xs: new Float32Array(TRAIL_LEN), ys: new Float32Array(TRAIL_LEN), n: 0, head: 0 }));
    this.voidPattern = null;
  }

  setLevel(level) {
    this.level = level;
    this.buildStatic(level);
    this.resetTrails();
  }

  resetTrails() { for (const t of this.trails) { t.n = 0; t.head = 0; } }

  // ---------- static layers (built once per level) ----------
  buildStatic(level) {
    const S = RENDER_SCALE;
    const W = level.width, H = level.height;
    const f = level.field;

    const floor = makeCanvas(Math.ceil(W * S), Math.ceil(H * S));
    const g = floor.getContext('2d');
    g.scale(S, S);
    g.fillStyle = PALETTE.floor;
    for (const c of level.route) g.fillRect(c.x, c.y, c.w, c.h);
    // Sealed pockets (unreachable floor) read as solid.
    g.fillStyle = PALETTE.wall;
    for (const c of level.route) {
      const tx0 = Math.floor(c.x / TILE), tx1 = Math.ceil((c.x + c.w) / TILE);
      const ty0 = Math.floor(c.y / TILE), ty1 = Math.ceil((c.y + c.h) / TILE);
      for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) {
        const i = ty * f.cols + tx;
        if (!f.floor[i] && f.free[i]) g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    // Faint square grid, aligned to world space so motion reads as distance.
    g.strokeStyle = PALETTE.grid;
    g.lineWidth = 0.75;
    g.beginPath();
    for (const c of level.route) {
      for (let x = Math.ceil(c.x / GRID) * GRID; x < c.x + c.w; x += GRID) { g.moveTo(x, c.y); g.lineTo(x, c.y + c.h); }
      for (let y = Math.ceil(c.y / GRID) * GRID; y < c.y + c.h; y += GRID) { g.moveTo(c.x, y); g.lineTo(c.x + c.w, y); }
    }
    g.stroke();
    // Finish: flat checkerboard, no label needed.
    const fz = level.finish;
    const q = 8;
    g.save(); g.beginPath(); g.rect(fz.x, fz.y, fz.w, fz.h); g.clip();
    for (let y = fz.y, j = 0; y < fz.y + fz.h; y += q, j++) for (let x = fz.x, i = 0; x < fz.x + fz.w; x += q, i++) {
      g.fillStyle = (i + j) % 2 ? PALETTE.checkA : PALETTE.checkB;
      g.fillRect(x, y, q, q);
    }
    g.restore();
    g.strokeStyle = PALETTE.ink; g.lineWidth = 1.25;
    g.strokeRect(fz.x + 0.6, fz.y + 0.6, fz.w - 1.2, fz.h - 1.2);

    // Walls + bumpers on a transparent layer drawn above the purple field.
    const wl = makeCanvas(Math.ceil(W * S), Math.ceil(H * S));
    const h = wl.getContext('2d');
    h.scale(S, S);
    const o = 1.25; // outline width (2.5 px at 1080p)
    h.fillStyle = PALETTE.ink;
    for (const w of level.walls) h.fillRect(w.x - o, w.y - o, w.w + 2 * o, w.h + 2 * o);
    for (const b of level.bumpers) { h.beginPath(); h.arc(b.x, b.y, b.r + o, 0, Math.PI * 2); h.fill(); }
    h.fillStyle = PALETTE.wall;
    for (const w of level.walls) h.fillRect(w.x, w.y, w.w, w.h);
    for (const b of level.bumpers) {
      h.fillStyle = PALETTE.wall;
      h.beginPath(); h.arc(b.x, b.y, b.r, 0, Math.PI * 2); h.fill();
      h.fillStyle = PALETTE.ink;
      h.fillRect(b.x - 1, b.y - 1, 2, 2);
    }
    this.floorLayer = floor;
    this.wallLayer = wl;
  }

  drawVoid() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Almost invisible diagonal hatching (screen space, fixed: it must not swim).
    ctx.strokeStyle = PALETTE.voidLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const W = this.canvas.width, H = this.canvas.height;
    for (let k = -H; k < W; k += 22) { ctx.moveTo(k, 0); ctx.lineTo(k + H, H); }
    ctx.stroke();
  }

  // frame: { sim, alpha, camera, view, particles, pres, debug }
  draw(frame) {
    const { ctx } = this;
    const S = RENDER_SCALE;
    const { sim, camera: cam, view } = frame;
    const level = this.level;
    this.drawVoid();
    if (!level) { ctx.setTransform(S, 0, 0, S, 0, 0); this.drawHud(frame); return; }

    const z = cam.zoom * S;
    ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + cam.shakeX) * S, (-cam.y * cam.zoom + cam.shakeY) * S);
    const a = frame.alpha ?? 1;
    this.drawScene(sim, view, a, cam.y, cam.y + VIEW_H / cam.zoom, frame.updateTrails !== false, frame.clock || 0);
    if (frame.particles && view.particles) frame.particles.draw(ctx);
    if (view.debug && sim) this.drawDebugWorld(sim, a);

    ctx.setTransform(S, 0, 0, S, 0, 0);
    if (sim && cam.pip) this.drawPip(sim, view, a, cam.pip);
    this.drawHud(frame);
  }

  // World pass shared by the main view and the inset camera. The caller sets
  // the transform; top/bottom (world y) limit the purple scan to what is visible.
  drawScene(sim, view, a, top, bottom, updateTrails, clock) {
    const { ctx } = this;
    const level = this.level;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.floorLayer, 0, 0, level.width, level.height);
    if (sim) {
      this.drawDanger(sim, top, bottom);
      if (view.trails) this.drawTrails(sim, a, updateTrails);
    }
    ctx.drawImage(this.wallLayer, 0, 0, level.width, level.height);
    if (sim) {
      this.drawBumperHits(sim);
      this.drawBarriers(sim);
      this.drawWeaponPickup(sim, clock);
      this.drawContestants(sim, a, view);
    }
  }

  // Circular inset camera following a racer that broke away from the pack.
  drawPip(sim, view, a, pip) {
    const c = sim.contestants.find((x) => x.id === pip.id);
    if (!c || pip.alpha <= 0) return;
    const { ctx } = this;
    const S = RENDER_SCALE;
    const { x: px, y: py, r, zoom } = PIP;
    const k = Math.min(1, pip.alpha);
    ctx.save();
    ctx.globalAlpha = 1;
    // Outline first (so the clip edge stays crisp), then the clipped world.
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath(); ctx.arc(px, py, r + 2.5 * k, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, r * (0.85 + 0.15 * k), 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = PALETTE.void; ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    const z = zoom * S;
    ctx.setTransform(z, 0, 0, z, (px - pip.x * zoom) * S, (py - pip.y * zoom) * S);
    this.drawScene(sim, view, a, pip.y - r / zoom, pip.y + r / zoom, false, 0);
    ctx.restore();
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalAlpha = k;
    ctx.strokeStyle = c.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, r + 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = PALETTE.ink; ctx.fillRect(px - 26, py + r + 8, 8, 8);
    ctx.fillStyle = c.color; ctx.fillRect(px - 25, py + r + 9, 6, 6);
    this.text(c.name, px - 14, py + r + 12.5, { size: 12, spacing: 0.8, outline: 3 });
    ctx.globalAlpha = 1;
  }

  // Stepped purple: whole 4px tiles, solid body + a lighter one-band edge.
  drawDanger(sim, top, bottom) {
    const d = sim.danger.dist;
    if (d <= 0) return;
    const { ctx } = this;
    const f = this.level.field;
    const cols = f.cols;
    const viewTop = Math.max(0, Math.floor(top / TILE) - 1);
    const viewBot = Math.min(f.rows, Math.ceil(bottom / TILE) + 1);
    const band = 6;
    const drawRuns = (lo, hi) => {
      for (let ty = viewTop; ty < viewBot; ty++) {
        let run = -1;
        const row = ty * cols;
        for (let tx = 0; tx <= cols; tx++) {
          let on = false;
          if (tx < cols) { const i = row + tx; const v = f.danger[i]; on = f.floor[i] === 1 && v < hi && v >= lo; }
          if (on && run < 0) run = tx;
          else if (!on && run >= 0) { ctx.fillRect(run * TILE, ty * TILE, (tx - run) * TILE, TILE + 0.3); run = -1; }
        }
      }
    };
    ctx.fillStyle = PALETTE.purple;
    drawRuns(-Infinity, d - band);
    ctx.fillStyle = PALETTE.purpleEdge;
    drawRuns(d - band, d);
  }

  // Tiny functional response when a bumper is hit (a few frames).
  drawBumperHits(sim) {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.ink;
    for (const b of sim.bumpers) {
      const age = sim.tick - b.hit;
      if (b.hit < 0 || age > 8) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBarriers(sim) {
    const { ctx } = this;
    for (const b of sim.barriers) {
      if (!b.alive) continue;
      if (b.color) {
        const def = contestantById(b.color);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        ctx.fillStyle = def.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        this.drawBricks(b);
      } else {
        const dmg = 1 - b.hp / b.maxHp;
        const hit = sim.tick - b.lastHitTick < 5;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        ctx.fillStyle = hit ? PALETTE.greyLight : dmg > 0.6 ? PALETTE.greyDark : dmg > 0.2 ? '#838d9b' : PALETTE.grey;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        this.drawBricks(b);
        if (dmg > 0) this.drawDamage(b, dmg);
      }
    }
  }

  // Brick joints: horizontal courses every ~9px with staggered vertical
  // joints, so breakable blocks read as brickwork (and never as racers).
  drawBricks(b) {
    const { ctx } = this;
    const course = b.h > 12 ? b.h / Math.max(1, Math.round(b.h / 9)) : b.h;
    const rows = Math.max(1, Math.round(b.h / course));
    ctx.strokeStyle = 'rgba(22,23,27,0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < rows; i++) {
      const y0 = b.y + i * course, y1 = y0 + course;
      if (i > 0) { ctx.moveTo(b.x + 1.5, y0); ctx.lineTo(b.x + b.w - 1.5, y0); }
      const joints = b.w >= 18 ? (i % 2 ? [0.25, 0.75] : [0.5]) : (i % 2 ? [] : [0.5]);
      for (const j of joints) { ctx.moveTo(b.x + b.w * j, y0 + 1.5); ctx.lineTo(b.x + b.w * j, y1 - 1.5); }
    }
    ctx.stroke();
  }

  // Cracks + missing corners, deterministic per block id. No health bars.
  drawDamage(b, dmg) {
    const { ctx } = this;
    let s = (b.id * 9301 + 49297) % 233280;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 0.9;
    const lines = Math.ceil(dmg * 3);
    ctx.beginPath();
    for (let k = 0; k < lines; k++) {
      let x = b.x + rnd() * b.w, y = b.y + rnd() * b.h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 3; j++) { x += (rnd() - 0.5) * 8; y += (rnd() - 0.5) * 8; ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.restore();
    // Chipped corners show through to the floor.
    const chips = dmg > 0.6 ? 2 : dmg > 0.3 ? 1 : 0;
    ctx.fillStyle = PALETTE.floor;
    for (let k = 0; k < chips; k++) {
      const cx = rnd() < 0.5 ? b.x - 1 : b.x + b.w - 2, cy = rnd() < 0.5 ? b.y - 1 : b.y + b.h - 2;
      ctx.fillRect(cx, cy, 3, 3);
    }
  }

  // Flat blade icon, pointing along +x. Black outline, light blade, dark handle.
  drawKnife(x, y, angle, scale = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 0.9;
    ctx.fillStyle = PALETTE.handle;
    ctx.fillRect(-5.5, -1.4, 5, 2.8); ctx.strokeRect(-5.5, -1.4, 5, 2.8);
    ctx.fillStyle = PALETTE.steel;
    ctx.beginPath();
    ctx.moveTo(-0.5, -1.8); ctx.lineTo(8, -1.8); ctx.lineTo(10.5, 0); ctx.lineTo(8, 1.8); ctx.lineTo(-0.5, 1.8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawWeaponPickup(sim) {
    const w = sim.weapon;
    if (!w || w.state !== 'ground') return;
    // Lies still on the floor: a small dark marker under it keeps it findable.
    const { ctx } = this;
    ctx.fillStyle = 'rgba(22,23,27,0.1)';
    ctx.fillRect(w.x - 7, w.y - 7, 14, 14);
    this.drawKnife(w.x - 2.5, w.y + 2.5, -Math.PI / 4, 1.05);
  }

  // Short tapering strip behind each racer, translucent, drawn under walls.
  drawTrails(sim, a, update) {
    const { ctx } = this;
    sim.contestants.forEach((c, i) => {
      const t = this.trails[i];
      if (!c.alive || c.finished) { t.n = 0; return; }
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      if (update) {
        t.xs[t.head] = x; t.ys[t.head] = y;
        t.head = (t.head + 1) % TRAIL_LEN; t.n = Math.min(t.n + 1, TRAIL_LEN);
      }
      if (t.n < 3) return;
      // Points from newest to oldest.
      const px = [], py = [];
      for (let k = 0; k < t.n; k++) {
        const idx = (t.head - 1 - k + TRAIL_LEN) % TRAIL_LEN;
        px.push(t.xs[idx]); py.push(t.ys[idx]);
      }
      const left = [], right = [];
      const w0 = c.size * 0.42;
      for (let k = 0; k < px.length; k++) {
        const k0 = Math.max(0, k - 1), k1 = Math.min(px.length - 1, k + 1);
        let dx = px[k0] - px[k1], dy = py[k0] - py[k1];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const w = w0 * (1 - k / (px.length - 1));
        left.push(px[k] - dy * w, py[k] + dx * w);
        right.push(px[k] + dy * w, py[k] - dx * w);
      }
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let k = 2; k < left.length; k += 2) ctx.lineTo(left[k], left[k + 1]);
      for (let k = right.length - 2; k >= 0; k -= 2) ctx.lineTo(right[k], right[k + 1]);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  drawContestants(sim, a, view) {
    const { ctx } = this;
    // Eliminated: short fade, then gone (optional small marker).
    for (const c of sim.contestants) {
      if (c.alive) continue;
      const age = sim.time - c.deathTime;
      const s = c.size;
      if (age < 0.22) {
        const k = 1 - age / 0.22;
        ctx.globalAlpha = k;
        const ss = s * (0.7 + 0.3 * k);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(c.x - ss / 2 - 1, c.y - ss / 2 - 1, ss + 2, ss + 2);
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x - ss / 2, c.y - ss / 2, ss, ss);
        ctx.globalAlpha = 1;
      } else if (view.deathMarkers) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(c.x - 3, c.y - 3); ctx.lineTo(c.x + 3, c.y + 3); ctx.moveTo(c.x + 3, c.y - 3); ctx.lineTo(c.x - 3, c.y + 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    for (const c of sim.contestants) {
      if (!c.alive) continue;
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      const s = c.size;
      // Hard 1px drop shadow, just enough to lift the square off the floor.
      ctx.fillStyle = 'rgba(16,17,20,0.22)';
      ctx.fillRect(x - s / 2 + 0.5, y - s / 2 + 1.5, s + 1, s + 1);
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
      ctx.fillStyle = c.color;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      if (c.hasWeapon) {
        const ang = Math.atan2(c.vy, c.vx);
        this.drawKnife(x + Math.cos(ang) * (s / 2 + 3.5), y + Math.sin(ang) * (s / 2 + 3.5), ang, 0.95);
      }
    }
  }

  drawDebugWorld(sim, a) {
    const { ctx } = this;
    const level = this.level;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(0,200,255,0.7)';
    for (const w of level.walls) ctx.strokeRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = 'rgba(255,0,200,0.9)';
    for (const b of sim.barriers) if (b.alive) ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,220,0,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    level.route.forEach((c, i) => { const x = c.x + c.w / 2, y = c.y + c.h / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (const c of level.route) {
      const label = `${c.index} ${c.stage} ${c.template}`;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(c.x + 3, c.y + 3, label.length * 4.9 + 4, 10);
      ctx.fillStyle = '#ffe600';
      ctx.fillText(label, c.x + 5, c.y + 4);
    }
    for (const d of level.doors) {
      const mid = (d.a + d.b) / 2;
      const [x, y] = d.orient === 'h' ? [mid, d.pos] : [d.pos, mid];
      ctx.fillStyle = '#ffe600'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    const f = level.field;
    ctx.strokeStyle = 'rgba(0,90,255,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let ty = 1; ty < f.rows; ty += 4) for (let tx = 1; tx < f.cols; tx += 4) {
      const i = ty * f.cols + tx;
      if (!f.free[i]) continue;
      const x = tx * TILE + 2, y = ty * TILE + 2;
      ctx.moveTo(x, y); ctx.lineTo(x + f.flowX[i] * 6, y + f.flowY[i] * 6);
    }
    ctx.stroke();
    for (const c of sim.contestants) {
      if (!c.alive) continue;
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, c.r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + c.vx * 0.15, y + c.vy * 0.15); ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = '8px monospace';
      ctx.fillText(`${(c.progress * 100).toFixed(0)}% v${c.speed.toFixed(0)}`, x + 8, y + 6);
    }
  }

  // ---------- text ----------
  setFont(size, family = FONT_LABEL, weight = 700) {
    this.ctx.font = `${weight} ${size}px ${family}`;
  }

  // Text with a thin dark outline for readability over the map (no shadow blur).
  text(str, x, y, { size = 14, color = PALETTE.text, align = 'left', family = FONT_LABEL, weight = 700, outline = 0, spacing = 0 } = {}) {
    const { ctx } = this;
    this.setFont(size, family, weight);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? `${spacing}px` : '0px';
    if (outline) { ctx.lineJoin = 'round'; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = outline; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // Multi-colour line, e.g. [["YELLOW", yellow], [" GOT THE BLADE", offwhite]], centred.
  richText(parts, cx, y, { size = 24, outline = 4, family = FONT_LABEL, spacing = 0.5 } = {}) {
    const { ctx } = this;
    this.setFont(size, family, 700);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    const widths = parts.map(([t]) => ctx.measureText(t).width);
    let x = cx - widths.reduce((s, w) => s + w, 0) / 2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    parts.forEach(([t, color], i) => {
      if (outline) { ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = outline; ctx.strokeText(t, x, y); }
      ctx.fillStyle = color; ctx.fillText(t, x, y);
      x += widths[i];
    });
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // ---------- HUD strip ----------
  drawHud(frame) {
    const { sim, view, pres } = frame;
    if (sim && view.hud) this.drawHudStrip(sim);
    if (pres) this.drawPresentation(frame);
    if (view.safeArea) this.drawSafeArea();
    if (view.debug && frame.debug) this.drawDebugHud(frame.debug);
  }

  drawHudStrip(sim) {
    const { ctx } = this;
    const L = 26, R = VIEW_W - 34;
    // Solid band: in follow mode the course scrolls underneath the strip.
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, VIEW_W, 110);
    // Row 1: SEED (left) / TIME (right), label over value.
    this.text('SEED', L, 44, { size: 10, color: PALETTE.muted, spacing: 1.2 });
    this.text(sim.level.seed, L, 58, { size: 13, family: FONT_MONO, weight: 600 });
    this.text('TIME', R, 44, { size: 10, color: PALETTE.muted, align: 'right', spacing: 1.2 });
    this.text(`${sim.time.toFixed(1)}s`, R, 58, { size: 13, family: FONT_MONO, weight: 600, align: 'right' });

    // Row 2: four narrow status sections, fixed colour order.
    const ordered = CONTESTANTS.map((d) => sim.contestants.find((c) => c.id === d.id)).filter(Boolean);
    const n = ordered.length, gap = 4, top = 72, h = 18;
    const w = (R - L - gap * (n - 1)) / n;
    ordered.forEach((c, i) => {
      const x = L + i * (w + gap);
      ctx.globalAlpha = c.alive ? 1 : 0.35;
      this.box(x, top, w, h);
      ctx.fillStyle = PALETTE.ink; ctx.fillRect(x + 6, top + 5, 8, 8);
      ctx.fillStyle = c.color; ctx.fillRect(x + 7, top + 6, 6, 6);
      this.text(c.name, x + 19, top + h / 2 + 0.5, { size: 12, spacing: 0.8 });
      const rx = x + w - 7;
      if (!c.alive) this.text('×', rx, top + h / 2, { size: 13, align: 'right', color: PALETTE.text });
      else if (c.finished) this.text(`#${c.place}`, rx, top + h / 2 + 0.5, { size: 10, family: FONT_MONO, weight: 600, align: 'right' });
      else if (c.hasWeapon) { ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0); this.drawKnife(rx - 10, top + h / 2, 0, 1); }
      ctx.globalAlpha = 1;
    });

    // Row 3: race timeline. Purple = pursuit, markers = racers, checker = finish.
    const bx = L, bw = R - L - 8, by = 97, bh = 4;
    ctx.fillStyle = PALETTE.track;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = PALETTE.purpleEdge;
    ctx.fillRect(bx, by, bw * Math.min(1, sim.danger.progress), bh);
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (k + j) % 2 ? PALETTE.checkB : PALETTE.checkA;
      ctx.fillRect(bx + bw + 2 + k * 3, by - 1 + j * 3, 3, 3);
    }
    for (const c of ordered) {
      if (!c.alive) continue;
      const px = Math.round(bx + bw * c.progress);
      ctx.fillStyle = PALETTE.ink; ctx.fillRect(px - 2.5, by - 3, 5, bh + 6);
      ctx.fillStyle = c.color; ctx.fillRect(px - 1.5, by - 2, 3, bh + 4);
    }
  }

  // Thin rectangular section: dark fill, 1px border, ~2px corner radius.
  box(x, y, w, h) {
    const { ctx } = this;
    const r = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r); else ctx.rect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = PALETTE.hudBg; ctx.fill();
    ctx.strokeStyle = PALETTE.hudLine; ctx.lineWidth = 1; ctx.stroke();
  }

  // ---------- intro, countdown, messages, result ----------
  dim(alpha) {
    if (alpha <= 0) return;
    this.ctx.fillStyle = `rgba(12,13,16,${alpha})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawPresentation(frame) {
    const { ctx } = this;
    const { pres, sim } = frame;
    const cx = VIEW_W / 2;
    if (pres.intro !== null && pres.intro !== undefined) {
      const t = pres.intro; // 0..1 over ~1 s
      this.dim(0.45 * clamp01((1 - t) / 0.2));
      const a0 = ease(clamp01(t / 0.12));
      ctx.globalAlpha = a0;
      this.text('WHO WILL SURVIVE?', cx, 392, { size: 34, align: 'center', outline: 4, spacing: 1 });
      CONTESTANTS.forEach((def, i) => {
        const k = ease(clamp01((t - 0.12 - i * 0.1) / 0.1));
        if (k <= 0) return;
        ctx.globalAlpha = k;
        const y = 438 + i * 24;
        ctx.fillStyle = PALETTE.ink; ctx.fillRect(cx - 44, y - 7, 14, 14);
        ctx.fillStyle = def.color; ctx.fillRect(cx - 43, y - 6, 12, 12);
        this.text(def.name, cx - 22, y + 0.5, { size: 18, color: PALETTE.text, outline: 3, spacing: 1 });
      });
      ctx.globalAlpha = 1;
    }
    if (pres.countdown) {
      const { label, k } = pres.countdown;
      const go = label === 'GO!';
      const inA = ease(clamp01(k / 0.25));
      ctx.globalAlpha = go ? Math.max(0, 1 - k) : inA;
      this.text(go ? 'GO' : label, cx, 440, { size: go ? 64 : 76, family: go ? FONT_LABEL : FONT_MONO, weight: go ? 700 : 600, align: 'center', outline: 5, spacing: go ? 3 : 0 });
      ctx.globalAlpha = 1;
    }
    if (pres.callouts) {
      pres.callouts.forEach((c, i) => {
        const age = c.age;
        const inT = clamp01(age / 0.12);
        const outT = clamp01((c.dur - age) / 0.2);
        ctx.globalAlpha = Math.min(ease(inT), outT);
        const parts = c.parts || [[c.text, c.color]];
        const scale = 0.94 + 0.06 * ease(inT);
        this.richText(parts, cx, 148 + i * 26, { size: 22 * scale, outline: 4 });
        ctx.globalAlpha = 1;
      });
    }
    if (pres.card) this.drawResult(pres.card, sim);
    if (pres.coverText) this.text(pres.coverText, cx, 170, { size: 40, align: 'center', outline: 5, spacing: 1.5 });
  }

  // Minimal ending: dim the scene, keep the final state visible, centred text.
  drawResult(card) {
    const { ctx } = this;
    const k = ease(clamp01(card.t / 0.3));
    this.dim(0.55 * k);
    ctx.globalAlpha = k;
    const cx = VIEW_W / 2, y = 420;
    const def = card.winner ? contestantById(card.winner) : null;
    if (def) this.richText([[def.name, def.color], [' WINS', PALETTE.text]], cx, y, { size: 50, outline: 5, spacing: 1.5 });
    else this.text('NO SURVIVORS', cx, y, { size: 46, align: 'center', outline: 5, spacing: 1.5, color: '#b99ae6' });
    if (card.stats) {
      card.stats.lines.forEach((l, i) => this.text(l, cx, y + 50 + i * 20, { size: 14, family: FONT_MONO, weight: 600, align: 'center', color: PALETTE.text, outline: 3 }));
      this.text(card.stats.seed, cx, y + 50 + card.stats.lines.length * 20 + 18, { size: 12, family: FONT_MONO, weight: 600, align: 'center', color: PALETTE.muted, outline: 3 });
    }
    ctx.globalAlpha = 1;
  }

  drawSafeArea() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,40,80,0.14)';
    ctx.fillRect(0, 0, VIEW_W, 40);                   // top app chrome (~80px @1080p)
    ctx.fillRect(0, VIEW_H - 192, VIEW_W, 192);       // caption + buttons (~380px)
    ctx.fillRect(VIEW_W - 60, VIEW_H * 0.5, 60, VIEW_H * 0.5 - 192); // action buttons column
    ctx.strokeStyle = 'rgba(255,40,80,0.8)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 40.5, VIEW_W - 1, VIEW_H - 40 - 192);
    ctx.setLineDash([]);
    this.text('SAFE AREA', 8, VIEW_H - 200, { size: 10, color: 'rgba(255,110,130,0.95)' });
  }

  drawDebugHud(d) {
    const { ctx } = this;
    const lines = Object.entries(d).map(([k, v]) => `${k}: ${v}`);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(8, 120, 190, lines.length * 11 + 8);
    ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#9dff9d';
    lines.forEach((l, i) => ctx.fillText(l, 12, 124 + i * 11));
  }
}
