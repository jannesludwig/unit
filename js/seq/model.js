// UNIT — project data model, defaults and (de)serialisation.
//
// Project
//   bpm, swing (50–75 %), macros {depth, entropy, space, mood}, master {duck, drive, volume}
//   fx {delay {div, feedback, tone, ping}, reverb {size, damp}}
//   tracks[8]   sound + mix + generator settings (shared by all patterns)
//     params {id: 0..1}, preset, mix {vol, pan, dly, rev, flt, crush, mute, solo},
//     gen {dv, mut, pulses, rot, seed}
//   patterns[4] {bars 1–4, tracks[8] {len 1–64, speed, steps[64] (null | Step)}}
//   cur, chain [pattern indices], chainOn
//   visual {scene, reactivity, auto, params{scene: [3]}}
// Step  {v vel 0–1, p prob 0–1, c condition index, n nudge (−0.5..0.5 of a 16th), r ratchet 1–4,
//        l locks {paramId: value}}

import { VOICES } from '../audio/voices.js';
import { norm, deepClone } from '../core/util.js';

export const MAX_STEPS = 64;
export const SPEEDS = [0.25, 0.5, 1, 2];
export const SPEED_LABELS = ['¼×', '½×', '1×', '2×'];
export const CONDS = ['—', 'FILL', '!FILL', '1ST', '!1ST', 'PRE', '!PRE', '1:2', '2:2', '1:3', '2:3', '3:3', '1:4', '2:4', '3:4', '4:4', '1:8', '8:8'];
export const PATTERN_NAMES = ['A', 'B', 'C', 'D'];
export const DEFAULT_VEL = 0.85;

export const newStep = (v = DEFAULT_VEL) => ({ v, p: 1, c: 0, n: 0, r: 1, l: null });

export function newPatternTrack(len = 16, speed = 1) {
  return { len, speed, steps: new Array(MAX_STEPS).fill(null) };
}

export function newPattern(bars = 1) {
  return { bars, tracks: VOICES.map(() => newPatternTrack(16 * bars)) };
}

/** Normalised param dict from a voice preset (real units). */
export function presetNorms(vi, pi) {
  const v = VOICES[vi], pr = v.presets[pi];
  const out = {};
  for (const p of v.params) out[p.id] = norm(p, pr && pr.p[p.id] !== undefined ? pr.p[p.id] : p.def);
  return out;
}

export function newTrack(i) {
  return {
    params: presetNorms(i, 0),
    preset: 0,
    mix: { vol: 0.8, pan: 0, dly: 0, rev: 0, flt: 0, crush: 0, mute: false, solo: false },
    gen: { dv: 0, mut: 0, pulses: 4, rot: 0, seed: (Math.random() * 1e9) | 0 },
  };
}

export function newProject() {
  return {
    version: 1,
    name: 'UNTITLED',
    bpm: 124,
    swing: 50,
    macros: { depth: 0.5, entropy: 0, space: 0.35, mood: 0.5 },
    master: { duck: 0.45, drive: 0.25, volume: 0.85 },
    fx: { delay: { div: 5, feedback: 0.38, tone: 0.45, ping: 0.75 }, reverb: { size: 0.35, damp: 0.6 } },
    tracks: VOICES.map((_, i) => newTrack(i)),
    patterns: [newPattern(), newPattern(), newPattern(), newPattern()],
    cur: 0,
    chain: [0],
    chainOn: false,
    visual: { scene: 0, reactivity: 0.75, auto: false, params: [[0.0, 0.6, 0.5], [0.6, 0.55, 0.5], [0.85, 0.5, 0.15], [0.5, 0.35, 0.6], [0.0, 0.45, 0.4]] },
  };
}

/** Compact JSON: only active steps are stored as [index, v, p, c, n, r, locks?]. */
export function serialize(p) {
  const o = deepClone(p);
  o.patterns = p.patterns.map((pat) => ({
    bars: pat.bars,
    tracks: pat.tracks.map((t) => ({
      len: t.len, speed: t.speed,
      steps: t.steps.map((s, i) => (s ? [i, +s.v.toFixed(3), +s.p.toFixed(3), s.c, +s.n.toFixed(3), s.r, s.l || 0] : null)).filter(Boolean),
    })),
  }));
  return o;
}

export function deserialize(o) {
  const base = newProject();
  if (!o || typeof o !== 'object') return base;
  const p = { ...base, ...o };
  p.macros = { ...base.macros, ...(o.macros || {}) };
  p.master = { ...base.master, ...(o.master || {}) };
  p.fx = { delay: { ...base.fx.delay, ...(o.fx?.delay || {}) }, reverb: { ...base.fx.reverb, ...(o.fx?.reverb || {}) } };
  p.visual = { ...base.visual, ...(o.visual || {}) };
  if (!Array.isArray(p.visual.params) || p.visual.params.length < 5) p.visual.params = base.visual.params;
  p.tracks = VOICES.map((v, i) => {
    const t = (o.tracks && o.tracks[i]) || {};
    const d = newTrack(i);
    return {
      params: { ...d.params, ...(t.params || {}) },
      preset: t.preset ?? 0,
      mix: { ...d.mix, ...(t.mix || {}) },
      gen: { ...d.gen, ...(t.gen || {}) },
    };
  });
  p.patterns = [0, 1, 2, 3].map((k) => {
    const src = o.patterns && o.patterns[k];
    const pat = newPattern(src?.bars || 1);
    if (src) {
      pat.tracks.forEach((tr, i) => {
        const st = src.tracks && src.tracks[i];
        if (!st) return;
        tr.len = Math.max(1, Math.min(MAX_STEPS, st.len || 16));
        tr.speed = SPEEDS.includes(st.speed) ? st.speed : 1;
        for (const e of st.steps || []) {
          if (Array.isArray(e)) {
            const [idx, v, pr, c, n, r, l] = e;
            if (idx >= 0 && idx < MAX_STEPS) tr.steps[idx] = { v, p: pr, c, n, r, l: l || null };
          } else if (e && typeof e === 'object' && e.i !== undefined) {
            tr.steps[e.i] = { ...newStep(), ...e };
          }
        }
      });
    }
    return pat;
  });
  p.cur = Math.max(0, Math.min(3, p.cur | 0));
  if (!Array.isArray(p.chain) || !p.chain.length) p.chain = [p.cur];
  return p;
}

/** Total bars in a chain (max 16). */
export const chainBars = (p) => p.chain.reduce((a, k) => a + p.patterns[k].bars, 0);
