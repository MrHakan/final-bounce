// Web Audio graph:
//   sfx voices -> fxGain ----------\
//                                    masterGain -> compressor -> destination
//   score  -> musicGain -> musicVol -/                        -> MediaStreamDestination (recording)
// Everything is synthesised; no audio files, no remote services.
import { SOUNDS, makeNoiseBuffer } from './Sounds.js';
import { MusicPlayer } from './Music.js';
import { bindSoundEvents } from './SoundMap.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, fx: 0.9, music: 0.45 };
    this.liveEnabled = true;          // false while a video is being rendered offline
    this.seed = 'seed';
    this.getIntensity = () => 0.3;    // supplied by the game: 0..1 race tension
    this.player = new MusicPlayer(this);
    this.intensityNow = 0.1;
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
      this.music = ctx.createGain();      // per-run fade automation
      this.musicVol = ctx.createGain();   // user music volume
      this.fx.connect(this.master);
      this.music.connect(this.musicVol);
      this.musicVol.connect(this.master);
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
    this.musicVol.gain.setTargetAtTime(this.volumes.music, t, 0.05);
  }

  rand() { return Math.random(); }    // sound design only; never used by the simulation

  // Throttled trigger. key allows per-contestant throttling of the same sound.
  play(name, params = {}, key = name) {
    if (!this.running || !this.liveEnabled) return;
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

  // Subscribe to gameplay events: sound effects (shared map) + the score.
  attach(bus) {
    bindSoundEvents(bus, (name, params, key) => this.play(name, params, key));
    // Score: starts on GO, follows the race tension, fades out at the end.
    bus.on('level:generated', (e) => { this.seed = e.seed; });
    bus.on('race:go', () => { if (this.liveEnabled && this.volumes.music > 0) this.player.start(this.seed, () => this.getIntensity()); });
    bus.on('race:end', () => this.player.stop(1.6));
    bus.on('race:reset', () => this.player.stop(0.15));
    bus.on('race:pause', () => this.player.stop(0.15));
    bus.on('race:resume', () => { if (this.liveEnabled && this.volumes.music > 0) this.player.start(this.seed, () => this.getIntensity()); });
  }
}
