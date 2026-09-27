// Records the simulation canvas + Web Audio output with MediaRecorder.
// Only the canvas is captured, so creator UI, cursor and browser chrome never
// appear in the video.

import { fixWebmDuration } from './WebmDuration.js';

export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
];

export function recordingSupport(env = globalThis) {
  const canvasCapture = !!(env.HTMLCanvasElement && env.HTMLCanvasElement.prototype && env.HTMLCanvasElement.prototype.captureStream);
  const mediaRecorder = typeof env.MediaRecorder !== 'undefined';
  const audio = !!(env.AudioContext || env.webkitAudioContext);
  const mimes = [];
  if (mediaRecorder && typeof env.MediaRecorder.isTypeSupported === 'function') {
    for (const m of MIME_CANDIDATES) {
      try { if (env.MediaRecorder.isTypeSupported(m)) mimes.push(m); } catch { /* ignore */ }
    }
  }
  const ok = canvasCapture && mediaRecorder && mimes.length > 0;
  let reason = '';
  if (!canvasCapture) reason = 'This browser cannot capture a canvas as video (canvas.captureStream missing).';
  else if (!mediaRecorder) reason = 'MediaRecorder is not available in this browser.';
  else if (!mimes.length) reason = 'MediaRecorder supports none of the WebM/MP4 formats this app can export.';
  return { ok, canvasCapture, mediaRecorder, audio, mimes, reason };
}

export function containerOf(mime) { return mime.startsWith('video/mp4') ? 'mp4' : 'webm'; }

export class Recorder {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.audio = audioEngine;
    this.rec = null;
    this.chunks = [];
    this.mime = null;
    this.startedAt = 0;
  }

  get active() { return !!this.rec && this.rec.state === 'recording'; }

  start({ fps = 60, mime = null, videoBitsPerSecond = 12_000_000 } = {}) {
    const support = recordingSupport();
    if (!support.ok) throw new Error(support.reason);
    const chosen = mime && support.mimes.includes(mime) ? mime : support.mimes[0];
    const video = this.canvas.captureStream(fps);
    const tracks = [...video.getVideoTracks()];
    let hasAudio = false;
    if (this.audio && this.audio.stream) {
      for (const t of this.audio.stream.getAudioTracks()) { tracks.push(t); hasAudio = true; }
    }
    const stream = new MediaStream(tracks);
    this.chunks = [];
    this.mime = chosen;
    this.hasAudio = hasAudio;
    this.rec = new MediaRecorder(stream, { mimeType: chosen, videoBitsPerSecond, audioBitsPerSecond: 160_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.videoTrack = video.getVideoTracks()[0];
    this.rec.start(250);
    this.startedAt = performance.now();
    return { mime: chosen, hasAudio };
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.rec) { reject(new Error('Not recording')); return; }
      const rec = this.rec;
      rec.onstop = async () => {
        let blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        const duration = (performance.now() - this.startedAt) / 1000;
        if (this.videoTrack) this.videoTrack.stop();
        this.rec = null;
        const container = containerOf(this.mime);
        if (container === 'webm') blob = await fixWebmDuration(blob, duration * 1000);
        resolve({ blob, mime: this.mime, duration, hasAudio: this.hasAudio, container });
      };
      rec.onerror = (e) => reject(e.error || new Error('Recording failed'));
      if (rec.state !== 'inactive') rec.stop();
    });
  }
}
