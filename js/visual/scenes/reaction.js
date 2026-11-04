// UNIT — scene 5: REACTION-DIFFUSION.
// Gray–Scott on the GPU (float ping-pong, 9-point Laplacian, several iterations per frame),
// growing like alien cells or coral. Bass feeds growth (faster, slightly higher feed), CLICK seeds
// new spots, NOISE disturbs the field, DRONE slowly drifts (f, k) toward the next pattern type.
// Rendered as thin, high-contrast iso-lines — never filled colour.
//   PRESET: feed/kill pair · SPEED: iterations per frame · SEEDS: seeding density

import { THREE, Pass, PingPong, GLSL, stateType } from '../gl.js';
import { clamp } from '../../core/util.js';

export const RD_PRESETS = [
  ['CORAL', 0.0545, 0.062], ['MITOSIS', 0.0367, 0.0649], ['WORMS', 0.078, 0.061],
  ['SPOTS', 0.03, 0.062], ['MAZE', 0.029, 0.057], ['SKATE', 0.062, 0.0609],
];

const SIM = /* glsl */ `
uniform sampler2D uS;
uniform vec2 uTx;
uniform float uF, uK, uNoise, uTime;
uniform vec4 uSeed[12];          // x, y (uv), radius (texels), strength
varying vec2 vUv;
${GLSL.hash}
void main() {
  vec2 s = texture2D(uS, vUv).rg;
  vec2 l = -s
    + 0.2 * (texture2D(uS, vUv + vec2(uTx.x, 0.0)).rg + texture2D(uS, vUv - vec2(uTx.x, 0.0)).rg
           + texture2D(uS, vUv + vec2(0.0, uTx.y)).rg + texture2D(uS, vUv - vec2(0.0, uTx.y)).rg)
    + 0.05 * (texture2D(uS, vUv + uTx).rg + texture2D(uS, vUv - uTx).rg
            + texture2D(uS, vUv + vec2(uTx.x, -uTx.y)).rg + texture2D(uS, vUv + vec2(-uTx.x, uTx.y)).rg);
  float u = s.r, v = s.g, uvv = u * v * v;
  u += 1.0 * l.r - uvv + uF * (1.0 - u);
  v += 0.5 * l.g + uvv - (uF + uK) * v;
  for (int i = 0; i < 12; i++) {
    vec4 sd = uSeed[i];
    if (sd.w <= 0.0) continue;
    vec2 d = (vUv - sd.xy) / uTx;
    if (dot(d, d) < sd.z * sd.z) { v = max(v, 0.5 * sd.w); u = min(u, 0.5); }
  }
  if (uNoise > 0.0) v += (hash12(vUv * 1731.0 + uTime) - 0.5) * uNoise * step(0.02, u);
  gl_FragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

const VIEW = /* glsl */ `
uniform sampler2D uS;
uniform vec3 uFg, uAccent;
uniform float uPulse, uCont;
varying vec2 vUv;
float iso(float v, float t) { float d = abs(v - t) / max(fwidth(v), 1e-4); return 1.0 - smoothstep(0.4, 1.4, d); }
void main() {
  float v = texture2D(uS, vUv).g;
  float a = iso(v, 0.22);
  float b = iso(v, 0.12) * 0.35;
  float c = iso(v, 0.32) * 0.25;
  float fill = smoothstep(0.18, 0.4, v) * 0.045;
  vec3 col = uFg * (a * uCont + c + fill) + uAccent * b * (0.6 + uPulse);
  col += uFg * a * uPulse * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

export class ReactionDiffusion {
  static title = 'REACTION-DIFFUSION';
  static params = ['PRESET', 'SPEED', 'SEEDS'];
  static steps = [RD_PRESETS.length, 0, 0];
  static formats = [(n) => RD_PRESETS[Math.min(RD_PRESETS.length - 1, Math.floor(n * RD_PRESETS.length))][0], (n) => String(2 + Math.round(n * 22)), null];

  constructor(V) {
    this.V = V;
    this.simU = { uS: { value: null }, uTx: { value: new THREE.Vector2() }, uF: { value: 0.0545 }, uK: { value: 0.062 }, uNoise: { value: 0 }, uTime: { value: 0 }, uSeed: { value: [...Array(12)].map(() => new THREE.Vector4()) } };
    this.sim = new Pass(SIM, this.simU);
    this.view = new Pass(VIEW, { uS: { value: null }, uFg: { value: V.palette.fg }, uAccent: { value: V.palette.accent }, uPulse: { value: 0 }, uCont: { value: 1 } });
    this.seeds = []; this.noise = 0; this.pulse = 0; this.drift = 0;
    this.f = 0.0545; this.k = 0.062;
  }

  resize(w, h) {
    const W = 512, H = Math.max(96, Math.round(W / (w / h)));
    if (this.W === W && this.H === H) return;
    this.W = W; this.H = H;
    const r = this.V.renderer;
    if (this.state) this.state.dispose();
    this.state = new PingPong(r, W, H, { type: stateType(r), wrap: THREE.RepeatWrapping });
    this.simU.uTx.value.set(1 / W, 1 / H);
    // initial: u = 1, v = 0 with a scatter of seed squares
    const d = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { d[i * 4] = 1; d[i * 4 + 3] = 1; }
    for (let s = 0; s < 26; s++) {
      const cx = Math.floor(Math.random() * W), cy = Math.floor(Math.random() * H), rr = 2 + Math.floor(Math.random() * 4);
      for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
        const i = (((cy + y + H) % H) * W + ((cx + x + W) % W)) * 4;
        d[i] = 0.5; d[i + 1] = 0.25 + Math.random() * 0.1;
      }
    }
    const tex = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
    const copy = new Pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }`, { t: { value: tex } });
    copy.render(r, this.state.read); copy.render(r, this.state.write);
    tex.dispose(); copy.material.dispose();
  }

  onHit(ev) {
    const [, , pSeed] = this.F?.params || [0, 0, 0.4];
    if (ev.track === 2) {
      const n = 1 + Math.round(pSeed * 4 * ev.vel);
      for (let i = 0; i < n; i++) this.seeds.push([Math.random(), Math.random(), 1.5 + Math.random() * 3 * (0.5 + pSeed), 1]);
    } else if (ev.track === 6) {
      // DATA: a short row of seeds, like a bit pattern
      const y = Math.random(), x0 = Math.random() * 0.7;
      for (let i = 0; i < 4; i++) if (Math.random() < 0.6) this.seeds.push([x0 + i * 0.03, y, 1.5, 1]);
    } else if (ev.track === 4) this.noise = Math.max(this.noise, 0.05 * ev.vel);
    else if (ev.track === 0) this.pulse = Math.max(this.pulse, ev.vel);
    if (this.seeds.length > 12) this.seeds.splice(0, this.seeds.length - 12);
  }

  update(F) {
    this.F = F;
    const [pPre, pSpeed, pSeed] = F.params;
    const pi = Math.min(RD_PRESETS.length - 1, Math.floor(pPre * RD_PRESETS.length));
    // DRONE drifts slowly towards the next preset
    const tgt = clamp(F.env[7] * 0.9 + F.entropy * 0.3);
    this.drift += (tgt - this.drift) * (1 - Math.exp(-F.dt * 0.25));
    const a = RD_PRESETS[pi], b = RD_PRESETS[(pi + 1) % RD_PRESETS.length];
    const f = a[1] + (b[1] - a[1]) * this.drift, k = a[2] + (b[2] - a[2]) * this.drift;
    this.f += (f - this.f) * 0.05; this.k += (k - this.k) * 0.05;
    const bass = clamp(F.sub * 0.6 + F.low * 0.4) * F.react;
    this.simU.uF.value = this.f + bass * 0.004;
    this.simU.uK.value = this.k;
    this.iters = Math.round((2 + pSpeed * 22) * (0.7 + bass * 0.8) * Math.min(2, F.dt * 60));
    // ambient seeding so the field never dies; ENTROPY adds more
    if (Math.random() < (0.01 + pSeed * 0.03 + F.entropy * 0.05) * F.dt * 60) this.seeds.push([Math.random(), Math.random(), 2 + Math.random() * 2, 1]);
    this.noise = this.noise * Math.exp(-F.dt * 10) + F.entropy * 0.004 * Math.random();
    this.pulse *= Math.exp(-F.dt * 6);
    this.view.uniforms.uPulse.value = this.pulse * F.react;
    this.view.uniforms.uCont.value = 0.75 + F.mood * 0.4;
    this.simU.uTime.value = F.time;
  }

  render(target) {
    const r = this.V.renderer, u = this.simU;
    for (let i = 0; i < this.iters; i++) {
      // seeds and noise are injected on the first iteration only
      u.uSeed.value.forEach((v, j) => { const s = i === 0 ? this.seeds[j] : null; if (s) v.set(s[0], s[1], s[2], s[3]); else v.set(0, 0, 0, 0); });
      u.uNoise.value = i === 0 ? this.noise : 0;
      u.uS.value = this.state.read.texture;
      this.sim.render(r, this.state.write);
      this.state.swap();
    }
    this.seeds.length = 0;
    this.view.uniforms.uS.value = this.state.read.texture;
    this.view.render(r, target);
  }
}
