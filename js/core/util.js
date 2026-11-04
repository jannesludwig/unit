// UNIT — small shared helpers (math, PRNG, events).

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-9));

/** Map a normalised 0..1 value to a parameter's real range (lin / exp / list). */
export function denorm(p, n) {
  n = clamp(n);
  if (p.list) return p.list[Math.min(p.list.length - 1, Math.floor(n * p.list.length))];
  let v = p.curve === 'exp' ? p.min * Math.pow(p.max / p.min, n) : p.min + (p.max - p.min) * n;
  if (p.step) v = Math.round(v / p.step) * p.step;
  return v;
}

/** Inverse of denorm. */
export function norm(p, v) {
  if (p.list) {
    let i = p.list.indexOf(v);
    if (i < 0) {
      // nearest numeric entry
      let best = 0, bd = Infinity;
      p.list.forEach((x, k) => { const d = Math.abs(+x - +v); if (d < bd) { bd = d; best = k; } });
      i = best;
    }
    return (i + 0.5) / p.list.length;
  }
  if (p.curve === 'exp') return clamp(Math.log(v / p.min) / Math.log(p.max / p.min));
  return clamp((v - p.min) / (p.max - p.min));
}

/** mulberry32 — tiny seeded PRNG returning [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of a float + index into [0,1). */
export function hash01(x, i = 0) {
  const s = Math.sin(x * 12.9898 + i * 78.233 + 0.1234) * 43758.5453;
  return s - Math.floor(s);
}

/** Minimal event emitter. */
export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, new Set()); this._h.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h.get(ev)?.delete(fn); }
  emit(ev, ...a) { this._h.get(ev)?.forEach((fn) => fn(...a)); }
}

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const deepClone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
