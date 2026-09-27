// Starting stalls: the first two route cells form one wide start room split
// into four narrow lanes, one racer per lane, plus an exit lane.
//
//   | L0 |B0| L1 |B1| L2 |B2| L3 |B3|   EXIT   |
//
// Between neighbouring lanes the upper part is a column of coloured bricks,
// the lower part a solid wall. B3 separates the last lane from the exit.
// Only the matching colour can break a brick, so the racers depend on each
// other in a chain (e.g. BLUE opens B1, YELLOW walks through and opens B0,
// RED can then leave its lane ... and nobody exits until B3's colour gets
// there). The purple rises from the back of every lane.
import { COLOR_IDS } from '../config/presets.js';
import { makeWall } from '../entities/Wall.js';
import { makeBarrier } from '../entities/Barrier.js';

const LANE_W = 28;
const BRICK_W = 12;
const BRICK_ROWS = 3;
const BRICK_SPAN = 0.62; // fraction of the room height taken by the brick columns

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((v, i) => {
    for (const p of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([v, ...p]);
  });
  return out;
}

// Returns the number of breaking rounds needed for every racer to reach the
// exit, or -1 if the stall can never be solved (with everyone alive).
export function stallRounds(lanes, bricks) {
  const n = lanes.length;
  const broken = new Array(n).fill(false);
  const laneOf = Object.fromEntries(lanes.map((id, i) => [id, i]));
  const reach = (id) => {
    let lo = laneOf[id], hi = laneOf[id];
    while (lo > 0 && broken[lo - 1]) lo--;
    while (hi < n - 1 && broken[hi]) hi++;
    return [lo, hi];
  };
  for (let round = 0; round <= n; round++) {
    const ranges = Object.fromEntries(lanes.map((id) => [id, reach(id)]));
    if (broken[n - 1] && lanes.every((id) => ranges[id][1] === n - 1)) return round;
    const now = [];
    for (let b = 0; b < n; b++) {
      if (broken[b]) continue;
      const [lo, hi] = ranges[bricks[b]];
      // Brick b touches lane b and lane b+1 (b = n-1 touches only the last lane).
      if ((b >= lo && b <= hi) || (b + 1 >= lo && b + 1 <= hi && b + 1 < n)) now.push(b);
    }
    if (!now.length) return -1;
    for (const b of now) broken[b] = true;
  }
  return -1;
}

export function chooseStallColors(rng) {
  const lanes = rng.shuffle(COLOR_IDS.slice());
  // The exit brick never belongs to the racer next to it: nobody leaves
  // without somebody else's help.
  const scored = permutations(COLOR_IDS)
    .filter((bricks) => bricks[bricks.length - 1] !== lanes[lanes.length - 1])
    .map((bricks) => ({ bricks, rounds: stallRounds(lanes, bricks) }))
    .filter((s) => s.rounds > 0);
  const best = Math.max(...scored.map((s) => s.rounds));
  // Always chained (2+ rounds: somebody must wait for somebody else); deeper
  // 3+-round chains about half of the time.
  const deep = scored.filter((s) => s.rounds >= 3);
  const pool = deep.length && rng.chance(0.5) ? deep : scored.filter((s) => s.rounds === Math.min(2, best));
  const pick = rng.pick(pool);
  return { lanes, bricks: pick.bricks, rounds: pick.rounds };
}

// Geometry of the stall room. cell0/cell1 are horizontally adjacent.
export function stallLayout(cell0, cell1, t) {
  const dir = cell1.c > cell0.c ? 1 : -1;
  const xL = Math.min(cell0.x, cell1.x) + t / 2;
  const xR = Math.max(cell0.x, cell1.x) + cell0.w - t / 2;
  const y0 = cell0.y + t / 2, y1 = cell0.y + cell0.h - t / 2;
  const n = COLOR_IDS.length;
  const used = n * (LANE_W + BRICK_W);
  // u runs from the far end (away from the exit) toward the exit.
  const X = (u, w) => (dir > 0 ? xL + u : xR - u - w);
  const lanes = [], bricks = [];
  for (let k = 0; k < n; k++) {
    lanes.push({ x: X(k * (LANE_W + BRICK_W), LANE_W), w: LANE_W });
    bricks.push({ x: X(k * (LANE_W + BRICK_W) + LANE_W, BRICK_W), w: BRICK_W });
  }
  const exit = { x: X(used, xR - xL - used), w: xR - xL - used };
  return { dir, xL, xR, y0, y1, lanes, bricks, exit };
}

export function buildStalls(layout, colors, rng, t) {
  const { y0, y1, lanes, bricks } = layout;
  const H = y1 - y0;
  const bricksTop = rng.chance(0.5);
  const span = Math.round(H * BRICK_SPAN);
  const rowH = span / BRICK_ROWS;
  const walls = [], barriers = [], spawns = [], dangerSources = [];
  bricks.forEach((b, k) => {
    for (let r = 0; r < BRICK_ROWS; r++) {
      const y = bricksTop ? y0 + r * rowH : y1 - (r + 1) * rowH;
      barriers.push(makeBarrier(b.x, y, b.w, rowH, colors.bricks[k], 1, 'stall'));
    }
    // Solid separator for the rest of the height (merged into the room wall).
    if (bricksTop) walls.push(makeWall(b.x, y0 + span, b.w, H - span + t / 2));
    else walls.push(makeWall(b.x, y0 - t / 2, b.w, H - span + t / 2));
  });
  lanes.forEach((l, k) => {
    const back = bricksTop ? y1 - 16 : y0 + 16;
    const up = bricksTop ? -Math.PI / 2 : Math.PI / 2;
    // Aim at the brick side of the lane, never straight along it.
    const side = rng.chance(0.5) ? 1 : -1;
    spawns.push({ id: colors.lanes[k], x: l.x + l.w / 2, y: back, angle: up + side * rng.range(0.35, 0.7) });
    dangerSources.push({ x: l.x, y: bricksTop ? y1 - 14 : y0, w: l.w, h: 14 });
  });
  return { walls, barriers, spawns, dangerSources, bricksTop };
}
