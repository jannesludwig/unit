// UNIT — the sequencer.
//
// Clock: Tone.Transport.scheduleRepeat at 32nd notes. Tone runs a worker-driven lookahead
// clock against the AudioContext clock, so there is no drift; every callback receives the exact
// audio time of its tick. We process one tick *ahead* (LOOK) so negative micro-timing still
// lands in the future.
//
// Per track: own length (1–64), speed (¼×–2×), loop counter (for A:B conditions), PRE result,
// and a DÉJÀ VU random memory (8 slots per step). Every random decision reads from that memory;
// each slot is refreshed with probability (1 − DV) right before a step uses it.

import { VOICES } from '../audio/voices.js';
import { MIX_LOCKABLE } from '../audio/engine.js';
import { CONDS, MAX_STEPS } from './model.js';
import { clamp, rng, hash01 } from '../core/util.js';

const SLOTS = 8;            // random slots per step
const S_PROB = 0, S_MUT = 1, S_VEL = 2, S_TIME = 3, S_PARAM = 4, S_SEED = 6, S_RATCH = 7;
const LOOK = 1;             // ticks processed ahead
const TPS = { 0.25: 8, 0.5: 4, 1: 2, 2: 1 }; // 32nd ticks per step for each speed

export class Sequencer {
  constructor(engine, getProject, hooks = {}) {
    this.engine = engine;
    this.getProject = getProject;
    this.hooks = hooks;          // onStep(time, pos), onHit(ev), onPattern(time, idx), onBar(time, info)
    this.playing = false;
    this.fill = false;
    this.queued = null;
    this.avOffset = 0;           // extra seconds added to visual/UI callbacks (latency comp.)
    this.rt = VOICES.map(() => ({ step: -1, loop: 0, tick0: 0, pre: true, mem: new Float32Array(MAX_STEPS * SLOTS), seed: 0 }));
    this.pos = VOICES.map(() => -1);
  }

  get project() { return this.getProject(); }
  get Tone() { return window.Tone; }

  /** (Re)seed a track's random memory from its stored seed. */
  seedTrack(i) {
    const p = this.project, rt = this.rt[i];
    rt.seed = p.tracks[i].gen.seed;
    const r = rng(rt.seed);
    for (let k = 0; k < rt.mem.length; k++) rt.mem[k] = r();
  }
  seedAll() { this.rt.forEach((_, i) => this.seedTrack(i)); }

  reroll(i) {
    this.project.tracks[i].gen.seed = (Math.random() * 1e9) | 0;
    this.seedTrack(i);
  }

  tickDur() { return 60 / this.project.bpm / 8; }

  start() {
    if (this.playing || !this.engine.ready) return;
    const T = this.Tone.getTransport();
    T.cancel(0);
    T.stop();
    T.position = 0;
    T.bpm.value = this.project.bpm;
    this.reset();
    this.first = true;
    this.G = 0;
    this.repeatId = T.scheduleRepeat((time) => this.onClock(time), '32n', 0);
    T.start('+0.05');
    this.playing = true;
    this.hooks.onTransport?.(true);
  }

  stop() {
    if (!this.playing) return;
    const T = this.Tone.getTransport();
    T.stop();
    T.clear(this.repeatId);
    T.cancel(0);
    this.Tone.getDraw().cancel(0);
    this.playing = false;
    this.engine.hush(0.06);
    this.reset();
    this.hooks.onTransport?.(false);
    this.hooks.onStep?.(-1, this.pos.map(() => -1));
  }

  toggle() { this.playing ? this.stop() : this.start(); }

  reset() {
    const p = this.project;
    this.patTick0 = 0;
    this.chainPos = Math.max(0, p.chain.indexOf(p.cur));
    this.patLoop = 0;
    this.rt.forEach((r) => { r.step = -1; r.loop = 0; r.tick0 = 0; r.pre = true; });
    this.pos.fill(-1);
  }

  setTempo(bpm) {
    this.project.bpm = bpm;
    if (this.Tone) this.Tone.getTransport().bpm.value = bpm;
    this.engine.setTempo(bpm);
  }

  /** Pattern selection: immediate when stopped, queued to the pattern end while playing. */
  selectPattern(k) {
    const p = this.project;
    if (!this.playing) { p.cur = k; this.queued = null; this.hooks.onPattern?.(null, k); return; }
    this.queued = k === p.cur ? null : k;
    this.hooks.onQueue?.(this.queued);
  }

  onClock(time) {
    const td = this.tickDur();
    if (this.first) { this.first = false; this.process(0, time); }
    this.G++;
    this.process(this.G - 1 + LOOK, time + LOOK * td);
  }

  /** Process global 32nd tick G whose nominal (unswung) time is t. */
  process(G, t) {
    const p = this.project;
    let pat = p.patterns[p.cur];
    // ---- pattern boundary: queue / chain advance ----
    if (G > 0 && G - this.patTick0 >= pat.bars * 32) {
      let next = p.cur;
      if (this.queued !== null) {
        next = this.queued; this.queued = null;
        if (p.chainOn) { const ci = p.chain.indexOf(next); if (ci >= 0) this.chainPos = ci; }
      } else if (p.chainOn && p.chain.length) {
        this.chainPos = (this.chainPos + 1) % p.chain.length;
        next = p.chain[this.chainPos];
      }
      this.patTick0 = G;
      this.patLoop++;
      if (next !== p.cur) {
        p.cur = next; pat = p.patterns[next];
        this.patLoop = 0;
        this.rt.forEach((r) => { r.step = -1; r.loop = 0; r.tick0 = G; r.pre = true; });
        this.schedule(t, () => this.hooks.onPattern?.(t, next));
      }
    }
    const rel = G - this.patTick0;
    if (rel % 8 === 0) {
      const info = { bar: Math.floor(rel / 32), beat: (rel / 8) % 4, pattern: p.cur, patLoop: this.patLoop, G };
      this.hooks.onBeat?.(t, info);
      this.schedule(t, () => this.hooks.onBeatDraw?.(info));
    }

    // ---- tracks ----
    const td = this.tickDur();
    let moved = false;
    for (let i = 0; i < 8; i++) {
      const tr = pat.tracks[i], rt = this.rt[i];
      const tps = TPS[tr.speed] || 2;
      if ((G - rt.tick0) % tps !== 0) continue;
      let s = rt.step + 1;
      if (s >= tr.len) { s = 0; rt.loop++; }
      rt.step = s; this.pos[i] = s; moved = true;
      this.playStep(i, tr, s, t, tps * td);
    }
    if (moved) {
      const snap = this.pos.slice();
      this.schedule(t, () => this.hooks.onStep?.(t, snap));
    }
  }

  schedule(t, fn) { this.Tone.getDraw().schedule(fn, t + this.avOffset); }

  evalCond(c, rt) {
    const name = CONDS[c];
    switch (name) {
      case 'FILL': return this.fill;
      case '!FILL': return !this.fill;
      case '1ST': return rt.loop === 0;
      case '!1ST': return rt.loop > 0;
      case 'PRE': return rt.pre;
      case '!PRE': return !rt.pre;
      default: {
        const [a, b] = name.split(':').map(Number);
        return rt.loop % b === a - 1;
      }
    }
  }

  playStep(i, tr, s, t, stepDur) {
    const p = this.project, track = p.tracks[i], gen = track.gen, rt = this.rt[i];
    const st = tr.steps[s];
    const voice = VOICES[i];
    // DÉJÀ VU: refresh this step's random slots with probability (1 − dv)
    const mem = rt.mem, base = s * SLOTS, dv = clamp(gen.dv);
    if (dv < 1) for (let k = 0; k < SLOTS; k++) if (Math.random() >= dv) mem[base + k] = Math.random();
    const R = (k) => mem[base + k];

    const ent = p.macros.entropy;
    const mut = clamp(gen.mut + ent * 0.45);
    let on = !!st, vel = st ? st.v : 0, ghost = false;
    if (st) {
      if (st.c) {
        const res = this.evalCond(st.c, rt);
        const nm = CONDS[st.c];
        if (nm !== 'PRE' && nm !== '!PRE') rt.pre = res;
        if (!res) on = false;
      }
      if (on && st.p < 1 && R(S_PROB) >= st.p) on = false;
      if (on && mut > 0 && R(S_MUT) < mut * 0.28) on = false;
      if (on && mut > 0) vel *= 1 - mut * 0.45 * R(S_VEL);
    } else if (mut > 0 && voice.id !== 'drone' && R(S_MUT) > 1 - mut * 0.11) {
      on = true; ghost = true; vel = 0.3 + R(S_VEL) * 0.35;
    }
    if (!on || vel <= 0.001) return;

    // timing: swing on odd steps, micro-timing nudge (fraction of a 16th), ENTROPY jitter
    const swing = (clamp(p.swing, 50, 75) / 100) * 2 - 1;
    let time = t + (s % 2 === 1 ? swing * stepDur : 0);
    const nudge = (st ? st.n : 0) + (R(S_TIME) - 0.5) * ent * 0.3;
    time += nudge * this.tickDur() * 2;
    time = Math.max(time, this.engine.now + 0.002);

    // params: base → locks → ENTROPY jitter
    const norms = { ...track.params };
    const mix = {};
    for (const k of MIX_LOCKABLE) mix[k] = track.mix[k];
    if (st && st.l) {
      for (const k in st.l) {
        if (k in norms) norms[k] = st.l[k];
        else if (k in mix) mix[k] = st.l[k];
      }
    }
    if (ent > 0) {
      const r = R(S_PARAM);
      voice.params.forEach((pp, j) => {
        const w = voice.entropy[pp.id];
        if (w) norms[pp.id] = clamp(norms[pp.id] + (hash01(r, j) - 0.5) * 2 * ent * w);
      });
    }

    let ratchet = st ? st.r : 1;
    if (mut > 0.2 && voice.id !== 'drone' && voice.id !== 'sub' && R(S_RATCH) < (mut - 0.2) * 0.14) ratchet = 2 + ((R(S_RATCH) * 97) | 0) % 2;
    const seed = R(S_SEED);
    for (let k = 0; k < ratchet; k++) {
      const tt = time + (k * stepDur) / ratchet;
      const vv = k === 0 ? vel : vel * (0.9 - 0.08 * k);
      const h = this.engine.trigger(i, tt, vv, norms, mix, (seed + k * 0.1371) % 1);
      const ev = { track: i, step: s, vel: vv, time: tt, freq: h.freq || 0, ghost, ratchet: k, norms };
      this.hooks.onHit?.(ev);
      this.schedule(tt, () => this.hooks.onHitDraw?.(ev));
    }
  }
}
