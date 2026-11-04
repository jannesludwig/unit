// UNIT — visual engine.
//
// Each scene renders into its own float render target. The engine then:
//   1. crossfades the outgoing and incoming scene (smooth scene switches),
//   2. runs a feedback buffer — out = max(scene, previous · decay) — for trails (SPACE),
//   3. adds a very light bloom (¼-res threshold + separable blur),
//   4. grades the result: MOOD palette / contrast, subtle animated grain, soft vignette.
// FREEZE stops scene updates and re-presents the held frame (grain stays alive).
//
// Sync: sequencer hits arrive through Tone.Draw at their audible time (plus output latency),
// so every hit is drawn on the frame it is heard. Continuous analysis comes from Features.

import { THREE, Pass, makeRT, PingPong, GLSL } from './gl.js';
import { Features } from './features.js';
import { Oscilloscope } from './scenes/oscilloscope.js';
import { Datamatics } from './scenes/datamatics.js';
import { CymaticSphere } from './scenes/cymatic.js';
import { Signal } from './scenes/signal.js';
import { ReactionDiffusion } from './scenes/reaction.js';
import { clamp, lerp } from '../core/util.js';

export const SCENE_CLASSES = [Oscilloscope, Datamatics, CymaticSphere, Signal, ReactionDiffusion];

const COMP_FRAG = /* glsl */ `
uniform sampler2D uA, uB; uniform float uMix;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(uA, vUv).rgb, b = texture2D(uB, vUv).rgb;
  // crossfade through a slight dip so two busy scenes never sum to mush
  float m = smoothstep(0.0, 1.0, uMix);
  vec3 c = a * (1.0 - m) * (1.0 - m * 0.35) + b * m * (1.0 - (1.0 - m) * 0.35);
  gl_FragColor = vec4(c, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
uniform sampler2D uCur, uPrev; uniform float uDecay; uniform vec2 uDrift;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uCur, vUv).rgb;
  vec3 p = texture2D(uPrev, vUv + uDrift).rgb * uDecay;
  gl_FragColor = vec4(max(c, p), 1.0);
}`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D uTex; varying vec2 vUv;
void main() { vec3 c = texture2D(uTex, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(c * smoothstep(0.55, 1.2, l), 1.0); }`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 s = texture2D(uTex, vUv).rgb * 0.227;
  s += (texture2D(uTex, vUv + uDir * 1.385).rgb + texture2D(uTex, vUv - uDir * 1.385).rgb) * 0.316;
  s += (texture2D(uTex, vUv + uDir * 3.231).rgb + texture2D(uTex, vUv - uDir * 3.231).rgb) * 0.07;
  gl_FragColor = vec4(s, 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D uTex, uBloom;
uniform float uBloomAmt, uGrain, uTime, uContrast, uGamma, uVig, uExposure;
uniform vec2 uRes;
varying vec2 vUv;
${GLSL.hash}
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * uExposure + texture2D(uBloom, vUv).rgb * uBloomAmt;
  c = c / (1.0 + max(c - 1.0, 0.0));                // soft shoulder above 1
  c = pow(max(c, 0.0), vec3(uGamma));
  c *= uContrast;
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVig * dot(q, q) * 1.6;
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 1000.0) - 0.5;
  c += g * uGrain * (0.35 + 0.65 * (1.0 - c));       // grain lives mostly in the dark
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class VisualEngine {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.canvas = this.renderer.domElement;
    container.prepend(this.canvas);
    this.features = new Features(app.engine);
    this.palette = { accent: new THREE.Color('#5ccfff'), fg: new THREE.Color('#f2f2f2'), amber: new THREE.Color('#ffb35c') };
    this.scenes = [];
    this.sceneRT = [];
    this.cur = clamp(app.project.visual.scene | 0, 0, SCENE_CLASSES.length - 1);
    this.prev = -1;
    this.mix = 1;
    this.frozen = false;
    this.time = 0;
    this.last = performance.now();
    this.dprMax = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = this.dprMax;
    this.slow = 0; this.fast = 0;
    this.fpsAvg = 60;

    const r = this.renderer;
    this.comp = new Pass(COMP_FRAG, { uA: { value: null }, uB: { value: null }, uMix: { value: 1 } });
    this.trailPass = new Pass(TRAIL_FRAG, { uCur: { value: null }, uPrev: { value: null }, uDecay: { value: 0 }, uDrift: { value: new THREE.Vector2() } });
    this.bright = new Pass(BRIGHT_FRAG, { uTex: { value: null } });
    this.blur = new Pass(BLUR_FRAG, { uTex: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.final = new Pass(FINAL_FRAG, {
      uTex: { value: null }, uBloom: { value: null }, uBloomAmt: { value: 0.22 }, uGrain: { value: 0.035 }, uTime: { value: 0 },
      uContrast: { value: 1 }, uGamma: { value: 1 }, uVig: { value: 0.35 }, uRes: { value: new THREE.Vector2() }, uExposure: { value: 1 },
    });
    this.compRT = makeRT(r, 4, 4);
    this.trail = new PingPong(r, 4, 4);
    this.bloomA = makeRT(r, 4, 4); this.bloomB = makeRT(r, 4, 4);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);

    app.on('hitDraw', (ev) => {
      this.features.onHit(ev);
      if (this.frozen) return;
      for (const i of [this.cur, this.prev]) if (i >= 0 && this.scenes[i]) this.scenes[i].onHit?.(ev, this.F);
    });
    app.on('pattern', () => {
      if (this.app.project.visual.auto) this.setScene((this.cur + 1) % SCENE_CLASSES.length);
    });
    app.on('audio', () => {
      this.features.setup();
      const ctx = app.engine.ctx;
      // visuals fire when the hit leaves the speakers, not when it is rendered
      app.seq.avOffset = (ctx.outputLatency || ctx.baseLatency || 0) + 0.006;
    });
    app.on('project', () => { this.setScene(app.project.visual.scene | 0, true); });
    this.ensureScene(this.cur);
  }

  get count() { return SCENE_CLASSES.length; }
  paramNames(i) { return SCENE_CLASSES[i]?.params || ['P1', 'P2', 'P3']; }
  paramMeta(i) { const C = SCENE_CLASSES[i]; return { steps: C?.steps, formats: C?.formats }; }

  ensureScene(i) {
    if (!this.scenes[i]) {
      this.scenes[i] = new SCENE_CLASSES[i](this);
      this.sceneRT[i] = makeRT(this.renderer, this.w, this.h);
      this.scenes[i].resize(this.w, this.h);
    }
    return this.scenes[i];
  }

  setScene(i, instant = false) {
    i = clamp(i | 0, 0, SCENE_CLASSES.length - 1);
    const v = this.app.project.visual;
    v.scene = i;
    if (i !== this.cur) {
      this.ensureScene(i);
      this.prev = instant ? -1 : this.cur;
      this.cur = i;
      this.mix = instant ? 1 : 0;
    }
    this.app.emit('visual');
    this.app.changed();
  }
  setSceneParam(k, val) { const v = this.app.project.visual; v.params[v.scene][k] = val; this.app.changed(); }
  setReactivity(val) { this.app.project.visual.reactivity = val; this.app.changed(); }
  toggleFreeze() { this.frozen = !this.frozen; this.app.emit('visual'); }
  toggleAuto() { const v = this.app.project.visual; v.auto = !v.auto; this.app.emit('visual'); this.app.changed(); }

  resize() {
    const w = Math.max(2, this.container.clientWidth), h = Math.max(2, this.container.clientHeight);
    this.cssW = w; this.cssH = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.w = Math.round(w * this.dpr); this.h = Math.round(h * this.dpr);
    this.compRT.setSize(this.w, this.h);
    this.trail.setSize(this.w, this.h);
    const bw = Math.max(2, this.w >> 2), bh = Math.max(2, this.h >> 2);
    this.bloomA.setSize(bw, bh); this.bloomB.setSize(bw, bh);
    this.scenes.forEach((s, i) => { if (s) { this.sceneRT[i].setSize(this.w, this.h); s.resize(this.w, this.h); } });
    this.final.uniforms.uRes.value.set(this.w, this.h);
  }

  /** Palette and grading from MOOD (dark ↔ cold/bright). */
  grade(mood) {
    const dark = new THREE.Color('#3f6f8a'), mid = new THREE.Color('#5ccfff'), cold = new THREE.Color('#b9f1ff');
    const a = this.palette.accent;
    if (mood < 0.5) a.copy(dark).lerp(mid, mood * 2); else a.copy(mid).lerp(cold, (mood - 0.5) * 2);
    this.palette.fg.setScalar(lerp(0.84, 1.0, clamp(mood * 1.4)));
    const u = this.final.uniforms;
    u.uContrast.value = lerp(0.95, 1.15, mood);
    u.uGamma.value = lerp(1.1, 0.92, mood);
    u.uExposure.value = lerp(0.95, 1.05, mood);
  }

  /** Frame-state shared by all scenes. */
  frameState(dt) {
    const p = this.app.project, f = this.features, m = p.macros, v = p.visual;
    return {
      time: this.time, dt, react: v.reactivity,
      rms: f.rms, sub: f.sub, low: f.low, mid: f.mid, high: f.high, centroid: f.centroid, transient: f.transient,
      spectrum: f.spectrum, spectrumPeak: f.spectrumPeak, wave: f.wave, waveL: f.waveL, waveR: f.waveR,
      env: f.env, hits: f.hits, pitch: f.pitch,
      depth: m.depth, entropy: m.entropy, space: m.space, mood: m.mood,
      bpm: p.bpm, playing: this.app.seq.playing,
      params: v.params[this.cur], palette: this.palette, w: this.w, h: this.h,
    };
  }

  frame(now) {
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    this.adapt(dt);
    const r = this.renderer;
    this.features.update(dt);
    const p = this.app.project;
    this.grade(p.macros.mood);
    if (!this.frozen) {
      this.time += dt;
      const F = this.F = this.frameState(dt);
      if (this.mix < 1) this.mix = Math.min(1, this.mix + dt / 1.4);
      if (this.mix >= 1) this.prev = -1;
      const active = [this.cur];
      if (this.prev >= 0) active.push(this.prev);
      for (const i of active) {
        const s = this.ensureScene(i);
        F.params = p.visual.params[i];
        s.update(F);
        s.render(this.sceneRT[i]);
      }
      // 1. crossfade
      const cu = this.comp.uniforms;
      cu.uA.value = this.sceneRT[this.prev >= 0 ? this.prev : this.cur].texture;
      cu.uB.value = this.sceneRT[this.cur].texture;
      cu.uMix.value = this.prev >= 0 ? this.mix : 1;
      this.comp.render(r, this.compRT);
      // 2. trails (SPACE → afterglow)
      const tu = this.trailPass.uniforms;
      tu.uCur.value = this.compRT.texture;
      tu.uPrev.value = this.trail.read.texture;
      // per-frame decay normalised to 60 fps so trails last the same time at any frame rate
      tu.uDecay.value = Math.pow(clamp(Math.pow(p.macros.space, 1.3) * 0.9, 0, 0.93), dt * 60);
      tu.uDrift.value.set(0, p.macros.space * 0.0006);
      this.trailPass.render(r, this.trail.write);
      this.trail.swap();
      // 3. light bloom
      this.bright.uniforms.uTex.value = this.trail.read.texture;
      this.bright.render(r, this.bloomA);
      const bw = this.bloomA.width, bh = this.bloomA.height;
      this.blur.uniforms.uTex.value = this.bloomA.texture; this.blur.uniforms.uDir.value.set(1 / bw, 0); this.blur.render(r, this.bloomB);
      this.blur.uniforms.uTex.value = this.bloomB.texture; this.blur.uniforms.uDir.value.set(0, 1 / bh); this.blur.render(r, this.bloomA);
    }
    // 4. grade to screen
    const fu = this.final.uniforms;
    fu.uTex.value = this.trail.read.texture;
    fu.uBloom.value = this.bloomA.texture;
    fu.uBloomAmt.value = 0.16 + p.macros.space * 0.12;
    fu.uTime.value = now / 1000;
    this.final.render(r, null);
  }

  /** Adaptive resolution: drop pixel ratio when frames run long, recover when there is headroom. */
  adapt(dt) {
    if (dt > 1 / 48) this.slow++; else this.slow = Math.max(0, this.slow - 1);
    if (dt < 1 / 75) this.fast++; else this.fast = 0;
    if (this.slow > 90 && this.dpr > 1) { this.dpr = Math.max(1, this.dpr - 0.25); this.slow = 0; this.resize(); }
    if (this.fast > 600 && this.dpr < this.dprMax) { this.dpr = Math.min(this.dprMax, this.dpr + 0.25); this.fast = 0; this.resize(); }
  }
}
