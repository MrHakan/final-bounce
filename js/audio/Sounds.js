// Procedural sound effects. Each entry: { throttle (s), play(engine, when, params) -> duration }.
export function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  return buf;
}

const semis = (n) => Math.pow(2, n / 12);

function env(g, when, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function tone(e, when, { type = 'sine', freq = 440, to = null, attack = 0.003, decay = 0.1, gain = 0.2, glide = null }) {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  if (to) o.frequency.exponentialRampToValueAtTime(to, when + (glide || attack + decay));
  env(g, when, attack, gain, decay);
  o.connect(g); g.connect(e.fx);
  o.start(when); o.stop(when + attack + decay + 0.05);
  return attack + decay;
}

function noise(e, when, { type = 'bandpass', freq = 1200, q = 1, to = null, attack = 0.002, decay = 0.12, gain = 0.2 }) {
  const ctx = e.ctx;
  const src = ctx.createBufferSource();
  src.buffer = e.noise;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, when); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, when + attack + decay);
  const g = ctx.createGain();
  env(g, when, attack, gain, decay);
  src.connect(f); f.connect(g); g.connect(e.fx);
  src.start(when, Math.random() * 0.5); src.stop(when + attack + decay + 0.05);
  return attack + decay;
}

export const SOUNDS = {
  bounce: {
    throttle: 0.05,
    play(e, t, p) {
      const f = 560 * semis(p.pitch || 0) * (p.barrier ? 0.75 : 1);
      return tone(e, t, { type: 'triangle', freq: f, to: f * 0.8, decay: 0.05, gain: 0.07 });
    },
  },
  bumper: {
    throttle: 0.05,
    play(e, t, p) {
      const f = 880 * semis(p.pitch || 0);
      tone(e, t, { type: 'sine', freq: f, to: f * 1.5, decay: 0.08, gain: 0.08 });
      return 0.1;
    },
  },
  collision: {
    throttle: 0.08,
    play(e, t) {
      tone(e, t, { type: 'square', freq: 260, to: 180, decay: 0.06, gain: 0.06 });
      noise(e, t, { type: 'highpass', freq: 2500, decay: 0.03, gain: 0.08 });
      return 0.08;
    },
  },
  colorBreak: {
    throttle: 0.04, priority: true,
    play(e, t, p) {
      noise(e, t, { type: 'bandpass', freq: 2200, q: 0.8, to: 700, decay: 0.16, gain: 0.3 });
      const base = 660 * semis(p.pitch || 0);
      tone(e, t, { type: 'triangle', freq: base, decay: 0.07, gain: 0.12 });
      tone(e, t + 0.05, { type: 'triangle', freq: base * 1.5, decay: 0.1, gain: 0.1 });
      return 0.2;
    },
  },
  greyHit: {
    throttle: 0.06, priority: true,
    play(e, t) {
      noise(e, t, { type: 'lowpass', freq: 1400, decay: 0.08, gain: 0.25 });
      tone(e, t, { type: 'sine', freq: 170, to: 110, decay: 0.1, gain: 0.25 });
      return 0.12;
    },
  },
  greyBreak: {
    throttle: 0.05, priority: true,
    play(e, t) {
      noise(e, t, { type: 'lowpass', freq: 2400, to: 180, decay: 0.42, gain: 0.45 });
      tone(e, t, { type: 'sine', freq: 110, to: 45, decay: 0.38, gain: 0.45 });
      tone(e, t, { type: 'square', freq: 80, to: 50, decay: 0.12, gain: 0.08 });
      return 0.45;
    },
  },
  pickup: {
    throttle: 0.2, priority: true,
    play(e, t) {
      [660, 880, 1320].forEach((f, i) => tone(e, t + i * 0.06, { type: 'square', freq: f, decay: 0.08, gain: 0.07 }));
      tone(e, t + 0.18, { type: 'sine', freq: 2640, decay: 0.25, gain: 0.05 });
      return 0.45;
    },
  },
  shatter: {
    throttle: 0.2, priority: true,
    play(e, t) {
      tone(e, t, { type: 'sine', freq: 2100, to: 1400, decay: 0.3, gain: 0.08 });
      noise(e, t, { type: 'highpass', freq: 4000, decay: 0.2, gain: 0.12 });
      return 0.32;
    },
  },
  kill: {
    throttle: 0.1, priority: true,
    play(e, t) {
      tone(e, t, { type: 'sawtooth', freq: 240, to: 55, decay: 0.26, gain: 0.18 });
      noise(e, t, { type: 'bandpass', freq: 900, decay: 0.1, gain: 0.3 });
      return 0.3;
    },
  },
  purpleDeath: {
    throttle: 0.1, priority: true,
    play(e, t) {
      tone(e, t, { type: 'sine', freq: 520, to: 70, decay: 0.45, gain: 0.25, glide: 0.45 });
      tone(e, t, { type: 'triangle', freq: 260, to: 40, decay: 0.4, gain: 0.12, glide: 0.4 });
      noise(e, t, { type: 'lowpass', freq: 600, decay: 0.3, gain: 0.18 });
      return 0.5;
    },
  },
  nearMiss: {
    throttle: 0.6,
    play(e, t) {
      noise(e, t, { type: 'bandpass', freq: 400, q: 2, to: 1800, attack: 0.05, decay: 0.2, gain: 0.12 });
      return 0.26;
    },
  },
  finish: {
    throttle: 0.5, priority: true,
    play(e, t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(e, t + i * 0.085, { type: 'triangle', freq: f, decay: 0.16, gain: 0.16 }));
      [523.25, 659.25, 783.99].forEach((f) => tone(e, t + 0.36, { type: 'sine', freq: f * 2, attack: 0.01, decay: 0.6, gain: 0.07 }));
      return 1.0;
    },
  },
  place: {
    throttle: 0.2,
    play(e, t) { tone(e, t, { type: 'triangle', freq: 784, decay: 0.15, gain: 0.1 }); return 0.16; },
  },
  count: {
    throttle: 0.1, priority: true,
    play(e, t) { tone(e, t, { type: 'square', freq: 660, decay: 0.1, gain: 0.08 }); return 0.12; },
  },
  go: {
    throttle: 0.1, priority: true,
    play(e, t) { tone(e, t, { type: 'square', freq: 990, decay: 0.28, gain: 0.1 }); tone(e, t, { type: 'sine', freq: 1980, decay: 0.2, gain: 0.05 }); return 0.3; },
  },
  intro: {
    throttle: 0.5,
    play(e, t) { noise(e, t, { type: 'bandpass', freq: 300, q: 1.5, to: 2400, attack: 0.2, decay: 0.3, gain: 0.1 }); return 0.5; },
  },
};
