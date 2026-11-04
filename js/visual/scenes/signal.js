// UNIT — scene 4: SIGNAL. Raw, minimal circuitry in three strictly geometric layers:
//   · signal lines (front): one bundle of vertical traces per track; a hit re-routes the bundle
//     sideways in clean 45° (or 90°) PCB jogs, then it snaps back — rhythm becomes routing.
//   · lattice (back): a sparse 3D lattice of orthogonal traces with node dots; the camera drifts
//     through it. DRONE and SUB light segments, KICK pulses the whole structure.
//   · spectrum columns (middle): dense particle dust per frequency band, rising and falling with
//     band energy; hard glitch dropouts on DATA and CLICK.
// Monochrome + cold accent; dark MOOD lets a warm amber appear, sparingly.
//   DENSITY: traces per bundle · CHAOS: routing chaos · DEPTH: flat ↔ 3D lattice

import { THREE, GLSL } from '../gl.js';
import { rng, clamp } from '../../core/util.js';

const V_PER_LINE = 180;
const COLS = 32, DUST = 300;

const LINE_VERT = /* glsl */ `
attribute vec3 aL;               // bundle, index in bundle, y (−1..1)
uniform vec4 uR1[8], uR2[8];     // routes: y0, y1, dx, amount
uniform vec2 uSlope[8];
uniform float uAspect, uSp, uN, uJit, uTime;
uniform float uB[8];
varying float vB; varying float vAcc;
${GLSL.hash}
float jog(float y, vec4 r, float slope, float shift) {
  float dx = r.z * r.w;
  if (abs(dx) < 1e-4) return 0.0;
  float L = abs(dx) / slope;
  float a = clamp((r.x - shift - y) / L, 0.0, 1.0);
  float b = clamp((r.y + shift - y) / L, 0.0, 1.0);
  return dx * (a - b);
}
void main() {
  float b = aL.x, k = aL.y, y = aL.z;
  float span = uAspect * 1.84;
  float cx = -uAspect * 0.92 + (b + 0.5) * span / 8.0;
  float x = cx + (k - (uN - 1.0) * 0.5) * uSp;
  int bi = int(b);
  vec4 r1 = uR1[bi], r2 = uR2[bi];
  // parallel bus: each trace starts its bend a little later so spacing stays even on the diagonal
  float s1 = (r1.z > 0.0 ? (uN - 1.0 - k) : k) * uSp * 0.414;
  float s2 = (r2.z > 0.0 ? (uN - 1.0 - k) : k) * uSp * 0.414;
  x += jog(y, r1, uSlope[bi].x, s1) + jog(y, r2, uSlope[bi].y, s2);
  x += (hash11(floor(y * 40.0) + b * 7.0 + floor(uTime * 20.0)) - 0.5) * uJit;
  float routed = max(r1.w, r2.w);
  vB = 0.22 + 0.78 * max(routed, uB[bi]);
  vAcc = routed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
}`;
const LINE_FRAG = /* glsl */ `
uniform vec3 uFg, uAccent;
varying float vB; varying float vAcc;
void main() { gl_FragColor = vec4(mix(uFg, uAccent, vAcc * 0.6) * vB, 1.0); }`;

const LAT_VERT = /* glsl */ `
attribute vec4 aS;               // seg id hash, centre z, kind (0 line, 1 node), -
uniform float uTravel, uD, uLit, uKick, uTime, uRate, uAmberMix;
varying float vB; varying float vAmb;
${GLSL.hash}
void main() {
  vec3 p = position;
  // wrap along z by segment centre so segments never stretch across the seam
  float cz = aS.y;
  float nz = mod(cz + uTravel, uD) - uD + 1.0;
  p.z += nz - cz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float slot = floor(uTime * uRate);
  float lit = step(hash11(aS.x * 91.7 + slot), uLit);
  float depth = -mv.z;
  float fog = smoothstep(14.0, 2.0, depth) * smoothstep(0.3, 1.5, depth);
  vB = (0.08 + lit * 0.9 + uKick * 0.35) * fog * (aS.z > 0.5 ? 1.6 : 1.0);
  vAmb = lit * step(hash11(aS.x * 13.3), uAmberMix);
  gl_PointSize = aS.z > 0.5 ? max(1.5, 3.0 / max(depth * 0.35, 0.5)) : 1.0;
}`;
const LAT_FRAG = /* glsl */ `
uniform vec3 uFg, uAccent, uAmber; uniform float uAlpha;
varying float vB; varying float vAmb;
void main() { gl_FragColor = vec4(mix(mix(uFg, uAccent, 0.35), uAmber, vAmb) * vB * uAlpha, 1.0); }`;

const DUST_VERT = /* glsl */ `
attribute vec4 aD;               // column, x jitter, y seed, speed
uniform float uE[${COLS}];
uniform float uDrop[${COLS}];
uniform float uAspect, uTime, uPx, uFlat;
varying float vB;
void main() {
  int c = int(aD.x);
  float e = uE[c];
  float span = uAspect * 1.84, w = span / ${COLS.toFixed(1)};
  float x = -uAspect * 0.92 + (aD.x + 0.5) * w + (aD.y - 0.5) * w * 0.62;
  float ry = fract(aD.z + uTime * aD.w * (0.02 + e * 0.12));
  float h = e * 1.7;
  float y = -0.92 + ry * h;
  float vis = step(0.5, 1.0 - uDrop[c]) * step(0.004, e);
  float top = smoothstep(0.85, 1.0, ry);
  vB = vis * (0.3 + top * 0.9) * (0.5 + e);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, -0.01, 1.0);
  gl_PointSize = uPx * (1.0 + top);
}`;
const DUST_FRAG = /* glsl */ `
uniform vec3 uFg, uAccent;
varying float vB;
void main() { if (vB < 0.01) discard; gl_FragColor = vec4(mix(uFg, uAccent, 0.45) * vB * 0.85, 1.0); }`;

export class Signal {
  static title = 'SIGNAL';
  static params = ['DENSITY', 'CHAOS', 'DEPTH'];
  static formats = [(n) => String(2 + Math.round(n * 5)), null, null];

  constructor(V) {
    this.V = V;
    const pal = V.palette;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.front = new THREE.Scene();
    this.lineU = {
      uR1: { value: [...Array(8)].map(() => new THREE.Vector4()) }, uR2: { value: [...Array(8)].map(() => new THREE.Vector4()) },
      uSlope: { value: [...Array(8)].map(() => new THREE.Vector2(1, 1)) },
      uAspect: { value: 1 }, uSp: { value: 0.016 }, uN: { value: 4 }, uJit: { value: 0 }, uTime: { value: 0 },
      uB: { value: new Array(8).fill(0) }, uFg: { value: pal.fg }, uAccent: { value: pal.accent },
    };
    this.lineMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: this.lineU, blending: THREE.AdditiveBlending, depthTest: false, transparent: true });
    this.n = 0;
    // dust columns
    const d = new Float32Array(COLS * DUST * 4), r = rng(42);
    for (let c = 0; c < COLS; c++) for (let i = 0; i < DUST; i++) { const o = (c * DUST + i) * 4; d[o] = c; d[o + 1] = r(); d[o + 2] = r(); d[o + 3] = 0.3 + r(); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('aD', new THREE.BufferAttribute(d, 4));
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COLS * DUST * 3), 3));
    this.dustU = { uE: { value: new Array(COLS).fill(0) }, uDrop: { value: new Array(COLS).fill(0) }, uAspect: { value: 1 }, uTime: { value: 0 }, uPx: { value: 1 }, uFlat: { value: 0 }, uFg: { value: pal.fg }, uAccent: { value: pal.accent } };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, uniforms: this.dustU, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
    this.dust.frustumCulled = false;
    this.front.add(this.dust);
    // lattice
    this.back = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(55, 1, 0.1, 40);
    this.latU = {
      uTravel: { value: 0 }, uD: { value: 16 }, uLit: { value: 0 }, uKick: { value: 0 }, uTime: { value: 0 }, uRate: { value: 2 }, uAmberMix: { value: 0 },
      uFg: { value: pal.fg }, uAccent: { value: pal.accent }, uAmber: { value: pal.amber }, uAlpha: { value: 1 },
    };
    this.buildLattice();
    this.routes = [...Array(8)].map(() => [{ y0: 0, y1: 0, dx: 0, t: -9, hold: 0.1, slope: 1 }, { y0: 0, y1: 0, dx: 0, t: -9, hold: 0.1, slope: 1 }]);
    this.drop = new Array(COLS).fill(0);
    this.travel = 0; this.kick = 0; this.chaos = 0;
  }

  buildLattice() {
    const r = rng(1234), segs = new Map(), nodes = [];
    const G = 0.62, NX = 12, NY = 7, NZ = 26;
    for (let w = 0; w < 90; w++) {
      let p = [Math.floor(r() * NX), Math.floor(r() * NY), Math.floor(r() * NZ)];
      let axis = Math.floor(r() * 3);
      const steps = 4 + Math.floor(r() * 10);
      nodes.push(p.slice());
      for (let s = 0; s < steps; s++) {
        if (r() < 0.35) { axis = (axis + 1 + Math.floor(r() * 2)) % 3; nodes.push(p.slice()); }
        const q = p.slice(); q[axis] += r() < 0.5 ? -1 : 1;
        if (q[axis] < 0 || q[axis] >= [NX, NY, NZ][axis]) continue;
        const key = [p, q].map((v) => v.join(',')).sort().join('|');
        segs.set(key, [p.slice(), q.slice()]);
        p = q;
      }
      nodes.push(p.slice());
    }
    const toW = (v) => [(v[0] - NX / 2) * G, (v[1] - NY / 2) * G, -v[2] * G];
    const pos = [], att = [];
    let id = 0;
    for (const [a, b] of segs.values()) {
      const A = toW(a), B = toW(b), cz = (A[2] + B[2]) / 2, h = (id++ * 0.618034) % 1;
      pos.push(...A, ...B); att.push(h, cz, 0, 0, h, cz, 0, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('aS', new THREE.Float32BufferAttribute(att, 4));
    const mat = new THREE.ShaderMaterial({ vertexShader: LAT_VERT, fragmentShader: LAT_FRAG, uniforms: this.latU, blending: THREE.AdditiveBlending, depthTest: false, transparent: true });
    this.lat = new THREE.LineSegments(lg, mat);
    const np = [], na = [];
    for (const n of nodes) { const W = toW(n), h = (id++ * 0.618034) % 1; np.push(...W); na.push(h, W[2], 1, 0); }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    ng.setAttribute('aS', new THREE.Float32BufferAttribute(na, 4));
    this.nodes = new THREE.Points(ng, mat);
    this.lat.frustumCulled = this.nodes.frustumCulled = false;
    this.back.add(this.lat, this.nodes);
    this.latU.uD.value = NZ * G;
  }

  buildLines(n) {
    this.n = n;
    if (this.lines) { this.front.remove(this.lines); this.lines.geometry.dispose(); }
    const att = [], idx = [];
    let v = 0;
    for (let b = 0; b < 8; b++) for (let k = 0; k < n; k++) {
      for (let i = 0; i < V_PER_LINE; i++) {
        att.push(b, k, 1.05 - (2.1 * i) / (V_PER_LINE - 1));
        if (i < V_PER_LINE - 1) idx.push(v + i, v + i + 1);
      }
      v += V_PER_LINE;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('aL', new THREE.Float32BufferAttribute(att, 3));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(att.length), 3));
    g.setIndex(idx);
    this.lines = new THREE.LineSegments(g, this.lineMat);
    this.lines.frustumCulled = false;
    this.front.add(this.lines);
    this.lineU.uN.value = n;
  }

  resize(w, h) {
    const a = w / h;
    this.aspect = a;
    this.ortho.left = -a; this.ortho.right = a; this.ortho.updateProjectionMatrix();
    this.persp.aspect = a; this.persp.updateProjectionMatrix();
    this.h = h;
  }

  onHit(ev) {
    const t = this.V.time, ch = this.chaos;
    const R = this.routes[ev.track];
    const slot = ch > 0.45 && Math.random() < ch * 0.6 && t - R[0].t < 0.25 ? 1 : 0;
    const y0 = 0.75 - Math.random() * (0.9 + ch * 0.6);
    const len = 0.15 + Math.random() * (0.35 + ch * 0.6) * (0.6 + ev.vel);
    const mag = (0.04 + ev.vel * 0.16 + Math.random() * ch * 0.25) * (Math.random() < 0.5 ? -1 : 1);
    R[slot] = { y0, y1: y0 - len, dx: mag, t, hold: 0.05 + ev.vel * 0.09 + ch * 0.06, slope: ch > 0.2 && Math.random() < ch * 0.5 ? 14 : 1 };
    if (ev.track === 0) this.kick = Math.max(this.kick, ev.vel);
    if (ev.track === 6 || ev.track === 2) {
      const n = ev.track === 6 ? 3 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.drop[Math.floor(Math.random() * COLS)] = 2 + Math.floor(Math.random() * 5);
    }
  }

  update(F) {
    const [pDen, pCh, pDepth] = F.params;
    const n = 2 + Math.round(pDen * 5);
    if (n !== this.n) this.buildLines(n);
    this.chaos = clamp(pCh + F.entropy * 0.5);
    const t = this.V.time, react = F.react, lu = this.lineU;
    lu.uAspect.value = this.aspect; lu.uTime.value = F.time;
    lu.uSp.value = 0.013 + (7 - n) * 0.002;
    lu.uJit.value = F.entropy * 0.01 * react;
    for (let b = 0; b < 8; b++) {
      for (let s = 0; s < 2; s++) {
        const r = this.routes[b][s], age = t - r.t;
        // hold, then snap back in a few quantised steps
        let amt = age < r.hold ? 1 : Math.max(0, 1 - Math.ceil(((age - r.hold) / 0.09) * 4) / 4);
        amt *= 0.4 + react * 0.8;
        (s ? lu.uR2 : lu.uR1).value[b].set(r.y0, r.y1, r.dx, Math.min(1, amt));
        lu.uSlope.value[b].setComponent(s, r.slope);
      }
      lu.uB.value[b] = F.env[b] * 0.5;
    }
    // dust columns
    const du = this.dustU;
    du.uAspect.value = this.aspect; du.uTime.value = F.time; du.uPx.value = Math.max(1, this.h / 600);
    for (let c = 0; c < COLS; c++) {
      let m = 0;
      for (let k = 0; k < 4; k++) m = Math.max(m, F.spectrum[c * 4 + k]);
      du.uE.value[c] = clamp(Math.pow(m, 1.5) * (0.6 + react * 0.6));
      du.uDrop.value[c] = this.drop[c] > 0 ? 1 : 0;
      if (this.drop[c] > 0) this.drop[c]--;
    }
    // lattice
    const L = this.latU;
    this.kick *= Math.exp(-F.dt * 7);
    this.travel += F.dt * (0.25 + (F.playing ? F.bpm / 400 : 0));
    L.uTravel.value = this.travel;
    L.uTime.value = F.time;
    L.uLit.value = clamp(F.env[7] * 0.35 + F.env[1] * 0.3 + F.sub * 0.15) * (0.5 + react * 0.7);
    L.uKick.value = this.kick * react;
    L.uRate.value = 1 + F.bpm / 60;
    L.uAmberMix.value = F.mood < 0.35 ? (0.35 - F.mood) * 1.2 : 0;
    L.uAlpha.value = pDepth;
    const drift = F.time * 0.04;
    this.persp.position.set(Math.sin(drift) * 0.8, 0.2 + Math.sin(drift * 0.7) * 0.4, 1.2);
    this.persp.lookAt(Math.sin(drift * 1.3) * 0.3, 0, -6);
    this.persp.fov = 40 + pDepth * 30; this.persp.updateProjectionMatrix();
  }

  render(target) {
    const r = this.V.renderer;
    r.setRenderTarget(target);
    r.clear();
    if (this.latU.uAlpha.value > 0.01) r.render(this.back, this.persp);
    r.render(this.front, this.ortho);
  }
}
