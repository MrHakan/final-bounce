// MediaRecorder writes WebM files without a Duration element, which breaks
// seeking/scrubbing in some players and editors. This inserts
// Segment > Info > Duration (EBML id 0x4489, float64) into the header.
// On any parsing surprise the original blob is returned unchanged.

const ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_DURATION = 0x4489, ID_TIMECODE_SCALE = 0x2ad7b1;

function readVint(b, pos, keepMarker) {
  const first = b[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error('bad vint');
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + b[pos + i]; if (b[pos + i] !== 0xff) allOnes = false; }
  return { value, len, unknown: !keepMarker && allOnes };
}

function encodeSize(size, width) {
  const out = new Uint8Array(width);
  let v = size;
  for (let i = width - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 1 << (8 - width);
  return out;
}

function sizeWidth(size) { let w = 1; while (w < 8 && size >= Math.pow(2, 7 * w) - 1) w++; return w; }

export function patchWebmDuration(bytes, durationMs) {
  const b = bytes;
  let pos = 0;
  const hdr = readVint(b, pos, true); pos += hdr.len;
  const hdrSize = readVint(b, pos, false); pos += hdrSize.len + hdrSize.value; // skip EBML header
  const segId = readVint(b, pos, true);
  if (segId.value !== ID_SEGMENT) throw new Error('no segment');
  const segSizePos = pos + segId.len;
  const segSize = readVint(b, segSizePos, false);
  let p = segSizePos + segSize.len;
  for (let guard = 0; guard < 64 && p < b.length; guard++) {
    const id = readVint(b, p, true);
    const sz = readVint(b, p + id.len, false);
    const dataStart = p + id.len + sz.len;
    if (id.value === ID_INFO) {
      // Scan Info children.
      let q = dataStart, scale = 1e6;
      const end = dataStart + sz.value;
      while (q < end) {
        const cid = readVint(b, q, true);
        const csz = readVint(b, q + cid.len, false);
        const cdata = q + cid.len + csz.len;
        if (cid.value === ID_DURATION) return null; // already present
        if (cid.value === ID_TIMECODE_SCALE) { let v = 0; for (let i = 0; i < csz.value; i++) v = v * 256 + b[cdata + i]; scale = v; }
        q = cdata + csz.value;
      }
      const dur = new Uint8Array(11);
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
      new DataView(dur.buffer).setFloat64(3, (durationMs * 1e6) / scale);
      const newInfoSize = sz.value + dur.length;
      const infoSizeBytes = encodeSize(newInfoSize, Math.max(sz.len, sizeWidth(newInfoSize)));
      const delta = dur.length + (infoSizeBytes.length - sz.len);
      const parts = [];
      // Segment header (update its size if it is known).
      if (segSize.unknown) parts.push(b.subarray(0, dataStart - sz.len - id.len));
      else {
        parts.push(b.subarray(0, segSizePos));
        const ns = segSize.value + delta;
        parts.push(encodeSize(ns, Math.max(segSize.len, sizeWidth(ns))));
        if (sizeWidth(ns) > segSize.len) throw new Error('segment size overflow');
        parts.push(b.subarray(segSizePos + segSize.len, p));
      }
      parts.push(b.subarray(p, p + id.len), infoSizeBytes, b.subarray(dataStart, end), dur, b.subarray(end));
      const total = parts.reduce((n, x) => n + x.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const x of parts) { out.set(x, o); o += x.length; }
      return out;
    }
    if (sz.unknown) break;
    p = dataStart + sz.value;
  }
  throw new Error('no info');
}

export async function fixWebmDuration(blob, durationMs) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const out = patchWebmDuration(bytes, durationMs);
    return out ? new Blob([out], { type: blob.type }) : blob;
  } catch {
    return blob;
  }
}
