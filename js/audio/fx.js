// UNIT — global effects: tempo-synced filtered ping-pong DELAY and a small dark REVERB.

import { clamp, rng } from '../core/util.js';

export const DELAY_DIVS = [
  ['1/32', 0.125], ['1/16T', 1 / 6], ['1/16', 0.25], ['1/8T', 1 / 3], ['1/16D', 0.375],
  ['1/8', 0.5], ['1/4T', 2 / 3], ['1/8D', 0.75], ['1/4', 1], ['1/4D', 1.5], ['1/2', 2],
];

/**
 * Ping-pong delay with LP + HP filters inside the feedback path (dub-style, keeps lows out).
 * ping 0 = mono echo (both sides), 1 = full alternation L→R→L.
 */
export class Delay {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.channelCount = 1; this.input.channelCountMode = 'explicit';
    this.dL = ctx.createDelay(4); this.dR = ctx.createDelay(4);
    this.toR = ctx.createGain();
    const mk = () => {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.5;
      const fb = ctx.createGain();
      lp.connect(hp).connect(fb);
      return { lp, hp, fb };
    };
    this.a = mk(); this.b = mk();
    this.input.connect(this.dL);
    this.input.connect(this.toR).connect(this.dR);
    this.dL.connect(this.a.lp); this.a.fb.connect(this.dR);
    this.dR.connect(this.b.lp); this.b.fb.connect(this.dL);
    // the first echo is filtered as well, so the delay never sounds brighter than the source
    this.merge = ctx.createChannelMerger(2);
    this.a.hp.connect(this.merge, 0, 0);
    this.b.hp.connect(this.merge, 0, 1);
    this.output = ctx.createGain();
    this.merge.connect(this.output);
    this.set({ div: 5, feedback: 0.35, tone: 0.5, ping: 0.7 }, 120);
  }
  set(p, bpm) {
    const t = this.ctx.currentTime;
    this.p = { ...this.p, ...p };
    const beats = DELAY_DIVS[clamp(this.p.div | 0, 0, DELAY_DIVS.length - 1)][1];
    const sec = clamp((beats * 60) / bpm, 0.01, 3.9);
    this.dL.delayTime.setTargetAtTime(sec, t, 0.03);
    this.dR.delayTime.setTargetAtTime(sec, t, 0.03);
    const fb = clamp(this.p.feedback + (this.fbAdd || 0), 0, 0.93);
    this.a.fb.gain.setTargetAtTime(fb, t, 0.02);
    this.b.fb.gain.setTargetAtTime(fb, t, 0.02);
    const cut = 500 * Math.pow(24, clamp(this.p.tone));
    this.a.lp.frequency.setTargetAtTime(cut, t, 0.02);
    this.b.lp.frequency.setTargetAtTime(cut, t, 0.02);
    this.toR.gain.setTargetAtTime(1 - clamp(this.p.ping), t, 0.02);
  }
}

/** Generate a stereo, progressively darkening IR (noise × exp decay × time-varying one-pole LP). */
function makeIR(ctx, size, damp, seed = 1) {
  const sr = ctx.sampleRate, N = Math.max(1, Math.floor(size * sr));
  const buf = ctx.createBuffer(2, N, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c), r = rng(seed * 7 + c * 1013);
    const fc0 = 9000 * (1 - damp * 0.65), dr = 0.8 + damp * 5;
    let y = 0, e2 = 0;
    for (let n = 0; n < N; n++) {
      const t = n / sr;
      const fc = Math.max(180, fc0 * Math.exp(-t * dr));
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      y = (1 - a) * (r() * 2 - 1) + a * y;
      // gentle fade-in avoids a hard onset; exponential tail to -60 dB at `size`
      const env = Math.exp((-6.9 * t) / size) * Math.min(1, t / 0.004);
      d[n] = y * env;
    }
    // sparse early reflections (5–40 ms)
    for (let k = 0; k < 7; k++) {
      const at = Math.floor((0.005 + r() * 0.035) * sr);
      if (at < N) d[at] += (r() < 0.5 ? -1 : 1) * 0.25 * (1 - k / 8);
    }
    for (let n = 0; n < N; n++) e2 += d[n] * d[n];
    const g = 0.6 / Math.sqrt(e2 + 1e-9);
    for (let n = 0; n < N; n++) d[n] *= g;
  }
  return buf;
}

/** Small, dark convolution space with high-passed input and damped tail. */
export class Reverb {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 280; this.hp.Q.value = 0.5;
    this.pre = ctx.createDelay(0.2); this.pre.delayTime.value = 0.012;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 5000; this.lp.Q.value = 0.4;
    this.output = ctx.createGain();
    this.input.connect(this.hp).connect(this.pre);
    this.lp.connect(this.output);
    this.conv = null; this.p = { size: 0.35, damp: 0.6 }; this.sizeMul = 1;
    this._gen = 0;
    this.rebuild();
  }
  set(p) {
    const prev = { ...this.p };
    this.p = { ...this.p, ...p };
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(1500 + (1 - this.p.damp) * 7000 * (this.moodMul || 1), t, 0.05);
    if (prev.size !== this.p.size || prev.damp !== this.p.damp) this.scheduleRebuild();
  }
  setSizeMul(m) { if (Math.abs(m - this.sizeMul) > 0.04) { this.sizeMul = m; this.scheduleRebuild(); } }
  scheduleRebuild() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.rebuild(), 120);
  }
  /** Swap in a freshly generated IR with a short crossfade (no clicks). */
  rebuild() {
    const ctx = this.ctx, t = ctx.currentTime;
    const seconds = 0.25 + Math.pow(this.p.size, 1.5) * 4.5 * this.sizeMul;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = makeIR(ctx, seconds, this.p.damp, ++this._gen);
    const g = ctx.createGain(); g.gain.value = 0;
    this.pre.connect(conv); conv.connect(g).connect(this.lp);
    g.gain.setTargetAtTime(1, t, 0.04);
    if (this.conv) {
      const old = this.conv;
      old.g.gain.setTargetAtTime(0, t, 0.04);
      setTimeout(() => { try { this.pre.disconnect(old.conv); old.conv.disconnect(); old.g.disconnect(); } catch (e) { /* noop */ } }, 600);
    }
    this.conv = { conv, g };
  }
}
