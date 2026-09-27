// The purple pursuit field. It is not a shape moving across the screen: it is a
// threshold on geodesic course distance (distance from START measured through
// the corridors), so it follows the route through every turn.
export class DangerZone {
  constructor(params, field) {
    this.p = params;          // { v0, accel, delay, catchGap, catchK, maxRate, scale }
    this.field = field;
    this.dist = 0;            // current front, in course px
    this.rate = 0;
    this.limit = field.totalLength - 34; // never swallow the finish zone
  }

  update(time, rearDist, dt) {
    const p = this.p;
    let rate = 0;
    if (time >= p.delay) rate = (p.v0 + p.accel * (time - p.delay)) * p.scale;
    // Catch-up: if every survivor is far ahead, the field hurries (never slows).
    if (rearDist !== Infinity && time >= p.delay) {
      const gap = rearDist - this.dist;
      if (gap > p.catchGap) rate += (gap - p.catchGap) * p.catchK;
    }
    if (rate > p.maxRate * p.scale) rate = p.maxRate * p.scale;
    this.rate = rate;
    this.dist = Math.min(this.limit, this.dist + rate * dt);
  }

  get active() { return this.dist > 0; }
  get progress() { return this.dist / this.field.totalLength; }
}
