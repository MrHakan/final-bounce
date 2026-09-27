// The blade power-up. Lies on the ground until the first living contestant touches it.
export class Weapon {
  constructor(x, y, maxKills) {
    this.x = x; this.y = y;
    this.pickupRadius = 8;
    this.holder = null;       // contestant id
    this.state = 'ground';    // 'ground' | 'held' | 'gone'
    this.killsLeft = maxKills > 0 ? maxKills : Infinity;
    this.pickupTime = null;
  }
}
