// UNIT — scene 3: CYMATIC SPHERE.
// Tens of thousands of GPU particles live on a sphere (state in a float texture, ping-pong).
// Each frame they descend the gradient of Y² where Y is a blend of two real spherical harmonics
// Y_lm — so, like sand on a Chladni plate, they gather on the nodal lines; agitation ∝ |Y|·energy
// bounces them off the antinodes. The (l, m) mode comes from the SUB (and KICK) pitch: a new bass
// note visibly reorganises the form. ENTROPY / SCATTER push particles into the void; transients
// launch shock rings across the surface.
//   RESOLUTION: particle count · COMPLEXITY: mode order · SCATTER

import { THREE, Pass, PingPong, GLSL, stateType } from '../gl.js';
import { clamp } from '../../core/util.js';

// 12 pitch classes → visually distinct (l, m) modes
const MODES = [[4, 2], [5, 2], [6, 3], [6, 2], [7, 3], [8, 4], [5, 1], [8, 3], [9, 4], [10, 5], [7, 4], [9, 3]];
const SIZES = [96, 128, 160, 192, 224, 256];

const SH = /* glsl */ `
float legendre(float l, float m, float x) {
  float pmm = 1.0;
  if (m > 0.0) {
    float s = sqrt(max(0.0, (1.0 - x) * (1.0 + x)));
    float f = 1.0;
    for (int i = 1; i <= 16; i++) { if (float(i) > m) break; pmm *= -f * s; f += 2.0; }
  }
  if (l == m) return pmm;
  float p1 = x * (2.0 * m + 1.0) * pmm;
  if (l == m + 1.0) return p1;
  float pl = 0.0;
  for (int i = 2; i <= 18; i++) {
    float L = m + float(i);
    if (L > l) break;
    pl = (x * (2.0 * L - 1.0) * p1 - (L + m - 1.0) * pmm) / (L - m);
    pmm = p1; p1 = pl;
  }
  return pl;
}
uniform vec4 uModeA, uModeB;   // l, m, norm, rotation
uniform float uMix;
float Ysh(vec3 p, vec4 md) {
  float th = acos(clamp(p.z, -1.0, 1.0));
  float ph = atan(p.y, p.x) + md.w;
  return legendre(md.x, md.y, cos(th)) * cos(md.y * ph) * md.z;
}
float field(vec3 p) { return mix(Ysh(p, uModeA), Ysh(p, uModeB), uMix); }
`;

const SIM_FRAG = /* glsl */ `
uniform sampler2D uState;
uniform float uTime, uDt, uStep, uAgit, uScatter, uShock, uSpring, uS;
uniform vec4 uRing[4];         // axis.xyz, age
varying vec2 vUv;
${GLSL.hash}
${SH}
void main() {
  vec4 s = texture2D(uState, vUv);
  vec3 p = normalize(s.xyz);
  float w = s.w;
  vec3 t1 = normalize(cross(p, abs(p.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(p, t1);
  float e = 0.012;
  float f = field(p);
  float fx = field(normalize(p + t1 * e)), fy = field(normalize(p + t2 * e));
  vec2 g = vec2(fx - f, fy - f) / e;
  // descend f² (towards nodal lines)
  vec3 mv = -(t1 * g.x + t2 * g.y) * f * uStep;
  // agitation at antinodes
  vec2 r = hash22(vUv * 913.7 + fract(uTime * 0.37) * 71.0) - 0.5;
  mv += (t1 * r.x + t2 * r.y) * abs(f) * uAgit;
  float lm = length(mv); if (lm > 0.05) mv *= 0.05 / lm;
  // spring back to the particle's home on a Fibonacci sphere: the surface stays covered, the
  // nodal lines appear as denser bands whose contrast grows with energy
  vec2 cell = floor(vUv * uS);
  float idx = cell.y * uS + cell.x, n = uS * uS;
  float hy = 1.0 - 2.0 * (idx + 0.5) / n, hr = sqrt(max(0.0, 1.0 - hy * hy));
  float ht = fract(idx * 0.381966) * 6.2831853;
  vec3 home = vec3(cos(ht) * hr, hy, sin(ht) * hr);
  mv += (home - p) * uSpring;
  p = normalize(p + mv);
  // radial scatter: a fraction of particles drift into the void, the rest settle back
  float hsel = hash12(vUv * 517.3);
  float target = hsel < uScatter ? (0.15 + hash12(vUv * 91.1) * 1.4) * uScatter * 1.6 : 0.0;
  w += (target - w) * (target > w ? 0.6 : 2.5) * uDt;
  // shock rings push outward
  for (int i = 0; i < 4; i++) {
    vec4 rg = uRing[i];
    if (rg.w < 0.0) continue;
    float ang = acos(clamp(dot(p, rg.xyz), -1.0, 1.0));
    float d = ang - rg.w * 2.6;
    w += exp(-d * d * 120.0) * uShock * exp(-rg.w * 2.5) * uDt * 6.0;
  }
  gl_FragColor = vec4(p, w);
}`;

const PT_VERT = /* glsl */ `
attribute vec2 aRef;
uniform sampler2D uState;
uniform float uTime, uR, uVib, uSize, uPx, uKick;
uniform vec4 uRing[4];
varying float vB; varying float vA; varying float vW;
${SH}
void main() {
  vec4 s = texture2D(uState, aRef);
  vec3 p = normalize(s.xyz);
  float f = field(p);
  float ring = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rg = uRing[i];
    if (rg.w < 0.0) continue;
    float d = acos(clamp(dot(p, rg.xyz), -1.0, 1.0)) - rg.w * 2.6;
    ring += exp(-d * d * 160.0) * exp(-rg.w * 2.2);
  }
  float rad = uR * (1.0 + f * uVib * cos(uTime * 9.0) + ring * 0.06 + s.w + uKick * 0.03);
  vec4 mv = modelViewMatrix * vec4(p * rad, 1.0);
  gl_Position = projectionMatrix * mv;
  // front hemisphere brighter than the back: reads as a solid form without depth testing
  vec3 nv = normalize(normalMatrix * p);
  float facing = 0.35 + 0.65 * smoothstep(-0.6, 0.8, nv.z);
  float near = 1.0 - smoothstep(0.0, 0.3, abs(f));        // bright on nodal lines
  vB = (0.22 + near * 0.78 + ring * 1.2) * facing;
  vA = clamp(abs(f) * 2.0, 0.0, 1.0) * 0.45 + ring;           // accent where agitated
  vW = s.w;
  float depth = -mv.z;
  gl_PointSize = max(1.0, uSize * uPx / depth);
  vB *= smoothstep(9.0, 2.0, depth) * (1.0 - smoothstep(0.2, 1.6, s.w) * 0.7);
}`;
const PT_FRAG = /* glsl */ `
uniform vec3 uFg, uAccent;
varying float vB; varying float vA; varying float vW;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(mix(uFg, uAccent, clamp(vA, 0.0, 1.0)) * vB * a * 0.55, 1.0);
}`;

function legendreJS(l, m, x) {
  let pmm = 1;
  if (m > 0) { const s = Math.sqrt(Math.max(0, (1 - x) * (1 + x))); let f = 1; for (let i = 1; i <= m; i++) { pmm *= -f * s; f += 2; } }
  if (l === m) return pmm;
  let p1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return p1;
  let pl = 0;
  for (let L = m + 2; L <= l; L++) { pl = (x * (2 * L - 1) * p1 - (L + m - 1) * pmm) / (L - m); pmm = p1; p1 = pl; }
  return pl;
}
const normCache = new Map();
function modeNorm(l, m) {
  const k = l * 100 + m;
  if (normCache.has(k)) return normCache.get(k);
  let mx = 1e-9;
  for (let i = 0; i <= 400; i++) mx = Math.max(mx, Math.abs(legendreJS(l, m, -1 + (2 * i) / 400)));
  normCache.set(k, 1 / mx);
  return 1 / mx;
}

export class CymaticSphere {
  static title = 'CYMATIC SPHERE';
  static params = ['RESOLUTION', 'COMPLEX', 'SCATTER'];
  static formats = [(n) => { const s = SIZES[Math.min(5, Math.floor(n * 6))]; return Math.round((s * s) / 1000) + 'k'; }, null, null];

  constructor(V) {
    this.V = V;
    this.simU = {
      uState: { value: null }, uTime: { value: 0 }, uDt: { value: 0.016 }, uStep: { value: 0.02 }, uAgit: { value: 0.01 },
      uScatter: { value: 0 }, uShock: { value: 0.5 }, uSpring: { value: 0.03 }, uS: { value: 128 },
      uModeA: { value: new THREE.Vector4(4, 2, 1, 0) }, uModeB: { value: new THREE.Vector4(4, 2, 1, 0) }, uMix: { value: 0 },
      uRing: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, -1)) },
    };
    this.sim = new Pass(SIM_FRAG, this.simU);
    this.ptU = {
      uState: { value: null }, uTime: { value: 0 }, uR: { value: 1 }, uVib: { value: 0.05 }, uSize: { value: 2 }, uPx: { value: 1 }, uKick: { value: 0 },
      uFg: { value: V.palette.fg }, uAccent: { value: V.palette.accent },
      uModeA: this.simU.uModeA, uModeB: this.simU.uModeB, uMix: this.simU.uMix, uRing: this.simU.uRing,
    };
    this.ptMat = new THREE.ShaderMaterial({
      vertexShader: PT_VERT, fragmentShader: PT_FRAG, uniforms: this.ptU,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.size = 0;
    this.modeKey = '';
    this.modeT = 1;
    this.rings = []; this.kick = 0;
  }

  build(S) {
    this.size = S;
    const r = this.V.renderer;
    if (this.state) this.state.dispose();
    this.state = new PingPong(r, S, S, { type: stateType(r), nearest: true });
    // initial state: Fibonacci sphere
    const n = S * S, data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - y * y), th = ((i * 0.381966) % 1) * Math.PI * 2;
      data[i * 4] = Math.cos(th) * rr; data[i * 4 + 1] = y; data[i * 4 + 2] = Math.sin(th) * rr; data[i * 4 + 3] = 0;
    }
    const init = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.FloatType);
    init.needsUpdate = true;
    const copy = new Pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }`, { t: { value: init } });
    copy.render(r, this.state.read); copy.render(r, this.state.write);
    init.dispose(); copy.material.dispose();
    if (this.points) { this.group.remove(this.points); this.points.geometry.dispose(); }
    const ref = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { ref[i * 2] = ((i % S) + 0.5) / S; ref[i * 2 + 1] = (Math.floor(i / S) + 0.5) / S; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(g, this.ptMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  resize(w, h) { this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.h = h; }

  onHit(ev) {
    if (ev.track === 0 || ev.track === 2 || ev.track === 4) {
      if (ev.track === 0) this.kick = Math.max(this.kick, ev.vel);
      const a = Math.random() * Math.PI * 2, z = Math.random() * 2 - 1, r = Math.sqrt(1 - z * z);
      this.rings.push({ axis: [Math.cos(a) * r, Math.sin(a) * r, z], t: this.V.time, s: ev.vel * (ev.track === 0 ? 1 : 0.6) });
      if (this.rings.length > 4) this.rings.shift();
    }
  }

  /** Choose the (l, m) mode from SUB / KICK pitch and COMPLEXITY. */
  pickMode(F, cx) {
    const note = Math.round(12 * Math.log2((F.pitch.sub || 55) / 440) + 69);
    const kn = Math.round(12 * Math.log2((F.pitch.kick || 50) / 440) + 69);
    const [l0, m0] = MODES[((note % 12) + 12) % 12];
    const oct = Math.floor(note / 12) - 2;
    const scale = 0.55 + cx * 0.9;
    const l = clamp(Math.round((l0 + Math.max(0, oct)) * scale), 2, 16);
    const m = clamp(Math.round(m0 * scale), 0, l);
    const rot = (((kn % 12) + 12) % 12) / 12 * Math.PI;
    return [l, m, rot];
  }

  update(F) {
    const [pRes, pCx, pSc] = F.params;
    const S = SIZES[Math.min(5, Math.floor(pRes * 6))];
    if (S !== this.size) this.build(S);
    const u = this.simU, t = this.V.time;
    // mode transitions
    const [l, m, rot] = this.pickMode(F, pCx);
    const key = l + ',' + m;
    if (key !== this.modeKey) {
      // freeze the current blend into A, fade towards the new mode B
      const A = u.uModeA.value, B = u.uModeB.value;
      if (this.modeT >= 0.5) A.copy(B);
      B.set(l, m, modeNorm(l, m), rot);
      this.modeKey = key; this.modeT = 0;
    }
    this.modeT = Math.min(1, this.modeT + F.dt * 1.2);
    u.uMix.value = this.modeT * this.modeT * (3 - 2 * this.modeT);
    const energy = clamp(F.sub * 0.6 + F.low * 0.5 + F.env[1] * 0.4 + F.env[0] * 0.3);
    const react = F.react;
    u.uTime.value = F.time; u.uDt.value = F.dt;
    u.uStep.value = 0.03 * (0.25 + energy * 1.2) * (F.dt * 60);
    u.uSpring.value = (0.012 + (1 - energy) * 0.03) * (F.dt * 60);
    u.uS.value = this.size;
    u.uAgit.value = (0.009 + energy * 0.035 * react + F.transient * 0.025 * react) * (F.dt * 60);
    u.uScatter.value = clamp(pSc * 0.6 + F.entropy * 0.7);
    u.uShock.value = 0.5 * react;
    this.rings = this.rings.filter((r) => t - r.t < 1.6);
    u.uRing.value.forEach((v, i) => {
      const r = this.rings[i];
      if (r) v.set(r.axis[0], r.axis[1], r.axis[2], (t - r.t) * (0.6 + r.s * 0.6)); else v.set(0, 0, 1, -1);
    });
    this.kick *= Math.exp(-F.dt * 8);
    const p = this.ptU;
    p.uTime.value = F.time;
    p.uR.value = 0.9 + F.depth * 0.35 + F.env[0] * 0.03 * react;
    p.uVib.value = (0.01 + energy * 0.08) * react;
    p.uKick.value = this.kick * react;
    p.uPx.value = this.h / 900;
    p.uSize.value = 3.2 * (1.25 - (S - 96) / 400);
    // slow orbit
    const a = F.time * 0.07;
    this.cam.position.set(Math.sin(a) * 4.2, Math.sin(F.time * 0.05) * 1.2, Math.cos(a) * 4.2);
    this.cam.lookAt(0, 0, 0);
    this.group.rotation.y += F.dt * 0.03;
  }

  render(target) {
    const r = this.V.renderer;
    this.simU.uState.value = this.state.read.texture;
    this.sim.render(r, this.state.write);
    this.state.swap();
    this.ptU.uState.value = this.state.read.texture;
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, this.cam);
  }
}
