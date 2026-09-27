// Narrow-phase contact tests. Contestants are treated as circles of radius r
// for contact (rendered as squares). Results are written into a reusable object.

export const contact = { nx: 0, ny: 0, depth: 0 };

// Circle vs axis-aligned rectangle {x, y, w, h}.
export function circleRect(cx, cy, r, rect, out = contact) {
  const px = cx < rect.x ? rect.x : cx > rect.x + rect.w ? rect.x + rect.w : cx;
  const py = cy < rect.y ? rect.y : cy > rect.y + rect.h ? rect.y + rect.h : cy;
  const dx = cx - px, dy = cy - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    out.nx = dx / d; out.ny = dy / d; out.depth = r - d;
    return true;
  }
  // Centre inside the rectangle: push out along the axis of least penetration.
  const left = cx - rect.x, right = rect.x + rect.w - cx;
  const top = cy - rect.y, bottom = rect.y + rect.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) { out.nx = -1; out.ny = 0; }
  else if (m === right) { out.nx = 1; out.ny = 0; }
  else if (m === top) { out.nx = 0; out.ny = -1; }
  else { out.nx = 0; out.ny = 1; }
  out.depth = m + r;
  return true;
}

// Circle vs circle; normal points from b towards a.
export function circleCircle(ax, ay, ar, bx, by, br, out = contact) {
  const dx = ax - bx, dy = ay - by;
  const rr = ar + br;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    out.nx = dx / d; out.ny = dy / d; out.depth = rr - d;
  } else {
    out.nx = 1; out.ny = 0; out.depth = rr;
  }
  return true;
}

export function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

export function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
