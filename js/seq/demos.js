// UNIT — curated demo projects. Built from compact step strings so they stay readable.
//   '.' off   'x' 0.85   'X' 1.0   'o' 0.55   'q' 0.32
// Per-step extras: { stepIndex: { p: prob, c: 'COND', n: nudge, r: ratchet, l: { param: realValue } } }

import { newProject, newPattern, newStep, CONDS, presetNorms } from './model.js';
import { euclid } from './generators.js';
import { VOICES } from '../audio/voices.js';
import { norm } from '../core/util.js';

const VEL = { x: 0.85, X: 1, o: 0.55, q: 0.32 };
const T = { kick: 0, sub: 1, click: 2, hat: 3, noise: 4, tone: 5, data: 6, drone: 7 };

function realLock(vi, id, v) {
  const p = VOICES[vi].params.find((q) => q.id === id);
  return p ? norm(p, v) : v; // mix locks are already normalised
}

/** Fill one pattern track. */
function seq(pat, name, str, opt = {}) {
  const vi = T[name], tr = pat.tracks[vi];
  if (opt.len) tr.len = opt.len; else tr.len = str.length;
  if (opt.speed) tr.speed = opt.speed;
  tr.steps.fill(null);
  [...str].forEach((ch, i) => { if (VEL[ch]) tr.steps[i] = { ...newStep(VEL[ch]) }; });
  if (opt.euclid) {
    const [k, rot] = opt.euclid;
    euclid(tr.len, k, rot || 0).forEach((on, i) => { tr.steps[i] = on ? newStep(i === 0 ? 1 : 0.8) : null; });
  }
  for (const [k, e] of Object.entries(opt.steps || {})) {
    const i = +k;
    if (!tr.steps[i]) tr.steps[i] = newStep();
    const s = tr.steps[i];
    if (e.v !== undefined) s.v = e.v;
    if (e.p !== undefined) s.p = e.p;
    if (e.c) s.c = CONDS.indexOf(e.c);
    if (e.n !== undefined) s.n = e.n;
    if (e.r) s.r = e.r;
    if (e.l) { s.l = {}; for (const [pid, v] of Object.entries(e.l)) s.l[pid] = realLock(vi, pid, v); }
  }
}

function sound(p, name, preset, mix = {}, gen = {}, tweak = {}) {
  const vi = T[name], tr = p.tracks[vi];
  tr.preset = preset;
  tr.params = presetNorms(vi, preset);
  for (const [k, v] of Object.entries(tweak)) {
    const pp = VOICES[vi].params.find((q) => q.id === k);
    if (pp) tr.params[k] = norm(pp, v);
  }
  Object.assign(tr.mix, mix);
  Object.assign(tr.gen, gen);
}

function base(name, bpm, extra = {}) {
  const p = newProject();
  p.name = name; p.bpm = bpm;
  Object.assign(p, extra);
  return p;
}

// ---------------------------------------------------------------------------------------
function strict() {
  const p = base('STRICT 4/4', 126, { swing: 53 });
  p.macros = { depth: 0.55, entropy: 0, space: 0.32, mood: 0.45 };
  p.master.duck = 0.5;
  sound(p, 'kick', 0, { vol: 0.82 });
  sound(p, 'sub', 1, { vol: 0.74 }, {}, { pitch: 31, decay: 0.22 });
  sound(p, 'click', 1, { vol: 0.62, rev: 0.32, pan: -0.15 });
  sound(p, 'hat', 0, { vol: 0.62, pan: 0.2, dly: 0.12 }, { dv: 0.85, seed: 4417 });
  sound(p, 'noise', 0, { vol: 0.58, rev: 0.25, flt: 0.12 });
  sound(p, 'tone', 1, { vol: 0.56, dly: 0.55, pan: 0.3 }, { dv: 1, seed: 90210 });
  sound(p, 'data', 0, { vol: 0.56, dly: 0.35, pan: -0.35 }, { dv: 0.9, seed: 1312 });
  sound(p, 'drone', 0, { vol: 0.62, rev: 0.2 });
  const A = p.patterns[0];
  seq(A, 'kick', 'X...x...x...x...');
  seq(A, 'sub', '..x...x...x...x.', { steps: { 14: { l: { pitch: 34 }, c: '2:2' } } });
  seq(A, 'click', '....x.......x..o', { steps: { 15: { p: 0.5 }, 12: { r: 1 } } });
  seq(A, 'hat', 'q.x.q.x.q.x.q.xq', { steps: { 0: { p: 0.6 }, 4: { p: 0.6 }, 8: { p: 0.6 }, 12: { p: 0.6 }, 15: { p: 0.4, r: 2 } } });
  seq(A, 'noise', '...............x', { steps: { 15: { c: '2:2' } } });
  seq(A, 'tone', '...x.......x....', { steps: { 3: { p: 0.65 }, 11: { p: 0.5, l: { pitch: 64 } } } });
  seq(A, 'data', '.......x.....x..', { steps: { 7: { c: '1:4', r: 2 }, 13: { c: '3:4' } } });
  seq(A, 'drone', 'x...............', { speed: 0.25, len: 16 });
  // B: same groove, kick drops out, clicks densify, fill-only extras
  const B = p.patterns[1];
  B.tracks = JSON.parse(JSON.stringify(A.tracks));
  seq(B, 'kick', 'X...x...x...x.x.', { steps: { 14: { c: 'FILL' } } });
  seq(B, 'click', '..o.x..o..o.x.oo', { steps: { 14: { r: 3 }, 15: { r: 4, c: 'FILL' } } });
  seq(B, 'data', '...x...x...x..x.', { steps: { 14: { r: 3, p: 0.7 } } });
  p.chain = [0, 0, 0, 1];
  p.chainOn = true;
  p.visual.scene = 0;
  return p;
}

function polymeter() {
  const p = base('POLYMETER HYPNOSIS', 118, { swing: 50 });
  p.macros = { depth: 0.6, entropy: 0.05, space: 0.42, mood: 0.55 };
  sound(p, 'kick', 1, { vol: 0.78 });
  sound(p, 'sub', 0, { vol: 0.7 }, {}, { decay: 0.45 });
  sound(p, 'click', 0, { vol: 0.6, rev: 0.25, pan: -0.25 });
  sound(p, 'hat', 2, { vol: 0.56, pan: 0.3, dly: 0.2 }, { dv: 0.8, mut: 0.15, seed: 777 });
  sound(p, 'noise', 1, { vol: 0.63 });
  sound(p, 'tone', 0, { vol: 0.54, dly: 0.5, pan: 0.15 }, { dv: 0.95, mut: 0.2, seed: 31337 });
  sound(p, 'data', 3, { vol: 0.48, pan: -0.4, dly: 0.3 }, { dv: 1, seed: 5150 });
  sound(p, 'drone', 4, { vol: 0.6, rev: 0.25 });
  const A = p.patterns[0];
  A.bars = 4;
  seq(A, 'kick', 'X...x...x...x...');
  seq(A, 'sub', '', { len: 15, euclid: [5, 1] });
  seq(A, 'click', '', { len: 13, euclid: [5, 2] });
  seq(A, 'hat', '', { len: 12, speed: 2, euclid: [7, 1] });
  seq(A, 'noise', '', { len: 9, euclid: [1, 6] });
  seq(A, 'tone', '', { len: 7, euclid: [3, 0], steps: { 0: { l: { pitch: 55 } }, 2: { l: { pitch: 62 } } } });
  seq(A, 'data', '', { len: 11, euclid: [2, 3], steps: { 3: { c: '1:2' } } });
  seq(A, 'drone', 'x...............', { speed: 0.25 });
  p.visual.scene = 3;
  return p;
}

function droneClicks() {
  const p = base('DRONE + CLICKS', 92, { swing: 50 });
  p.macros = { depth: 0.6, entropy: 0.08, space: 0.58, mood: 0.35 };
  p.fx.delay = { div: 7, feedback: 0.5, tone: 0.35, ping: 0.9 };
  p.fx.reverb = { size: 0.5, damp: 0.7 };
  p.master.duck = 0.25;
  sound(p, 'kick', 2, { vol: 0.7 });
  sound(p, 'sub', 4, { vol: 0.66 });
  sound(p, 'click', 0, { vol: 0.66, rev: 0.4, pan: 0.1 }, { dv: 0.75, mut: 0.12, seed: 2024 });
  sound(p, 'hat', 4, { vol: 0.48, pan: -0.3 }, { dv: 0.6, seed: 61 });
  sound(p, 'noise', 1, { vol: 0.58, rev: 0.3 });
  sound(p, 'tone', 1, { vol: 0.56, dly: 0.62, pan: -0.2 }, { dv: 0.7, seed: 1001 });
  sound(p, 'data', 3, { vol: 0.42, dly: 0.4, pan: 0.45 }, { dv: 0.5, seed: 4040 });
  sound(p, 'drone', 1, { vol: 0.78, rev: 0.35 });
  const A = p.patterns[0];
  A.bars = 2;
  seq(A, 'kick', 'x...............................', { steps: { 0: { v: 0.7 }, 22: { v: 0.5, p: 0.5 } } });
  seq(A, 'sub', 'x...............x...............', { steps: { 16: { l: { pitch: 26 } } } });
  seq(A, 'click', 'x..o..x...o.x.....x..o.x...o..x.', { steps: { 6: { r: 3 }, 12: { n: 0.25 }, 18: { r: 4, p: 0.7 }, 27: { n: -0.2 }, 30: { r: 2 } } });
  seq(A, 'hat', '', { len: 32, euclid: [7, 3] });
  seq(A, 'noise', '............x...................', { steps: { 12: { c: '1:2' } } });
  seq(A, 'tone', '.....x...........x.......x......', { steps: { 5: { p: 0.6 }, 17: { p: 0.5, l: { pitch: 76 } }, 25: { p: 0.4 } } });
  seq(A, 'data', '..........x.................x...', { steps: { 10: { p: 0.5 }, 28: { r: 2, p: 0.6 } } });
  seq(A, 'drone', 'x.......', { speed: 0.25, len: 8, steps: { 4: { l: { pitch: 31 } } } });
  p.visual.scene = 2;
  return p;
}

function broken() {
  const p = base('BROKEN EXPERIMENTAL', 136, { swing: 57 });
  p.macros = { depth: 0.5, entropy: 0.3, space: 0.3, mood: 0.65 };
  sound(p, 'kick', 1, { vol: 0.8 }, { dv: 0.7, seed: 99 });
  sound(p, 'sub', 3, { vol: 0.7 });
  sound(p, 'click', 4, { vol: 0.58, rev: 0.2, pan: 0.25 }, { dv: 0.6, mut: 0.3, seed: 808 });
  sound(p, 'hat', 1, { vol: 0.52, pan: -0.25, dly: 0.15 }, { dv: 0.5, mut: 0.25, seed: 4 });
  sound(p, 'noise', 3, { vol: 0.56, crush: 0.2 }, { dv: 0.7, seed: 23 });
  sound(p, 'tone', 3, { vol: 0.54, dly: 0.45 }, { dv: 0.8, mut: 0.2, seed: 12 });
  sound(p, 'data', 1, { vol: 0.5, pan: 0.4, dly: 0.3 }, { dv: 0.5, mut: 0.4, seed: 5 });
  sound(p, 'drone', 2, { vol: 0.5, rev: 0.2 });
  const A = p.patterns[0];
  seq(A, 'kick', 'X..x....x.x...x.', { steps: { 3: { n: 0.18 }, 10: { p: 0.75 }, 14: { c: '!1ST' } } });
  seq(A, 'sub', 'x...x.x...x...x.', { steps: { 4: { l: { pitch: 34 } }, 6: { l: { pitch: 29 } }, 10: { l: { pitch: 36 }, c: '1:2' } } });
  seq(A, 'click', '', { len: 16, euclid: [7, 2], steps: { 4: { r: 3 }, 11: { r: 2, n: -0.2 } } });
  seq(A, 'hat', '', { len: 14, speed: 2, euclid: [9, 1] });
  seq(A, 'noise', '...x.....x....x.', { steps: { 3: { p: 0.6 }, 9: { p: 0.6 }, 14: { c: '1:2' } } });
  seq(A, 'tone', '', { len: 10, euclid: [3, 1] });
  seq(A, 'data', '', { len: 12, euclid: [5, 2] });
  seq(A, 'drone', 'x...', { speed: 0.25, len: 4 });
  p.visual.scene = 4;
  return p;
}

function pulseData() {
  const p = base('PULSE / DATA', 128, { swing: 50 });
  p.macros = { depth: 0.62, entropy: 0, space: 0.28, mood: 0.6 };
  p.master.duck = 0.55;
  sound(p, 'kick', 4, { vol: 0.8 });
  sound(p, 'sub', 0, { vol: 0.72 }, {}, { decay: 0.35, pitch: 33 });
  sound(p, 'click', 0, { vol: 0.6, pan: 0.15 }, { dv: 1, seed: 11 });
  sound(p, 'hat', 2, { vol: 0.52, pan: -0.2 });
  sound(p, 'noise', 2, { vol: 0.48, rev: 0.2 });
  sound(p, 'tone', 1, { vol: 0.52, dly: 0.35, pan: 0.35 }, { dv: 0.7, seed: 3 });
  sound(p, 'data', 0, { vol: 0.52, pan: -0.3, dly: 0.25 }, { dv: 1, seed: 7 });
  sound(p, 'drone', 2, { vol: 0.42 });
  const A = p.patterns[0];
  seq(A, 'kick', 'X...x...x...x...', { steps: { 12: { l: { pitch: 40 } } } });
  seq(A, 'sub', '..x...x...x...x.');
  seq(A, 'click', 'xoxoxoxoxoxoxoxo', { steps: Object.fromEntries([1, 3, 5, 7, 9, 11, 13, 15].map((i) => [i, { p: 0.55 }])) });
  seq(A, 'hat', '..x...x...x...x.');
  seq(A, 'noise', '....x.......x...', { steps: { 4: { p: 0.3 }, 12: { p: 0.3 } } });
  seq(A, 'tone', 'x..', { len: 3, steps: { 0: { p: 0.7 } } });
  seq(A, 'data', 'xxxxxxxxxxxxxxxx', { steps: Object.fromEntries([...Array(16)].map((_, i) => [i, { p: 0.28 }])) });
  seq(A, 'drone', 'x...', { speed: 0.25, len: 4 });
  p.visual.scene = 1;
  return p;
}

export const DEMOS = [
  { name: 'STRICT 4/4', make: strict },
  { name: 'POLYMETER HYPNOSIS', make: polymeter },
  { name: 'DRONE + CLICKS', make: droneClicks },
  { name: 'BROKEN EXPERIMENTAL', make: broken },
  { name: 'PULSE / DATA', make: pulseData },
];

export { newPattern };
