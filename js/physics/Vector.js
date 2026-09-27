// Scalar vector helpers. The hot path avoids allocating vector objects.

export function len(x, y) { return Math.sqrt(x * x + y * y); }

// V' = V - 2 (V . N) N ; returns the reflected component pair in `out`.
export function reflect(vx, vy, nx, ny, out) {
  const d = vx * nx + vy * ny;
  out.x = vx - 2 * d * nx;
  out.y = vy - 2 * d * ny;
  return out;
}

export function rotate(vx, vy, angle, out) {
  const c = Math.cos(angle), s = Math.sin(angle);
  out.x = vx * c - vy * s;
  out.y = vx * s + vy * c;
  return out;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
