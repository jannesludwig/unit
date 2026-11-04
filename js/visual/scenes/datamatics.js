// UNIT — scene 2: DATAMATICS.
// A field of parallel lines displaced by the spectrum history (a scrolling line landscape),
// occluding each other front to back, overlaid with barcode strips, binary / numeric readouts
// and scanlines. KICK inverts or shifts whole horizontal bands; CLICK and DATA fire barcode bursts.
//   DENSITY: number of lines · PERSPECTIVE: flat stack ↔ 3D landscape · DATA: overlay amount

import { THREE, Pass, makeRT, GLSL } from '../gl.js';
import { TextLayer } from '../text.js';
import { NBANDS } from '../features.js';
import { clamp } from '../../core/util.js';

const HIST = 256;          // spectrum history rows
const P = NBANDS;          // points per line

const LINE_VERT = /* glsl */ `
attribute vec2 aUR;        // u along the line (0..1), row (0 = newest .. 1 = oldest)
attribute float aTop;      // 1 = on the line, 0 = ribbon base (occluder)
uniform sampler2D uHist;
uniform float uHead, uSpan, uPersp, uAmp, uAspect, uTime, uShift, uShiftY0, uShiftY1;
varying float vRow; varying float vH; varying float vTop;
void main() {
  float u = aUR.x, row = aUR.y;
  float hr = fract((uHead - row * uSpan) / ${HIST.toFixed(1)});
  float h = texture2D(uHist, vec2(u, hr)).r;
  // symmetric fall-off at the edges keeps the field framed
  float edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
  h = pow(h, 1.6) * edge;
  float x = (u - 0.5) * 2.0 * uAspect * 0.9;
  // flat: rows stacked on screen; 3D: rows recede in depth
  // newest row in front (bottom of the flat stack / nearest in 3D); front rows occlude
  vec3 pFlat = vec3(x, mix(-0.85, 0.8, row) + h * uAmp * 0.55 * aTop, -row * 0.5);
  vec3 pDeep = vec3(x * 1.25, -0.35 + h * uAmp * aTop, -row * 9.0 + 1.5);
  vec3 p = mix(pFlat, pDeep, uPersp);
  float sy = pFlat.y;
  if (sy > uShiftY0 && sy < uShiftY1) p.x += uShift * (1.0 - uPersp * 0.5);
  vRow = row; vH = h; vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const LINE_FRAG = /* glsl */ `
uniform vec3 uFg, uAccent; uniform float uLine, uHot;
varying float vRow; varying float vH; varying float vTop;
void main() {
  if (uLine < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // occluder ribbon
  float fade = pow(1.0 - vRow, 1.4);
  vec3 c = mix(uFg, uAccent, smoothstep(0.55, 0.9, vH) * uHot);
  float newest = smoothstep(0.02, 0.0, vRow);
  gl_FragColor = vec4(c * (0.18 + 0.82 * fade) * (0.75 + newest * 0.6), 1.0);
}`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D uLines;
uniform vec3 uFg, uAccent;
uniform float uTime, uData, uScan, uAspect;
uniform vec4 uInv[3];      // y0, y1, amount, -
uniform vec4 uBar[8];      // y0, y1, seed, intensity
varying vec2 vUv;
${GLSL.hash}
float barcode(float x, float seed) {
  // variable-width bars: quantise x into irregular cells
  float n = floor(x * 180.0);
  float w = hash11(n * 1.7 + seed);
  return step(0.48, hash11(floor(x * mix(60.0, 260.0, w)) + seed * 13.0));
}
void main() {
  vec3 c = texture2D(uLines, vUv).rgb;
  // barcode bursts
  for (int i = 0; i < 8; i++) {
    vec4 b = uBar[i];
    if (b.w > 0.001 && vUv.y > b.x && vUv.y < b.y) {
      float bc = barcode(vUv.x, b.z);
      c = mix(c, uFg * bc, b.w);
    }
  }
  // persistent data strip at the bottom: the live spectrum as bits
  if (uData > 0.01 && vUv.y < 0.035 && vUv.y > 0.02) {
    float bc = barcode(vUv.x + floor(uTime * 12.0) * 0.013, 7.0);
    c = max(c, uFg * bc * 0.5 * uData);
  }
  // inversion bands (KICK)
  for (int i = 0; i < 3; i++) {
    vec4 v = uInv[i];
    if (v.z > 0.001 && vUv.y > v.x && vUv.y < v.y) c = mix(c, uFg - c, v.z);
  }
  // scanlines + a travelling scan bar
  float sl = 0.94 + 0.06 * step(0.5, fract(gl_FragCoord.y * 0.5));
  c *= mix(1.0, sl, uData);
  float bar = smoothstep(0.004, 0.0, abs(vUv.y - fract(uScan)));
  c += uAccent * bar * 0.25 * uData;
  gl_FragColor = vec4(c, 1.0);
}`;

const HEX = '0123456789ABCDEF';
const hex = (v, n) => { let s = ''; for (let i = 0; i < n; i++) s = HEX[(v >>> (i * 4)) & 15] + s; return s; };
const bin = (v, n) => { let s = ''; for (let i = n - 1; i >= 0; i--) s += (v >>> i) & 1; return s; };

export class Datamatics {
  static title = 'DATAMATICS';
  static params = ['DENSITY', 'PERSPECT', 'DATA'];
  static formats = [(n) => String(32 + 16 * Math.round(n * 10)), null, null];

  constructor(V) {
    this.V = V;
    this.hist = new Float32Array(P * HIST * 4);
    this.histTex = new THREE.DataTexture(this.hist, P, HIST, THREE.RGBAFormat, THREE.FloatType);
    this.histTex.minFilter = THREE.LinearFilter; this.histTex.magFilter = THREE.LinearFilter;
    this.histTex.wrapT = THREE.RepeatWrapping;
    this.histTex.needsUpdate = true;
    this.head = 0; this.acc = 0;
    this.lineU = {
      uHist: { value: this.histTex }, uHead: { value: 0 }, uSpan: { value: 1 }, uPersp: { value: 0.5 }, uAmp: { value: 1 },
      uAspect: { value: 1 }, uTime: { value: 0 }, uShift: { value: 0 }, uShiftY0: { value: 0 }, uShiftY1: { value: 0 },
      uFg: { value: V.palette.fg }, uAccent: { value: V.palette.accent }, uLine: { value: 1 }, uHot: { value: 1 },
    };
    this.lineMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: this.lineU, depthTest: true, depthWrite: true });
    this.ribU = { ...this.lineU, uLine: { value: 0 } };
    this.ribMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: this.ribU, depthTest: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    this.linesRT = makeRT(V.renderer, 4, 4, { depth: true });
    this.comp = new Pass(COMP_FRAG, {
      uLines: { value: this.linesRT.texture }, uFg: { value: V.palette.fg }, uAccent: { value: V.palette.accent },
      uTime: { value: 0 }, uData: { value: 0.5 }, uScan: { value: 0 }, uAspect: { value: 1 },
      uInv: { value: [0, 1, 2].map(() => new THREE.Vector4()) },
      uBar: { value: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4()) },
    });
    this.text = new TextLayer(V.palette);
    this.bars = []; this.invs = []; this.shift = 0; this.shiftBand = [0, 0];
    this.K = 0;
    this.stream = '';
    this.frame = 0;
  }

  /** (Re)build line + ribbon geometry for K lines. */
  build(K) {
    this.K = K;
    if (this.lines) { this.scene.remove(this.lines, this.ribbons); this.lines.geometry.dispose(); this.ribbons.geometry.dispose(); }
    const ur = new Float32Array(K * P * 2 * 2), top = new Float32Array(K * P * 2);
    const li = [], ri = [];
    for (let k = 0; k < K; k++) {
      const row = k / (K - 1);
      for (let j = 0; j < P; j++) {
        const v = (k * P + j) * 2;
        ur[v * 2] = j / (P - 1); ur[v * 2 + 1] = row; top[v] = 1;
        ur[(v + 1) * 2] = j / (P - 1); ur[(v + 1) * 2 + 1] = row; top[v + 1] = 0;
        if (j < P - 1) {
          li.push(v, v + 2);
          ri.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
        }
      }
    }
    const mk = (idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('aUR', new THREE.BufferAttribute(ur, 2));
      g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K * P * 2 * 3), 3));
      g.setIndex(idx);
      return g;
    };
    this.lines = new THREE.LineSegments(mk(li), this.lineMat);
    this.ribbons = new THREE.Mesh(mk(ri), this.ribMat);
    this.lines.frustumCulled = this.ribbons.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.scene.add(this.ribbons, this.lines);
  }

  resize(w, h) {
    this.w = w; this.h = h; this.aspect = w / h;
    this.linesRT.setSize(w, h);
    this.cam.aspect = this.aspect; this.cam.updateProjectionMatrix();
    this.text.resize(w, h);
  }

  onHit(ev) {
    const t = this.V.time;
    if (ev.track === 0) {
      // KICK: invert a band, or shift one sideways
      if (Math.random() < 0.6) {
        const y0 = Math.random() * 0.8, hgt = 0.04 + Math.random() * 0.22 * ev.vel;
        this.invs.push({ y0, y1: y0 + hgt, a: 0.9 * ev.vel, t });
        if (this.invs.length > 3) this.invs.shift();
      } else {
        const y0 = -0.8 + Math.random() * 1.4;
        this.shiftBand = [y0, y0 + 0.1 + Math.random() * 0.3];
        this.shift = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.25) * ev.vel;
      }
    } else if (ev.track === 2 || ev.track === 6) {
      const n = ev.track === 6 ? 1 + ((Math.random() * 3) | 0) : 1;
      for (let i = 0; i < n; i++) {
        const y0 = Math.random() * 0.94, hgt = (ev.track === 6 ? 0.006 + Math.random() * 0.026 : 0.003 + Math.random() * 0.01);
        this.bars.push({ y0, y1: y0 + hgt, seed: Math.random() * 100, a: 0.85 * ev.vel, life: ev.track === 6 ? 0.16 : 0.08, t });
      }
      while (this.bars.length > 8) this.bars.shift();
    }
  }

  update(F) {
    const [pDen, pPersp, pData] = F.params;
    const K = 32 + 16 * Math.round(pDen * 10);
    if (K !== this.K) this.build(K);
    this.F = F;
    // push spectrum rows at ~60 rows/s regardless of frame rate
    this.acc += F.dt * 60;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.head = (this.head + 1) % HIST;
      const o = this.head * P * 4, react = 0.55 + F.react * 0.6;
      for (let j = 0; j < P; j++) this.hist[o + j * 4] = clamp(F.spectrum[j] * react * (0.85 + F.depth * 0.3));
    }
    this.histTex.needsUpdate = true;
    const u = this.lineU;
    u.uHead.value = this.head + 0.5;
    u.uSpan.value = (HIST - 2) / 1.0;
    u.uPersp.value = pPersp;
    u.uAmp.value = (0.6 + F.depth * 0.8) * (1 + F.entropy * 0.6 * Math.random());
    u.uAspect.value = this.aspect || 1;
    u.uTime.value = F.time;
    u.uHot.value = 0.3 + F.mood * 0.7;
    this.shift *= Math.exp(-F.dt * 10);
    u.uShift.value = this.shift + (F.entropy > 0.2 && Math.random() < F.entropy * 0.1 ? (Math.random() - 0.5) * 0.2 : 0);
    u.uShiftY0.value = this.shiftBand[0]; u.uShiftY1.value = this.shiftBand[1];
    // camera: front view for the flat stack, low grazing angle for 3D
    const e = pPersp;
    this.cam.position.set(Math.sin(F.time * 0.05) * 0.4 * e, 0.0 + e * 1.6, 3.2 - e * 0.6);
    this.cam.lookAt(0, -0.15 * e, -2.5 * e);
    this.cam.fov = 40 + e * 12; this.cam.updateProjectionMatrix();
    // overlays
    const cu = this.comp.uniforms, t = this.V.time;
    cu.uTime.value = F.time; cu.uData.value = pData; cu.uAspect.value = this.aspect;
    cu.uScan.value = F.playing ? (F.time * F.bpm / 60 / 4) : F.time * 0.1;
    this.invs = this.invs.filter((v) => t - v.t < 0.5);
    cu.uInv.value.forEach((v, i) => {
      const iv = this.invs[i];
      if (iv) v.set(iv.y0, iv.y1, iv.a * Math.exp(-(t - iv.t) * 9) * (0.4 + F.react * 0.8), 0); else v.set(0, 0, 0, 0);
    });
    this.bars = this.bars.filter((b) => t - b.t < b.life);
    cu.uBar.value.forEach((v, i) => {
      const b = this.bars[i];
      if (b) v.set(b.y0, b.y1, b.seed, b.a * (1 - (t - b.t) / b.life) * (0.5 + pData * 0.5)); else v.set(0, 0, 0, 0);
    });
    this.frame++;
    this.writeText(F, pData);
  }

  /** Numeric / binary readouts — Ikeda-style data typography. */
  writeText(F, amt) {
    const T = this.text, w = this.w, h = this.h;
    T.clear();
    if (amt < 0.05) return;
    const s = Math.max(9, Math.round(h * 0.022)), a = Math.min(1, amt * 1.4);
    const pad = s * 1.4;
    // left column: spectrum as hex words
    const rows = Math.floor((h * 0.62) / (s * 1.25));
    for (let r = 0; r < rows; r++) {
      const b = Math.floor((r / rows) * P);
      const v = Math.round(F.spectrum[b] * 255);
      const y = pad * 2 + r * s * 1.25;
      T.text(hex(v * 65793 + b, 6), pad, y, s, a * (0.25 + F.spectrum[b] * 0.75), v > 200 ? 1 : 0);
      if (amt > 0.4) T.text(bin(v, 8), pad + T.width('000000  ', s), y, s, a * 0.35, 0);
    }
    // right column: band values
    const lab = [['SUB', F.sub], ['LOW', F.low], ['MID', F.mid], ['HIGH', F.high], ['RMS', F.rms], ['CNT', F.centroid], ['TRN', F.transient]];
    lab.forEach(([k, v], i) => {
      const str = `${k.padEnd(4)} ${v.toFixed(4)}`;
      T.text(str, w - pad - T.width(str, s), pad * 2 + i * s * 1.4, s, a * 0.8, i === 6 && v > 0.5 ? 1 : 0);
    });
    // per-track envelope bits
    let bits = '';
    for (let i = 0; i < 8; i++) bits += F.env[i] > 0.3 ? '1' : '0';
    const str = `TRK ${bits}  ${String(Math.round(F.bpm * 10)).padStart(5, '0')}`;
    T.text(str, w - pad - T.width(str, s), pad * 2 + 8 * s * 1.4, s, a, 0);
    // bottom stream: sign bits of the waveform, scrolling
    if (this.frame % 2 === 0) {
      let chunk = '';
      for (let i = 0; i < 6; i++) chunk += F.wave[4095 - i * 97] > 0 ? '1' : '0';
      this.stream = (chunk + this.stream).slice(0, 400);
    }
    const sy = h - pad * 1.6 - s;
    T.text(this.stream.slice(0, Math.floor((w - pad * 2) / (s * T.charW * 0.92))), pad, sy, s * 0.9, a * 0.45, 0);
    // timecode
    const tc = `T+${F.time.toFixed(3).padStart(9, '0')}`;
    T.text(tc, w - pad - T.width(tc, s), sy, s, a * 0.7, 0);
  }

  render(target) {
    const r = this.V.renderer;
    r.setRenderTarget(this.linesRT);
    r.clear(true, true);
    r.render(this.scene, this.cam);
    this.comp.render(r, target);
    this.text.render(r, target);
  }
}
