// Frame-perfect video export (WebCodecs).
//
// The live recorder captures whatever the browser happens to draw in real time,
// so frame pacing and audio sync depend on how busy the machine is. This
// exporter instead runs the race itself, one exact 1/fps step per video frame:
//
//   game.update(1/fps) -> render to an offscreen 1080x1920 canvas -> VideoEncoder
//
// Sound effects are recorded with the exact frame time they happened at, the
// score follows the per-frame tension curve, and the whole soundtrack is
// rendered offline (OfflineMixer) and encoded with AudioEncoder. Both tracks are
// then muxed in timestamp order:
//
//   MP4  (H.264 + AAC)   what Instagram likes, when the browser can encode it
//   WebM (VP9 + Opus)    everywhere else that has WebCodecs
//
// Same seed + same settings = the same video, frame for frame, at any speed of
// machine. It also runs in a background tab and faster than real time.
import { Renderer } from '../rendering/Renderer.js';
import { bindSoundEvents } from '../audio/SoundMap.js';
import { OfflineMixer } from '../audio/OfflineMixer.js';

export const WIDTH = 1080;
export const HEIGHT = 1920;
const SAMPLE_RATE = 48000;

// Formats in order of preference. `hidden` ones are only used by tests.
const FORMATS = [
  {
    id: 'mp4-h264', container: 'mp4', label: 'MP4 (H.264 + AAC)', note: 'Instagram-ready',
    video: [{ codec: 'avc1.64002a', mux: 'avc' }, { codec: 'avc1.640028', mux: 'avc' }, { codec: 'avc1.4d002a', mux: 'avc' }, { codec: 'avc1.42002a', mux: 'avc' }],
    audio: { codec: 'mp4a.40.2', mux: 'aac' },
  },
  {
    id: 'webm-vp9', container: 'webm', label: 'WebM (VP9 + Opus)', note: 'plays everywhere; convert to MP4 if a site insists',
    video: [{ codec: 'vp09.00.50.08', mux: 'V_VP9' }],
    audio: { codec: 'opus', mux: 'A_OPUS' },
  },
  {
    id: 'webm-vp8', container: 'webm', label: 'WebM (VP8 + Opus)', note: 'older browsers',
    video: [{ codec: 'vp8', mux: 'V_VP8' }],
    audio: { codec: 'opus', mux: 'A_OPUS' },
  },
  {
    id: 'mp4-vp9', container: 'mp4', label: 'MP4 (VP9 + Opus)', note: 'not accepted by every site', hidden: true,
    video: [{ codec: 'vp09.00.50.08', mux: 'vp9' }],
    audio: { codec: 'opus', mux: 'opus' },
  },
];

export function webCodecsSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' &&
    typeof AudioData !== 'undefined' && OfflineMixer.supported;
}

// Which formats can this browser actually encode? (isConfigSupported is authoritative.)
export async function probeFormats({ fps = 60, bitrate = 12e6, includeHidden = false } = {}) {
  if (!webCodecsSupported()) return [];
  const out = [];
  for (const f of FORMATS) {
    if (f.hidden && !includeHidden) continue;
    let video = null;
    for (const v of f.video) {
      try {
        const s = await VideoEncoder.isConfigSupported({ codec: v.codec, width: WIDTH, height: HEIGHT, bitrate, framerate: fps });
        if (s.supported) { video = v; break; }
      } catch { /* try the next profile */ }
    }
    if (!video) continue;
    try {
      const a = await AudioEncoder.isConfigSupported({ codec: f.audio.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 });
      if (!a.supported) continue;
    } catch { continue; }
    out.push({ ...f, videoChoice: video });
  }
  // WebM VP8 is only a fallback for browsers without VP9.
  if (out.some((f) => f.id === 'webm-vp9')) return out.filter((f) => f.id !== 'webm-vp8');
  return out;
}

const yieldToUI = () => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve();
  ch.port2.postMessage(0);
});

function waitDequeue(enc) {
  return new Promise((resolve) => enc.addEventListener('dequeue', resolve, { once: true }));
}

// Predicted length of the video from the headless test run, used for the progress bar.
function predictFrames(game, fps) {
  const r = game.gen && game.gen.result;
  const base = r ? r.duration : 35;
  return Math.round((base + 0.35 + 1.8 + 0.5) * fps);
}

export async function exportVideo(game, audio, opts = {}) {
  const {
    format, fps = 60, bitrate = 12e6, onProgress = () => {}, signal = null, preview = true,
    volumes = audio ? audio.volumes : {}, muted = audio ? audio.muted : false, tailSeconds = 0.35,
  } = opts;
  if (!format) throw new Error('No export format selected');
  if (!game.level) throw new Error('Generate a course first');
  const dt = 1 / fps;
  const fmt = format;
  const vchoice = fmt.videoChoice || fmt.video[0];
  const aborted = () => { if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError'); };

  // ----- setup -----
  const muxerLib = fmt.container === 'mp4'
    ? await import('../../vendor/muxers/mp4-muxer.mjs')
    : await import('../../vendor/muxers/webm-muxer.mjs');
  const target = new muxerLib.ArrayBufferTarget();
  const muxerOpts = {
    target,
    video: { codec: vchoice.mux, width: WIDTH, height: HEIGHT, frameRate: fps },
    audio: { codec: fmt.audio.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
    firstTimestampBehavior: 'offset',
  };
  if (fmt.container === 'mp4') muxerOpts.fastStart = 'in-memory';
  const muxer = new muxerLib.Muxer(muxerOpts);

  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  renderer.setLevel(game.level);
  const previewCtx = preview && game.canvas ? game.canvas.getContext('2d') : null;

  let encError = null;
  const videoChunks = [], audioChunks = [];
  const venc = new VideoEncoder({
    output: (chunk, meta) => videoChunks.push({ chunk, meta, ts: chunk.timestamp }),
    error: (e) => { encError = e; },
  });
  const vcfg = { codec: vchoice.codec, width: WIDTH, height: HEIGHT, bitrate, framerate: fps, latencyMode: 'quality' };
  if (vchoice.codec.startsWith('avc1')) vcfg.avc = { format: 'avc' };
  venc.configure(vcfg);

  // ----- take over the game -----
  const bus = game.bus;
  const wasRecording = game.recording;
  const prevLive = audio ? audio.liveEnabled : true;
  game.exporting = true;
  game.recording = true;
  if (audio) audio.liveEnabled = false;
  const mixer = new OfflineMixer({ volumes, muted, seed: game.seed, sampleRate: SAMPLE_RATE });
  let frameIdx = 0;
  let goTime = null, completeFrame = null;
  const intensities = [];
  const offSounds = bindSoundEvents(bus, (name, params, key) => mixer.addSound(frameIdx * dt, name, params, key));
  const offGo = bus.on('race:go', () => { if (goTime === null) goTime = frameIdx * dt; });
  const offDone = bus.on('presentation:complete', () => { if (completeFrame === null) completeFrame = frameIdx; });

  const predicted = predictFrames(game, fps);
  const t0 = performance.now();
  const report = (stage, extra = {}) => {
    const elapsed = (performance.now() - t0) / 1000;
    const rate = frameIdx / Math.max(0.001, elapsed);
    onProgress({ stage, frame: frameIdx, fps, seconds: frameIdx * dt, fraction: Math.min(1, frameIdx / Math.max(predicted, frameIdx + 1)), etaSeconds: Math.max(0, (Math.max(predicted, frameIdx) - frameIdx) / Math.max(rate, 1)), speed: rate / fps, ...extra });
  };

  try {
    game.resetRace();
    game.play();
    const maxFrames = fps * 150;
    const tailFrames = Math.round(tailSeconds * fps);
    while (frameIdx < maxFrames) {
      aborted();
      if (encError) throw encError;
      game.update(dt);
      intensities.push(game.intensity);
      const args = game.frameArgs();
      renderer.draw({ ...args, view: { ...args.view, safeArea: false, debug: false }, debug: null });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((frameIdx * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: frameIdx % (fps * 2) === 0 });
      frame.close();
      if (previewCtx && frameIdx % 3 === 0) { previewCtx.setTransform(1, 0, 0, 1, 0, 0); previewCtx.drawImage(canvas, 0, 0); }
      frameIdx++;
      if (completeFrame !== null && frameIdx >= completeFrame + tailFrames) break;
      if (venc.encodeQueueSize > 6) await waitDequeue(venc);
      if (frameIdx % 4 === 0) { report('video'); await yieldToUI(); }
    }
    if (completeFrame === null && game.state !== 'FINISHED') throw new Error('The race did not finish within 150 s');
    await venc.flush();
    aborted();
    if (encError) throw encError;

    // ----- audio -----
    const totalSeconds = frameIdx * dt;
    report('audio');
    await yieldToUI();
    const at = (t) => intensities[Math.max(0, Math.min(intensities.length - 1, Math.floor(t * fps)))] ?? 0.2;
    mixer.setMusic(goTime ?? 0, Math.max(goTime ?? 0, totalSeconds - 0.1), at);
    const buffer = await mixer.render(totalSeconds);
    aborted();
    const aenc = new AudioEncoder({
      output: (chunk, meta) => audioChunks.push({ chunk, meta, ts: chunk.timestamp }),
      error: (e) => { encError = e; },
    });
    aenc.configure({ codec: fmt.audio.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 });
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const block = 4800;
    for (let off = 0; off < buffer.length; off += block) {
      const n = Math.min(block, buffer.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SAMPLE_RATE) * 1e6), data });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 12) await waitDequeue(aenc);
    }
    await aenc.flush();
    aenc.close();
    if (encError) throw encError;

    // ----- mux (in timestamp order; video first on ties) -----
    report('mux');
    await yieldToUI();
    videoChunks.sort((a, b) => a.ts - b.ts);
    audioChunks.sort((a, b) => a.ts - b.ts);
    let vi = 0, ai = 0;
    while (vi < videoChunks.length || ai < audioChunks.length) {
      const takeVideo = ai >= audioChunks.length || (vi < videoChunks.length && videoChunks[vi].ts <= audioChunks[ai].ts);
      if (takeVideo) { const c = videoChunks[vi++]; muxer.addVideoChunk(c.chunk, c.meta); }
      else { const c = audioChunks[ai++]; muxer.addAudioChunk(c.chunk, c.meta); }
    }
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: fmt.container === 'mp4' ? 'video/mp4' : 'video/webm' });
    onProgress({ stage: 'done', frame: frameIdx, fps, seconds: totalSeconds, fraction: 1, etaSeconds: 0, speed: frameIdx / fps / Math.max(0.001, (performance.now() - t0) / 1000) });
    return {
      blob, container: fmt.container, mime: blob.type, formatId: fmt.id, label: fmt.label,
      videoCodec: vchoice.codec, audioCodec: fmt.audio.codec, duration: totalSeconds, frames: frameIdx, fps,
      hasAudio: true, size: blob.size, renderSeconds: (performance.now() - t0) / 1000, exact: true,
    };
  } finally {
    offSounds(); offGo(); offDone();
    try { if (venc.state !== 'closed') venc.close(); } catch { /* ignore */ }
    game.exporting = false;
    game.recording = wasRecording;
    if (audio) audio.liveEnabled = prevLive;
    game.resetRace();
  }
}
