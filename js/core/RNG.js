// Deterministic seeded PRNG. Every simulation decision must go through this,
// never through Math.random().

// cyrb128: hashes an arbitrary string into four 32-bit seeds.
export function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32 generator: small, fast, good statistical quality.
export class RNG {
  constructor(seed) {
    this.seedLabel = String(seed);
    const [a, b, c, d] = hashSeed(this.seedLabel);
    this.a = a; this.b = b; this.c = c; this.d = d;
    for (let i = 0; i < 12; i++) this.nextUint();
  }

  nextUint() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  next() { return this.nextUint() / 4294967296; }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  weighted(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) { r -= e[1]; if (r < 0) return e[0]; }
    return entries[entries.length - 1][0];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Independent child stream, stable regardless of how much the parent was used.
  fork(label) { return new RNG(this.seedLabel + '/' + label); }
}

// Integer hash for stateless deterministic noise (anti-stuck nudges, field noise).
export function hash2(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const SEED_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// Seed *creation* is allowed to use platform randomness: the seed itself is
// what makes the race reproducible.
export function randomSeedString(len = 6) {
  const buf = new Uint32Array(len);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 4294967296);
  let s = '';
  for (let i = 0; i < len; i++) s += SEED_ALPHABET[buf[i] % SEED_ALPHABET.length];
  return s;
}

// Deterministic seed sequence (used by stress tests so reports are reproducible).
export function seedFromIndex(prefix, i) {
  const r = new RNG(prefix + ':' + i);
  let s = '';
  for (let k = 0; k < 6; k++) s += SEED_ALPHABET[r.nextUint() % SEED_ALPHABET.length];
  return s;
}

export function normalizeSeed(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}
