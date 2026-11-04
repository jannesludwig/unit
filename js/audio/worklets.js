// UNIT — AudioWorklet processors, shipped as a string and loaded from a Blob URL
// so the site works from any static host (and from file:// in Chrome) without extra files.
//
//  unit-crusher  : per-track bit-depth + sample-rate reduction (stereo)
//  unit-recorder : sample-accurate capture of the master bus between two frame indices

const SRC = /* js */ `
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 1, minValue: 0.005, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.ph = 0; this.h0 = 0; this.h1 = 0; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || inp.length === 0) return true;
    const bits = params.bits[0], ratio = params.ratio[0];
    const nCh = out.length;
    const i0 = inp[0], i1 = inp[1] || inp[0];
    const o0 = out[0], o1 = out[1] || out[0];
    if (bits >= 15.99 && ratio >= 0.999) {           // bypass: exact copy
      o0.set(i0); if (nCh > 1) o1.set(i1);
      return true;
    }
    const q = Math.pow(2, bits - 1);
    let ph = this.ph, h0 = this.h0, h1 = this.h1;
    for (let n = 0; n < o0.length; n++) {
      ph += ratio;
      if (ph >= 1) {                                // sample & hold at the reduced rate
        ph -= 1;
        h0 = Math.round(i0[n] * q) / q;
        h1 = Math.round(i1[n] * q) / q;
      }
      o0[n] = h0; if (nCh > 1) o1[n] = h1;
    }
    this.ph = ph; this.h0 = h0; this.h1 = h1;
    return true;
  }
}
registerProcessor('unit-crusher', Crusher);

class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.start = -1; this.end = -1; this.armed = false;
    this.chunk = 48000; this.buf = null; this.pos = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cmd === 'arm') {
        this.start = d.start; this.end = d.end; this.armed = true;
        this.chunk = Math.max(4096, Math.floor(sampleRate));
        this.newBuf();
      } else if (d.cmd === 'stop') {
        // stop now (manual stop / open-ended recording)
        if (this.armed) { this.flush(); this.armed = false; this.port.postMessage({ done: true }); }
      }
    };
  }
  newBuf() { this.buf = [new Float32Array(this.chunk), new Float32Array(this.chunk)]; this.pos = 0; }
  flush() {
    if (this.pos > 0) {
      const l = this.buf[0].slice(0, this.pos), r = this.buf[1].slice(0, this.pos);
      this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    }
    this.newBuf();
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    // pass-through so the node can sit in-line if needed
    if (outputs[0] && inp && inp.length) for (let c = 0; c < outputs[0].length; c++) outputs[0][c].set(inp[c] || inp[0]);
    if (!this.armed || !inp || inp.length === 0) return true;
    const i0 = inp[0], i1 = inp[1] || inp[0];
    const f0 = currentFrame;
    for (let n = 0; n < i0.length; n++) {
      const f = f0 + n;
      if (f < this.start) continue;
      if (this.end >= 0 && f >= this.end) {
        this.flush(); this.armed = false; this.port.postMessage({ done: true });
        return true;
      }
      this.buf[0][this.pos] = i0[n]; this.buf[1][this.pos] = i1[n]; this.pos++;
      if (this.pos >= this.chunk) this.flush();
    }
    return true;
  }
}
registerProcessor('unit-recorder', Recorder);
`;

let url = null;
export function workletURL() {
  if (!url) url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
  return url;
}
