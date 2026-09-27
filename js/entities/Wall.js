// Static geometry. Walls are axis-aligned rectangles; bumpers are circles.
export function makeWall(x, y, w, h, tag = 'wall') {
  return { kind: 'wall', tag, x, y, w, h };
}

export function makeBumper(x, y, r) {
  return { kind: 'bumper', x, y, r };
}
