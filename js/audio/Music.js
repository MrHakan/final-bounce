// Procedural score: a dark pulse that follows the race.
//
// One bar = 16 steps at 128 bpm. What plays depends on an intensity level
// (0-3) chosen at every bar from the race state (how close the purple is to
// the pack, how far the leader has climbed, whether the blade is out):
//
//   0  drone + a soft kick on 1 and 3                         (locked in the stalls)
//   1  four-on-the-floor kick, off-beat hats, bass pulse       (the climb)
//   2  + 16th arpeggio, denser hats                            (the purple is near)
//   3  + clap on 2 and 4, octave bass, bright arpeggio         (the finale)
//
// The key and every bar's variation come from the seed, so a seed always has
// the same score. The scheduling function is shared by the live player
// (look-ahead timer) and the offline mixer (whole race at once).
import { RNG, hashSeed } from '../core/RNG.js';

export const BPM = 128;
export const STEP = 60 / BPM / 4;
export const BAR = STEP * 16;

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const CHORD_ROOTS = [0, 8, 3, 10];           // i - VI - III - VII
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function levelFor(intensity) {
  return intensity < 0.2 ? 0 : intensity < 0.45 ? 1 : intensity < 0.72 ? 2 : 3;
}

export function rootFor(seed) { return 43 + (hashSeed(String(seed) + '/key')[0] % 7); }   // G2 .. F#3

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function kick(e, t, v) {
  const o = e.ctx.createOscillator(), g = e.ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
  env(g, t, 0.004, v, 0.22);
  o.connect(g); g.connect(e.music);
  o.start(t); o.stop(t + 0.3);
}

function noiseHit(e, t, { type, freq, q = 0.7, a = 0.002, d = 0.05, v = 0.1 }) {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  const f = e.ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = e.ctx.createGain();
  env(g, t, a, v, d);
  src.connect(f); f.connect(g); g.connect(e.music);
  src.start(t, e.rand() * 0.5); src.stop(t + a + d + 0.05);
}

function bass(e, t, midi, dur, v) {
  const o = e.ctx.createOscillator(), f = e.ctx.createBiquadFilter(), g = e.ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = midiHz(midi);
  f.type = 'lowpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(160, t + dur);
  env(g, t, 0.006, v, dur);
  o.connect(f); f.connect(g); g.connect(e.music);
  o.start(t); o.stop(t + dur + 0.08);
}

function arp(e, t, midi, v, bright) {
  const o = e.ctx.createOscillator(), f = e.ctx.createBiquadFilter(), g = e.ctx.createGain();
  o.type = 'square';
  o.frequency.value = midiHz(midi);
  f.type = 'lowpass'; f.frequency.value = bright ? 3600 : 1900;
  env(g, t, 0.003, v, 0.085);
  o.connect(f); f.connect(g); g.connect(e.music);
  o.start(t); o.stop(t + 0.14);
}

function pad(e, t, midi, dur, v) {
  for (const det of [-6, 6]) {
    const o = e.ctx.createOscillator(), f = e.ctx.createBiquadFilter(), g = e.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = midiHz(midi); o.detune.value = det;
    f.type = 'lowpass'; f.frequency.value = 340;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(e.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

// One 16th step of the score.
export function scheduleStep(e, t, stepInBar, barIndex, level, root, seed) {
  const chord = root + CHORD_ROOTS[barIndex % 4];
  const r = new RNG(`${seed}/bar${barIndex}`);
  if (stepInBar === 0) pad(e, t, chord + 12, BAR, level >= 2 ? 0.05 : 0.035);

  // kick
  if (level === 0 ? stepInBar % 8 === 0 : stepInBar % 4 === 0) kick(e, t, level === 0 ? 0.32 : level === 3 ? 0.62 : 0.5);
  // hats
  if (level >= 1) {
    const dense = level >= 2;
    if (dense ? stepInBar % 2 === 0 : stepInBar % 4 === 2) noiseHit(e, t, { type: 'highpass', freq: 7500, d: 0.04, v: stepInBar % 4 === 2 ? 0.05 : 0.028 });
  }
  // clap
  if (level >= 3 && (stepInBar === 4 || stepInBar === 12)) noiseHit(e, t, { type: 'bandpass', freq: 1700, q: 0.8, d: 0.11, v: 0.09 });
  // bass: a seeded pattern per bar
  if (level >= 1) {
    const pattern = r.pick([[0, 6, 10], [0, 3, 6, 10], [0, 4, 8, 11], [0, 6, 8, 14]]);
    if (pattern.includes(stepInBar)) {
      const k = pattern.indexOf(stepInBar);
      const note = chord - 12 + (k % 3 === 2 ? 7 : k % 3 === 1 && level >= 3 ? 12 : 0);
      bass(e, t, note, STEP * 2.6, level >= 3 ? 0.2 : 0.15);
    }
  }
  // arpeggio
  if (level >= 2) {
    const dir = r.chance(0.5) ? 1 : -1;
    const idx = (dir > 0 ? stepInBar : 15 - stepInBar) % 7;
    const octave = level >= 3 && stepInBar % 8 >= 4 ? 24 : 12;
    if (level >= 3 || stepInBar % 2 === 0) arp(e, t, chord + octave + MINOR[(idx * 2) % 7], level >= 3 ? 0.032 : 0.024, level >= 3);
  }
  // sub rumble follows the intensity (the flood coming)
  if (stepInBar % 4 === 0 && e.rumble) e.rumble.gain.setTargetAtTime(0.012 + 0.09 * e.intensityNow * e.intensityNow, t, 0.3);
}

// A looping low rumble whose gain is automated by scheduleStep.
export function startRumble(e, t) {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise; src.loop = true;
  const f = e.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 95; f.Q.value = 0.9;
  const g = e.ctx.createGain();
  g.gain.value = 0.0001;
  src.connect(f); f.connect(g); g.connect(e.music);
  src.start(t);
  e.rumble = g; e.rumbleSrc = src;
}

export function stopMusic(e, t, fade = 1.2) {
  e.music.gain.cancelScheduledValues(t);
  e.music.gain.setValueAtTime(e.music.gain.value, t);
  e.music.gain.linearRampToValueAtTime(0, t + fade);
  if (e.rumbleSrc) { try { e.rumbleSrc.stop(t + fade + 0.05); } catch { /* already stopped */ } }
  e.rumble = null; e.rumbleSrc = null;
}

// Live player: schedules a little ahead of the audio clock.
export class MusicPlayer {
  constructor(engine) {
    this.engine = engine;
    this.timer = null;
  }

  start(seed, getIntensity) {
    const e = this.engine;
    if (!e.running) return;
    this.stop(0.05);
    e.music.gain.cancelScheduledValues(e.ctx.currentTime);
    e.music.gain.setValueAtTime(1, e.ctx.currentTime);
    this.seed = seed; this.root = rootFor(seed); this.getIntensity = getIntensity;
    this.next = e.ctx.currentTime + 0.06; this.step = 0; this.level = 0;
    e.intensityNow = 0.1;
    startRumble(e, this.next);
    this.timer = setInterval(() => this.pump(), 30);
    this.pump();
  }

  pump() {
    const e = this.engine;
    if (!e.ctx) return;
    while (this.next < e.ctx.currentTime + 0.25) {
      const inBar = this.step % 16, bar = Math.floor(this.step / 16);
      if (inBar === 0) { e.intensityNow = this.getIntensity(); this.level = levelFor(e.intensityNow); }
      scheduleStep(e, this.next, inBar, bar, this.level, this.root, this.seed);
      this.next += STEP;
      this.step++;
    }
  }

  stop(fade = 1.2) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const e = this.engine;
    if (e.ctx && e.music) stopMusic(e, e.ctx.currentTime, fade);
  }
}
