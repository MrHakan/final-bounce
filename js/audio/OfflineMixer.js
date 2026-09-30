// Renders the whole soundtrack of a race offline at exact timestamps.
//
// The video exporter runs the race frame by frame, so every sound effect has an
// exact time (frame index / fps). Those events, plus the score driven by the
// per-frame tension curve, are scheduled into an OfflineAudioContext with the
// same synthesis code as the live engine (Sounds.js / Music.js). The result is
// sample-accurate, deterministic (seeded noise) and independent of machine load.
import { SOUNDS, makeNoiseBuffer } from './Sounds.js';
import { scheduleStep, startRumble, stopMusic, levelFor, rootFor, STEP } from './Music.js';
import { RNG } from '../core/RNG.js';

export class OfflineMixer {
  constructor({ volumes, muted = false, seed = 'seed', sampleRate = 48000 }) {
    this.volumes = { master: 0.8, fx: 0.9, music: 0.45, ...volumes };
    this.muted = muted;
    this.seed = seed;
    this.sampleRate = sampleRate;
    this.events = [];
    this.musicTrack = null;
  }

  static get supported() { return typeof OfflineAudioContext !== 'undefined' || typeof webkitOfflineAudioContext !== 'undefined'; }

  addSound(time, name, params = {}, key = name) { this.events.push({ time, name, params, key }); }

  // intensityAt(t) -> 0..1, sampled at every bar.
  setMusic(start, end, intensityAt) { this.musicTrack = { start, end, intensityAt }; }

  async render(duration) {
    const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : webkitOfflineAudioContext;
    const sr = this.sampleRate;
    const ctx = new OAC(2, Math.ceil(duration * sr), sr);
    const master = ctx.createGain(), fx = ctx.createGain(), music = ctx.createGain(), musicVol = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    fx.connect(master); music.connect(musicVol); musicVol.connect(master); master.connect(comp); comp.connect(ctx.destination);
    master.gain.value = this.muted ? 0 : this.volumes.master;
    fx.gain.value = this.volumes.fx;
    musicVol.gain.value = this.volumes.music;

    const rng = new RNG(this.seed + '/audio');
    const e = { ctx, fx, music, noise: makeNoiseBuffer(ctx), rand: () => rng.next(), rumble: null, intensityNow: 0.1 };

    // Sound effects, with the same per-key throttling as the live engine.
    const last = new Map();
    for (const ev of this.events.slice().sort((a, b) => a.time - b.time)) {
      const def = SOUNDS[ev.name];
      if (!def) continue;
      if (ev.time - (last.get(ev.key) ?? -1) < (def.throttle || 0)) continue;
      last.set(ev.key, ev.time);
      def.play(e, ev.time + 0.005, ev.params || {});
    }

    // Score.
    const m = this.musicTrack;
    if (m && this.volumes.music > 0 && m.end > m.start) {
      const root = rootFor(this.seed);
      startRumble(e, m.start);
      const steps = Math.floor((m.end - m.start) / STEP);
      let level = 0;
      for (let i = 0; i < steps; i++) {
        const t = m.start + i * STEP, inBar = i % 16;
        if (inBar === 0) { e.intensityNow = m.intensityAt(t); level = levelFor(e.intensityNow); }
        scheduleStep(e, t, inBar, Math.floor(i / 16), level, root, this.seed);
      }
      stopMusic(e, Math.max(m.start, m.end - 1.6), 1.5);
    }

    const buffer = await ctx.startRendering();
    normalize(buffer);
    return buffer;
  }
}

// Bring the mix to a consistent loudness (sparse effect-only tracks are quiet next
// to other Reels) and soft-limit the peaks instead of hard clipping.
export function normalize(buffer, { targetRms = 0.1, maxGain = 3.2, minGain = 0.7, ceiling = 0.92 } = {}) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  let sum = 0, n = 0;
  const len = buffer.length;
  for (let i = 0; i < len; i += 4) {
    let v = 0;
    for (const ch of chans) v += ch[i] * ch[i];
    v /= chans.length;
    if (v > 1e-7) { sum += v; n++; }     // ignore near-silence
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  const gain = rms > 0 ? Math.max(minGain, Math.min(maxGain, targetRms / rms)) : 1;
  for (const ch of chans) for (let i = 0; i < len; i++) ch[i] = ceiling * Math.tanh((ch[i] * gain) / ceiling);
  return { rms, gain };
}
