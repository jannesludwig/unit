// UNIT — audio engine: context, 8 channel strips, FX sends, master bus.
//
// Signal flow
//   voice hit → strip.input → HP/LP (DJ filter) → crusher (worklet) → pan → fader → mute ┬→ bus
//                                                                                        ├→ DELAY send
//                                                                                        └→ REVERB send
//   bus: KICK goes straight to SUM; every other track and both FX returns go through DUCK
//   (event-driven sidechain: the gain dips exactly at each KICK hit).
//   SUM → low/high shelves (DEPTH / MOOD) → LR4 crossover @120 Hz (lows summed to mono)
//       → tanh saturation → limiter → OUT → speakers, analysers, recorder, video stream.
//
// Tone.js provides the clock (Transport), lookahead scheduling and Draw; the DSP graph runs on
// the same native AudioContext handed to Tone, so Tone and raw Web Audio nodes interoperate.

import { clamp, denorm, dbToGain } from '../core/util.js';
import { VOICES } from './voices.js';
import { Delay, Reverb } from './fx.js';
import { workletURL } from './worklets.js';
import { softClipCurve } from './dsp.js';

export const MIX_LOCKABLE = ['pan', 'dly', 'rev', 'flt', 'crush'];

const faderGain = (v) => (v <= 0.001 ? 0 : Math.pow(v / 0.8, 2.5));

class Strip {
  constructor(engine, index) {
    const ctx = engine.ctx;
    this.ctx = ctx; this.index = index;
    this.input = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 10; this.hp.Q.value = 0.8;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000; this.lp.Q.value = 0.8;
    this.crusher = engine.hasWorklet
      ? new AudioWorkletNode(ctx, 'unit-crusher', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
      : ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.mute = ctx.createGain();
    this.sendD = ctx.createGain(); this.sendD.gain.value = 0;
    this.sendR = ctx.createGain(); this.sendR.gain.value = 0;
    this.input.connect(this.hp).connect(this.lp).connect(this.crusher).connect(this.pan).connect(this.fader).connect(this.mute);
    this.mute.connect(this.sendD); this.mute.connect(this.sendR);
    this.cur = {}; // last value scheduled per lockable param (avoids redundant automation)
  }
  /** Schedule a mix parameter at time t (used for base values and per-step locks). */
  setParam(key, v, t, tc = 0.003) {
    if (this.cur[key] === v) return;
    this.cur[key] = v;
    const ctx = this.ctx; t = Math.max(t, ctx.currentTime);
    switch (key) {
      case 'vol': this.fader.gain.setTargetAtTime(faderGain(v), t, 0.01); break;
      case 'pan': this.pan.pan.setTargetAtTime(clamp(v, -1, 1), t, tc); break;
      case 'dly': this.sendD.gain.setTargetAtTime(v * v, t, tc); break;
      case 'rev': this.sendR.gain.setTargetAtTime(v * v, t, tc); break;
      case 'flt': {
        // bipolar DJ filter: <0 low-pass sweep, >0 high-pass sweep, centre = transparent
        const a = Math.abs(v);
        const lpF = v < -0.02 ? 20000 * Math.pow(2, -a * 9) : 22000;
        const hpF = v > 0.02 ? 10 * Math.pow(2, a * 9.6) : 10;
        this.lp.frequency.setTargetAtTime(lpF, t, tc);
        this.hp.frequency.setTargetAtTime(hpF, t, tc);
        break;
      }
      case 'crush': {
        if (!this.crusher.parameters) break;
        const bits = v < 0.01 ? 16 : 16 - v * 13;
        const ratio = v < 0.01 ? 1 : Math.max(0.02, Math.pow(1 - v, 2.2));
        this.crusher.parameters.get('bits').setValueAtTime(bits, t);
        this.crusher.parameters.get('ratio').setValueAtTime(ratio, t);
        break;
      }
    }
  }
  setMuted(m, t) { this.mute.gain.setTargetAtTime(m ? 0 : 1, t, 0.006); }
}

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.voiceState = VOICES.map(() => ({ voice: null, lastFreq: 0 }));
    this.macros = { depth: 0.5, entropy: 0, space: 0.35, mood: 0.5 };
    this.master = { duck: 0.5, drive: 0.25, volume: 0.85 };
    this.bpm = 120;
  }

  async init() {
    if (this.ready) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const Tone = window.Tone;
    if (Tone) {
      Tone.setContext(ctx, true);
      Tone.getContext().lookAhead = 0.1;
    }
    try { await ctx.audioWorklet.addModule(workletURL()); this.hasWorklet = true; }
    catch (e) { console.warn('AudioWorklet unavailable — crusher/recorder disabled', e); this.hasWorklet = false; }
    this.build();
    this.ready = true;
  }

  build() {
    const ctx = this.ctx;
    // --- master section ---
    this.sum = ctx.createGain();
    this.sum.gain.value = 0.6; // headroom: eight tracks summed, kick peaks land around −4 dBFS
    this.duckBus = ctx.createGain();
    this.duckBus.connect(this.sum);
    this.lowShelf = ctx.createBiquadFilter(); this.lowShelf.type = 'lowshelf'; this.lowShelf.frequency.value = 90;
    this.highShelf = ctx.createBiquadFilter(); this.highShelf.type = 'highshelf'; this.highShelf.frequency.value = 3500;
    this.sum.connect(this.lowShelf).connect(this.highShelf);
    // LR4 crossover: two cascaded Butterworth biquads per side; lows summed to mono
    const bq = (type) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = 120; f.Q.value = Math.SQRT1_2; return f; };
    const lp1 = bq('lowpass'), lp2 = bq('lowpass'), hp1 = bq('highpass'), hp2 = bq('highpass');
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    // 'speakers' downmix is 0.5·(L+R): a centred signal keeps its level, then upmixes to L=R
    const xo = ctx.createGain();
    this.highShelf.connect(lp1).connect(lp2).connect(mono).connect(xo);
    this.highShelf.connect(hp1).connect(hp2).connect(xo);
    // soft saturation → limiter
    this.drivePre = ctx.createGain();
    this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
    this.drivePost = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    this.out = ctx.createGain();
    xo.connect(this.drivePre).connect(this.shaper).connect(this.drivePost).connect(this.limiter).connect(this.out);
    this.out.connect(ctx.destination);
    // silent sink keeps analysers / recorder pulled in every browser
    this.sink = ctx.createGain(); this.sink.gain.value = 0; this.sink.connect(ctx.destination);

    // --- FX ---
    this.delay = new Delay(ctx);
    this.reverb = new Reverb(ctx);
    this.delayRet = ctx.createGain(); this.revRet = ctx.createGain();
    this.delay.output.connect(this.delayRet).connect(this.duckBus);
    this.reverb.output.connect(this.revRet).connect(this.duckBus);
    // dub touch: a little of the delay goes into the reverb
    const d2r = ctx.createGain(); d2r.gain.value = 0.18; this.delay.output.connect(d2r).connect(this.reverb.input);

    // --- strips ---
    this.strips = VOICES.map((v, i) => {
      const s = new Strip(this, i);
      s.mute.connect(i === 0 ? this.sum : this.duckBus);
      s.sendD.connect(this.delay.input);
      s.sendR.connect(this.reverb.input);
      return s;
    });

    // --- analysis taps ---
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;
    this.split = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
    for (const a of [this.anL, this.anR]) { a.fftSize = 2048; a.smoothingTimeConstant = 0; }
    this.out.connect(this.analyser).connect(this.sink);
    this.out.connect(this.split);
    this.split.connect(this.anL, 0); this.split.connect(this.anR, 1);
    this.anL.connect(this.sink); this.anR.connect(this.sink);

    this.applyMaster();
    this.applyMacros();
  }

  get now() { return this.ctx.currentTime; }

  /** Resolve normalised params (+locks/jitter) into real units for a voice. */
  resolve(i, n) {
    const P = {};
    for (const p of VOICES[i].params) P[p.id] = denorm(p, n[p.id]);
    return P;
  }

  /**
   * Play one hit on track i at time t.
   * norms: full normalised param set (locks and ENTROPY already merged)
   * mix:   normalised mix values to apply at t (base or locked)
   */
  trigger(i, t, vel, norms, mix, seed) {
    const v = VOICES[i], st = this.voiceState[i], strip = this.strips[i];
    for (const k of MIX_LOCKABLE) if (mix[k] !== undefined) strip.setParam(k, mix[k], t);
    const P = this.resolve(i, norms);
    const m = this.macros;
    let g = v.level * Math.pow(clamp(vel, 0, 1), 1.5);
    if (i === 0 || i === 1) g *= 0.75 + m.depth * 0.5;
    if (v.mono && st.voice && t >= (st.voice.start || 0)) st.voice.stop(t, v.id === 'drone' ? 0.35 : 0.004);
    const env = { mood: m.mood, depth: m.depth, entropy: m.entropy, bpm: this.bpm };
    const h = v.play(this.ctx, strip.input, t, P, g, seed, st, env);
    h.start = t;
    if (v.mono) st.voice = h;
    if (i === 0) this.duck(t, vel);
    return h;
  }

  /** Event-based sidechain: dip the duck bus exactly at the kick. */
  duck(t, vel = 1) {
    const amt = this.master.duck * clamp(vel, 0, 1);
    if (amt < 0.01) return;
    const g = this.duckBus.gain, floor = 1 - amt * 0.85;
    const beat = 60 / this.bpm;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(floor, t, 0.0015);
    g.setTargetAtTime(1, t + 0.012, beat * (0.05 + amt * 0.08));
  }

  /** Stop/choke everything that is still sounding (used on transport stop). */
  hush(fade = 0.08) {
    const t = this.now;
    this.voiceState.forEach((st) => { if (st.voice) st.voice.stop(t, fade); st.voice = null; });
    this.duckBus.gain.cancelScheduledValues(t);
    this.duckBus.gain.setTargetAtTime(1, t, 0.02);
  }

  setTempo(bpm) {
    this.bpm = bpm;
    this.delay.set({}, bpm);
  }

  setMix(i, key, v) {
    const s = this.strips[i];
    if (key === 'vol' || MIX_LOCKABLE.includes(key)) s.setParam(key, v, this.now, 0.01);
  }

  applyMutes(tracks) {
    const anySolo = tracks.some((t) => t.mix.solo);
    tracks.forEach((t, i) => this.strips[i].setMuted(t.mix.mute || (anySolo && !t.mix.solo), this.now));
  }

  setFx(fx) {
    this.fx = fx;
    this.delay.set(fx.delay, this.bpm);
    this.reverb.set(fx.reverb);
  }

  setMaster(m) { Object.assign(this.master, m); this.applyMaster(); }

  applyMaster() {
    if (!this.out) return;
    const t = this.now, m = this.master;
    // soft saturation: clean below the knee, rounded peaks; DRIVE pushes into the knee
    const drive = clamp(m.drive + (this.macros.depth - 0.5) * 0.2, 0, 1);
    if (!this.shaper.curve) this.shaper.curve = softClipCurve();
    this.drivePre.gain.setTargetAtTime(0.5 * (1 + drive * 1.5), t, 0.02);
    this.drivePost.gain.setTargetAtTime(1 / (1 + drive * 0.6), t, 0.02);
    this.out.gain.setTargetAtTime(m.volume, t, 0.02);
  }

  setMacros(m) { Object.assign(this.macros, m); this.applyMacros(); }

  applyMacros() {
    if (!this.out) return;
    const t = this.now, m = this.macros;
    // DEPTH: low shelf + drive
    this.lowShelf.gain.setTargetAtTime((m.depth - 0.5) * 9, t, 0.05);
    // MOOD: tilt — dark ↔ cold/bright
    this.highShelf.gain.setTargetAtTime((m.mood - 0.5) * 9, t, 0.05);
    this.reverb.moodMul = 0.6 + m.mood * 0.8;
    // SPACE: global wet amount, size and feedback
    const wet = Math.pow(m.space, 0.8) * 1.25;
    this.delayRet.gain.setTargetAtTime(wet, t, 0.05);
    this.revRet.gain.setTargetAtTime(wet, t, 0.05);
    this.delay.fbAdd = (m.space - 0.5) * 0.2;
    this.delay.set({}, this.bpm);
    this.reverb.setSizeMul(0.6 + m.space * 0.9);
    this.reverb.set({});
    this.applyMaster();
  }
}

export { dbToGain };
