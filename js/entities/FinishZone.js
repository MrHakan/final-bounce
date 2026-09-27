export class FinishZone {
  constructor(rect) { Object.assign(this, rect); }
  contains(x, y) { return x >= this.x && x <= this.x + this.w && y >= this.y && y <= this.y + this.h; }
}
