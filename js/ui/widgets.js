// UNIT — small UI toolkit: element helper, SVG knob, tooltip.

import { clamp } from '../core/util.js';

/** Create an element: el('div.cls#id', {attrs}, children...) */
export function el(spec, attrs = {}, ...kids) {
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const node = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) {
    if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) node.append(k.nodeType ? k : document.createTextNode(k));
  return node;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25; // 270° sweep, gap at the bottom

/**
 * Knob: vertical drag (Shift = fine), wheel, double-click = default, arrow keys when focused.
 * opts: { label, value 0..1, def, size, bipolar, steps (discrete count), format(v), onChange(v),
 *         onStart(), onReset(), tip }
 */
export class Knob {
  constructor(opts) {
    this.o = { size: 30, def: 0, bipolar: false, ...opts };
    this.v = opts.value ?? this.o.def;
    const s = this.o.size, r = s / 2 - 3, c = s / 2;
    this.r = r; this.c = c;
    this.root = el('div.knob' + (opts.big ? '.big' : ''), { tabindex: 0, 'data-tip': opts.tip || '' });
    this.svg = svg('svg', { width: s, height: s, viewBox: `0 0 ${s} ${s}` });
    this.track = svg('path', { d: arcPath(c, c, r, A0, A1), class: 'k-track' });
    this.arc = svg('path', { class: 'k-arc' });
    this.ind = svg('line', { class: 'k-ind' });
    this.svg.append(this.track, this.arc, this.ind);
    this.label = el('div.k-label', { text: opts.label || '' });
    this.valEl = el('div.k-val');
    this.root.append(this.svg, this.label, this.valEl);
    this.bind();
    this.render();
  }
  get value() { return this.v; }
  set(v, emit = false) {
    v = clamp(v);
    if (this.o.steps) v = Math.round(v * (this.o.steps - 1)) / (this.o.steps - 1);
    if (v === this.v && !emit) return;
    this.v = v; this.render();
    if (emit) this.o.onChange?.(v);
  }
  setMode(m) { this.root.classList.toggle('locked', m === 'locked'); this.root.classList.toggle('dimmed', m === 'dimmed'); }
  setLabel(t) { this.label.textContent = t; }
  render() {
    const { c, r } = this, v = this.v;
    const a = A0 + (A1 - A0) * v;
    const from = this.o.bipolar ? (A0 + A1) / 2 : A0;
    const lo = Math.min(from, a), hi = Math.max(from, a);
    this.arc.setAttribute('d', hi - lo < 0.001 ? '' : arcPath(c, c, r, lo, hi));
    const ri = r * 0.45;
    this.ind.setAttribute('x1', (c + Math.cos(a) * ri).toFixed(2));
    this.ind.setAttribute('y1', (c + Math.sin(a) * ri).toFixed(2));
    this.ind.setAttribute('x2', (c + Math.cos(a) * (r + 1)).toFixed(2));
    this.ind.setAttribute('y2', (c + Math.sin(a) * (r + 1)).toFixed(2));
    this.valEl.textContent = this.o.format ? this.o.format(v) : Math.round(v * 100);
  }
  bind() {
    let y0 = 0, v0 = 0, dragging = false;
    const range = this.o.big ? 260 : 200;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.root.setPointerCapture(e.pointerId);
      y0 = e.clientY; v0 = this.v; dragging = true;
      this.root.classList.add('active');
      this.o.onStart?.();
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const fine = e.shiftKey ? 0.2 : 1;
      const dv = ((y0 - e.clientY) / range) * fine;
      if (e.shiftKey) { y0 = e.clientY; v0 = this.v; this.set(v0 + dv, true); }
      else this.set(v0 + dv, true);
    });
    const end = () => { dragging = false; this.root.classList.remove('active'); this.o.onEnd?.(); };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.root.addEventListener('dblclick', () => {
      if (this.o.onReset) { this.o.onReset(); return; }
      this.o.onStart?.(); this.set(this.o.def, true);
    });
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this._wheelT) this.o.onStart?.();
      clearTimeout(this._wheelT); this._wheelT = setTimeout(() => { this._wheelT = 0; }, 400);
      const step = this.o.steps ? 1 / (this.o.steps - 1) : 0.004 * (e.shiftKey ? 0.25 : 1);
      const d = this.o.steps ? Math.sign(-e.deltaY) * step : -e.deltaY * step;
      if (this.o.steps && Math.abs(e.deltaY) < 4) return;
      this.set(this.v + d, true);
    }, { passive: false });
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      const step = this.o.steps ? 1 / (this.o.steps - 1) : e.shiftKey ? 0.002 : 0.01;
      this.o.onStart?.();
      this.set(this.v + (e.key === 'ArrowUp' ? step : -step), true);
    });
  }
}

/** Tooltip: any element with data-tip (and optional data-key) shows a delayed hint. */
export function installTooltips(root = document.body) {
  const tip = el('div.tooltip');
  document.body.append(tip);
  let timer = 0, cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('on'); cur = null; };
  root.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t || !t.dataset.tip || t === cur) return;
    hide(); cur = t;
    timer = setTimeout(() => {
      const k = t.dataset.key;
      tip.innerHTML = '';
      tip.append(el('span', { text: t.dataset.tip }));
      if (k) tip.append(el('span.kbd', { text: k }));
      const r = t.getBoundingClientRect();
      tip.classList.add('on');
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 6;
      if (y < 4) y = r.bottom + 6;
      x = clamp(x, 4, innerWidth - tw - 4);
      tip.style.transform = `translate(${x}px, ${y}px)`;
    }, 450);
  });
  root.addEventListener('pointerout', (e) => { if (cur && !cur.contains(e.relatedTarget)) hide(); });
  root.addEventListener('pointerdown', hide);
}

/** Momentary flash helper (adds a class for ms). */
export function flash(node, cls = 'flash', ms = 120) {
  node.classList.add(cls);
  clearTimeout(node._fl);
  node._fl = setTimeout(() => node.classList.remove(cls), ms);
}
