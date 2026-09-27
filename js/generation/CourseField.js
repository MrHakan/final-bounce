// Rasterised course analysis on a 4px tile grid.
//
//  free    : tiles where a contestant centre fits (configuration space)
//  distS   : geodesic distance from START through the corridors
//  distF   : geodesic distance to the FINISH zone
//  danger  : distS + small organic noise; purple covers tiles with danger < front
//  flow    : unit vectors down the distF gradient (the "course current")
//
// Breakable barriers are treated as passable: they are temporary.
import { RNG } from '../core/RNG.js';

export const TILE = 4;
const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor(cap) { this.idx = new Int32Array(cap); this.key = new Float64Array(cap); this.n = 0; }
  push(i, k) {
    let p = this.n++;
    if (p >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2); ni.set(this.idx); this.idx = ni;
      const nk = new Float64Array(this.key.length * 2); nk.set(this.key); this.key = nk;
    }
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.key[q] <= k) break;
      this.idx[p] = this.idx[q]; this.key[p] = this.key[q]; p = q;
    }
    this.idx[p] = i; this.key[p] = k;
  }
  pop() {
    const top = this.idx[0];
    this.popKey = this.key[0];
    const n = --this.n;
    if (n > 0) {
      const li = this.idx[n], lk = this.key[n];
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= n) break;
        if (c + 1 < n && this.key[c + 1] < this.key[c]) c++;
        if (this.key[c] >= lk) break;
        this.idx[p] = this.idx[c]; this.key[p] = this.key[c]; p = c;
      }
      this.idx[p] = li; this.key[p] = lk;
    }
    return top;
  }
}

function dijkstra(free, cols, rows, sources) {
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(4096);
  for (const s of sources) { dist[s] = 0; heap.push(s, 0); }
  const step = TILE, diag = TILE * SQRT2;
  while (heap.n > 0) {
    const i = heap.pop();
    const d = heap.popKey;
    if (d > dist[i]) continue;
    const x = i % cols, y = (i / cols) | 0;
    const l = x > 0 && free[i - 1], r = x < cols - 1 && free[i + 1];
    const u = y > 0 && free[i - cols], b = y < rows - 1 && free[i + cols];
    if (l) relax(i - 1, d + step);
    if (r) relax(i + 1, d + step);
    if (u) relax(i - cols, d + step);
    if (b) relax(i + cols, d + step);
    // Diagonals only when both orthogonal neighbours are free (no corner cutting).
    if (l && u && free[i - cols - 1]) relax(i - cols - 1, d + diag);
    if (r && u && free[i - cols + 1]) relax(i - cols + 1, d + diag);
    if (l && b && free[i + cols - 1]) relax(i + cols - 1, d + diag);
    if (r && b && free[i + cols + 1]) relax(i + cols + 1, d + diag);
  }
  return Float32Array.from(dist);

  function relax(j, nd) {
    if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
  }
}

// Spread finite values from reachable tiles into the wall-adjacent floor band
// (where a contestant's edge can be, but not its centre).
function dilate(dist, floor, cols, rows, passes) {
  for (let p = 0; p < passes; p++) {
    const src = dist.slice();
    let changed = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!floor[i] || src[i] !== Infinity) continue;
        let best = Infinity;
        if (x > 0 && src[i - 1] < best) best = src[i - 1];
        if (x < cols - 1 && src[i + 1] < best) best = src[i + 1];
        if (y > 0 && src[i - cols] < best) best = src[i - cols];
        if (y < rows - 1 && src[i + cols] < best) best = src[i + cols];
        if (best !== Infinity) { dist[i] = best + TILE; changed = true; }
      }
    }
    if (!changed) break;
  }
}

function markRect(mask, cols, rows, x0, y0, x1, y1, value) {
  const tx0 = Math.max(0, Math.ceil((x0 - TILE / 2) / TILE));
  const tx1 = Math.min(cols - 1, Math.floor((x1 - TILE / 2) / TILE));
  const ty0 = Math.max(0, Math.ceil((y0 - TILE / 2) / TILE));
  const ty1 = Math.min(rows - 1, Math.floor((y1 - TILE / 2) / TILE));
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) mask[y * cols + x] = value;
}

function markCircle(mask, cols, rows, cx, cy, R, value) {
  const tx0 = Math.max(0, Math.floor((cx - R) / TILE)), tx1 = Math.min(cols - 1, Math.ceil((cx + R) / TILE));
  const ty0 = Math.max(0, Math.floor((cy - R) / TILE)), ty1 = Math.min(rows - 1, Math.ceil((cy + R) / TILE));
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const px = x * TILE + TILE / 2 - cx, py = y * TILE + TILE / 2 - cy;
      if (px * px + py * py <= R * R) mask[y * cols + x] = value;
    }
  }
}

export function buildCourseField(level, radius) {
  const cols = Math.ceil(level.width / TILE), rows = Math.ceil(level.height / TILE);
  const n = cols * rows;
  const floor = new Uint8Array(n);
  const free = new Uint8Array(n);
  const m = radius + 0.75;

  for (const cell of level.route) {
    markRect(floor, cols, rows, cell.x, cell.y, cell.x + cell.w, cell.y + cell.h, 1);
    markRect(free, cols, rows, cell.x, cell.y, cell.x + cell.w, cell.y + cell.h, 1);
  }
  for (const w of level.walls) {
    markRect(floor, cols, rows, w.x, w.y, w.x + w.w, w.y + w.h, 0);
    markRect(free, cols, rows, w.x - m, w.y - m, w.x + w.w + m, w.y + w.h + m, 0);
  }
  for (const b of level.bumpers) {
    markCircle(floor, cols, rows, b.x, b.y, b.r, 0);
    markCircle(free, cols, rows, b.x, b.y, b.r + m, 0);
  }

  const idxAt = (x, y) => {
    const tx = Math.min(cols - 1, Math.max(0, Math.floor(x / TILE)));
    const ty = Math.min(rows - 1, Math.max(0, Math.floor(y / TILE)));
    return ty * cols + tx;
  };
  const nearestFree = (x, y) => {
    let best = -1, bd = Infinity;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const i = ty * cols + tx;
      if (!free[i]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const startIdx = nearestFree(level.startPoint.x, level.startPoint.y);
  const finishSources = [];
  const f = level.finish;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!free[i]) continue;
    const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
    if (px >= f.x && px <= f.x + f.w && py >= f.y && py <= f.y + f.h) finishSources.push(i);
  }
  if (startIdx < 0 || finishSources.length === 0) return { ok: false, reason: 'no start or finish tiles' };

  // Purple (and progress) starts from the back of the start room: the free
  // tiles of the start cell farthest from the finish, not from its centre.
  const distF = dijkstra(free, cols, rows, finishSources);
  if (!isFinite(distF[startIdx])) return { ok: false, reason: 'finish unreachable from start' };
  const sc = level.route[0];
  let far = -Infinity;
  const startTiles = [];
  for (let y = Math.floor(sc.y / TILE); y < Math.ceil((sc.y + sc.h) / TILE); y++) {
    for (let x = Math.floor(sc.x / TILE); x < Math.ceil((sc.x + sc.w) / TILE); x++) {
      const i = y * cols + x;
      if (!free[i] || !isFinite(distF[i])) continue;
      startTiles.push(i);
      if (distF[i] > far) far = distF[i];
    }
  }
  const sources = startTiles.filter((i) => distF[i] >= far - 10);
  if (!sources.length) return { ok: false, reason: 'start room unreachable' };
  const distS = dijkstra(free, cols, rows, sources);
  let totalLength = distF[sources[0]];
  // Reachable-area check: count free tiles that the start cannot reach.
  let freeCount = 0, unreachable = 0;
  for (let i = 0; i < n; i++) if (free[i]) { freeCount++; if (!isFinite(distS[i])) unreachable++; }

  const pass = Math.ceil(m / TILE) + 2;
  dilate(distS, floor, cols, rows, pass);
  dilate(distF, floor, cols, rows, pass);
  // Floor that is still unreachable (sealed pockets) is rendered as solid.
  for (let i = 0; i < n; i++) if (floor[i] && !isFinite(distS[i])) floor[i] = 0;

  // Organic purple front: low-frequency value noise, +-5px.
  const rng = new RNG(level.seed + '/field-noise:' + level.attempt);
  const ns = 6; // noise cell = 6 tiles
  const ncols = Math.ceil(cols / ns) + 2, nrows = Math.ceil(rows / ns) + 2;
  const nv = new Float32Array(ncols * nrows);
  for (let i = 0; i < nv.length; i++) nv[i] = rng.range(-1, 1);
  const danger = new Float32Array(n);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!isFinite(distS[i])) { danger[i] = Infinity; continue; }
    const gx = x / ns, gy = y / ns;
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
    const a = nv[y0 * ncols + x0], b = nv[y0 * ncols + x0 + 1];
    const c = nv[(y0 + 1) * ncols + x0], d = nv[(y0 + 1) * ncols + x0 + 1];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    danger[i] = distS[i] + v * 5;
  }

  // Course current: negative gradient of distF, lightly blurred.
  const gxA = new Float32Array(n), gyA = new Float32Array(n);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    const c = distF[i];
    if (!isFinite(c)) continue;
    const l = x > 0 && isFinite(distF[i - 1]) ? distF[i - 1] : c;
    const r = x < cols - 1 && isFinite(distF[i + 1]) ? distF[i + 1] : c;
    const u = y > 0 && isFinite(distF[i - cols]) ? distF[i - cols] : c;
    const b = y < rows - 1 && isFinite(distF[i + cols]) ? distF[i + cols] : c;
    let gx = -(r - l), gy = -(b - u);
    const len = Math.hypot(gx, gy);
    if (len > 1e-6) { gx /= len; gy /= len; } else { gx = 0; gy = 0; }
    gxA[i] = gx; gyA[i] = gy;
  }
  const flowX = new Float32Array(n), flowY = new Float32Array(n);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!isFinite(distF[i])) continue;
    let sx = 0, sy = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const j = ty * cols + tx;
      sx += gxA[j]; sy += gyA[j];
    }
    const len = Math.hypot(sx, sy);
    if (len > 1e-6) { flowX[i] = sx / len; flowY[i] = sy / len; }
  }

  return {
    ok: true, tile: TILE, cols, rows, floor, free, distS, distF, danger, flowX, flowY,
    totalLength, freeCount, unreachable, startIdx, idxAt,
    distAt(x, y) { return distS[idxAt(x, y)]; },
    progressAt(x, y) {
      const i = idxAt(x, y);
      const s = distS[i], e = distF[i];
      if (!isFinite(s) || !isFinite(e)) return 0;
      const p = s / (s + e);
      return p < 0 ? 0 : p > 1 ? 1 : p;
    },
    isFreeAt(x, y) { return free[idxAt(x, y)] === 1; },
  };
}
