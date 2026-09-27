// Web Audio graph:
//   voices -> fxGain -> masterGain -> compressor -> destination
//                                                -> MediaStreamDestination (recording)
// Everything is synthesised; no audio files, no remote services.
import { SOUNDS, makeNoiseBuffer } from './Sounds.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, fx: 0.9 };
    this.muted = false;
    this.lastPlay = new Map();
    this.voices = 0;
    this.maxVoices = 28;
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  // Must be called from a user gesture the first time (autoplay policy).
  ensure() {
    if (!this.supported) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.fx = ctx.createGain();
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.15;
      this.fx.connect(this.master);
      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);
      if (ctx.createMediaStreamDestination) {
        this.streamDest = ctx.createMediaStreamDestination();
        this.comp.connect(this.streamDest);
      }
      this.noise = makeNoiseBuffer(ctx);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  get stream() { return this.streamDest ? this.streamDest.stream : null; }

  setVolume(kind, v) { this.volumes[kind] = v; this.applyVolumes(); }
  setMuted(m) { this.muted = m; this.applyVolumes(); }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.02);
    this.fx.gain.setTargetAtTime(this.volumes.fx, t, 0.02);
  }

  // Throttled trigger. key allows per-contestant throttling of the same sound.
  play(name, params = {}, key = name) {
    if (!this.running) return;
    const def = SOUNDS[name];
    if (!def) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < (def.throttle || 0)) return;
    if (this.voices >= this.maxVoices && !def.priority) return;
    this.lastPlay.set(key, now);
    this.voices++;
    const dur = def.play(this, now + 0.005, params) || 0.3;
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, (dur + 0.05) * 1000);
  }

  // Subscribe to gameplay events.
  attach(bus) {
    const pitchOf = (id) => ({ red: 0, blue: 3, yellow: 7, green: 10 }[id] || 0);
    bus.on('contestant:bounce', (e) => this.play('bounce', { pitch: pitchOf(e.actor), barrier: e.on === 'barrier' }, 'bounce:' + e.actor));
    bus.on('contestant:bumper', (e) => this.play('bumper', { pitch: pitchOf(e.actor) }, 'bumper:' + e.actor));
    bus.on('contestant:collision', () => this.play('collision'));
    bus.on('barrier:damage', () => this.play('greyHit'));
    bus.on('barrier:destroy', (e) => this.play(e.type === 'finalBreak' ? 'greyBreak' : 'colorBreak', { pitch: pitchOf(e.actor) }));
    bus.on('weapon:pickup', () => this.play('pickup'));
    bus.on('weapon:break', () => this.play('shatter'));
    bus.on('contestant:killed', (e) => this.play(e.cause === 'kill' ? 'kill' : 'purpleDeath'));
    bus.on('danger:nearMiss', () => this.play('nearMiss'));
    bus.on('contestant:finish', (e) => this.play(e.place === 1 ? 'finish' : 'place'));
    bus.on('race:countdown', (e) => this.play(e.step === 3 ? 'go' : 'count'));
    bus.on('race:go', () => {});
    bus.on('race:intro', () => this.play('intro'));
  }
}
