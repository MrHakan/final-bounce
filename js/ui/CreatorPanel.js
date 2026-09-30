// Creator controls (DOM only). Nothing here is ever drawn into the canvas.
import { PRESETS, RACE_DEFAULTS, resolveRaceConfig } from '../config/presets.js';
import { randomSeedString, normalizeSeed } from '../core/RNG.js';
import { GameState } from '../core/Game.js';
import { shareUrl, buildQuery } from '../core/Share.js';
import { findInterestingRace } from '../generation/RaceFinder.js';
import { recordingSupport, containerOf } from '../recording/Recorder.js';
import { downloadBlob, canvasToPng, convertToMp4 } from '../recording/VideoExporter.js';
import { exportVideo, probeFormats, webCodecsSupported } from '../recording/FrameExporter.js';
import { runSelfTests } from '../dev/SelfTests.js';
import { testSeeds } from '../dev/DevTools.js';

const $ = (id) => document.getElementById(id);
const CFG_FIELDS = {
  difficulty: ['cfgDifficulty', 'select'],
  raceMode: ['cfgRaceMode', 'select'],
  complexity: ['cfgComplexity', 'select'],
  barrierDensity: ['cfgBarrierDensity', 'select'],
  mapLength: ['cfgMapLength', 'select'],
  finalHp: ['cfgFinalHp', 'number'],
  dangerSpeed: ['cfgDangerSpeed', 'range'],
  contestantSpeed: ['cfgContestantSpeed', 'range'],
  coursePull: ['cfgCoursePull', 'range'],
  weaponKills: ['cfgWeaponKills', 'number'],
  weaponEnabled: ['cfgWeaponEnabled', 'check'],
  validateRace: ['cfgValidateRace', 'check'],
};

export class CreatorPanel {
  constructor({ game, bus, audio, recorder }) {
    this.game = game; this.bus = bus; this.audio = audio; this.recorder = recorder;
    this.abort = null;
    this.lastVideo = null;
    this.stopWaiter = null;
    this.busy = false;
  }

  init(presetId) {
    const sel = $('presetSelect');
    for (const [id, p] of Object.entries(PRESETS)) sel.add(new Option(p.label, id));
    sel.add(new Option('Custom', 'custom'));
    sel.value = presetId;

    this.bindTransport();
    this.bindSeed();
    this.bindConfig();
    this.bindView();
    this.bindAudio();
    this.bindRecording();
    this.bindExport();
    this.bindCover();
    this.bindDev();
    this.bindKeys();

    this.bus.on('state:change', () => this.syncState());
    this.bus.on('level:generated', ({ gen }) => this.onGenerated(gen));
    this.bus.on('presentation:complete', () => { if (this.stopWaiter) this.stopWaiter('complete'); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.recorder.active) this.toast('Keep this tab visible while recording — hidden tabs stop drawing.');
    });
    // First user gesture unlocks audio.
    const unlock = () => { this.audio.ensure(); this.updateAudioMeta(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- transport ----------
  bindTransport() {
    $('btnPlay').onclick = () => { this.audio.ensure(); this.playPause(); };
    $('btnRestart').onclick = () => { this.audio.ensure(); this.game.restart(); };
    $('btnReplay').onclick = () => { this.audio.ensure(); this.game.replay(); };
    $('btnNew').onclick = () => this.newSeed();
    for (const b of document.querySelectorAll('#speedGroup button')) {
      b.onclick = () => {
        this.game.view.speed = Number(b.dataset.speed);
        for (const o of document.querySelectorAll('#speedGroup button')) o.classList.toggle('on', o === b);
      };
    }
  }

  playPause() {
    const g = this.game;
    if (g.paused) g.play();
    else if (g.state === GameState.RUNNING || g.state === GameState.COUNTDOWN) g.pause();
    else if (g.state === GameState.FINISHED) g.replay();
    else g.play();
    this.syncState();
  }

  syncState() {
    const g = this.game;
    const s = g.sessionState;
    const badge = $('stateBadge');
    badge.textContent = g.paused ? 'PAUSED' : s;
    badge.className = 'badge' + (s === 'RENDERING' ? ' rendering' : s === 'RECORDING' ? ' recording' : s === 'RUNNING' || s === 'REPLAY' || s === 'COUNTDOWN' ? ' running' : s === 'FINISHED' ? ' finished' : '');
    const playing = (g.state === GameState.RUNNING || g.state === GameState.COUNTDOWN) && !g.paused;
    $('btnPlay').textContent = playing ? 'Pause' : g.state === GameState.FINISHED ? 'Replay' : 'Play';
    const rec = this.recorder.active;
    for (const id of ['btnLoadSeed', 'btnRandomSeed', 'btnRegenerate', 'btnInteresting', 'btnApply', 'btnNew', 'btnRestart', 'btnReplay', 'btnPlay', 'btnRecord', 'btnRender', 'btnAutoRecord', 'presetSelect']) {
      let off = rec || this.busy;
      if (id === 'btnRecord') off = off || !!this._recDisabled;                                  // live capture unsupported
      else if (id === 'btnRender') off = off || !this.canExport;                                 // WebCodecs unsupported
      else if (id === 'btnAutoRecord') off = off || (!this.canExport && !!this._recDisabled);    // neither path works
      $(id).disabled = off;
    }
    $('btnStopRec').disabled = !rec;
    $('btnCancelRender').disabled = !this.exporting;
    $('recDot').hidden = !rec;
    document.body.classList.toggle('is-recording', rec);
  }

  // ---------- seed & generation ----------
  bindSeed() {
    const input = $('seedInput');
    $('btnLoadSeed').onclick = () => this.loadSeed(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.loadSeed(input.value); } });
    $('btnRandomSeed').onclick = () => this.newSeed();
    $('btnRegenerate').onclick = () => this.generate(this.game.seed);
    $('btnCopySeed').onclick = () => this.copy(this.game.seed, 'Seed copied');
    $('btnCopyLink').onclick = () => this.copy(shareUrl(this.game.seed, this.presetKey(), this.game.raceConfig), 'Share link copied');
    $('presetSelect').onchange = (e) => {
      if (e.target.value === 'custom') return;
      this.writeConfig(resolveRaceConfig(e.target.value));
      this.generate(this.game.seed);
    };
    $('minScore').oninput = (e) => { $('minScoreOut').textContent = e.target.value; };
    $('maxCand').oninput = (e) => { $('maxCandOut').textContent = e.target.value; };
    $('btnInteresting').onclick = () => this.interesting();
    $('busyCancel').onclick = () => { if (this.abort) this.abort.abort(); };
  }

  presetKey() { const v = $('presetSelect').value; return v === 'custom' ? 'medium' : v; }

  async copy(text, msg) {
    try { await navigator.clipboard.writeText(text); this.toast(msg); }
    catch { window.prompt('Copy:', text); }
  }

  loadSeed(raw) {
    const s = normalizeSeed(raw);
    if (!s) { this.toast('Enter a seed (letters and digits)'); return; }
    this.generate(s);
  }

  newSeed() { this.generate(randomSeedString()); }

  generate(seed, cfg = this.readConfig()) {
    try {
      this.game.generate(seed, cfg, this.presetKey());
    } catch (err) {
      console.error(err);
      this.toast('Generation failed: ' + err.message);
    }
  }

  onGenerated(gen) {
    const g = this.game;
    $('seedInput').value = g.seed;
    this.writeConfig(g.raceConfig);
    const parts = [
      `Seed <b class="mono">${g.seed}</b>`,
      `${g.level.route.length} halls`,
      `${gen.attempts} attempt${gen.attempts > 1 ? 's' : ''}`,
    ];
    if (gen.ms !== undefined) parts.push(`${gen.ms} ms`);
    if (gen.score) parts.push(`score <b>${gen.score.score}</b>`);
    $('genMeta').innerHTML = parts.join(' · ') + (gen.accepted === false ? '<br><span class="warn">No attempt passed validation — showing the best candidate.</span>' : '');
    try { history.replaceState(null, '', '?' + buildQuery(g.seed, this.presetKey(), g.raceConfig)); } catch { /* file:// etc. */ }
    this.syncState();
  }

  showBusy(title, text = '', frac = 0, cancellable = true) {
    $('busy').hidden = false;
    $('busyTitle').textContent = title;
    $('busyText').textContent = text;
    $('busyBar').style.width = `${Math.round(frac * 100)}%`;
    $('busyCancel').hidden = !cancellable;
  }

  hideBusy() { $('busy').hidden = true; }

  async interesting() {
    if (this.busy) return null;
    this.busy = true; this.syncState();
    this.abort = new AbortController();
    const cfg = this.readConfig();
    const candidates = Number($('maxCand').value), threshold = Number($('minScore').value);
    this.showBusy('Testing races…', `0 / ${candidates}`);
    let out = null;
    try {
      const { best } = await findInterestingRace(cfg, {
        candidates, threshold, signal: this.abort.signal,
        onProgress: ({ i, best: b }) => {
          this.showBusy('Testing races…', `${i} / ${candidates}   best ${b ? b.score : '—'}${b ? ' (' + b.seed + ')' : ''}`, i / candidates);
        },
      });
      if (best) {
        best.gen.ms = undefined;
        this.game.presetId = this.presetKey();
        this.game.loadGenerated(best.gen);
        $('findMeta').innerHTML = `Selected seed <b class="mono">${best.seed}</b> · score <b>${best.score}</b>${best.score < threshold ? ' (best found, below target)' : ''}`;
        out = best;
      } else $('findMeta').textContent = 'No candidate found.';
    } catch (err) {
      console.error(err);
      this.toast('Search failed: ' + err.message);
    } finally {
      this.hideBusy();
      this.busy = false; this.abort = null;
      this.syncState();
    }
    return out;
  }

  // ---------- race config ----------
  bindConfig() {
    for (const [, [id, kind]] of Object.entries(CFG_FIELDS)) {
      const el = $(id);
      const out = $(id + 'Out');
      el.addEventListener('input', () => {
        if (out) out.textContent = Number(el.value).toFixed(2) + '×';
        $('presetSelect').value = 'custom';
      });
      if (kind === 'check' || kind === 'select' || kind === 'number') el.addEventListener('change', () => { $('presetSelect').value = 'custom'; });
    }
    $('btnApply').onclick = () => this.generate(this.game.seed);
  }

  readConfig() {
    const cfg = { ...RACE_DEFAULTS, ...(this.game.raceConfig || {}) };
    for (const [key, [id, kind]] of Object.entries(CFG_FIELDS)) {
      const el = $(id);
      if (kind === 'check') cfg[key] = el.checked;
      else if (kind === 'range' || kind === 'number') cfg[key] = Number(el.value);
      else cfg[key] = el.value;
    }
    const p = $('presetSelect').value;
    if (p !== 'custom') {
      const base = resolveRaceConfig(p);
      cfg.minDuration = base.minDuration; cfg.maxDuration = base.maxDuration;
    }
    return cfg;
  }

  writeConfig(cfg) {
    for (const [key, [id, kind]] of Object.entries(CFG_FIELDS)) {
      const el = $(id);
      if (kind === 'check') el.checked = !!cfg[key];
      else el.value = String(cfg[key]);
      const out = $(id + 'Out');
      if (out) out.textContent = Number(cfg[key]).toFixed(2) + '×';
    }
  }

  // ---------- view ----------
  bindView() {
    const v = this.game.view;
    $('viewCamera').value = v.camera;
    $('viewCamera').onchange = (e) => { v.camera = e.target.value; };
    for (const el of document.querySelectorAll('[data-view]')) {
      el.checked = !!v[el.dataset.view];
      el.onchange = () => {
        v[el.dataset.view] = el.checked;
        if (el.dataset.view === 'particles') this.game.particles.enabled = el.checked;
        if (el.dataset.view === 'closeCam') this.syncCloseCam();
      };
    }
    $('viewCta').value = v.cta || '';
    $('viewCta').oninput = (e) => { v.cta = e.target.value.toUpperCase(); };
    $('btnCloseCam').onclick = () => this.setCloseCam(!v.closeCam);
    this.syncCloseCam();
  }

  setCloseCam(on) {
    this.game.view.closeCam = on;
    this.syncCloseCam();
    this.toast(on ? 'Close camera on' : 'Close camera off — whole course');
  }

  syncCloseCam() {
    const on = !!this.game.view.closeCam;
    $('btnCloseCam').setAttribute('aria-pressed', String(on));
    const box = document.querySelector('[data-view="closeCam"]');
    if (box) box.checked = on;
    if ($('viewCamera').value !== 'auto') $('btnCloseCam').title = 'Close camera applies to the Auto camera';
  }

  // ---------- audio ----------
  bindAudio() {
    const a = this.audio;
    $('volMaster').oninput = (e) => { a.setVolume('master', Number(e.target.value)); $('volMasterOut').textContent = Math.round(e.target.value * 100); };
    $('volFx').oninput = (e) => { a.setVolume('fx', Number(e.target.value)); $('volFxOut').textContent = Math.round(e.target.value * 100); };
    $('volMusic').oninput = (e) => { a.setVolume('music', Number(e.target.value)); $('volMusicOut').textContent = Math.round(e.target.value * 100); if (Number(e.target.value) === 0) a.player.stop(0.2); };
    $('mute').onchange = (e) => a.setMuted(e.target.checked);
    $('btnTestSound').onclick = () => {
      a.ensure();
      ['count', 'bounce', 'colorBreak', 'pickup', 'greyBreak', 'finish'].forEach((s, i) => setTimeout(() => a.play(s, { pitch: 0 }, 'test' + i), i * 260));
      this.updateAudioMeta();
    };
    if (!a.supported) $('audioMeta').textContent = 'Web Audio is not available in this browser — races run silently.';
  }

  updateAudioMeta() {
    if (!this.audio.supported) return;
    setTimeout(() => {
      $('audioMeta').textContent = this.audio.running ? 'Audio on. Sounds are synthesised live (no files).' : 'Audio is suspended — click anywhere to enable it.';
    }, 80);
  }

  // ---------- recording ----------
  bindRecording() {
    const sup = recordingSupport();
    this.support = sup;
    const fmt = $('recFormat');
    for (const m of sup.mimes) {
      const label = `${containerOf(m).toUpperCase()} — ${m.replace(/^video\/\w+;?/, '').replace('codecs=', '') || 'default codecs'}`;
      fmt.add(new Option(label, m));
    }
    if (!sup.ok) {
      this._liveReason = sup.reason;
      for (const id of ['btnRecord', 'recFormat']) $(id).disabled = true;
      this._recDisabled = true;
    } else {
      $('recSupport').innerHTML = `Records the canvas only (1080×1920) with sound.${sup.audio ? '' : ' <span class="warn">No Web Audio: video will be silent.</span>'}`;
    }
    $('btnRecord').onclick = () => this.recordRace();
    $('btnStopRec').onclick = () => { if (this.stopWaiter) this.stopWaiter('manual'); };
    $('btnAutoRecord').onclick = () => this.autoRecord();
    $('btnDownload').onclick = () => { if (this.lastVideo) downloadBlob(this.lastVideo.blob, this.lastVideo.filename); };
    $('btnMp4').onclick = () => this.toMp4();
  }

  async recordRace() {
    if (!this.support.ok || this.recorder.active) return;
    this.audio.ensure();
    if (this.audio.ctx && this.audio.ctx.state !== 'running') { try { await this.audio.ctx.resume(); } catch { /* ignore */ } }
    const g = this.game;
    g.resetRace();
    try {
      this.recorder.start({ fps: Number($('recFps').value), mime: $('recFormat').value, videoBitsPerSecond: Number($('recBitrate').value) });
    } catch (err) {
      this.toast('Could not start recording: ' + err.message);
      return;
    }
    g.recording = true;
    this.syncState();
    // Tiny pre-roll so the first encoded frame is the fully drawn course.
    await new Promise((r) => setTimeout(r, 120));
    g.play();
    this.syncState();
    const why = await new Promise((resolve) => { this.stopWaiter = resolve; });
    this.stopWaiter = null;
    if (why === 'complete') await new Promise((r) => setTimeout(r, 200));
    let out;
    try { out = await this.recorder.stop(); } catch (err) { this.toast('Recording failed: ' + err.message); }
    g.recording = false;
    this.syncState();
    if (!out) return;
    const winner = g.sim && g.sim.winner ? g.sim.winner : 'none';
    out.filename = `final-bounce-${g.seed}-${winner}.${out.container}`;
    this.lastVideo = out;
    $('exportBox').hidden = false;
    $('exportMeta').innerHTML = `<b>${out.filename}</b><br>${(out.blob.size / 1e6).toFixed(1)} MB · ${out.duration.toFixed(1)} s · ${out.mime}${out.hasAudio ? ' · with audio' : ' · <span class="warn">no audio track</span>'}${why === 'manual' ? ' · stopped manually' : ''}`;
    $('btnMp4').hidden = out.container === 'mp4';
    $('mp4Meta').textContent = out.container === 'mp4' ? '' : 'WebM is the default export. MP4 conversion runs in your browser with ffmpeg.wasm (large download, slow on phones).';
    if ($('recAutoDownload').checked) downloadBlob(out.blob, out.filename);
    else this.toast('Recording ready — download it below');
  }

  async toMp4() {
    const v = this.lastVideo;
    if (!v || v.container === 'mp4') return;
    const bar = $('mp4Bar');
    bar.hidden = false; $('btnMp4').disabled = true;
    const setP = (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; };
    setP(0);
    try {
      const mp4 = await convertToMp4(v.blob, {
        fps: Number($('recFps').value),
        onStatus: (s) => { $('mp4Meta').textContent = s; },
        onProgress: (p) => { setP(p); $('mp4Meta').textContent = `Converting to MP4… ${Math.round(p * 100)}%`; },
      });
      const name = v.filename.replace(/\.webm$/, '.mp4');
      $('mp4Meta').textContent = `MP4 ready (${(mp4.size / 1e6).toFixed(1)} MB).`;
      downloadBlob(mp4, name);
    } catch (err) {
      console.error(err);
      $('mp4Meta').textContent = `MP4 conversion failed (${err.message || err}). The WebM download still works; you can convert it on desktop with: ffmpeg -i ${v.filename} -c:v libx264 -pix_fmt yuv420p -c:a aac out.mp4`;
    } finally {
      $('btnMp4').disabled = false;
      setTimeout(() => { bar.hidden = true; }, 800);
    }
  }

  // ---------- frame-perfect export ----------
  async bindExport() {
    this.formats = [];
    this.canExport = false;
    const sel = $('expFormat');
    if (!webCodecsSupported()) {
      $('expNote').textContent = 'Frame-perfect rendering needs WebCodecs (Chrome or Edge 94+, Firefox 130+, Safari 16.4+). Use Live capture below.';
      $('btnRender').disabled = true; $('btnAutoRecord').disabled = !this.support.ok;
      $('liveBox').open = true;
      this.syncState();
      return;
    }
    this.formats = await probeFormats({ fps: Number($('recFps').value), bitrate: Number($('recBitrate').value) });
    if (!this.formats.length) {
      $('expNote').textContent = 'This browser exposes WebCodecs but cannot encode any format this app writes. Use Live capture below.';
      $('btnRender').disabled = true;
      $('liveBox').open = true;
      return;
    }
    this.canExport = true;
    for (const f of this.formats) sel.add(new Option(f.label, f.id));
    const note = () => { const f = this.formats.find((x) => x.id === sel.value); $('expNote').textContent = f ? f.note + '.' : ''; };
    sel.onchange = note; note();
    const h264 = this.formats.some((f) => f.id === 'mp4-h264');
    $('recSupport').innerHTML = `Renders every frame at an exact 1/fps step (1080×1920) and the soundtrack offline, so the video is smooth and in sync whatever the machine load.${h264 ? ' This browser can write <b>MP4</b> directly.' : ' This browser cannot encode H.264, so the file is <b>WebM</b>; MP4 conversion is optional.'}`;
    $('recSupport').className = 'meta';
    $('btnRender').onclick = () => this.renderVideo();
    $('btnCancelRender').onclick = () => { if (this.abort) this.abort.abort(); };
    $('btnCaption').onclick = () => this.copy(this.caption(), 'Caption copied');
    this.syncState();
  }

  caption() {
    const g = this.game;
    const r = g.gen && g.gen.result;
    const name = r && r.winner ? r.winner.toUpperCase() : null;
    const line1 = name ? `${name} wins seed ${g.seed} in ${r.winTime.toFixed(1)}s.` : `Nobody escapes seed ${g.seed}.`;
    return `${line1}\nEach color breaks only its own bricks. Which color would you pick for the next one?\n#physics #simulation #satisfying #survival #marblerace`;
  }

  fmtEta(sec) { return sec < 90 ? `${Math.ceil(sec)} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`; }

  async renderVideo() {
    if (this.busy || !this.canExport) return null;
    const format = this.formats.find((f) => f.id === $('expFormat').value) || this.formats[0];
    const g = this.game;
    this.audio.ensure();
    this.busy = true; this.exporting = true;
    this.abort = new AbortController();
    this.syncState();
    $('renderProg').hidden = false; $('renderChip').hidden = false;
    const stageText = { video: 'Rendering frames', audio: 'Rendering soundtrack', mux: 'Writing file', done: 'Done' };
    let out = null;
    try {
      out = await exportVideo(g, this.audio, {
        format, fps: Number($('recFps').value), bitrate: Number($('recBitrate').value), signal: this.abort.signal,
        onProgress: (p) => {
          const pct = Math.round(p.fraction * (p.stage === 'video' ? 92 : p.stage === 'audio' ? 95 : 100));
          $('renderBar').style.width = `${pct}%`;
          $('renderChip').textContent = `RENDER ${pct}%`;
          $('renderMeta').textContent = p.stage === 'video'
            ? `${stageText.video}: ${p.seconds.toFixed(1)} s · ${p.speed.toFixed(1)}× real time · about ${this.fmtEta(p.etaSeconds)} left`
            : `${stageText[p.stage]}…`;
        },
      });
      out.filename = `final-bounce-${g.seed}-${g.gen.result && g.gen.result.winner ? g.gen.result.winner : 'none'}.${out.container}`;
      this.lastVideo = out;
      $('exportBox').hidden = false;
      $('exportMeta').innerHTML = `<b>${out.filename}</b><br>${(out.size / 1e6).toFixed(1)} MB · ${out.duration.toFixed(1)} s · ${out.fps} fps · ${out.label} · frame-perfect · rendered in ${out.renderSeconds.toFixed(0)} s`;
      $('btnMp4').hidden = out.container === 'mp4';
      $('mp4Meta').textContent = out.container === 'mp4' ? '' : 'Some sites only accept MP4. Conversion runs in your browser with ffmpeg.wasm (large download).';
      if ($('recAutoDownload').checked || this.batchRunning) downloadBlob(out.blob, out.filename);
      else this.toast('Video ready — download it below');
    } catch (err) {
      if (err && err.name === 'AbortError') this.toast('Render cancelled');
      else { console.error(err); this.toast('Render failed: ' + (err.message || err)); }
    } finally {
      this.busy = false; this.exporting = false; this.abort = null;
      $('renderProg').hidden = true; $('renderChip').hidden = true;
      this.syncState();
      g.render();
    }
    return out;
  }

  // Find an interesting race, then render it. With a batch count > 1, repeat.
  async autoRecord() {
    const n = Math.max(1, Math.min(12, Number($('batchCount').value) || 1));
    if (this.canExport) {
      this.batchRunning = n > 1;
      try {
        for (let i = 0; i < n; i++) {
          if (n > 1) this.toast(`Video ${i + 1} of ${n}`);
          const best = await this.interesting();
          if (!best) break;
          const out = await this.renderVideo();
          if (!out) break;
        }
      } finally { this.batchRunning = false; }
      return;
    }
    if (!this.support.ok) return;
    this.audio.ensure();
    const best = await this.interesting();
    if (best) await this.recordRace();
  }

  // ---------- cover ----------
  bindCover() {
    $('btnCover').onclick = async () => {
      const g = this.game;
      if (!g.level) return;
      const moment = $('coverMoment').value;
      const text = $('coverOverlay').checked ? $('coverText').value.trim().toUpperCase() : '';
      const c = document.createElement('canvas');
      g.renderMoment(c, moment, text);
      try {
        const png = await canvasToPng(c);
        downloadBlob(png, `final-bounce-${g.seed}-cover-${moment}.png`);
      } catch (err) { this.toast(err.message); }
    };
  }

  // ---------- developer ----------
  bindDev() {
    const out = $('devOut');
    $('btnSelfTests').onclick = () => {
      out.textContent = 'Running self-tests…';
      setTimeout(() => {
        const res = runSelfTests();
        const ok = res.filter((r) => r.pass).length;
        out.textContent = res.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms} ms)${r.pass ? '' : '\n      ' + r.detail}`).join('\n') + `\n\n${ok}/${res.length} passed`;
      }, 30);
    };
    for (const b of document.querySelectorAll('[data-stress]')) {
      b.onclick = async () => {
        if (this.busy) return;
        const n = Number(b.dataset.stress);
        this.busy = true; this.syncState();
        this.abort = new AbortController();
        this.showBusy(`testSeeds(${n})`, '');
        try {
          const report = await testSeeds(n, this.readConfig(), {
            signal: this.abort.signal,
            onProgress: (i, total) => this.showBusy(`testSeeds(${n})`, `${i} / ${total}`, i / total),
          });
          out.textContent = JSON.stringify(report, null, 2);
        } finally {
          this.hideBusy(); this.busy = false; this.abort = null; this.syncState();
        }
      };
    }
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || this.recorder.active || this.busy) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.audio.ensure(); this.playPause(); }
      else if (k === 'r') this.game.restart();
      else if (k === 'n') this.newSeed();
      else if (k === 'g') this.interesting();
      else if (k === 'c') this.setCloseCam(!this.game.view.closeCam);
      else if (k === 'd') {
        this.game.view.debug = !this.game.view.debug;
        const el = document.querySelector('[data-view="debug"]');
        if (el) el.checked = this.game.view.debug;
      }
    });
  }
}
