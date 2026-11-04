// UNIT — audio features for the visuals.
//
// Two sources, merged every frame:
//  (a) exact sequencer events (track, velocity, step, pitch) delivered through Tone.Draw at the
//      moment the hit is heard → per-track envelopes, pitch memory, event list.
//  (b) continuous analysis of the master output: RMS, sub/low/mid/high band energy, spectral
//      centroid, spectral-flux transients, a 128-band log spectrum and the raw waveform (L/R).

import { clamp } from '../core/util.js';

const DECAY = [7, 4, 20, 16, 9, 7, 12, 0.7]; // per-track envelope decay rates (1/s)
export const NBANDS = 128;

export class Features {
  constructor(engine) {
    this.engine = engine;
    this.spectrum = new Float32Array(NBANDS);
    this.spectrumPeak = new Float32Array(NBANDS);
    this.env = new Float32Array(8);
    this.hits = [];
    this.pending = [];
    this.pitch = { kick: 50, sub: 55, tone: 220, drone: 65 };
    this.rms = 0; this.sub = 0; this.low = 0; this.mid = 0; this.high = 0;
    this.centroid = 0.5; this.transient = 0; this.flux = 0;
    this.trackHits = new Uint32Array(8);
    this._fluxMean = 0; this._lastTr = 0;
    this.waveL = new Float32Array(4096); this.waveR = new Float32Array(4096); this.wave = new Float32Array(4096);
    this.ready = false;
  }

  setup() {
    const e = this.engine;
    this.fft = new Float32Array(e.analyser.frequencyBinCount);
    this.prevMag = new Float32Array(e.analyser.frequencyBinCount);
    this.time = new Float32Array(e.analyser.fftSize);
    e.anL.fftSize = 4096; e.anR.fftSize = 4096;
    const sr = e.ctx.sampleRate, n = this.fft.length, binHz = sr / 2 / n;
    // log-spaced band edges 30 Hz … 16 kHz
    this.edges = new Uint16Array(NBANDS + 1);
    for (let b = 0; b <= NBANDS; b++) this.edges[b] = Math.min(n - 1, Math.round((30 * Math.pow(16000 / 30, b / NBANDS)) / binHz));
    this.binHz = binHz;
    this.ready = true;
  }

  /** Called from Tone.Draw at the audible moment of a hit. */
  onHit(ev) {
    this.pending.push(ev);
  }

  update(dt) {
    const e = this.engine;
    // ---- events
    this.hits = this.pending; this.pending = [];
    for (let i = 0; i < 8; i++) this.env[i] *= Math.exp(-DECAY[i] * dt);
    let evTr = 0;
    for (const h of this.hits) {
      this.env[h.track] = Math.max(this.env[h.track], h.vel);
      this.trackHits[h.track]++;
      if (h.freq) {
        if (h.track === 0) this.pitch.kick = h.freq;
        else if (h.track === 1) this.pitch.sub = h.freq;
        else if (h.track === 5) this.pitch.tone = h.freq;
        else if (h.track === 7) this.pitch.drone = h.freq;
      }
      if (h.track === 0 || h.track === 2) evTr = Math.max(evTr, h.vel);
    }
    if (!this.ready || !e.ready) { this.transient = Math.max(evTr, this.transient * Math.exp(-12 * dt)); return; }

    // ---- spectrum
    e.analyser.getFloatFrequencyData(this.fft);
    const fft = this.fft, n = fft.length, binHz = this.binHz;
    let flux = 0, cNum = 0, cDen = 0;
    const band = [0, 0, 0, 0], bandN = [0, 0, 0, 0];
    for (let k = 1; k < n; k++) {
      const db = fft[k] > -160 ? fft[k] : -160;
      const mag = Math.pow(10, db / 20);
      const d = mag - this.prevMag[k];
      if (d > 0) flux += d;
      this.prevMag[k] = mag;
      const f = k * binHz;
      if (f > 30 && f < 16000) { cNum += f * mag; cDen += mag; }
      const p = mag * mag;
      const bi = f < 60 ? 0 : f < 250 ? 1 : f < 2000 ? 2 : f < 16000 ? 3 : -1;
      if (bi >= 0) { band[bi] += p; bandN[bi]++; }
    }
    const toN = (pw, cnt, floor, range) => clamp((10 * Math.log10(pw / Math.max(1, cnt) + 1e-12) - floor) / range);
    const tgt = [toN(band[0], bandN[0], -62, 50), toN(band[1], bandN[1], -64, 50), toN(band[2], bandN[2], -76, 50), toN(band[3], bandN[3], -88, 52)];
    const att = 1 - Math.exp(-dt * 40), rel = 1 - Math.exp(-dt * 7);
    const sm = (cur, t) => cur + (t - cur) * (t > cur ? att : rel);
    this.sub = sm(this.sub, tgt[0]); this.low = sm(this.low, tgt[1]); this.mid = sm(this.mid, tgt[2]); this.high = sm(this.high, tgt[3]);
    const cen = cDen > 1e-9 ? cNum / cDen : 1000;
    this.centroid += (clamp(Math.log2(cen / 100) / Math.log2(160)) - this.centroid) * (1 - Math.exp(-dt * 6));

    // log spectrum (0..1) with peak-hold
    const sp = this.spectrum, ed = this.edges;
    for (let b = 0; b < NBANDS; b++) {
      let m = -160;
      for (let k = ed[b]; k <= Math.max(ed[b], ed[b + 1] - 1); k++) if (fft[k] > m) m = fft[k];
      const v = clamp((m + 96) / 84);
      sp[b] = v > sp[b] ? v : sp[b] + (v - sp[b]) * (1 - Math.exp(-dt * 10));
      this.spectrumPeak[b] = Math.max(v, this.spectrumPeak[b] - dt * 0.4);
    }

    // transient: spectral flux above its running mean, merged with exact event onsets
    this.flux = flux;
    this._fluxMean += (flux - this._fluxMean) * (1 - Math.exp(-dt * 3));
    const now = performance.now();
    let tr = 0;
    if (flux > this._fluxMean * 1.7 + 0.05 && now - this._lastTr > 70) { tr = clamp((flux / (this._fluxMean + 1e-6) - 1.7) * 0.5 + 0.4); this._lastTr = now; }
    this.transient = Math.max(tr, evTr, this.transient * Math.exp(-12 * dt));

    // ---- waveform / RMS
    e.anL.getFloatTimeDomainData(this.waveL);
    e.anR.getFloatTimeDomainData(this.waveR);
    const w = this.wave, L = this.waveL, R = this.waveR;
    let s2 = 0;
    for (let i = 0; i < w.length; i++) { const v = (L[i] + R[i]) * 0.5; w[i] = v; if (i >= w.length - 1024) s2 += v * v; }
    const rms = Math.sqrt(s2 / 1024);
    this.rms += (clamp(rms * 2.2) - this.rms) * (rms * 2.2 > this.rms ? att : rel);
  }
}
