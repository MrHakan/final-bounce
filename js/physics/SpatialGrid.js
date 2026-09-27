// Uniform-grid broadphase for static-ish colliders (walls, bumpers, barriers).
// Items are inserted once per level; removed items are flagged dead by the caller.

export class SpatialGrid {
  constructor(width, height, cellSize = 32) {
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
    this.stamp = 0;
    this.result = [];
  }

  insert(item, x, y, w, h) {
    const c0 = Math.max(0, Math.floor(x / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((x + w) / this.cell));
    const r0 = Math.max(0, Math.floor(y / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((y + h) / this.cell));
    item._q = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.buckets[r * this.cols + c].push(item);
  }

  // Returns a shared array of unique candidates overlapping the query box.
  // Order is insertion order within buckets, so results are deterministic.
  query(x, y, w, h) {
    const out = this.result;
    out.length = 0;
    const s = ++this.stamp;
    const c0 = Math.max(0, Math.floor(x / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((x + w) / this.cell));
    const r0 = Math.max(0, Math.floor(y / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((y + h) / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets[r * this.cols + c];
        for (let i = 0; i < b.length; i++) {
          const it = b[i];
          if (it._q !== s) { it._q = s; out.push(it); }
        }
      }
    }
    return out;
  }
}
