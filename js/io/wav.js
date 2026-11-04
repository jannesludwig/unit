// UNIT — sample-accurate master recording (AudioWorklet) and 16-bit WAV encoding.

export class MasterRecorder {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.node = new AudioWorkletNode(this.ctx, 'unit-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    engine.out.connect(this.node);
    this.node.connect(engine.sink);
    this.busy = false;
    this.node.port.onmessage = (e) => this.onMsg(e.data);
  }
  onMsg(d) {
    if (d.l) { this.chunks.push(d); this.frames += d.l.length; this.onProgress?.(this.frames / this.ctx.sampleRate); }
    if (d.done) {
      const L = new Float32Array(this.frames), R = new Float32Array(this.frames);
      let o = 0;
      for (const c of this.chunks) { L.set(c.l, o); R.set(c.r, o); o += c.l.length; }
      this.busy = false;
      const res = this.resolve; this.resolve = null; this.chunks = [];
      res?.({ l: L, r: R, sampleRate: this.ctx.sampleRate });
    }
  }
  /** Capture [start, end) in AudioContext seconds (end = null → until stop()). */
  record(start, end) {
    if (this.busy) return Promise.reject(new Error('busy'));
    this.busy = true; this.chunks = []; this.frames = 0;
    const sr = this.ctx.sampleRate;
    this.node.port.postMessage({ cmd: 'arm', start: Math.round(start * sr), end: end == null ? -1 : Math.round(end * sr) });
    return new Promise((res) => { this.resolve = res; });
  }
  stop() { this.node.port.postMessage({ cmd: 'stop' }); }
}

/** Interleaved 16-bit PCM WAV with TPDF dither. */
export function encodeWav(l, r, sr) {
  const n = l.length, nc = 2, bytes = n * nc * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const x = (c ? r : l)[i] + (Math.random() - Math.random()) / 32768;
      const s = Math.max(-1, Math.min(1, x));
      v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
