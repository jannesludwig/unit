// UNIT — scene 1: OSCILLOSCOPE.
// The real master signal drawn as a phosphor beam. Every sample-to-sample segment is a quad whose
// fragment shader integrates a Gaussian beam along the segment; intensity ∝ 1/length, so a slow
// beam glows and a fast one fades (dwell time), like a CRT. Additive into a float buffer that
// decays every frame (persistence).
//   MODE: SCOPE (triggered time-domain) · XY (stereo, mid vertical / side horizontal) · PHASE
//         (delay embedding x = s(t), y = s(t−τ), τ = quarter period of the SUB note → sines
//         draw circles, noise and glitches tear them).

import { THREE, Pass, makeRT, GLSL } from '../gl.js';
import { clamp } from '../../core/util.js';

const N = 2048;
const MODES = ['SCOPE', 'XY', 'PHASE'];

const BEAM_VERT = /* glsl */ `
attribute float aIdx;
uniform sampler2D uPts;
uniform float uN, uW, uAspect, uTear, uSeed, uJit;
varying vec3 vUvl;
varying float vI;
${GLSL.hash}
vec2 P(float i) { return texture2D(uPts, vec2((i + 0.5) / uN, 0.5)).xy; }
void main() {
  vec2 a = P(aIdx), b = P(aIdx + 1.0);
  // glitch tearing: whole bands of segments jump sideways
  float band = floor(aIdx / 48.0);
  float h = hash11(band * 1.37 + uSeed);
  if (h < uTear) { vec2 o = vec2((hash11(band + uSeed * 3.1) - 0.5) * 0.5, (hash11(band * 7.7 + uSeed) - 0.5) * 0.08); a += o; b += o; }
  a += (vec2(hash11(aIdx + uSeed), hash11(aIdx * 1.3 + uSeed)) - 0.5) * uJit;
  b += (vec2(hash11(aIdx + 1.0 + uSeed), hash11((aIdx + 1.0) * 1.3 + uSeed)) - 0.5) * uJit;
  vec2 d = b - a; float len = length(d);
  vec2 n = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nn = vec2(-n.y, n.x);
  vec2 c = position.xy;
  vec2 p = (c.x < 0.0 ? a - n * uW : b + n * uW) + nn * uW * c.y;
  vUvl = vec3(c.x < 0.0 ? -uW : len + uW, c.y * uW, len);
  vI = h < uTear ? 0.6 : 1.0;
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uW, uInt;
varying vec3 vUvl;
varying float vI;
${GLSL.erf}
void main() {
  float s = uW * 0.32, len = vUvl.z;
  vec2 xy = vUvl.xy;
  float a;
  if (len < s * 0.05) a = exp(-dot(xy, xy) / (2.0 * s * s)) * 0.5;
  else {
    a = erf(xy.x / (1.41421 * s)) - erf((xy.x - len) / (1.41421 * s));
    a *= exp(-xy.y * xy.y / (2.0 * s * s)) * 0.5 * s / max(len, s);
  }
  gl_FragColor = vec4(vec3(a * uInt * vI), 1.0);
}`;

const OUT_FRAG = /* glsl */ `
uniform sampler2D uAcc;
uniform vec3 uAccent, uFg;
uniform float uAspect, uGrat, uFlash;
varying vec2 vUv;
float line(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(x)); }
void main() {
  float I = texture2D(uAcc, vUv).r;
  vec3 col = uAccent * (1.0 - exp(-I * 1.1)) * 0.8 + uFg * smoothstep(0.55, 2.6, I) * 0.95;
  // graticule: 10 × 8 divisions, faint, with centre ticks
  vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
  vec2 hf = vec2(0.92 * uAspect, 0.92);
  vec2 q = (p + hf) / (2.0 * hf) * vec2(10.0, 8.0);
  vec2 dq = fwidth(q);
  vec2 fq = abs(fract(q + 0.5) - 0.5);
  float gl = max(line(fq.x, dq.x), line(fq.y, dq.y));
  vec2 c = abs(q - vec2(5.0, 4.0));
  float axis = max(line(c.x, dq.x), line(c.y, dq.y));
  vec2 tq = abs(fract(q * 5.0 + 0.5) - 0.5) / 5.0;
  float ticks = line(c.y, 0.1) * line(tq.x, dq.x) + line(c.x, 0.1) * line(tq.y, dq.y);
  float inside = step(abs(p.x), hf.x) * step(abs(p.y), hf.y);
  col += uFg * (gl * 0.04 + axis * 0.06 + ticks * 0.1) * inside * uGrat;
  col += uAccent * uFlash * 0.04;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Oscilloscope {
  static title = 'OSCILLOSCOPE';
  static params = ['MODE', 'PERSIST', 'GAIN'];
  static steps = [3, 0, 0];
  static formats = [(n) => MODES[Math.min(2, Math.floor(n * 3))], null, (n) => Math.pow(2, (n - 0.5) * 2).toFixed(2) + '×'];

  constructor(V) {
    this.V = V;
    const r = V.renderer;
    this.pts = new Float32Array(N * 4);
    this.tex = new THREE.DataTexture(this.pts, N, 1, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const idx = new Float32Array(N - 1); for (let i = 0; i < N - 1; i++) idx[i] = i;
    g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
    g.instanceCount = N - 1;
    this.beamU = {
      uPts: { value: this.tex }, uN: { value: N }, uW: { value: 0.012 }, uAspect: { value: 1 },
      uInt: { value: 1 }, uTear: { value: 0 }, uSeed: { value: 0 }, uJit: { value: 0 },
    };
    this.beam = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: this.beamU,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true,
    }));
    this.beam.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.beam);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fade = new Pass(`uniform float uDecay; void main(){ gl_FragColor = vec4(vec3(uDecay), 1.0); }`, { uDecay: { value: 0.8 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    });
    this.out = new Pass(OUT_FRAG, {
      uAcc: { value: null }, uAccent: { value: V.palette.accent }, uFg: { value: V.palette.fg },
      uAspect: { value: 1 }, uGrat: { value: 1 }, uFlash: { value: 0 },
    }, { extensions: { derivatives: true } });
    this.acc = makeRT(r, 4, 4);
    this.agc = 1; this.peakSm = 0.3; this.tear = 0; this.flare = 0; this.lastTrig = 0;
  }

  resize(w, h) { this.acc.setSize(w, h); this.aspect = w / h; }

  onHit(ev) {
    const v = ev.vel;
    if (ev.track === 6) this.tear = Math.max(this.tear, 0.35 * v);       // DATA tears
    else if (ev.track === 4) this.tear = Math.max(this.tear, 0.22 * v);  // NOISE disturbs
    else if (ev.track === 2) this.tear = Math.max(this.tear, 0.12 * v);  // CLICK nicks
    else if (ev.track === 0) this.flare = Math.max(this.flare, v);       // KICK flares
  }

  update(F) {
    const [pMode, pPersist, pGain] = F.params;
    const mode = Math.min(2, Math.floor(pMode * 3));
    this.mode = mode;
    const L = F.waveL, R = F.waveR, W = F.wave, M = W.length;
    const pts = this.pts;
    const gain = Math.pow(2, (pGain - 0.5) * 2) * (0.9 + F.depth * 0.2);
    const asp = this.aspect || 1;
    let peak = 0;
    if (mode === 0) {
      // triggered sweep: rising zero crossing of a low-passed copy (HF-reject trigger coupling),
      // searched backwards from the newest possible start so the display stays fresh and stable
      let start = M - N, acc = 0;
      const lp = this.lp || (this.lp = new Float32Array(M));
      for (let i = 0; i < M; i++) { acc += W[i] - (i >= 24 ? W[i - 24] : 0); lp[i] = acc / 24; }
      for (let i = M - N; i > 32; i--) {
        if (lp[i - 1] < 0 && lp[i] >= 0 && lp[i + 6] > lp[i]) { start = i; break; }
      }
      for (let k = 0; k < N; k++) {
        const y = W[start + k];
        peak = Math.max(peak, Math.abs(y));
        pts[k * 4] = (-1 + (2 * k) / (N - 1)) * 0.92 * asp;
        pts[k * 4 + 1] = y;
      }
    } else if (mode === 1) {
      // vectorscope: mid vertical, side horizontal. The side axis has its own AGC (≤ 6× the mid
      // gain) so panning, ping-pong echoes and the drone's stereo saws open the line into figures.
      let pS = 0;
      for (let k = 0; k < N; k++) {
        const l = L[M - N + k], r = R[M - N + k];
        const x = (r - l) * 0.7071, y = (l + r) * 0.7071;
        peak = Math.max(peak, Math.abs(y)); pS = Math.max(pS, Math.abs(x));
        pts[k * 4] = x; pts[k * 4 + 1] = y;
      }
      this.peakS = Math.max(pS, (this.peakS || 0.05) * 0.994);
      this.sideBoost = clamp(Math.max(peak, this.peakSm) / Math.max(this.peakS, 1e-4) * 0.8, 1, 6);
    } else {
      const sr = this.V.app.engine.ctx?.sampleRate || 48000;
      const tau = clamp(Math.round(sr / (4 * (F.pitch.sub || 55))), 2, M - N - 1);
      for (let k = 0; k < N; k++) {
        const i = M - N + k;
        const x = W[i], y = W[i - tau];
        peak = Math.max(peak, Math.abs(x), Math.abs(y));
        pts[k * 4] = x; pts[k * 4 + 1] = y;
      }
    }
    // slow AGC (peak-hold ~3 s) so quiet passages still draw a figure; GAIN zooms around it
    this.peakSm = Math.max(peak, this.peakSm * 0.994);
    const target = clamp(0.8 / Math.max(this.peakSm, 0.02), 0.5, 10);
    this.agc += (target - this.agc) * 0.06;
    const s = gain * this.agc;
    for (let k = 0; k < N; k++) {
      if (mode === 0) pts[k * 4 + 1] *= s;
      else { pts[k * 4] *= s * (mode === 1 ? this.sideBoost : 1); pts[k * 4 + 1] *= s; }
    }
    this.tex.needsUpdate = true;

    const react = F.react;
    this.tear *= Math.exp(-F.dt * 9);
    this.flare *= Math.exp(-F.dt * 6);
    const ent = F.entropy;
    const tear = clamp(this.tear * (0.4 + react) + (Math.random() < ent * 0.3 ? ent * 0.25 : 0), 0, 0.9);
    const u = this.beamU;
    u.uTear.value = tear;
    u.uSeed.value = Math.floor(F.time * 30) % 1000;
    u.uJit.value = ent * 0.012 * react;
    u.uAspect.value = asp;
    u.uW.value = 0.009 * (0.7 + F.depth * 0.9) * (1 + this.flare * 0.4 * react);
    u.uInt.value = (mode === 0 ? 1.5 : 1.1) * (1 + this.flare * 0.8 * react + F.transient * 0.3 * react);
    this.fade.uniforms.uDecay.value = clamp(0.5 + pPersist * 0.45 + F.space * 0.03, 0, 0.985);
    this.out.uniforms.uAspect.value = asp;
    this.out.uniforms.uFlash.value = this.flare * react;
    this.out.uniforms.uGrat.value = 0.7 + F.mood * 0.6;
  }

  render(target) {
    const r = this.V.renderer;
    this.fade.render(r, this.acc, false);
    r.setRenderTarget(this.acc);
    r.render(this.scene, this.cam);
    this.out.uniforms.uAcc.value = this.acc.texture;
    this.out.render(r, target);
  }

  label(F) { return MODES[this.mode || 0]; }

  dispose() { this.acc.dispose(); this.tex.dispose(); this.beam.geometry.dispose(); this.beam.material.dispose(); }
}
