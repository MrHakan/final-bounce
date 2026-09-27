// World -> screen mapping. Static mode fits the whole course; follow modes
// track the leader or the pack with exponential smoothing. Shake is a small,
// decaying offset in logical pixels.
import { VIEW_W, VIEW_H } from '../config/presets.js';

// Screen area (logical px) the course is fitted into: below the HUD band,
// above the caption zone, with side gutters.
export const FRAME = { x: 22, y: 118, w: VIEW_W - 22 - 40, h: VIEW_H - 118 - 132, maxZoom: 1.3 };

// Asymmetric composition: a course that uses less than ~80% of the frame
// width hugs the left edge and leaves negative space on the right (where
// Instagram's buttons live). Wide courses are centred.
function frameLeft(drawnW) {
  return drawnW < FRAME.w * 0.8 ? FRAME.x : FRAME.x + (FRAME.w - drawnW) / 2;
}

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 1;
    this.mode = 'static';
    this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0;
    this.shakePhase = 0;
    this.worldW = VIEW_W; this.worldH = VIEW_H;
  }

  // bounds: bounding box of the course. The course is fitted into the frame
  // area between the HUD band and the caption zone.
  setWorld(w, h, bounds = null) {
    this.worldW = w; this.worldH = h;
    this.bounds = bounds || { x: 0, y: 0, w, h };
  }

  resolveMode(pref) {
    // Auto: show the whole course unless that would shrink it noticeably.
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

  targetFor(sim, mode) {
    const cs = sim.contestants.filter((c) => c.alive && !c.finished);
    const pool = cs.length ? cs : sim.contestants.filter((c) => c.alive);
    if (!pool.length) return null;
    if (mode === 'follow-leader') {
      let best = pool[0];
      for (const c of pool) if (c.progress > best.progress) best = c;
      return { x: best.x, y: best.y };
    }
    let x = 0, y = 0;
    for (const c of pool) { x += c.x; y += c.y; }
    return { x: x / pool.length, y: y / pool.length };
  }

  update(sim, pref, dt, snap = false) {
    const mode = this.resolveMode(pref);
    this.mode = mode;
    if (mode === 'static' || !sim) { this.fitStatic(); }
    else {
      const b = this.bounds;
      const z = this.fitZoomX();
      this.zoom = z;
      // Keep the course inside the frame area vertically, follow the target.
      const minY = b.y - FRAME.y / z;
      const maxY = Math.max(minY, b.y + b.h - (FRAME.y + FRAME.h) / z);
      const t = this.targetFor(sim, mode);
      if (t) {
        const ty = Math.max(minY, Math.min(maxY, t.y - (FRAME.y + FRAME.h * 0.5) / z));
        const k = snap ? 1 : 1 - Math.exp(-2.6 * dt);
        this.y += (ty - this.y) * k;
      }
      this.x = b.x - frameLeft(b.w * z) / z;
      this.y = Math.max(minY, Math.min(maxY, this.y));
    }
    // Shake decay.
    if (this.shakeAmp > 0.05) {
      this.shakePhase += dt * 60;
      this.shakeX = Math.sin(this.shakePhase * 1.7) * this.shakeAmp;
      this.shakeY = Math.cos(this.shakePhase * 2.3) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-9 * dt);
    } else { this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }
  }

  shake(amount) { this.shakeAmp = Math.min(4, Math.max(this.shakeAmp, amount)); }

  worldToScreen(x, y) { return { x: (x - this.x) * this.zoom + this.shakeX, y: (y - this.y) * this.zoom + this.shakeY }; }
}
