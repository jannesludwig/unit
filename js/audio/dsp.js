// UNIT — tiny JS DSP toolkit used to render short percussive hits sample-accurately.
// Short events (clicks, hats, noise blocks, data bursts) are rendered per hit into
// AudioBuffers: exact to the sample, deterministic for a given seed, cheap (< 1 ms).

import { rng } from '../core/util.js';

/** Topology-preserving-transform state variable filter (Zavalishin). Stable up to ~0.45·sr. */
export class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.set(1000, 0.707, 48000); }
  set(fc, q, sr) {
    fc = Math.min(Math.max(fc, 10), sr * 0.45);
    const g = Math.tan(Math.PI * fc / sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  /** Process one sample; results in this.lp / this.bp / this.hp. */
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

/** PolyBLEP correction for band-limited square/saw edges. */
export function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Bit-depth + sample-rate reduction in place. crush 0..1. */
export function crushBuffer(d, crush) {
  if (crush <= 0.001) return;
  const bits = 16 - crush * 13;
  const q = Math.pow(2, bits - 1);
  const ratio = Math.max(0.02, Math.pow(1 - crush, 2.2));
  let ph = 1, h = 0;
  for (let n = 0; n < d.length; n++) {
    ph += ratio;
    if (ph >= 1) { ph -= 1; h = Math.round(d[n] * q) / q; }
    d[n] = h;
  }
}

/** Normalise peak to `target`. Returns the applied factor. */
export function normalize(d, target = 1) {
  let pk = 0;
  for (let n = 0; n < d.length; n++) { const a = Math.abs(d[n]); if (a > pk) pk = a; }
  if (pk < 1e-9) return 1;
  const f = target / pk;
  for (let n = 0; n < d.length; n++) d[n] *= f;
  return f;
}

/** Linear fade in/out (samples) to guarantee click-free buffer edges. */
export function edgeFade(d, inS, outS) {
  const N = d.length;
  for (let n = 0; n < inS && n < N; n++) d[n] *= n / inS;
  for (let n = 0; n < outS && n < N; n++) d[N - 1 - n] *= n / outS;
}

/** Gaussian-ish white noise source seeded for repeatable randomness. */
export function noiseGen(seed) {
  const r = rng(seed);
  return () => r() * 2 - 1;
}

/** Small LRU cache for rendered buffers. */
export class BufferCache {
  constructor(max = 256) { this.max = max; this.map = new Map(); }
  get(k) {
    const v = this.map.get(k);
    if (v) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k, v) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

/** Build an AudioBuffer from a Float32Array (mono). */
export function toBuffer(ctx, data) {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.copyToChannel(data, 0);
  return b;
}

const curves = new Map();
/** Cached tanh waveshaper curve with drive k, normalised so ±1 in → ±1 out. */
export function tanhCurve(k) {
  k = Math.max(0.05, Math.round(k * 20) / 20);
  if (curves.has(k)) return curves.get(k);
  const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / norm; }
  curves.set(k, c);
  return c;
}

let softCurve = null;
/**
 * Master soft clipper: linear below 0.6, tanh knee above, asymptote at 1.
 * The curve spans an input range of ±2 (feed it pre-scaled by 0.5).
 */
export function softClipCurve() {
  if (softCurve) return softCurve;
  const n = 4096, c = new Float32Array(n), T = 0.6;
  for (let i = 0; i < n; i++) {
    const X = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(X);
    c[i] = a < T ? X : Math.sign(X) * (T + (1 - T) * Math.tanh((a - T) / (1 - T)));
  }
  return (softCurve = c);
}
