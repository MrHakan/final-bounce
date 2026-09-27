// World -> screen mapping (presentation only; never touches the simulation).
//
//  static        : the whole course, top-aligned under the HUD strip.
//  follow-pack   : a close camera (up to 1.6x) on the main group of racers,
//                  zooming out a little when the group spreads. A racer that
//                  breaks away from the group gets its own circular inset
//                  camera in the lower-right corner (see `pip`).
//  follow-leader : the close camera on the leading racer.
// Shake is a small, decaying offset in logical pixels.
import { VIEW_W, VIEW_H } from '../config/presets.js';

// Screen area (logical px) the course is fitted into: below the HUD band,
// above the caption zone, with side gutters.
export const FRAME = { x: 22, y: 118, w: VIEW_W - 22 - 40, h: VIEW_H - 118 - 132, maxZoom: 1.3 };

// Circular inset camera (screen space, logical px).
export const PIP = { x: VIEW_W - 96, y: VIEW_H - 236, r: 68, zoom: 1.7 };

const FOLLOW_ZOOM = 1.6;
const GROUP_DIST = 130;   // racers closer than this (world px, chained) form a group

// Asymmetric composition: a course that uses less than ~80% of the frame
// width hugs the left edge and leaves negative space on the right (where
// Instagram's buttons live). Wide courses are centred.
function frameLeft(drawnW) {
  return drawnW < FRAME.w * 0.8 ? FRAME.x : FRAME.x + (FRAME.w - drawnW) / 2;
}

// Single-linkage clustering of racers by distance.
function groups(list) {
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (seen.has(c)) continue;
    const g = [c]; seen.add(c);
    for (let k = 0; k < g.length; k++) {
      for (const o of list) {
        if (seen.has(o)) continue;
        if (Math.hypot(o.x - g[k].x, o.y - g[k].y) < GROUP_DIST) { g.push(o); seen.add(o); }
      }
    }
    out.push(g);
  }
  return out;
}

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 1;
    this.mode = 'static';
    this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0;
    this.shakePhase = 0;
    this.worldW = VIEW_W; this.worldH = VIEW_H;
    this.pip = null; // { id, x, y, alpha }
  }

  // bounds: bounding box of the course.
  // longCourse: long-mode courses always get the close follow camera on auto.
  setWorld(w, h, bounds = null, longCourse = false) {
    this.worldW = w; this.worldH = h;
    this.longCourse = longCourse;
    this.bounds = bounds || { x: 0, y: 0, w, h };
    this.pip = null;
    this._init = false;
  }

  resolveMode(pref) {
    // Auto: show the whole course unless that would shrink it noticeably.
    if (pref === 'auto' && this.longCourse) return 'follow-pack';
    if (pref === 'auto') return Math.min(FRAME.w / this.bounds.w, FRAME.h / this.bounds.h) < 0.9 ? 'follow-pack' : 'static';
    return pref;
  }

  fitZoomX() { return Math.min(FRAME.maxZoom, FRAME.w / this.bounds.w); }

  fitStatic() {
    const b = this.bounds;
    const z = Math.min(FRAME.maxZoom, FRAME.w / b.w, FRAME.h / b.h);
    this.zoom = z;
    this.x = b.x - frameLeft(b.w * z) / z;
    this.y = b.y - FRAME.y / z; // top-aligned under the HUD strip
  }

  // Main subject: the biggest group (ties -> the group with the leader).
  subject(sim, mode) {
    let pool = sim.contestants.filter((c) => c.alive && !c.finished);
    if (!pool.length) pool = sim.contestants.filter((c) => c.alive);
    if (!pool.length) return null;
    if (mode === 'follow-leader') {
      let best = pool[0];
      for (const c of pool) if (c.progress > best.progress) best = c;
      return { members: [best], others: pool.filter((c) => c !== best) };
    }
    const gs = groups(pool);
    gs.sort((a, b) => b.length - a.length || Math.max(...b.map((c) => c.progress)) - Math.max(...a.map((c) => c.progress)));
    return { members: gs[0], others: pool.filter((c) => !gs[0].includes(c)) };
  }

  update(sim, pref, dt, snap = false) {
    const mode = this.resolveMode(pref);
    this.mode = mode;
    const k = snap || !this._init ? 1 : 1 - Math.exp(-2.6 * dt);
    this._init = true;
    if (mode === 'static' || !sim) {
      this.fitStatic();
      this.pip = null;
    } else {
      const b = this.bounds;
      const sub = this.subject(sim, mode);
      if (sub) {
        const m = sub.members;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of m) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
        // Close camera; back off only as far as needed to keep the group in view.
        const need = Math.min(FRAME.w * 0.7 / Math.max(1, x1 - x0), FRAME.h * 0.65 / Math.max(1, y1 - y0));
        const zt = Math.max(this.fitZoomX(), Math.min(FOLLOW_ZOOM, need));
        this.zoom += (zt - this.zoom) * (snap || k === 1 ? 1 : 1 - Math.exp(-1.5 * dt));
        const z = this.zoom;
        const tx = (x0 + x1) / 2, ty = (y0 + y1) / 2;
        const wantX = tx - (FRAME.x + FRAME.w / 2) / z;
        const wantY = ty - (FRAME.y + FRAME.h * 0.5) / z;
        this.x += (wantX - this.x) * k;
        this.y += (wantY - this.y) * k;
        this.updatePip(sub.others, dt, snap);
      }
      this.clampToCourse();
    }
    // Shake decay.
    if (this.shakeAmp > 0.05) {
      this.shakePhase += dt * 60;
      this.shakeX = Math.sin(this.shakePhase * 1.7) * this.shakeAmp;
      this.shakeY = Math.cos(this.shakePhase * 2.3) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-9 * dt);
    } else { this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }
  }

  clampToCourse() {
    const b = this.bounds, z = this.zoom;
    const minX = b.x - FRAME.x / z, maxX = b.x + b.w - (FRAME.x + FRAME.w) / z;
    if (maxX < minX) this.x = b.x - frameLeft(b.w * z) / z;
    else this.x = Math.max(minX, Math.min(maxX, this.x));
    const minY = b.y - FRAME.y / z, maxY = b.y + b.h - (FRAME.y + FRAME.h) / z;
    if (maxY < minY) this.y = minY;
    else this.y = Math.max(minY, Math.min(maxY, this.y));
  }

  visible(c, margin = 10) {
    const sx = (c.x - this.x) * this.zoom, sy = (c.y - this.y) * this.zoom;
    return sx > FRAME.x + margin && sx < FRAME.x + FRAME.w - margin && sy > FRAME.y + margin && sy < FRAME.y + FRAME.h - margin;
  }

  // Inset camera for a racer that has broken away from the main group and is
  // off screen. Sticky: keeps its subject until it rejoins, so it never flickers.
  updatePip(others, dt, snap) {
    const away = others.filter((c) => !this.visible(c, 0) || this.coveredByPip(c));
    let target = null;
    if (this.pip && this.pip.id && away.some((c) => c.id === this.pip.id)) target = away.find((c) => c.id === this.pip.id);
    else if (away.length) target = away.reduce((a, c) => (c.progress > a.progress ? c : a));
    if (target) {
      if (!this.pip || this.pip.id !== target.id) this.pip = { id: target.id, x: target.x, y: target.y, alpha: this.pip ? this.pip.alpha : 0 };
      const k = snap ? 1 : 1 - Math.exp(-8 * dt);
      this.pip.x += (target.x - this.pip.x) * k;
      this.pip.y += (target.y - this.pip.y) * k;
      this.pip.alpha = Math.min(1, this.pip.alpha + dt / 0.2);
    } else if (this.pip) {
      this.pip.alpha -= dt / 0.2;
      if (this.pip.alpha <= 0) this.pip = null;
    }
  }

  coveredByPip(c) {
    const sx = (c.x - this.x) * this.zoom, sy = (c.y - this.y) * this.zoom;
    return Math.hypot(sx - PIP.x, sy - PIP.y) < PIP.r + 8;
  }

  shake(amount) { this.shakeAmp = Math.min(4, Math.max(this.shakeAmp, amount)); }

  worldToScreen(x, y) { return { x: (x - this.x) * this.zoom + this.shakeX, y: (y - this.y) * this.zoom + this.shakeY }; }
}
