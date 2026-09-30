// End-to-end tests in a real browser (Chromium via Playwright).
//
//   npm i -D playwright && npx playwright install chromium
//   node tests/e2e.mjs
//
// or point PLAYWRIGHT_MODULE at an existing install:
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/e2e.mjs
//
// It starts its own static server, so nothing else needs to be running. It covers
// what unit tests cannot: the real WebCodecs export (decoded back and inspected),
// determinism of the export, the automatic encoder fallback, the auto/batch flow and
// the live-capture fallback.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium || pw.default.chromium;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function newPage(query) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => window.race && document.getElementById('expFormat'), null, { timeout: 20000 });
  return { ctx, page, errors };
}

// Decode a produced file in a fresh page and report what a viewer would get.
async function inspect(blobBytes) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/tests/gallery.html?n=0`);
  const info = await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const vid = document.createElement('video'); vid.muted = true;
    vid.src = URL.createObjectURL(new Blob([bytes]));
    await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('video failed to load')); });
    const out = { duration: vid.duration, w: vid.videoWidth, h: vid.videoHeight };
    const ac = new AudioContext();
    const ab = await ac.decodeAudioData(bytes.buffer.slice(0));
    const d = ab.getChannelData(0); let s = 0, peak = 0;
    for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
    out.audio = { seconds: ab.duration, rms: Math.sqrt(s / d.length), peak };
    return out;
  }, Buffer.from(blobBytes).toString('base64'));
  await page.context().close();
  return info;
}

async function renderVia(page, formatId, fps) {
  return page.evaluate(async ({ formatId, fps }) => {
    const formats = await race.probeFormats({ fps, includeHidden: true });
    const format = formats.find((f) => f.id === formatId) || formats[0];
    const v = await race.exportVideo({ format, fps });
    const buf = new Uint8Array(await v.blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { meta: { ...v, blob: undefined }, b64: btoa(bin), gen: race.game.gen.result.duration };
  }, { formatId, fps });
}

try {
  // ---- 1. export, decode and inspect (WebM and the MP4 container) ----
  const exportsByFormat = {};
  for (const fmt of ['webm-vp9', 'mp4-vp9']) {
    const { ctx, page, errors } = await newPage('seed=E2E1&preset=short');
    const r = await renderVia(page, fmt, 30);
    exportsByFormat[fmt] = r;
    const info = await inspect(Buffer.from(r.b64, 'base64'));
    check(`${fmt}: decodes as 1080x1920`, info.w === 1080 && info.h === 1920, `${info.w}x${info.h}`);
    check(`${fmt}: duration equals frames/fps`, Math.abs(info.duration - r.meta.frames / 30) < 0.08, `${info.duration.toFixed(2)}s vs ${(r.meta.frames / 30).toFixed(2)}s`);
    check(`${fmt}: video and audio lengths agree`, Math.abs(info.duration - info.audio.seconds) < 0.1, `${info.duration.toFixed(2)} / ${info.audio.seconds.toFixed(2)}`);
    check(`${fmt}: audio is audible and unclipped`, info.audio.rms > 0.05 && info.audio.peak < 0.95, `rms ${info.audio.rms.toFixed(3)} peak ${info.audio.peak.toFixed(2)}`);
    check(`${fmt}: length is race + result card (from the headless run)`, r.meta.duration > r.gen && r.meta.duration < r.gen + 6, `${r.meta.duration.toFixed(1)}s for a ${r.gen.toFixed(1)}s race`);
    check(`${fmt}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // MP4 must be streamable: moov before mdat.
  {
    const b = Buffer.from(exportsByFormat['mp4-vp9'].b64, 'base64');
    let i = 0; const boxes = [];
    while (i < b.length) { const size = b.readUInt32BE(i); boxes.push(b.toString('latin1', i + 4, i + 8)); i += size || b.length; }
    check('mp4: moov comes before mdat (fast start)', boxes.indexOf('moov') > -1 && boxes.indexOf('moov') < boxes.indexOf('mdat'), boxes.join(','));
  }

  // ---- 2. determinism: same seed + settings => same frames and identical soundtrack ----
  {
    const a = exportsByFormat['webm-vp9'];
    const { ctx, page } = await newPage('seed=E2E1&preset=short');
    const b = await renderVia(page, 'webm-vp9', 30);
    check('determinism: same frame count', a.meta.frames === b.meta.frames, `${a.meta.frames} vs ${b.meta.frames}`);
    check('determinism: same soundtrack (loudness-envelope fingerprint)', a.meta.audioFingerprint === b.meta.audioFingerprint, `${a.meta.audioFingerprint} vs ${b.meta.audioFingerprint}`);
    // Raw samples: Chromium sums simultaneous voices in a varying order, so two renders
    // may differ by float rounding. Anything audible would be orders of magnitude larger.
    const drift = await page.evaluate(async () => {
      const { OfflineMixer } = await import('/js/audio/OfflineMixer.js');
      const mk = () => {
        const m = new OfflineMixer({ seed: 'E2E1' });
        for (let i = 0; i < 40; i++) m.addSound(0.3 + i * 0.21, i % 3 ? 'bounce' : 'colorBreak', { pitch: i % 4 * 3 }, 'k' + i);
        m.setMusic(0.5, 9, () => 0.6);
        return m.render(10);
      };
      const [x, y] = [await mk(), await mk()];
      let max = 0;
      for (let c = 0; c < 2; c++) { const p = x.getChannelData(c), q = y.getChannelData(c); for (let i = 0; i < p.length; i++) max = Math.max(max, Math.abs(p[i] - q[i])); }
      return max;
    });
    check('determinism: two renders of one mix agree to float rounding', drift < 1e-5, `max sample difference ${drift.toExponential(2)}`);
    await ctx.close();
    const { ctx: c2, page: p2 } = await newPage('seed=E2E2&preset=short');
    const other = await renderVia(p2, 'webm-vp9', 30);
    check('determinism: a different seed gives a different soundtrack', other.meta.audioFingerprint !== a.meta.audioFingerprint);
    await c2.close();
  }

  // ---- 3. frame rate independence of the race inside the export ----
  {
    const { ctx, page } = await newPage('seed=E2E1&preset=short');
    const r60 = await page.evaluate(async () => {
      const f = (await race.probeFormats({ fps: 60 }))[0];
      const v = await race.exportVideo({ format: f, fps: 60, bitrate: 4e6 });
      return { frames: v.frames, dur: v.duration, gen: race.game.gen.result.duration };
    });
    const r30 = exportsByFormat['webm-vp9'].meta;
    check('60 fps and 30 fps exports cover the same race time', Math.abs(r60.dur - r30.duration) < 0.15, `${r60.dur.toFixed(2)}s vs ${r30.duration.toFixed(2)}s`);
    check('60 fps export has twice the frames', Math.abs(r60.frames - 2 * r30.frames) <= 4, `${r60.frames} vs ${r30.frames}`);
    await ctx.close();
  }

  // ---- 4. UI: automatic fallback when an encoder fails ----
  {
    const { ctx, page, errors } = await newPage('seed=E2E1&preset=short');
    await page.waitForFunction(() => document.getElementById('expFormat').options.length > 0);
    await page.evaluate(() => {
      // A format whose encoder is guaranteed to fail, placed first.
      const fake = { id: 'fake', label: 'Fake (always fails)', container: 'webm', note: '', video: [{ codec: 'no-such-codec', mux: 'V_VP9' }], videoChoice: { codec: 'no-such-codec', mux: 'V_VP9' }, audio: { codec: 'opus', mux: 'A_OPUS' } };
      race.panel.formats.unshift(fake);
      const sel = document.getElementById('expFormat'); sel.add(new Option(fake.label, fake.id), 0); sel.value = 'fake';
    });
    await page.selectOption('#recFps', '30');
    const toasts = [];
    await page.exposeFunction('__toast', (t) => toasts.push(t));
    await page.evaluate(() => { const orig = race.panel.toast.bind(race.panel); race.panel.toast = (m) => { window.__toast(m); orig(m); }; });
    await page.click('#btnRender');
    await page.waitForSelector('#exportBox:not([hidden])', { timeout: 120000 });
    const meta = await page.textContent('#exportMeta');
    check('fallback: a failing encoder falls back to the next format', /WebM \(VP9/.test(meta), meta.replace(/\s+/g, ' ').slice(0, 90));
    check('fallback: the user is told', toasts.some((t) => /Fake \(always fails\).*Trying/.test(t)), toasts.join(' | '));
    check('fallback: game is left usable', await page.evaluate(() => !race.game.exporting && race.game.state === 'GENERATED'));
    check('fallback: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- 5. UI: auto + batch renders N different videos and downloads them ----
  {
    const { ctx, page, errors } = await newPage('seed=E2E3&preset=short');
    await page.waitForFunction(() => document.getElementById('expFormat').options.length > 0);
    await page.selectOption('#recFps', '30');
    await page.evaluate(() => { const s = document.getElementById('maxCand'); s.value = '5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.fill('#batchCount', '2');
    const names = [];
    page.on('download', (d) => names.push(d.suggestedFilename()));
    await page.click('#btnAutoRecord');
    const t0 = Date.now();
    while (names.length < 2 && Date.now() - t0 < 240000) await page.waitForTimeout(500);
    check('batch: two videos downloaded', names.length === 2, names.join(', '));
    check('batch: each video has its own seed', names.length === 2 && names[0].split('-')[2] !== names[1].split('-')[2], names.join(', '));
    check('batch: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- 6. live capture still works as a fallback ----
  {
    const { ctx, page, errors } = await newPage('seed=E2E4&preset=short');
    await page.evaluate(() => { document.getElementById('liveBox').open = true; });
    await page.click('#btnRecord');
    await page.waitForSelector('#exportBox:not([hidden])', { timeout: 120000 });
    const meta = await page.textContent('#exportMeta');
    check('live capture: produces a file with audio', /with audio/.test(meta), meta.replace(/\s+/g, ' ').slice(0, 100));
    check('live capture: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} e2e checks passed`);
process.exit(failed ? 1 : 0);
