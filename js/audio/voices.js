// UNIT — the eight voices.
//
// Every voice is defined by: params (with real-unit ranges), curated presets (real units),
// ENTROPY sensitivity per param, and a play() function that schedules one hit at time `t`.
//
//  - Oscillator voices (KICK, SUB, TONE, DRONE) build a short-lived Web Audio graph per hit
//    with sample-accurate envelopes.
//  - Rendered voices (CLICK, HAT, NOISE, DATA) synthesise the hit in JS into an AudioBuffer
//    (cached by parameter hash + random seed), giving exact digital control: single-sample
//    impulses, sample-and-hold, bit quantisation, FSK bit streams.
//
// play(ctx, dest, t, P, g, seed, st, env)
//   P    real-valued params (locks, ENTROPY and macros already applied)
//   g    linear gain from velocity
//   seed 0..1 random value from the track's DÉJÀ VU memory (repeatable randomness)
//   st   per-track persistent state (mono choke, last pitch for glide)
//   env  { mood, depth, entropy, bpm }
// returns { stop(time, fade) } so monophonic voices can be choked, plus info for visuals.

import { mtof, rng } from '../core/util.js';
import { SVF, polyblep, crushBuffer, normalize, edgeFade, noiseGen, BufferCache, toBuffer, tanhCurve } from './dsp.js';

const cache = new BufferCache(320);
const q3 = (v) => Math.round(v * 1000) / 1000;

/** Common output stage for one hit: env gain → choke gain → dest. */
function outStage(ctx, dest, g) {
  const choke = ctx.createGain();
  choke.gain.value = g;
  choke.connect(dest);
  return choke;
}

function handle(choke, sources, end) {
  return {
    end,
    stop(time, fade = 0.004) {
      if (time >= this.end) return;
      choke.gain.cancelScheduledValues(time);
      choke.gain.setTargetAtTime(0, time, fade);
      const st = time + fade * 8;
      for (const s of sources) { try { s.stop(st); } catch (e) { /* already stopped */ } }
      this.end = st;
    },
  };
}

function playBuffer(ctx, dest, t, buf, g) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const out = outStage(ctx, dest, g);
  src.connect(out);
  src.onended = () => out.disconnect();
  src.start(t);
  return handle(out, [src], t + buf.duration);
}

// ---------------------------------------------------------------------------------------
// 1 KICK — sine with exponential pitch sweep, click transient, tanh drive.
// ---------------------------------------------------------------------------------------
function kickClickBuffer(ctx) {
  const key = 'kickclick';
  let b = cache.get(key);
  if (b) return b;
  const sr = ctx.sampleRate, N = Math.round(sr * 0.006), d = new Float32Array(N);
  const nz = noiseGen(77), f = new SVF(); f.set(3800, 0.6, sr);
  for (let n = 0; n < N; n++) {
    const e = (n === 0 ? 1 : 0) + nz() * Math.exp(-n / (sr * 0.0007)) * 0.8;
    f.tick(e);
    d[n] = f.bp * 0.8 + f.hp * 0.5;
  }
  normalize(d, 1); edgeFade(d, 0, 32);
  b = toBuffer(ctx, d); cache.set(key, b);
  return b;
}

const KICK = {
  id: 'kick', name: 'KICK', mono: true, level: 0.95,
  params: [
    { id: 'pitch', name: 'PITCH', min: 30, max: 90, curve: 'exp', unit: 'Hz', def: 45 },
    { id: 'decay', name: 'DECAY', min: 0.06, max: 2.0, curve: 'exp', unit: 's', def: 0.5 },
    { id: 'sweep', name: 'SWEEP', min: 0, max: 5, unit: 'oct', def: 3 },
    { id: 'click', name: 'CLICK', min: 0, max: 1, def: 0.2 },
    { id: 'drive', name: 'DRIVE', min: 0, max: 1, def: 0.15 },
  ],
  entropy: { pitch: 0.04, decay: 0.15, click: 0.3 },
  presets: [
    { name: 'DEEP', p: { pitch: 42, decay: 0.7, sweep: 3.2, click: 0.15, drive: 0.15 } },
    { name: 'TIGHT', p: { pitch: 52, decay: 0.22, sweep: 3.6, click: 0.35, drive: 0.25 } },
    { name: 'BOOM', p: { pitch: 37, decay: 1.4, sweep: 2.4, click: 0.05, drive: 0.1 } },
    { name: 'PULSE', p: { pitch: 62, decay: 0.12, sweep: 1.4, click: 0.55, drive: 0 } },
    { name: 'DRIVEN', p: { pitch: 46, decay: 0.5, sweep: 4.0, click: 0.3, drive: 0.7 } },
  ],
  play(ctx, dest, t, P, g, seed, st, env) {
    const base = P.pitch, start = base * Math.pow(2, P.sweep);
    const decay = P.decay * (0.75 + env.depth * 0.5);
    const hold = Math.min(0.03, decay * 0.12);
    const end = t + hold + decay * 1.05;
    const out = outStage(ctx, dest, g);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.setTargetAtTime(base, t, 0.006 + 0.004 * P.sweep);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(1, t);
    amp.gain.setValueAtTime(1, t + hold);
    amp.gain.setTargetAtTime(0, t + hold, decay / 6.9);
    osc.connect(amp);
    let last = amp;
    if (P.drive > 0.01) {
      const sh = ctx.createWaveShaper(); sh.curve = tanhCurve(1 + P.drive * 9); sh.oversample = '2x';
      amp.connect(sh); last = sh;
    }
    last.connect(out);
    const srcs = [osc];
    if (P.click > 0.01) {
      const c = ctx.createBufferSource(); c.buffer = kickClickBuffer(ctx);
      const cg = ctx.createGain(); cg.gain.value = P.click * 0.55 * (0.7 + env.mood * 0.6);
      c.connect(cg).connect(out); c.start(t); srcs.push(c);
    }
    osc.onended = () => out.disconnect();
    osc.start(t); osc.stop(end);
    return Object.assign(handle(out, srcs, end), { freq: base });
  },
};

// ---------------------------------------------------------------------------------------
// 2 SUB — pure sine pulse, glide from the previous note, tanh saturation for harmonics.
// ---------------------------------------------------------------------------------------
const SUB = {
  id: 'sub', name: 'SUB', mono: true, level: 0.8,
  params: [
    { id: 'pitch', name: 'PITCH', min: 24, max: 55, step: 1, unit: 'note', def: 33 },
    { id: 'decay', name: 'DECAY', min: 0.05, max: 4, curve: 'exp', unit: 's', def: 0.6 },
    { id: 'glide', name: 'GLIDE', min: 0, max: 0.4, unit: 's', def: 0 },
    { id: 'sat', name: 'SAT', min: 0, max: 1, def: 0.15 },
    { id: 'attack', name: 'ATTACK', min: 0.002, max: 0.4, curve: 'exp', unit: 's', def: 0.004 },
  ],
  entropy: { decay: 0.15, sat: 0.2 },
  presets: [
    { name: 'PRESSURE', p: { pitch: 31, decay: 0.9, glide: 0, sat: 0.12, attack: 0.004 } },
    { name: 'PULSE', p: { pitch: 33, decay: 0.18, glide: 0, sat: 0.25, attack: 0.003 } },
    { name: 'LONG', p: { pitch: 29, decay: 2.8, glide: 0.06, sat: 0.08, attack: 0.02 } },
    { name: 'GLIDE', p: { pitch: 34, decay: 0.5, glide: 0.12, sat: 0.3, attack: 0.003 } },
    { name: 'SWELL', p: { pitch: 28, decay: 3.5, glide: 0, sat: 0.05, attack: 0.25 } },
  ],
  play(ctx, dest, t, P, g, seed, st, env) {
    const f = mtof(P.pitch);
    const atk = P.attack, end = t + atk + P.decay * 1.05;
    const out = outStage(ctx, dest, g);
    const osc = ctx.createOscillator();
    if (P.glide > 0.003 && st.lastFreq) {
      osc.frequency.setValueAtTime(st.lastFreq, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + P.glide);
    } else osc.frequency.setValueAtTime(f, t);
    st.lastFreq = f;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + atk);
    amp.gain.setTargetAtTime(0, t + atk, P.decay / 6.9);
    osc.connect(amp);
    const sat = Math.min(1, P.sat + env.depth * 0.15);
    if (sat > 0.01) {
      const sh = ctx.createWaveShaper(); sh.curve = tanhCurve(1 + sat * 5); sh.oversample = '2x';
      amp.connect(sh).connect(out);
    } else amp.connect(out);
    osc.onended = () => out.disconnect();
    osc.start(t); osc.stop(end);
    return Object.assign(handle(out, [osc], end), { freq: f });
  },
};

// ---------------------------------------------------------------------------------------
// 3 CLICK — single-sample impulses / doublets / noise grains through a resonant SVF.
// ---------------------------------------------------------------------------------------
const CLICK = {
  id: 'click', name: 'CLICK', level: 0.62,
  params: [
    { id: 'freq', name: 'FREQ', min: 200, max: 16000, curve: 'exp', unit: 'Hz', def: 4200 },
    { id: 'length', name: 'LENGTH', min: 0.0004, max: 0.06, curve: 'exp', unit: 's', def: 0.004 },
    { id: 'reso', name: 'RESO', min: 0, max: 1, def: 0.3 },
    { id: 'crush', name: 'CRUSH', min: 0, max: 1, def: 0 },
    { id: 'shape', name: 'SHAPE', min: 0, max: 1, def: 0.1 },
  ],
  entropy: { freq: 0.35, length: 0.3, reso: 0.2, shape: 0.3 },
  presets: [
    { name: 'IMPULSE', p: { freq: 9000, length: 0.0008, reso: 0.05, crush: 0, shape: 0 } },
    { name: 'TICK', p: { freq: 4200, length: 0.004, reso: 0.35, crush: 0, shape: 0.1 } },
    { name: 'WOOD', p: { freq: 1500, length: 0.01, reso: 0.55, crush: 0, shape: 0.2 } },
    { name: 'GRAIN', p: { freq: 6500, length: 0.006, reso: 0.15, crush: 0.4, shape: 0.85 } },
    { name: 'BIT', p: { freq: 2500, length: 0.003, reso: 0.2, crush: 0.75, shape: 0.5 } },
  ],
  render(sr, P, seed) {
    const len = P.length, N = Math.max(64, Math.ceil((len * 1.6 + 0.0015) * sr));
    const d = new Float32Array(N), nz = noiseGen(seed * 1e6 | 0), f = new SVF();
    const q = 0.6 + P.reso * P.reso * 24;
    f.set(P.freq, q, sr);
    const tau = Math.max(1, len * sr / 4.5);
    const nTau = Math.max(1, len * sr / 3);
    const half = Math.max(1, Math.round(sr / P.freq / 2));
    const s = P.shape;
    const wImp = Math.max(0, 1 - s * 2), wDbl = 1 - Math.abs(s * 2 - 1), wNz = Math.max(0, s * 2 - 1);
    const bpG = 0.25 + P.reso * 1.2, hpG = (1 - P.reso) * 0.9;
    for (let n = 0; n < N; n++) {
      const e = (n === 0 ? wImp + wDbl : 0) - (n === half ? wDbl : 0) + wNz * nz() * Math.exp(-n / nTau);
      f.tick(e);
      d[n] = (f.bp * bpG + f.hp * hpG) * Math.exp(-n / tau);
    }
    crushBuffer(d, P.crush);
    normalize(d, 1); edgeFade(d, 0, Math.min(48, N >> 2));
    return d;
  },
  play(ctx, dest, t, P, g, seed, st, env) {
    const mf = Math.pow(2, (env.mood - 0.5) * 1.6);
    const p = { ...P, freq: Math.min(18000, P.freq * mf) };
    const key = `c|${q3(p.freq)}|${q3(p.length * 1e3)}|${q3(p.reso)}|${q3(p.crush)}|${q3(p.shape)}|${(seed * 4096) | 0}`;
    let b = cache.get(key);
    if (!b) { b = toBuffer(ctx, this.render(ctx.sampleRate, p, seed)); cache.set(key, b); }
    return playBuffer(ctx, dest, t, b, g);
  },
};

// ---------------------------------------------------------------------------------------
// 4 HAT — six band-limited squares at inharmonic ratios + noise, steep high-pass.
// ---------------------------------------------------------------------------------------
const HAT_RATIOS = [1, 1.483, 1.8, 2.546, 2.63, 3.897];
const HAT = {
  id: 'hat', name: 'HAT', level: 0.32,
  params: [
    { id: 'tone', name: 'TONE', min: 0, max: 1, def: 0.5 },
    { id: 'decay', name: 'DECAY', min: 0.005, max: 0.6, curve: 'exp', unit: 's', def: 0.04 },
    { id: 'filter', name: 'FILTER', min: 1500, max: 14000, curve: 'exp', unit: 'Hz', def: 6200 },
    { id: 'metal', name: 'METAL', min: 0, max: 1, def: 0.5 },
  ],
  entropy: { decay: 0.25, filter: 0.2, tone: 0.3 },
  presets: [
    { name: 'TICK', p: { tone: 0.6, decay: 0.025, filter: 6200, metal: 0.4 } },
    { name: 'METAL', p: { tone: 0.4, decay: 0.09, filter: 4600, metal: 0.9 } },
    { name: 'AIR', p: { tone: 0.5, decay: 0.06, filter: 8200, metal: 0.1 } },
    { name: 'OPEN', p: { tone: 0.45, decay: 0.32, filter: 5200, metal: 0.6 } },
    { name: 'DUST', p: { tone: 0.8, decay: 0.012, filter: 9500, metal: 0 } },
  ],
  render(sr, P, seed) {
    const N = Math.ceil((P.decay * 1.1 + 0.002) * sr), d = new Float32Array(N);
    const nz = noiseGen(seed * 1e6 | 0);
    const base = 180 * Math.pow(2, P.tone * 2.2);
    const ph = new Float64Array(6), dt = HAT_RATIOS.map((r) => (base * r) / sr);
    const r0 = rng(seed * 1e6 | 0); for (let i = 0; i < 6; i++) ph[i] = r0();
    const h1 = new SVF(), h2 = new SVF(), bp = new SVF(), lp = new SVF();
    h1.set(P.filter, 0.7, sr); h2.set(P.filter, 0.7, sr); bp.set(Math.min(sr * 0.42, P.filter * 1.35), 1.4, sr);
    lp.set(Math.min(sr * 0.42, P.filter * 1.9 + 1500), 0.6, sr); // roll off fizz above the metal band
    const tau = P.decay / 6.9 * sr, atk = Math.max(1, sr * 0.0003);
    for (let n = 0; n < N; n++) {
      let m = 0;
      for (let i = 0; i < 6; i++) {
        let t = ph[i], s = t < 0.5 ? 1 : -1;
        s += polyblep(t, dt[i]); s -= polyblep((t + 0.5) % 1, dt[i]);
        m += s; t += dt[i]; ph[i] = t - Math.floor(t);
      }
      const x = (m / 6) * P.metal + nz() * (1 - P.metal) * 0.8;
      h1.tick(x); h2.tick(h1.hp); bp.tick(x);
      const env = (n < atk ? n / atk : 1) * Math.exp(-n / tau);
      d[n] = lp.tick(h2.hp + bp.bp * 0.5) * env;
    }
    normalize(d, 1); edgeFade(d, 0, 24);
    return d;
  },
  play(ctx, dest, t, P, g, seed, st, env) {
    const mf = Math.pow(2, (env.mood - 0.5) * 1.2);
    const p = { ...P, filter: Math.min(16000, P.filter * mf) };
    const key = `h|${q3(p.tone)}|${q3(p.decay * 1e3)}|${q3(p.filter)}|${q3(p.metal)}|${(seed * 64) | 0}`;
    let b = cache.get(key);
    if (!b) { b = toBuffer(ctx, this.render(ctx.sampleRate, p, ((seed * 64) | 0) / 64 + 0.001)); cache.set(key, b); }
    return playBuffer(ctx, dest, t, b, g);
  },
};

// ---------------------------------------------------------------------------------------
// 5 NOISE — gated white-noise blocks, sample-rate reduction, LP/BP/HP SVF.
// ---------------------------------------------------------------------------------------
const NOISE = {
  id: 'noise', name: 'NOISE', level: 0.28,
  params: [
    { id: 'type', name: 'TYPE', list: ['LP', 'BP', 'HP'], def: 'BP' },
    { id: 'cutoff', name: 'CUTOFF', min: 60, max: 16000, curve: 'exp', unit: 'Hz', def: 3000 },
    { id: 'gate', name: 'GATE', min: 0.004, max: 1.2, curve: 'exp', unit: 's', def: 0.06 },
    { id: 'rate', name: 'S.RATE', min: 0, max: 1, def: 0 },
    { id: 'reso', name: 'RESO', min: 0, max: 1, def: 0.2 },
  ],
  entropy: { cutoff: 0.3, gate: 0.3, rate: 0.2 },
  presets: [
    { name: 'BLOCK', p: { type: 'BP', cutoff: 3000, gate: 0.06, rate: 0, reso: 0.2 } },
    { name: 'THUD', p: { type: 'LP', cutoff: 220, gate: 0.12, rate: 0.3, reso: 0.3 } },
    { name: 'SPRAY', p: { type: 'HP', cutoff: 8000, gate: 0.03, rate: 0, reso: 0.1 } },
    { name: 'CRUSH', p: { type: 'BP', cutoff: 1500, gate: 0.15, rate: 0.7, reso: 0.4 } },
    { name: 'WALL', p: { type: 'LP', cutoff: 5000, gate: 0.5, rate: 0.15, reso: 0.1 } },
  ],
  render(sr, P, seed) {
    const N = Math.ceil((P.gate + 0.003) * sr), d = new Float32Array(N);
    const nz = noiseGen(seed * 1e6 | 0), f = new SVF();
    f.set(P.cutoff, 0.6 + P.reso * P.reso * 12, sr);
    const ratio = Math.max(0.015, Math.pow(1 - P.rate, 2.5));
    let ph = 1, h = 0;
    for (let n = 0; n < N; n++) {
      ph += ratio; if (ph >= 1) { ph -= 1; h = nz(); }
      f.tick(h);
      d[n] = P.type === 'LP' ? f.lp : P.type === 'HP' ? f.hp : f.bp;
    }
    normalize(d, 1);
    edgeFade(d, Math.round(sr * 0.0006), Math.round(sr * 0.002)); // hard gate, but click-free
    return d;
  },
  play(ctx, dest, t, P, g, seed, st, env) {
    const mf = Math.pow(2, (env.mood - 0.5) * 1.4);
    const p = { ...P, cutoff: Math.min(16000, P.cutoff * mf) };
    const key = `n|${p.type}|${q3(p.cutoff)}|${q3(p.gate * 1e3)}|${q3(p.rate)}|${q3(p.reso)}|${(seed * 4096) | 0}`;
    let b = cache.get(key);
    if (!b) { b = toBuffer(ctx, this.render(ctx.sampleRate, p, seed)); cache.set(key, b); }
    return playBuffer(ctx, dest, t, b, g);
  },
};

// ---------------------------------------------------------------------------------------
// 6 TONE — 2-operator FM sine, short and exact.
// ---------------------------------------------------------------------------------------
const TONE = {
  id: 'tone', name: 'TONE', mono: false, level: 0.32,
  params: [
    { id: 'pitch', name: 'PITCH', min: 28, max: 84, step: 1, unit: 'note', def: 48 },
    { id: 'fm', name: 'FM', min: 0, max: 1, def: 0.15 },
    { id: 'ratio', name: 'RATIO', list: [0.5, 1, 1.5, 2, 2.76, 3, 3.5, 4, 5.19, 7, 8.4], def: 2 },
    { id: 'decay', name: 'DECAY', min: 0.008, max: 1.5, curve: 'exp', unit: 's', def: 0.15 },
    { id: 'fmdec', name: 'FM ENV', min: 0, max: 1, def: 0.5 },
  ],
  entropy: { fm: 0.3, decay: 0.2, fmdec: 0.2 },
  presets: [
    { name: 'SINE', p: { pitch: 57, fm: 0, ratio: 1, decay: 0.12, fmdec: 0.5 } },
    { name: 'PROBE', p: { pitch: 69, fm: 0, ratio: 1, decay: 0.018, fmdec: 0.5 } },
    { name: 'LOW FM', p: { pitch: 40, fm: 0.35, ratio: 2, decay: 0.3, fmdec: 0.3 } },
    { name: 'METAL', p: { pitch: 52, fm: 0.5, ratio: 2.76, decay: 0.15, fmdec: 0.6 } },
    { name: 'GLASS', p: { pitch: 72, fm: 0.22, ratio: 3.5, decay: 0.05, fmdec: 0.8 } },
  ],
  play(ctx, dest, t, P, g, seed, st, env) {
    const f = mtof(P.pitch), fmF = f * P.ratio;
    const idx = P.fm * 6 * (0.6 + env.mood * 0.8);
    const dev = Math.min(idx * fmF, 7000);
    const end = t + 0.001 + P.decay * 1.05;
    const out = outStage(ctx, dest, g);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.001);
    amp.gain.setTargetAtTime(0, t + 0.001, P.decay / 6.9);
    car.connect(amp).connect(out);
    const srcs = [car];
    if (dev > 0.5) {
      const mod = ctx.createOscillator(); mod.frequency.value = fmF;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(dev, t);
      mg.gain.setTargetAtTime(dev * 0.03, t, Math.max(0.002, P.decay * (1 - P.fmdec * 0.92)) / 3);
      mod.connect(mg).connect(car.frequency);
      mod.start(t); mod.stop(end); srcs.push(mod);
    }
    car.onended = () => out.disconnect();
    car.start(t); car.stop(end);
    return Object.assign(handle(out, srcs, end), { freq: f });
  },
};

// ---------------------------------------------------------------------------------------
// 7 DATA — FSK bit streams, impulse trains, stutters, noise slices from a seeded RNG.
// ---------------------------------------------------------------------------------------
const DATA = {
  id: 'data', name: 'DATA', level: 0.24,
  params: [
    { id: 'rate', name: 'RATE', min: 100, max: 8000, curve: 'exp', unit: 'bd', def: 1200 },
    { id: 'chaos', name: 'CHAOS', min: 0, max: 1, def: 0.4 },
    { id: 'length', name: 'LENGTH', min: 0.01, max: 0.5, curve: 'exp', unit: 's', def: 0.08 },
    { id: 'crush', name: 'CRUSH', min: 0, max: 1, def: 0.25 },
    { id: 'freq', name: 'FREQ', min: 300, max: 6000, curve: 'exp', unit: 'Hz', def: 1800 },
  ],
  entropy: { rate: 0.3, chaos: 0.35, freq: 0.25, length: 0.2 },
  presets: [
    { name: 'MODEM', p: { rate: 1200, chaos: 0.2, length: 0.12, crush: 0.1, freq: 1200 } },
    { name: 'GLITCH', p: { rate: 3000, chaos: 0.7, length: 0.06, crush: 0.5, freq: 2400 } },
    { name: 'STUTTER', p: { rate: 600, chaos: 0.9, length: 0.2, crush: 0.3, freq: 800 } },
    { name: 'BITS', p: { rate: 6000, chaos: 0.1, length: 0.03, crush: 0, freq: 4000 } },
    { name: 'LOW', p: { rate: 300, chaos: 0.5, length: 0.15, crush: 0.6, freq: 420 } },
  ],
  render(sr, P, seed) {
    const N = Math.max(64, Math.ceil(P.length * sr)), d = new Float32Array(N);
    const r = rng((seed * 1e6) | 0), c = P.chaos;
    const bit = Math.max(8, sr / P.rate);
    const f0 = P.freq, f1 = P.freq * 1.833;
    let pos = 0, phase = 0, prevA = -1, prevB = -1;
    const fade = 12;
    while (pos < N) {
      const bits = 1 + Math.floor(r() * (1 + c * 4));
      let L = Math.max(16, Math.round(bit * bits));
      if (pos + L > N) L = N - pos;
      const x = r();
      if (prevA >= 0 && x < c * 0.35) {
        // stutter: repeat the previous segment 1..3 times
        const reps = 1 + Math.floor(r() * 3);
        const sl = prevB - prevA;
        for (let k = 0; k < reps && pos < N; k++) {
          for (let i = 0; i < sl && pos < N; i++) d[pos++] = d[prevA + i];
        }
        continue;
      }
      const a = pos;
      if (x < 0.12 + c * 0.1) {
        pos += L; // silence
      } else if (x < 0.22 + c * 0.25) {
        const per = Math.max(4, Math.round(bit / (1 + Math.floor(r() * 4))));
        for (let i = 0; i < L; i++, pos++) d[pos] = i % per === 0 ? (r() < 0.5 ? 0.6 : -0.6) : 0;
      } else if (x < 0.25 + c * 0.3) {
        for (let i = 0; i < L; i++, pos++) d[pos] = (r() * 2 - 1) * 0.3;
      } else {
        // FSK bit: phase-continuous sine at f0/f1 (chaos lets it jump octaves)
        let f = r() < 0.5 ? f0 : f1;
        if (c > 0.3 && r() < (c - 0.3)) f *= Math.pow(2, Math.round((r() - 0.5) * 4));
        f = Math.min(f, sr * 0.4);
        const dp = (2 * Math.PI * f) / sr;
        for (let i = 0; i < L; i++, pos++) { d[pos] = Math.sin(phase) * 0.85; phase += dp; }
      }
      // micro fades at segment edges keep it crisp, not splattery
      const b = pos;
      for (let i = 0; i < fade && a + i < b; i++) { d[a + i] *= i / fade; d[b - 1 - i] *= i / fade; }
      prevA = a; prevB = b;
    }
    // gentle one-pole low-pass keeps the data texture "low", not fizzy
    const a = Math.exp((-2 * Math.PI * Math.min(14000, P.freq * 4.5)) / sr);
    let y = 0;
    for (let n = 0; n < N; n++) { y = (1 - a) * d[n] + a * y; d[n] = y; }
    crushBuffer(d, P.crush);
    normalize(d, 1); edgeFade(d, 8, 32);
    return d;
  },
  play(ctx, dest, t, P, g, seed, st, env) {
    const mf = Math.pow(2, (env.mood - 0.5) * 1.0);
    const p = { ...P, freq: P.freq * mf, chaos: Math.min(1, P.chaos + env.entropy * 0.5) };
    const key = `d|${q3(p.rate)}|${q3(p.chaos)}|${q3(p.length * 1e3)}|${q3(p.crush)}|${q3(p.freq)}|${(seed * 4096) | 0}`;
    let b = cache.get(key);
    if (!b) { b = toBuffer(ctx, this.render(ctx.sampleRate, p, seed)); cache.set(key, b); }
    return playBuffer(ctx, dest, t, b, g);
  },
};

// ---------------------------------------------------------------------------------------
// 8 DRONE — sine root + two detuned, filtered saws, slow LFO movement. Long, dark, quiet.
// ---------------------------------------------------------------------------------------
const DRONE = {
  id: 'drone', name: 'DRONE', mono: true, level: 0.24,
  params: [
    { id: 'pitch', name: 'PITCH', min: 24, max: 60, step: 1, unit: 'note', def: 36 },
    { id: 'detune', name: 'DETUNE', min: 0, max: 1, def: 0.3 },
    { id: 'filter', name: 'FILTER', min: 60, max: 3000, curve: 'exp', unit: 'Hz', def: 350 },
    { id: 'move', name: 'MOVE', min: 0, max: 1, def: 0.35 },
    { id: 'length', name: 'LENGTH', min: 0.4, max: 16, curve: 'exp', unit: 's', def: 6 },
  ],
  entropy: { filter: 0.2, move: 0.2, detune: 0.2 },
  presets: [
    { name: 'DARK', p: { pitch: 36, detune: 0.3, filter: 300, move: 0.3, length: 6 } },
    { name: 'VOID', p: { pitch: 29, detune: 0.15, filter: 170, move: 0.5, length: 10 } },
    { name: 'COLD', p: { pitch: 43, detune: 0.5, filter: 900, move: 0.2, length: 4 } },
    { name: 'BREATH', p: { pitch: 31, detune: 0.6, filter: 420, move: 0.8, length: 8 } },
    { name: 'STILL', p: { pitch: 36, detune: 0.05, filter: 240, move: 0.05, length: 12 } },
  ],
  play(ctx, dest, t, P, g, seed, st, env) {
    const f = mtof(P.pitch), len = P.length;
    const atk = len * 0.3, rel = len * 0.4, end = t + len + rel * 0.6;
    const out = outStage(ctx, dest, g);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + atk);
    amp.gain.setValueAtTime(1, t + len - rel);
    amp.gain.setTargetAtTime(0, t + len - rel, rel / 4);
    amp.connect(out);
    const cents = P.detune * 22;
    const cutoff = Math.min(8000, P.filter * Math.pow(2, (env.mood - 0.5) * 1.2));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    lp.frequency.value = cutoff;
    lp.connect(amp);
    const srcs = [];
    const root = ctx.createOscillator(); root.frequency.value = f;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    root.connect(rg).connect(amp); srcs.push(root);
    const r = rng((seed * 1e6) | 0);
    for (const s of [-1, 1]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = s * cents + (r() - 0.5) * 3;
      const pn = ctx.createStereoPanner(); pn.pan.value = s * 0.55;
      const og = ctx.createGain(); og.gain.value = 0.32;
      o.connect(og).connect(pn).connect(lp); srcs.push(o);
    }
    // movement: slow LFOs on cutoff and detune drift
    const mv = P.move;
    if (mv > 0.01) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + mv * 0.35 + r() * 0.02;
      const lg = ctx.createGain(); lg.gain.value = cutoff * 0.6 * mv;
      lfo.connect(lg).connect(lp.frequency); srcs.push(lfo);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07 + mv * 0.2;
      const lg2 = ctx.createGain(); lg2.gain.value = 0.18 * mv;
      const trem = ctx.createGain(); trem.gain.value = 1 - 0.18 * mv;
      lfo2.connect(lg2).connect(trem.gain); srcs.push(lfo2);
      amp.disconnect(); amp.connect(trem).connect(out);
    }
    srcs.forEach((s) => { s.start(t); s.stop(end); });
    root.onended = () => out.disconnect();
    return Object.assign(handle(out, srcs, end), { freq: f });
  },
};

export const VOICES = [KICK, SUB, CLICK, HAT, NOISE, TONE, DATA, DRONE];
export const TRACK_IDS = VOICES.map((v) => v.id);
