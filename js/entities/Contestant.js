// A racer. Pure data + tiny helpers; the Simulation owns all behaviour so the
// update order stays explicit and deterministic.
export class Contestant {
  constructor(def, index, spawn, speed, size) {
    this.id = def.id;
    this.index = index;
    this.name = def.name;
    this.color = def.color;
    this.x = spawn.x; this.y = spawn.y;
    this.px = spawn.x; this.py = spawn.y;  // previous tick position (render interpolation)
    this.size = size;
    this.r = size / 2;
    this.baseSpeed = speed;
    this.speed = speed;
    this.vx = Math.cos(spawn.angle) * speed;
    this.vy = Math.sin(spawn.angle) * speed;
    this.alive = true;
    this.finished = false;
    this.finishTime = null;
    this.place = null;
    this.deathTime = null;
    this.deathCause = null;   // 'danger' | 'kill'
    this.killedBy = null;
    this.hasWeapon = false;
    this.kills = 0;
    this.blocksDestroyed = 0;
    this.bounces = 0;
    this.progress = 0;        // normalized route progress 0..1
    this.maxProgress = 0;
    this.courseDist = 0;      // geodesic distance from start at current position
    this.dangerGap = Infinity;
    this.lastNearMiss = -99;
    this.stuckRing = new Float32Array(16); // 8 samples of (x, y)
    this.stuckCount = 0;
    this.stuckHead = 0;
  }

  get active() { return this.alive && !this.finished; }
}
