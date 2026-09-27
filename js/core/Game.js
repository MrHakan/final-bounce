// Orchestrates one "episode": level -> intro -> countdown -> race -> result card.
// Owns the presentation timeline (which is pure display) and forwards
// simulation events to the EventBus so audio/particles/UI stay decoupled.
import { DT, VIEW_DEFAULTS, contestantById, resolveRaceConfig } from '../config/presets.js';
import { Simulation } from './Simulation.js';
import { generateLevel } from '../generation/LevelGenerator.js';
import { Renderer } from '../rendering/Renderer.js';
import { Camera } from '../rendering/Camera.js';
import { Particles } from '../rendering/Particles.js';

export const GameState = Object.freeze({
  IDLE: 'IDLE',             // nothing generated yet
  GENERATED: 'GENERATED',   // level ready, race at t=0, waiting for play
  COUNTDOWN: 'COUNTDOWN',   // intro + 3-2-1-GO
  RUNNING: 'RUNNING',       // simulation stepping
  FINISHED: 'FINISHED',     // result card
  REPLAY: 'REPLAY',         // session mode: re-running the same seed + config
  RECORDING: 'RECORDING',   // session mode: canvas + audio being captured
});

// Simulation event type -> public bus event name.
export const EVENT_MAP = {
  bounce: 'contestant:bounce',
  bumper: 'contestant:bumper',
  collision: 'contestant:collision',
  barrierDamage: 'barrier:damage',
  barrierBreak: 'barrier:destroy',
  finalBreak: 'barrier:destroy',
  orphan: 'barrier:orphan',
  weaponPickup: 'weapon:pickup',
  weaponBreak: 'weapon:break',
  weaponLost: 'weapon:lost',
  eliminated: 'contestant:killed',
  nearMiss: 'danger:nearMiss',
  finish: 'contestant:finish',
  leadChange: 'race:leadChange',
  antiStuck: 'debug:antiStuck',
  raceEnd: 'race:end',
};

export function courseBounds(level) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of level.route) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); }
  const m = 6;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

const INTRO = 1.0;
const COUNT_STEP = 0.3;
const COUNTDOWN = 4 * COUNT_STEP; // 3, 2, 1, GO  (~1.2 s)
const CARD = 1.8;
const SLOWMO = { factor: 0.25, seconds: 0.4 };

export class Game {
  constructor(canvas, bus) {
    this.canvas = canvas;
    this.bus = bus;
    this.renderer = new Renderer(canvas);
    this.camera = new Camera();
    this.particles = new Particles();
    this.view = { ...VIEW_DEFAULTS };
    this.presetId = 'medium';
    this.raceConfig = resolveRaceConfig('medium');
    this.seed = null;
    this.level = null;
    this.gen = null;
    this.sim = null;
    this.state = GameState.IDLE;
    this.mode = 'live';          // 'live' | 'replay'
    this.recording = false;
    this.paused = false;
    this.acc = 0;
    this.presT = 0;
    this.goT = 0;
    this.cardT = 0;
    this.slowmoLeft = 0;
    this.callouts = [];
    this.pulse = 0;
    this.clock = 0;
    this.completeSent = false;
    this.lastEvents = [];
    this.fps = 0;
    this.maxStepsPerFrame = 160;
  }

  setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    this.bus.emit('state:change', { state: s, prev, mode: this.mode, recording: this.recording });
  }

  get sessionState() {
    if (this.recording) return GameState.RECORDING;
    if (this.mode === 'replay' && (this.state === GameState.RUNNING || this.state === GameState.COUNTDOWN)) return GameState.REPLAY;
    return this.state;
  }

  // ---------- level lifecycle ----------
  generate(seed, raceConfig, presetId) {
    this.seed = seed;
    if (raceConfig) this.raceConfig = { ...raceConfig };
    if (presetId) this.presetId = presetId;
    const t0 = performance.now();
    const gen = generateLevel(seed, this.raceConfig, { forceTestRun: true });
    gen.ms = Math.round(performance.now() - t0);
    return this.loadGenerated(gen);
  }

  loadGenerated(gen) {
    if (!gen.level) throw new Error('Could not generate a valid course for seed ' + gen.seed);
    this.gen = gen;
    this.level = gen.level;
    this.seed = gen.level.seed;
    this.raceConfig = { ...gen.level.config };
    this.renderer.setLevel(this.level);
    this.camera.setWorld(this.level.width, this.level.height, courseBounds(this.level));
    this.mode = 'live';
    this.resetRace();
    this.bus.emit('level:generated', { seed: this.seed, gen });
    return gen;
  }

  resetRace() {
    if (!this.level) return;
    this.sim = new Simulation(this.level);
    this.particles.reset(this.seed);
    this.renderer.resetTrails();
    this.acc = 0; this.presT = 0; this.goT = 0; this.cardT = 0; this.slowmoLeft = 0;
    this.callouts = [];
    this.completeSent = false;
    this.paused = false;
    this.camera.shakeAmp = 0;
    this.camera.update(this.sim, this.view.camera, 0, true);
    this.setState(GameState.GENERATED);
    this.bus.emit('race:reset', { seed: this.seed });
  }

  play() {
    if (!this.sim) return;
    if (this.paused) { this.paused = false; this.bus.emit('race:resume', {}); return; }
    if (this.state === GameState.GENERATED) {
      this.presT = 0;
      const skip = !this.view.intro && !this.view.countdown;
      if (skip) { this.goT = 0; this.setState(GameState.RUNNING); this.bus.emit('race:go', {}); }
      else this.setState(GameState.COUNTDOWN);
    } else if (this.state === GameState.FINISHED) {
      this.replay();
    }
  }

  pause() {
    if (this.state === GameState.RUNNING || this.state === GameState.COUNTDOWN) {
      this.paused = true;
      this.bus.emit('race:pause', {});
    }
  }

  restart(autoplay = true) {
    this.resetRace();
    if (autoplay) this.play();
  }

  replay() {
    this.resetRace();
    this.mode = 'replay';
    this.play();
  }

  // ---------- per-frame update ----------
  update(realDt) {
    this.clock += realDt;
    const speed = this.recording ? 1 : this.view.speed;
    const dt = this.paused ? 0 : realDt * speed;
    this.pulse += dt;

    if (this.state === GameState.COUNTDOWN) {
      this.presT += dt;
      const introLen = this.view.intro ? INTRO : 0;
      const cdLen = this.view.countdown ? COUNTDOWN : 0;
      const prevStep = this._cdStep;
      if (this.presT >= introLen && this.view.countdown) {
        const step = Math.min(3, Math.floor((this.presT - introLen) / COUNT_STEP));
        if (step !== prevStep) { this._cdStep = step; this.bus.emit('race:countdown', { step, label: ['3', '2', '1', 'GO!'][step] }); }
      } else this._cdStep = -1;
      // The race starts the moment "GO!" appears.
      const goAt = introLen + (this.view.countdown ? cdLen - COUNT_STEP : 0);
      if (this.presT >= goAt) {
        this.goT = 0;
        this.setState(GameState.RUNNING);
        this.bus.emit('race:go', {});
      }
    } else if (this.state === GameState.RUNNING) {
      this.goT += dt;
      let scale = 1;
      if (this.slowmoLeft > 0) { scale = SLOWMO.factor; this.slowmoLeft -= dt; }
      this.acc += dt * scale;
      let steps = 0;
      while (this.acc >= DT && steps < this.maxStepsPerFrame) {
        this.sim.step();
        this.acc -= DT;
        steps++;
        if (this.sim.events.length) this.dispatch(this.sim.events);
        if (this.sim.ended) break;
      }
      if (steps >= this.maxStepsPerFrame) this.acc = 0; // never spiral
      if (this.sim.ended) { this.cardT = 0; this.setState(GameState.FINISHED); }
    } else if (this.state === GameState.FINISHED) {
      this.cardT += dt;
      if (this.cardT >= CARD && !this.completeSent) {
        this.completeSent = true;
        this.bus.emit('presentation:complete', { seed: this.seed, result: this.sim.result() });
      }
    }

    const pdt = this.state === GameState.RUNNING && this.slowmoLeft > 0 ? dt * SLOWMO.factor : dt;
    this.particles.update(pdt);
    for (const c of this.callouts) c.age += dt;
    this.callouts = this.callouts.filter((c) => c.age < c.dur);
    if (this.sim) this.camera.update(this.sim, this.view.camera, dt);
  }

  dispatch(events) {
    for (const e of events) {
      this.react(e);
      const name = EVENT_MAP[e.type];
      if (name) this.bus.emit(name, e);
    }
  }

  callout(text, color, dur = 0.9) {
    if (!this.view.textOverlays) return;
    this.callouts.push({ text, color, age: 0, dur });
    if (this.callouts.length > 2) this.callouts.shift();
  }

  // Visual reactions to gameplay events (never feed back into the simulation).
  react(e) {
    const P = this.particles, cam = this.camera, shake = this.view.shake;
    const def = e.actor ? contestantById(e.actor) : null;
    switch (e.type) {
      case 'barrierBreak': {
        const c = contestantById(e.color);
        P.burst(e.x, e.y, c.color, 14, 110, 0.55, 3.2);
        P.burst(e.x, e.y, c.light, 6, 70, 0.4, 2.4);
        P.ring(e.x, e.y, c.color, 16);
        if (shake) cam.shake(2.5);
        break;
      }
      case 'barrierDamage':
        P.burst(e.x, e.y, '#8f949b', 5, 70, 0.35, 2.2);
        if (shake) cam.shake(1.2);
        break;
      case 'finalBreak':
        P.burst(e.x, e.y, '#a7abb1', 22, 140, 0.7, 3.6);
        P.burst(e.x, e.y, '#6f747b', 10, 90, 0.6, 2.6);
        P.ring(e.x, e.y, '#ffffff', 22);
        if (shake) cam.shake(5);
        this.callout(e.role === 'final' ? 'FINAL WALL CRACKED' : 'BLOCK DOWN', '#ffffff', 0.7);
        break;
      case 'weaponPickup':
        P.ring(e.x, e.y, '#ffffff', 18, 0.45);
        P.burst(e.x, e.y, '#e8edf3', 10, 90, 0.5, 2.4);
        this.callout(`${def.name} GOT THE BLADE`, def.color, 0.8);
        break;
      case 'kill': {
        const victim = contestantById(e.target);
        this.callout(`${def.name} TOOK OUT ${victim.name}`, def.color, 0.9);
        break;
      }
      case 'eliminated': {
        P.burst(e.x, e.y, def.color, 20, 130, 0.7, 3.4);
        P.ring(e.x, e.y, def.color, 20, 0.4);
        if (e.cause === 'danger') {
          P.burst(e.x, e.y, '#8b45d6', 8, 80, 0.5, 2.6);
          this.callout(`${def.name} IS OUT`, def.color, 0.8);
        }
        if (shake) cam.shake(4);
        break;
      }
      case 'weaponBreak':
        P.burst(e.x, e.y, '#e8edf3', 10, 100, 0.5, 2.2);
        this.callout('THE BLADE SHATTERED', '#e8edf3', 0.8);
        break;
      case 'nearMiss':
        P.ring(e.x, e.y, '#b986ff', 12, 0.3);
        break;
      case 'finish':
        if (e.place === 1) {
          this.slowmoLeft = SLOWMO.seconds;
          P.burst(e.x, e.y, def.color, 30, 170, 0.9, 3.8);
          P.burst(e.x, e.y, '#ffffff', 14, 120, 0.7, 2.6);
          P.ring(e.x, e.y, '#ffffff', 26, 0.5);
          if (shake) cam.shake(3);
        } else {
          P.burst(e.x, e.y, def.color, 12, 110, 0.6, 3);
        }
        break;
      default:
    }
  }

  // ---------- rendering ----------
  presentation() {
    const pres = { intro: null, countdown: null, callouts: this.callouts, card: null };
    if (this.state === GameState.COUNTDOWN) {
      const introLen = this.view.intro ? INTRO : 0;
      if (this.presT < introLen) pres.intro = this.presT / INTRO;
      else if (this.view.countdown) {
        const t = this.presT - introLen;
        const step = Math.min(3, Math.floor(t / COUNT_STEP));
        pres.countdown = { label: ['3', '2', '1', 'GO!'][step], k: (t - step * COUNT_STEP) / COUNT_STEP };
      }
    } else if (this.state === GameState.RUNNING && this.view.countdown && this.goT < 0.45) {
      pres.countdown = { label: 'GO!', k: (this.goT + COUNT_STEP * 0) / 0.45 };
    }
    if (this.state === GameState.FINISHED) {
      const r = this.sim;
      const w = r.winner ? r.contestants.find((c) => c.id === r.winner) : null;
      const stats = [];
      if (w) stats.push(`TIME ${w.finishTime.toFixed(1)}s   ·   KILLS ${w.kills}`);
      else stats.push(`SURVIVED ${r.time.toFixed(1)}s`);
      stats.push(`SEED ${this.seed}`);
      pres.card = { t: this.cardT, winner: r.winner, stats: this.view.textOverlays ? stats : null };
    }
    return pres;
  }

  debugInfo() {
    if (!this.sim) return null;
    const s = this.sim;
    return {
      fps: this.fps,
      state: this.sessionState,
      tick: s.tick,
      time: s.time.toFixed(2) + 's',
      seed: this.seed,
      attempts: this.gen ? this.gen.attempts : '-',
      score: this.gen && this.gen.score ? this.gen.score.score : '-',
      danger: (s.danger.progress * 100).toFixed(1) + '%  ' + s.danger.rate.toFixed(0) + 'px/s',
      leader: s.leader || '-',
      events: s.log.length,
      style: this.level.style,
    };
  }

  render() {
    this.renderer.draw({
      sim: this.sim,
      alpha: this.state === GameState.RUNNING && !this.paused ? Math.min(1, this.acc / DT) : 1,
      camera: this.camera,
      view: this.view,
      particles: this.particles,
      pres: this.presentation(),
      pulse: this.pulse,
      clock: this.clock,
      updateTrails: !this.paused,
      debug: this.view.debug ? this.debugInfo() : null,
    });
  }

  // Render an arbitrary moment of this race into a separate 1080x1920 canvas.
  renderMoment(canvas, moment, overlayText) {
    const r = new Renderer(canvas);
    r.setLevel(this.level);
    let sim;
    if (moment === 'current' && this.sim) sim = this.sim;
    else {
      sim = new Simulation(this.level);
      const endTick = this.gen && this.gen.result ? this.gen.result.endTick : null;
      const total = endTick || new Simulation(this.level).runToEnd(90).endTick;
      const target = moment === 'start' ? 0 : moment === 'middle' ? Math.round(total * 0.5) : Math.max(0, total - Math.round(0.35 / DT));
      while (sim.tick < target && !sim.ended) sim.step();
    }
    const cam = new Camera();
    cam.setWorld(this.level.width, this.level.height, courseBounds(this.level));
    cam.update(sim, this.view.camera, 0, true);
    r.draw({
      sim, alpha: 1, camera: cam, view: { ...this.view, safeArea: false, debug: false, trails: false },
      particles: null, pres: overlayText ? { coverText: overlayText } : null, pulse: 0, clock: 0,
    });
    return canvas;
  }
}
