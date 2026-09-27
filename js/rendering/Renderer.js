// Canvas 2D renderer. Draws at 1080x1920 (2x the 540x960 logical space).
// Only the simulation, HUD and Reel overlays are drawn here; creator UI lives
// in the DOM and is never part of the recorded canvas.
import { VIEW_W, VIEW_H, RENDER_SCALE, CONTESTANTS, contestantById } from '../config/presets.js';
import { TILE } from '../generation/CourseField.js';

export const PALETTE = {
  void: '#6d7076',
  floor: '#c4c6c9',
  floorLine: 'rgba(0,0,0,0.05)',
  wall: '#f3f0e8',
  outline: '#202329',
  purple: '#4e1a7d',
  purpleEdge: '#8b45d6',
  grey: '#a7abb1',
  greyDark: '#7e838a',
  steel: '#e8edf3',
  text: '#ffffff',
  hudShadow: 'rgba(15,16,20,0.85)',
};
const FONT = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';

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
    this.trails = CONTESTANTS.map(() => ({ xs: new Float32Array(18), ys: new Float32Array(18), n: 0, head: 0 }));
  }

  setLevel(level) {
    this.level = level;
    this.buildStatic(level);
    this.resetTrails();
  }

  resetTrails() { for (const t of this.trails) { t.n = 0; t.head = 0; } }

  buildStatic(level) {
    const S = RENDER_SCALE;
    const W = level.width, H = level.height;
    const floor = makeCanvas(Math.ceil(W * S), Math.ceil(H * S));
    const g = floor.getContext('2d');
    g.scale(S, S);
    g.fillStyle = PALETTE.void;
    g.fillRect(0, 0, W, H);
    // Faint diagonal texture on the void so it reads as "outside".
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.lineWidth = 3;
    for (let k = -H; k < W + H; k += 14) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); }

    g.fillStyle = PALETTE.floor;
    for (const c of level.route) g.fillRect(c.x, c.y, c.w, c.h);
    // Sealed pockets (unreachable floor) are filled solid.
    const f = level.field;
    g.fillStyle = PALETTE.void;
    for (const c of level.route) {
      const tx0 = Math.floor(c.x / TILE), tx1 = Math.ceil((c.x + c.w) / TILE);
      const ty0 = Math.floor(c.y / TILE), ty1 = Math.ceil((c.y + c.h) / TILE);
      for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) {
        const i = ty * f.cols + tx;
        if (!f.floor[i] && f.free[i]) g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    // Floor grid.
    g.strokeStyle = PALETTE.floorLine;
    g.lineWidth = 1;
    for (const c of level.route) {
      g.save(); g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip();
      for (let x = Math.ceil(c.x / 18) * 18; x < c.x + c.w; x += 18) { g.beginPath(); g.moveTo(x, c.y); g.lineTo(x, c.y + c.h); g.stroke(); }
      for (let y = Math.ceil(c.y / 18) * 18; y < c.y + c.h; y += 18) { g.beginPath(); g.moveTo(c.x, y); g.lineTo(c.x + c.w, y); g.stroke(); }
      g.restore();
    }
    // Start pad.
    const s = level.startPoint;
    g.strokeStyle = 'rgba(32,35,41,0.22)';
    g.setLineDash([4, 4]); g.lineWidth = 1.5;
    g.strokeRect(s.x - 26, s.y - 26, 52, 52);
    g.setLineDash([]);
    // Finish zone: checkerboard.
    const fz = level.finish;
    g.save(); g.beginPath(); g.rect(fz.x, fz.y, fz.w, fz.h); g.clip();
    const q = 9;
    for (let y = fz.y, j = 0; y < fz.y + fz.h; y += q, j++) for (let x = fz.x, i = 0; x < fz.x + fz.w; x += q, i++) {
      g.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(32,35,41,0.22)';
      g.fillRect(x, y, q, q);
    }
    g.restore();
    g.strokeStyle = PALETTE.outline; g.lineWidth = 1.5;
    g.strokeRect(fz.x + 0.75, fz.y + 0.75, fz.w - 1.5, fz.h - 1.5);

    const wl = makeCanvas(Math.ceil(W * S), Math.ceil(H * S));
    const h = wl.getContext('2d');
    h.scale(S, S);
    h.fillStyle = PALETTE.outline;
    const o = 1.1;
    for (const w of level.walls) h.fillRect(w.x - o, w.y - o, w.w + 2 * o, w.h + 2 * o);
    for (const b of level.bumpers) { h.beginPath(); h.arc(b.x, b.y, b.r + o, 0, Math.PI * 2); h.fill(); }
    h.fillStyle = PALETTE.wall;
    for (const w of level.walls) h.fillRect(w.x, w.y, w.w, w.h);
    for (const b of level.bumpers) {
      h.fillStyle = PALETTE.wall;
      h.beginPath(); h.arc(b.x, b.y, b.r, 0, Math.PI * 2); h.fill();
      h.strokeStyle = 'rgba(32,35,41,0.35)'; h.lineWidth = 1;
      h.beginPath(); h.arc(b.x, b.y, b.r * 0.55, 0, Math.PI * 2); h.stroke();
    }
    this.floorLayer = floor;
    this.wallLayer = wl;
  }

  // frame: { sim, alpha, camera, view, particles, pres, debug }
  draw(frame) {
    const { ctx } = this;
    const S = RENDER_SCALE;
    const { sim, camera: cam, view } = frame;
    const level = this.level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!level) { this.drawHud(frame); return; }

    const z = cam.zoom * S;
    ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + cam.shakeX) * S, (-cam.y * cam.zoom + cam.shakeY) * S);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.floorLayer, 0, 0, level.width, level.height);
    if (sim) this.drawDanger(sim, cam, frame.pulse || 0);
    ctx.drawImage(this.wallLayer, 0, 0, level.width, level.height);
    if (sim) {
      this.drawBumperHits(sim);
      this.drawBarriers(sim);
      this.drawWeaponPickup(sim, frame.clock || 0);
      const a = frame.alpha ?? 1;
      if (view.trails) this.drawTrails(sim, a, frame.updateTrails !== false);
      this.drawContestants(sim, a, view);
    }
    if (frame.particles && view.particles) frame.particles.draw(ctx);
    if (view.debug && sim) this.drawDebugWorld(sim, frame.alpha ?? 1);

    ctx.setTransform(S, 0, 0, S, 0, 0);
    this.drawHud(frame);
  }

  drawDanger(sim, cam, pulse) {
    const d = sim.danger.dist;
    if (d <= 0) return;
    const { ctx } = this;
    const f = this.level.field;
    const cols = f.cols;
    const viewTop = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const viewBot = Math.min(f.rows, Math.ceil((cam.y + VIEW_H / cam.zoom) / TILE) + 1);
    const band = 7;
    const drawRuns = (lo, hi) => {
      for (let ty = viewTop; ty < viewBot; ty++) {
        let run = -1;
        const row = ty * cols;
        for (let tx = 0; tx <= cols; tx++) {
          let on = false;
          if (tx < cols) { const i = row + tx; const v = f.danger[i]; on = f.floor[i] === 1 && v < hi && v >= lo; }
          if (on && run < 0) run = tx;
          else if (!on && run >= 0) { ctx.fillRect(run * TILE, ty * TILE, (tx - run) * TILE, TILE + 0.35); run = -1; }
        }
      }
    };
    ctx.fillStyle = PALETTE.purple;
    drawRuns(-Infinity, d - band);
    ctx.fillStyle = PALETTE.purpleEdge;
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(pulse * 8);
    drawRuns(d - band, d);
    ctx.globalAlpha = 1;
  }

  drawBumperHits(sim) {
    const { ctx } = this;
    for (const b of sim.bumpers) {
      const age = sim.tick - b.hit;
      if (b.hit < 0 || age > 14) continue;
      ctx.globalAlpha = 1 - age / 14;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBarriers(sim) {
    const { ctx } = this;
    for (const b of sim.barriers) {
      if (!b.alive) continue;
      if (b.color) {
        const def = contestantById(b.color);
        ctx.fillStyle = PALETTE.outline;
        ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        ctx.fillStyle = def.light;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        // Diagonal hatching distinguishes barriers from contestants.
        ctx.save();
        ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
        ctx.strokeStyle = def.color; ctx.lineWidth = 2.6;
        const span = b.w + b.h;
        for (let k = -span; k < span; k += 6) { ctx.beginPath(); ctx.moveTo(b.x + k, b.y); ctx.lineTo(b.x + k + b.h, b.y + b.h); ctx.stroke(); }
        ctx.restore();
        ctx.strokeStyle = def.dark; ctx.lineWidth = 1.2;
        ctx.strokeRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, b.h - 1.2);
      } else {
        const dmg = 1 - b.hp / b.maxHp;
        const flash = sim.tick - b.lastHitTick < 8;
        ctx.fillStyle = PALETTE.outline;
        ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        ctx.fillStyle = flash ? '#ffffff' : dmg > 0.6 ? '#8f949b' : dmg > 0.3 ? '#9a9fa6' : PALETTE.grey;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(b.x, b.y, b.w, 1.4);
        if (dmg > 0) this.drawCracks(b, dmg);
      }
    }
  }

  drawCracks(b, dmg) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    ctx.strokeStyle = 'rgba(25,27,31,0.8)'; ctx.lineWidth = 1;
    const lines = Math.ceil(dmg * 4);
    let s = (b.id * 9301 + 49297) % 233280;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let k = 0; k < lines; k++) {
      let x = b.x + rnd() * b.w, y = b.y + rnd() * b.h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 3; j++) { x += (rnd() - 0.5) * 9; y += (rnd() - 0.5) * 9; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // Chipped corner at heavy damage.
    if (dmg > 0.6) { ctx.fillStyle = PALETTE.floor; ctx.fillRect(b.x + b.w - 3, b.y, 3, 3); }
    ctx.restore();
  }

  drawKnife(x, y, angle, scale = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    // handle
    ctx.fillStyle = '#3b2b20';
    ctx.strokeStyle = PALETTE.outline; ctx.lineWidth = 0.9;
    ctx.fillRect(-6, -1.6, 5, 3.2); ctx.strokeRect(-6, -1.6, 5, 3.2);
    // guard
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(-1.2, -3, 1.6, 6);
    // blade
    ctx.fillStyle = PALETTE.steel;
    ctx.beginPath();
    ctx.moveTo(0.4, -2); ctx.lineTo(9, -1.2); ctx.lineTo(12, 0.3); ctx.lineTo(0.4, 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawWeaponPickup(sim, clock) {
    const w = sim.weapon;
    if (!w || w.state !== 'ground') return;
    const { ctx } = this;
    const bob = Math.sin(clock * 4) * 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -clock * 12;
    ctx.beginPath(); ctx.arc(w.x, w.y, 11 + Math.sin(clock * 5), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    this.drawKnife(w.x - 2, w.y + bob, -Math.PI / 4, 1.15);
  }

  drawTrails(sim, a, update) {
    const { ctx } = this;
    sim.contestants.forEach((c, i) => {
      const t = this.trails[i];
      if (!c.alive || c.finished) { t.n = 0; return; }
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      if (update) {
        t.xs[t.head] = x; t.ys[t.head] = y;
        t.head = (t.head + 1) % t.xs.length; t.n = Math.min(t.n + 1, t.xs.length);
      }
      if (t.n < 2) return;
      ctx.strokeStyle = c.color;
      ctx.lineCap = 'round';
      const L = t.xs.length;
      for (let k = 1; k < t.n; k++) {
        const i0 = (t.head - t.n + k - 1 + L) % L, i1 = (t.head - t.n + k + L) % L;
        const u = k / t.n;
        ctx.globalAlpha = 0.28 * u;
        ctx.lineWidth = c.size * 0.55 * u;
        ctx.beginPath(); ctx.moveTo(t.xs[i0], t.ys[i0]); ctx.lineTo(t.xs[i1], t.ys[i1]); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  drawContestants(sim, a, view) {
    const { ctx } = this;
    // Dead first (below), then living.
    for (const c of sim.contestants) {
      if (c.alive) continue;
      const age = sim.time - c.deathTime;
      const x = c.x, y = c.y, s = c.size;
      if (age < 0.45) {
        const k = 1 - age / 0.45;
        ctx.globalAlpha = k;
        ctx.fillStyle = PALETTE.outline;
        const ss = s * (0.6 + 0.6 * k);
        ctx.fillRect(x - ss / 2 - 1, y - ss / 2 - 1, ss + 2, ss + 2);
        ctx.fillStyle = age < 0.08 ? '#ffffff' : c.color;
        ctx.fillRect(x - ss / 2, y - ss / 2, ss, ss);
        ctx.globalAlpha = 1;
      } else if (view.deathMarkers) {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2);
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    for (const c of sim.contestants) {
      if (!c.alive) continue;
      const x = c.px + (c.x - c.px) * a, y = c.py + (c.y - c.py) * a;
      const s = c.size;
      ctx.fillStyle = PALETTE.outline;
      ctx.fillRect(x - s / 2 - 1.2, y - s / 2 - 1.2, s + 2.4, s + 2.4);
      ctx.fillStyle = c.color;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x - s / 2, y - s / 2, s, 2);
      if (c.hasWeapon) {
        const ang = Math.atan2(c.vy, c.vx);
        this.drawKnife(x + Math.cos(ang) * (s / 2 + 3), y + Math.sin(ang) * (s / 2 + 3), ang, 1);
      }
      if (c.finished) {
        ctx.fillStyle = PALETTE.outline;
        ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('#' + c.place, x, y - s / 2 - 2);
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
    // Route graph.
    ctx.strokeStyle = 'rgba(255,255,0,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    level.route.forEach((c, i) => { const x = c.x + c.w / 2, y = c.y + c.h / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (const c of level.route) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const label = `${c.index} ${c.stage} ${c.template}`;
      ctx.fillRect(c.x + 3, c.y + 3, label.length * 4.9 + 4, 10);
      ctx.fillStyle = '#ffe600';
      ctx.fillText(label, c.x + 5, c.y + 4);
    }
    for (const d of level.doors) {
      const mid = (d.a + d.b) / 2;
      const [x, y] = d.orient === 'h' ? [mid, d.pos] : [d.pos, mid];
      ctx.fillStyle = '#ffe600'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // Course current (flow field), sparse arrows.
    const f = level.field;
    ctx.strokeStyle = 'rgba(0,90,255,0.55)'; ctx.lineWidth = 0.8;
    for (let ty = 1; ty < f.rows; ty += 4) for (let tx = 1; tx < f.cols; tx += 4) {
      const i = ty * f.cols + tx;
      if (!f.free[i]) continue;
      const x = tx * 4 + 2, y = ty * 4 + 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + f.flowX[i] * 6, y + f.flowY[i] * 6); ctx.stroke();
    }
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

  // ---------- HUD (screen space, logical units) ----------
  text(str, x, y, size, color, align = 'center', stroke = 4) {
    const { ctx } = this;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (stroke) { ctx.strokeStyle = PALETTE.hudShadow; ctx.lineWidth = stroke; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  drawHud(frame) {
    const { ctx } = this;
    const { sim, view, pres } = frame;
    if (sim && view.hud) {
      this.text(`SEED ${sim.level.seed}`, 30, 50, 12, 'rgba(255,255,255,0.85)', 'left', 3);
      this.text(`${sim.time.toFixed(1)}s`, VIEW_W - 30, 50, 12, 'rgba(255,255,255,0.85)', 'right', 3);
      // Status chips.
      const n = sim.contestants.length;
      const cw = 114, gap = 6, x0 = (VIEW_W - (n * cw + (n - 1) * gap)) / 2;
      const ordered = CONTESTANTS.map((d) => sim.contestants.find((c) => c.id === d.id)).filter(Boolean);
      ordered.forEach((c, i) => {
        const x = x0 + i * (cw + gap), y = 64;
        ctx.globalAlpha = c.alive ? 1 : 0.45;
        ctx.fillStyle = 'rgba(20,21,25,0.72)';
        ctx.fillRect(x, y, cw, 22);
        ctx.fillStyle = PALETTE.outline; ctx.fillRect(x + 5, y + 4, 14, 14);
        ctx.fillStyle = c.color; ctx.fillRect(x + 6, y + 5, 12, 12);
        let tag = c.name;
        this.text(tag, x + 25, y + 11.5, 11, '#fff', 'left', 0);
        let status = '';
        if (c.finished) status = '#' + c.place;
        else if (!c.alive) status = c.deathCause === 'kill' ? 'KO' : 'OUT';
        if (status) this.text(status, x + cw - 6, y + 11.5, 10, c.finished ? '#ffd84a' : '#ff8a8a', 'right', 0);
        else if (c.hasWeapon) { ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0); this.drawKnife(x + cw - 16, y + 11, 0, 0.9); }
        if (!c.alive) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 22, y + 11, cw - 30, 1.5); }
        ctx.globalAlpha = 1;
      });
      // Progress bar with purple fill.
      const bx = 40, bw = VIEW_W - 80, by = 97;
      ctx.fillStyle = 'rgba(20,21,25,0.72)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 8);
      ctx.fillStyle = PALETTE.purpleEdge; ctx.fillRect(bx, by, bw * sim.danger.progress, 4);
      for (const c of sim.contestants) {
        if (!c.alive) continue;
        const px = bx + bw * c.progress;
        ctx.fillStyle = PALETTE.outline; ctx.fillRect(px - 4, by - 3, 8, 10);
        ctx.fillStyle = c.color; ctx.fillRect(px - 3, by - 2, 6, 8);
      }
      ctx.fillStyle = '#fff'; ctx.fillRect(bx + bw - 1, by - 4, 2, 12);
    }
    if (pres) this.drawPresentation(frame);
    if (view.safeArea) this.drawSafeArea();
    if (view.debug && frame.debug) this.drawDebugHud(frame.debug);
  }

  drawPresentation(frame) {
    const { ctx } = this;
    const { pres, sim } = frame;
    const cx = VIEW_W / 2;
    if (pres.intro !== null && pres.intro !== undefined) {
      const t = pres.intro; // 0..1
      ctx.fillStyle = `rgba(12,12,16,${0.5 * Math.min(1, (1 - t) / 0.2)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const pop = Math.min(1, t * 6);
      this.text('WHO WILL', cx, 360, 38 * (0.8 + 0.2 * pop), '#fff', 'center', 7);
      this.text('SURVIVE?', cx, 404, 46 * (0.8 + 0.2 * pop), '#fff', 'center', 8);
      CONTESTANTS.forEach((def, i) => {
        const appear = 0.15 + i * 0.13;
        if (t < appear) return;
        const k = Math.min(1, (t - appear) * 8);
        const y = 470 + i * 38;
        ctx.globalAlpha = k;
        ctx.fillStyle = PALETTE.outline; ctx.fillRect(cx - 90 - 2, y - 13, 28, 28);
        ctx.fillStyle = def.color; ctx.fillRect(cx - 90, y - 11, 24, 24);
        this.text(def.name, cx - 50 + (1 - k) * 20, y + 1, 26, def.color, 'left', 6);
        ctx.globalAlpha = 1;
      });
    }
    if (pres.countdown) {
      const { label, k } = pres.countdown; // k: 0..1 within the step
      const scale = 1.35 - 0.35 * Math.min(1, k * 3);
      ctx.globalAlpha = label === 'GO!' ? Math.max(0, 1 - k * 0.9) : 1;
      this.text(label, cx, 440, (label === 'GO!' ? 84 : 110) * scale, label === 'GO!' ? '#ffffff' : '#ffe14d', 'center', 10);
      ctx.globalAlpha = 1;
    }
    if (pres.callouts) {
      pres.callouts.forEach((c, i) => {
        const k = c.age / c.dur;
        const a = k < 0.12 ? k / 0.12 : k > 0.8 ? (1 - k) / 0.2 : 1;
        ctx.globalAlpha = Math.max(0, a);
        this.text(c.text, cx, 150 + i * 30, 22 * (k < 0.12 ? 0.85 + k * 1.25 : 1), c.color, 'center', 6);
        ctx.globalAlpha = 1;
      });
    }
    if (pres.card) this.drawResultCard(pres.card, sim);
    if (pres.coverText) {
      this.text(pres.coverText, cx, 250, 44, '#ffffff', 'center', 9);
    }
  }

  drawResultCard(card, sim) {
    const { ctx } = this;
    const k = Math.min(1, card.t * 5);
    const cx = VIEW_W / 2;
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(14,14,18,0.78)';
    ctx.fillRect(0, 360, VIEW_W, 210);
    const def = card.winner ? contestantById(card.winner) : null;
    if (def) {
      ctx.fillStyle = def.color; ctx.fillRect(0, 360, VIEW_W, 5); ctx.fillRect(0, 565, VIEW_W, 5);
      this.text(`${def.name} WINS`, cx, 430, 58 * (0.8 + 0.2 * k), def.color, 'center', 10);
    } else {
      this.text('NO SURVIVORS', cx, 430, 48, '#d9b6ff', 'center', 10);
    }
    if (card.stats) {
      const lines = card.stats;
      lines.forEach((l, i) => this.text(l, cx, 490 + i * 26, 17, '#ffffff', 'center', 4));
    }
    ctx.globalAlpha = 1;
  }

  drawSafeArea() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,40,80,0.16)';
    ctx.fillRect(0, 0, VIEW_W, 108);                 // top UI (~220px @1080p)
    ctx.fillRect(0, VIEW_H - 192, VIEW_W, 192);      // caption + buttons (~380px)
    ctx.fillRect(VIEW_W - 60, VIEW_H * 0.5, 60, VIEW_H * 0.5 - 192); // action buttons column
    ctx.strokeStyle = 'rgba(255,40,80,0.8)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 108.5, VIEW_W - 1, VIEW_H - 108 - 192);
    ctx.setLineDash([]);
    this.text('SAFE AREA', 8, 118, 9, 'rgba(255,90,120,0.95)', 'left', 0);
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
