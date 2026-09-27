// Shareable race links: ?seed=ABC123&preset=chaos[&d=hard&w=0...]
// Only settings that differ from the preset are written, so links stay short.
import { PRESETS, RACE_DEFAULTS, URL_KEYS, resolveRaceConfig } from '../config/presets.js';
import { normalizeSeed } from './RNG.js';

const REVERSE = Object.fromEntries(Object.entries(URL_KEYS).map(([k, v]) => [v, k]));

function encodeValue(v) { return typeof v === 'boolean' ? (v ? '1' : '0') : String(v); }
function decodeValue(key, raw) {
  const def = RACE_DEFAULTS[key];
  if (typeof def === 'boolean') return raw === '1' || raw === 'true';
  if (typeof def === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : def; }
  return raw;
}

export function buildQuery(seed, presetId, cfg) {
  const q = new URLSearchParams();
  q.set('seed', seed);
  q.set('preset', presetId);
  const base = resolveRaceConfig(presetId);
  for (const [key, short] of Object.entries(URL_KEYS)) {
    if (cfg[key] !== undefined && cfg[key] !== base[key]) q.set(short, encodeValue(cfg[key]));
  }
  return q.toString();
}

export function parseQuery(search) {
  const q = new URLSearchParams(search);
  const seed = normalizeSeed(q.get('seed') || '');
  const presetRaw = q.get('preset');
  const preset = presetRaw && PRESETS[presetRaw] ? presetRaw : null;
  const overrides = {};
  for (const [short, key] of Object.entries(REVERSE)) {
    if (q.has(short)) overrides[key] = decodeValue(key, q.get(short));
  }
  return { seed: seed || null, preset, overrides };
}

export function shareUrl(seed, presetId, cfg, loc = globalThis.location) {
  const base = loc.origin + loc.pathname; // works under /REPOSITORY/ on GitHub Pages
  return `${base}?${buildQuery(seed, presetId, cfg)}`;
}
