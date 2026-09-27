// Downloads, PNG covers, and the optional WebM -> MP4 conversion.
//
// MP4 strategy:
//  1. If the browser's MediaRecorder can write MP4 directly (recent Chromium,
//     Safari), the recorder produces a real MP4 and nothing else is needed.
//  2. Otherwise a WebM can be converted client-side with ffmpeg.wasm
//     (H.264 + AAC). The ~31 MB core is fetched from jsDelivr only when the
//     creator asks for it; the small wrapper is vendored so its worker is
//     same-origin (required for GitHub Pages).

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
let ffmpegPromise = null;

async function loadFFmpeg(onStatus) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const base = new URL('../../vendor/ffmpeg/', import.meta.url);
      const { FFmpeg } = await import(new URL('index.js', base).href);
      const { toBlobURL } = await import(new URL('util/index.js', base).href);
      const ffmpeg = new FFmpeg();
      onStatus && onStatus('Downloading ffmpeg core (~31 MB, cached afterwards)…');
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
    ffmpegPromise.catch(() => { ffmpegPromise = null; });
  }
  return ffmpegPromise;
}

export async function convertToMp4(webmBlob, { onProgress, onStatus, fps = 60 } = {}) {
  const ffmpeg = await loadFFmpeg(onStatus);
  const onProg = ({ progress }) => onProgress && onProgress(Math.max(0, Math.min(1, progress)));
  ffmpeg.on('progress', onProg);
  try {
    onStatus && onStatus('Converting to MP4 (H.264/AAC)…');
    await ffmpeg.writeFile('in.webm', new Uint8Array(await webmBlob.arrayBuffer()));
    const code = await ffmpeg.exec([
      '-i', 'in.webm',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-r', String(fps), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.mp4',
    ]);
    if (code !== 0) throw new Error('ffmpeg exited with code ' + code);
    const data = await ffmpeg.readFile('out.mp4');
    await ffmpeg.deleteFile('in.webm');
    await ffmpeg.deleteFile('out.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', onProg);
  }
}
