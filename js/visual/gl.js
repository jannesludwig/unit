// UNIT — WebGL helpers shared by the visual engine and scenes.

import * as THREE from 'three';

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const quad = new THREE.PlaneGeometry(2, 2);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Full-screen shader pass. */
export class Pass {
  constructor(fragmentShader, uniforms = {}, opts = {}) {
    this.uniforms = uniforms;
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader, uniforms,
      depthTest: false, depthWrite: false, transparent: !!opts.blending, ...opts,
    });
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  render(renderer, target, clear = true) {
    renderer.setRenderTarget(target || null);
    if (clear) renderer.clear();
    renderer.render(this.scene, orthoCam);
  }
}

let floatType = null;
/** Pick the best renderable float type once per renderer. */
export function rtType(renderer) {
  if (floatType) return floatType;
  const gl = renderer.getContext();
  const ok = renderer.capabilities.isWebGL2 && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  floatType = ok ? THREE.HalfFloatType : THREE.UnsignedByteType;
  return floatType;
}

let fullFloat = null;
/** FloatType when 32-bit float targets are renderable (needed for particle state), else half. */
export function stateType(renderer) {
  if (fullFloat) return fullFloat;
  const gl = renderer.getContext();
  fullFloat = renderer.capabilities.isWebGL2 && gl.getExtension('EXT_color_buffer_float') ? THREE.FloatType : rtType(renderer);
  return fullFloat;
}

export function makeRT(renderer, w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: opts.type || rtType(renderer),
    format: THREE.RGBAFormat,
    minFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
    magFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
    depthBuffer: !!opts.depth,
    stencilBuffer: false,
    wrapS: opts.wrap || THREE.ClampToEdgeWrapping,
    wrapT: opts.wrap || THREE.ClampToEdgeWrapping,
  });
}

/** Ping-pong pair of render targets. */
export class PingPong {
  constructor(renderer, w, h, opts) { this.a = makeRT(renderer, w, h, opts); this.b = makeRT(renderer, w, h, opts); }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  get read() { return this.a; }
  get write() { return this.b; }
  setSize(w, h) { this.a.setSize(w, h); this.b.setSize(w, h); }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

/** Common GLSL snippets. */
export const GLSL = {
  hash: /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`,
  noise: /* glsl */ `
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  #define H(o) fract(sin(n + o) * 43758.5453)
  return mix(mix(mix(H(0.0), H(1.0), f.x), mix(H(57.0), H(58.0), f.x), f.y),
             mix(mix(H(113.0), H(114.0), f.x), mix(H(170.0), H(171.0), f.x), f.y), f.z);
  #undef H
}
`,
  erf: /* glsl */ `
float erf(float x) {
  float s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}
`,
};

export { THREE };
