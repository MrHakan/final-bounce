// Pooled particle system (fixed capacity, no per-frame allocation).
// Uses its own seeded RNG so recordings of the same seed look identical.
import { RNG } from '../core/RNG.js';

const MAX = 600;

export class Particles {
  constructor() {
    this.x = new Float32Array(MAX); this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX); this.rot = new Float32Array(MAX); this.vr = new Float32Array(MAX);
    this.color = new Array(MAX).fill('#fff');
    this.kind = new Uint8Array(MAX); // 0 square debris, 1 ring
    this.count = 0;
    this.enabled = true;
    this.rng = new RNG('fx');
  }

  reset(seed) { this.count = 0; this.rng = new RNG(String(seed) + '/fx'); }

  spawn(x, y, vx, vy, life, size, color, kind = 0) {
    if (!this.enabled) return;
    let i = this.count;
    if (i >= MAX) {
      // Recycle the oldest-ish slot deterministically.
      i = Math.floor(this.rng.next() * MAX);
    } else this.count++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.rot[i] = this.rng.range(0, Math.PI); this.vr[i] = this.rng.range(-8, 8);
    this.color[i] = color; this.kind[i] = kind;
  }

  burst(x, y, color, n, speed = 90, life = 0.6, size = 3) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = r.range(0, Math.PI * 2), s = speed * r.range(0.35, 1);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * r.range(0.6, 1.1), size * r.range(0.6, 1.2), color, 0);
    }
  }

  ring(x, y, color, radius = 18, life = 0.35) {
    this.spawn(x, y, 0, 0, life, radius, color, 1);
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.x[i] = this.x[n]; this.y[i] = this.y[n]; this.vx[i] = this.vx[n]; this.vy[i] = this.vy[n];
        this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n]; this.size[i] = this.size[n];
        this.rot[i] = this.rot[n]; this.vr[i] = this.vr[n]; this.color[i] = this.color[n]; this.kind[i] = this.kind[n];
        i--;
        continue;
      }
      const drag = Math.exp(-3.2 * dt);
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
    }
    this.count = n;
  }

  draw(ctx) {
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.maxLife[i];
      ctx.globalAlpha = Math.min(1, t * 1.6);
      if (this.kind[i] === 1) {
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = 2 * t;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.size[i] * (1.25 - t * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const s = this.size[i] * (0.5 + 0.5 * t);
      ctx.fillStyle = this.color[i];
      ctx.save();
      ctx.translate(this.x[i], this.y[i]);
      ctx.rotate(this.rot[i]);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
