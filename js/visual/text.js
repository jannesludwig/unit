// UNIT — GPU text: a monospace glyph atlas (ASCII 32–127) drawn as instanced quads.
// Used for the binary / numeric readouts. One draw call for thousands of glyphs.

import { THREE } from './gl.js';

let atlas = null;
function getAtlas() {
  if (atlas) return atlas;
  const cw = 32, ch = 48, cols = 16, rows = 6;
  const c = document.createElement('canvas');
  c.width = cw * cols; c.height = ch * rows;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.font = `${Math.round(ch * 0.72)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 96; i++) {
    const x = (i % cols) * cw + cw / 2, y = Math.floor(i / cols) * ch + ch / 2 + 2;
    g.fillText(String.fromCharCode(32 + i), x, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  atlas = { tex, cols, rows, aspect: cw / ch };
  return atlas;
}

const VERT = /* glsl */ `
attribute vec4 aG;   // x, y (px, top-left origin), size (px height), char index
attribute vec2 aC;   // alpha, accent mix
uniform vec2 uRes; uniform float uAspect;
varying vec2 vUv; varying vec2 vC;
void main() {
  vec2 corner = position.xy * 0.5 + 0.5;            // 0..1
  vec2 sz = vec2(aG.z * uAspect, aG.z);
  vec2 px = aG.xy + vec2(corner.x, 1.0 - corner.y) * sz;
  float ci = aG.w;
  vec2 cell = vec2(mod(ci, 16.0), floor(ci / 16.0));
  vUv = vec2((cell.x + corner.x) / 16.0, 1.0 - (cell.y + 1.0 - corner.y) / 6.0);
  vC = aC;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas; uniform vec3 uFg, uAccent;
varying vec2 vUv; varying vec2 vC;
void main() {
  float a = texture2D(uAtlas, vUv).a * vC.x;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uFg, uAccent, vC.y) * a, 1.0);
}`;

export class TextLayer {
  constructor(palette, max = 6000) {
    const A = getAtlas();
    this.max = max; this.n = 0;
    this.g = new Float32Array(max * 4); this.c = new Float32Array(max * 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.aG = new THREE.InstancedBufferAttribute(this.g, 4); this.aG.setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(this.c, 2); this.aC.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aG', this.aG); geo.setAttribute('aC', this.aC);
    this.uniforms = { uAtlas: { value: A.tex }, uRes: { value: new THREE.Vector2(1, 1) }, uAspect: { value: A.aspect }, uFg: { value: palette.fg }, uAccent: { value: palette.accent } };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    }));
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.charW = A.aspect;
  }
  resize(w, h) { this.uniforms.uRes.value.set(w, h); }
  clear() { this.n = 0; }
  /** Draw a string at pixel (x, y) with glyph height `size`. */
  text(s, x, y, size, alpha = 1, accent = 0) {
    const adv = size * this.charW * 0.92;
    for (let i = 0; i < s.length && this.n < this.max; i++) {
      const code = s.charCodeAt(i) - 32;
      if (code <= 0 || code > 95) { x += adv; continue; }
      const k = this.n++;
      this.g[k * 4] = x; this.g[k * 4 + 1] = y; this.g[k * 4 + 2] = size; this.g[k * 4 + 3] = code;
      this.c[k * 2] = alpha; this.c[k * 2 + 1] = accent;
      x += adv;
    }
    return x;
  }
  width(s, size) { return s.length * size * this.charW * 0.92; }
  render(renderer, target) {
    if (!this.n) return;
    this.mesh.geometry.instanceCount = this.n;
    this.aG.needsUpdate = true; this.aC.needsUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}
