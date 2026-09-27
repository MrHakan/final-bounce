// Route skeleton: a self-avoiding walk over the course grid. Consecutive route
// cells are joined by doors; every other cell boundary is a solid wall, so the
// course is a single chain START -> ... -> FINISH and progress is well defined.

export const DIRS = {
  N: { dx: 0, dy: -1, opp: 'S' },
  S: { dx: 0, dy: 1, opp: 'N' },
  E: { dx: 1, dy: 0, opp: 'W' },
  W: { dx: -1, dy: 0, opp: 'E' },
};
const DIR_KEYS = ['N', 'E', 'S', 'W'];

export const ROUTE_STYLES = ['wander', 'snake', 'zigzag', 'corridor', 'spiral'];

function neighbourWeights(style, dir, prevDir, cand, cols, rows, visitedCountAround) {
  let w = 1;
  const straight = prevDir && dir === prevDir;
  const horizontal = dir === 'E' || dir === 'W';
  switch (style) {
    case 'snake': w = horizontal ? 4 : 1; if (straight) w *= 1.5; break;
    case 'zigzag': w = straight ? 0.35 : 2.2; break;
    case 'corridor': w = straight ? 3.2 : 1; break;
    case 'spiral': w = 1 + visitedCountAround * 1.4; break; // hug already-used cells
    default: w = straight ? 1.4 : 1;
  }
  // Mild downward bias so courses read top-to-bottom on a phone.
  if (dir === 'S') w *= 1.25;
  if (dir === 'N') w *= 0.8;
  // Avoid wandering along an edge into a corner trap too eagerly.
  if (cand.c === 0 || cand.c === cols - 1) w *= 0.95;
  if (cand.r === 0 || cand.r === rows - 1) w *= 0.95;
  return w;
}

function orderedCandidates(rng, style, cols, rows, visited, cell, prevDir) {
  const opts = [];
  for (const k of DIR_KEYS) {
    const d = DIRS[k];
    const c = cell.c + d.dx, r = cell.r + d.dy;
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    if (visited[r * cols + c]) continue;
    let around = 0;
    for (const k2 of DIR_KEYS) {
      const c2 = c + DIRS[k2].dx, r2 = r + DIRS[k2].dy;
      if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) { around += 0.5; continue; }
      if (visited[r2 * cols + c2]) around++;
    }
    opts.push({ c, r, dir: k, w: neighbourWeights(style, k, prevDir, { c, r }, cols, rows, around) });
  }
  // Weighted random order (sampling without replacement).
  const out = [];
  while (opts.length) {
    let total = 0;
    for (const o of opts) total += o.w;
    let x = rng.next() * total, pick = opts.length - 1;
    for (let i = 0; i < opts.length; i++) { x -= opts[i].w; if (x < 0) { pick = i; break; } }
    out.push(opts.splice(pick, 1)[0]);
  }
  return out;
}

export function generateRoute(rng, cols, rows, minLen, maxLen, style) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const target = rng.int(minLen, Math.min(maxLen, cols * rows));
    const startRow = rng.chance(0.8) ? 0 : rng.int(0, Math.max(0, Math.floor(rows / 3)));
    const start = { c: rng.int(0, cols - 1), r: startRow };
    const visited = new Uint8Array(cols * rows);
    const path = [start];
    visited[start.r * cols + start.c] = 1;
    const stack = [orderedCandidates(rng, style, cols, rows, visited, start, null)];
    let budget = 2500;
    while (path.length && budget-- > 0) {
      if (path.length === target) {
        // Prefer a finish that is not directly beside the start cell.
        const end = path[path.length - 1];
        if (Math.abs(end.c - start.c) + Math.abs(end.r - start.r) > 1 || target > cols * rows - 2) {
          return path.map((p, i) => ({ c: p.c, r: p.r, dir: i === 0 ? null : p.dir }));
        }
      }
      const opts = stack[stack.length - 1];
      if (path.length === target || opts.length === 0) {
        const last = path.pop();
        stack.pop();
        visited[last.r * cols + last.c] = 0;
        continue;
      }
      const next = opts.shift();
      if (visited[next.r * cols + next.c]) continue;
      visited[next.r * cols + next.c] = 1;
      path.push(next);
      stack.push(orderedCandidates(rng, style, cols, rows, visited, next, next.dir));
    }
  }
  return null;
}

// Classify each route cell by its entry/exit geometry (for debug + templates).
export function classifyRoute(route) {
  const turnSign = (a, b) => {
    const order = { N: 0, E: 1, S: 2, W: 3 };
    const d = (order[b] - order[a] + 4) % 4;
    return d === 1 ? 1 : d === 3 ? -1 : 0;
  };
  for (let i = 0; i < route.length; i++) {
    const cell = route[i];
    const inDir = i > 0 ? route[i].dir : null;          // direction travelled into this cell
    const outDir = i < route.length - 1 ? route[i + 1].dir : null;
    cell.entrySide = inDir ? DIRS[inDir].opp : null;
    cell.exitSide = outDir;
    if (!inDir || !outDir) cell.shape = i === 0 ? 'START' : 'FINISH';
    else if (inDir === outDir) cell.shape = 'STRAIGHT';
    else {
      cell.shape = 'L_TURN';
      if (i + 1 < route.length - 1) {
        const nextOut = route[i + 2] ? route[i + 2].dir : null;
        if (nextOut && turnSign(inDir, outDir) === turnSign(outDir, nextOut) && turnSign(inDir, outDir) !== 0) cell.shape = 'U_TURN';
      }
    }
  }
  return route;
}
