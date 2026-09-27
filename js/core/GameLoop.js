// requestAnimationFrame driver. Real elapsed time is handed to Game.update,
// which converts it into a whole number of fixed simulation ticks; the frame
// rate therefore changes smoothness, never results.
export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.last = 0;
    this.fps = 0;
    this._frames = 0;
    this._fpsT = 0;
    this._raf = null;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this._frames++;
    this._fpsT += dt;
    if (this._fpsT >= 0.5) { this.fps = Math.round(this._frames / this._fpsT); this._frames = 0; this._fpsT = 0; }
    this.update(dt);
    this.render();
    this._raf = requestAnimationFrame(this.tick);
  }
}
