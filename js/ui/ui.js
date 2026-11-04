// UNIT — user interface: transport bar, step grid (with hold-to-lock), inspector, mixer,
// macros, visual HUD, help overlay and the keyboard map.
//
// Design: few visible controls; details appear on demand. Hold a step (long-press, Shift-click,
// or hold its key Q…K) and every knob in the inspector writes a parameter lock to that step.

import { el, Knob, installTooltips, flash } from './widgets.js';
import { fmtParam, pct, bip, panFmt, fltFmt } from './format.js';
import { VOICES } from '../audio/voices.js';
import { MIX_LOCKABLE } from '../audio/engine.js';
import { DELAY_DIVS } from '../audio/fx.js';
import { CONDS, SPEEDS, SPEED_LABELS, PATTERN_NAMES, MAX_STEPS, newStep, chainBars } from '../seq/model.js';
import { applyEuclid, mutate, randomize } from '../seq/generators.js';
import { DEMOS } from '../seq/demos.js';
import { clamp, deepClone } from '../core/util.js';

export const TRACK_COLORS = ['#e6e6e6', '#8fa9c4', '#5ccfff', '#86c9bd', '#a99bc9', '#c9b27e', '#7d9cff', '#6b8796'];
const STEP_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const PAT_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'];
export const SCENE_NAMES = ['OSCILLOSCOPE', 'DATAMATICS', 'CYMATIC SPHERE', 'SIGNAL', 'REACTION-DIFFUSION'];
const MIX_LABEL = { pan: 'PAN', dly: 'DLY', rev: 'REV', flt: 'FLT', crush: 'CRSH', vol: 'VOL' };
const MIX_TIP = { pan: 'Pan', dly: 'Send to DELAY', rev: 'Send to REVERB', flt: 'Filter: left = low-pass, right = high-pass', crush: 'Bit-crush + sample-rate reduction', vol: 'Track volume' };
const BIPOLAR = { pan: true, flt: true };
// mix values: pan/flt are −1..1, others 0..1; knobs are 0..1
const mixToKnob = (k, v) => (BIPOLAR[k] ? (v + 1) / 2 : v);
const knobToMix = (k, n) => (BIPOLAR[k] ? n * 2 - 1 : n);
const mixFmt = (k) => (k === 'pan' ? panFmt : k === 'flt' ? fltFmt : pct);

export class UI {
  constructor(app) {
    this.app = app;
    this.selTrack = 0;
    this.page = 0;
    this.follow = true;
    this.view = 'grid';
    this.sel = new Set();          // latched step selection (selected track)
    this.held = new Map();         // step keys currently held → {s, wasOn, t0, edited}
    this.clip = null;
    this.playCells = new Array(8).fill(null);
    this.pos = new Array(8).fill(-1);
    this.build();
    this.bindApp();
    this.bindKeys();
    installTooltips();
    this.refreshAll();
  }

  get p() { return this.app.project; }
  get pat() { return this.p.patterns[this.p.cur]; }
  get ptr() { return this.pat.tracks[this.selTrack]; }
  /** Steps currently being edited (held keys + latched selection). */
  get targets() { return [...new Set([...this.sel, ...[...this.held.values()].map((h) => h.s)])].sort((a, b) => a - b); }
  get stepMode() { return this.targets.length > 0; }

  // =====================================================================================
  // build
  // =====================================================================================
  build() {
    document.body.innerHTML = '';
    this.stage = el('section#stage');
    this.bar = el('section#bar');
    this.deck = el('section#deck');
    document.body.append(this.stage, this.bar, this.deck);
    this.buildHUD();
    this.buildBar();
    this.gridSec = el('section#grid-sec');
    this.inspSec = el('section#insp');
    this.macroSec = el('section#macros');
    this.deck.append(this.gridSec, this.inspSec, this.macroSec);
    this.buildGrid();
    this.buildMixer();
    this.buildMacros();
    this.buildHelp();
    this.start = el('div#start', { onclick: () => this.app.ensureAudio() },
      el('div.logo', { html: 'UNI<b>T</b>' }), el('div.lbl', { text: 'CLICK OR PRESS ANY KEY TO START AUDIO' }),
      el('div.lbl', { text: 'THEN  SPACE = PLAY  ·  ? = HELP', style: { color: 'var(--dim)' } }));
    document.body.append(this.start);
  }

  // ---------------------------------------------------------------- visual HUD
  buildHUD() {
    this.sceneName = el('span.scene-name');
    this.fps = el('span.fps');
    this.hudTop = el('div.hud.top', {}, el('div', {}, el('span.logo', { html: 'UNI<b>T</b>' }), ' ', this.sceneName), this.fps);
    this.sceneBtns = SCENE_NAMES.map((n, i) => el('button', { text: String(i + 1), 'data-tip': n, 'data-key': String(i + 1), onclick: () => this.app.visual?.setScene(i) }));
    this.sceneKnobs = [0, 1, 2].map((k) => new Knob({
      label: 'P' + (k + 1), size: 22, def: 0.5,
      onChange: (v) => this.app.visual?.setSceneParam(k, v),
    }));
    this.reactKnob = new Knob({ label: 'REACT', size: 22, def: 0.75, tip: 'Reactivity: how strongly visuals follow the audio', onChange: (v) => this.app.visual?.setReactivity(v) });
    this.freezeBtn = el('button', { text: 'FREEZE', 'data-tip': 'Freeze the image', 'data-key': 'P', onclick: () => this.app.visual?.toggleFreeze() });
    this.autoBtn = el('button', { text: 'AUTO', 'data-tip': 'Switch scene when the pattern changes', 'data-key': '0', onclick: () => this.app.visual?.toggleAuto() });
    this.fullBtn = el('button', { text: '⤢', 'data-tip': 'Visuals only', 'data-key': '⇧F', onclick: () => this.toggleFull() });
    this.hudBottom = el('div.hud.bottom', {},
      el('div.grp', {}, ...this.sceneBtns),
      el('div.grp', {}, ...this.sceneKnobs.map((k) => k.root)),
      el('div.grp', {}, this.reactKnob.root, this.freezeBtn, this.autoBtn, this.fullBtn));
    this.stage.append(this.hudTop, this.hudBottom);
    // hide the bottom HUD when the pointer is idle over the stage
    let idleT = 0;
    const wake = () => { this.stage.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => this.stage.classList.add('idle'), 2200); };
    this.stage.addEventListener('pointermove', wake);
    wake();
  }

  // ---------------------------------------------------------------- transport bar
  buildBar() {
    const a = this.app;
    this.playBtn = el('button.play', { text: '▶', 'data-tip': 'Play / stop', 'data-key': 'SPACE', onclick: () => a.togglePlay() });
    this.bpmEl = el('span.num', { 'data-tip': 'Tempo — drag, wheel, or −/=', 'data-key': '− =' });
    this.dragNumber(this.bpmEl, () => this.p.bpm, (v) => a.setTempo(v), 0.25, 40, 220);
    this.swEl = el('span.num.small', { 'data-tip': 'Swing — drag or [ ]', 'data-key': '[ ]' });
    this.dragNumber(this.swEl, () => this.p.swing, (v) => a.setSwing(Math.round(v)), 0.1, 50, 75);
    this.posEl = el('span.pos');
    this.patBtns = PATTERN_NAMES.map((n, i) => el('button.pat', {
      text: n, 'data-tip': `Pattern ${n} — click: select (queued while playing) · ⇧click: copy current here · ⌥click: add to chain`, 'data-key': PAT_KEYS[i].slice(3),
      onclick: (e) => this.patternClick(i, e),
    }));
    this.barsBtns = [1, 2, 3, 4].map((b) => el('button.pat', { text: String(b), 'data-tip': `Pattern length: ${b} bar${b > 1 ? 's' : ''}`, onclick: () => this.setBars(b) }));
    this.chainBtn = el('button', { text: 'CHAIN', 'data-tip': 'Play the chain instead of looping one pattern', 'data-key': 'B', onclick: () => this.toggleChain() });
    this.chainStr = el('span.chainstr', { 'data-tip': 'Chain (⌥click a pattern to append, click here to clear)', onclick: () => this.clearChain() });
    this.pageBtns = [0, 1, 2, 3].map((k) => el('button.pat', { text: String(k + 1), 'data-tip': `Page ${k + 1} (steps ${k * 16 + 1}–${k * 16 + 16})`, 'data-key': '← →', onclick: () => { this.follow = false; this.setPage(k); } }));
    this.followBtn = el('button', { text: 'FOLLOW', 'data-tip': 'Page follows the playhead', onclick: () => { this.follow = !this.follow; this.refreshBar(); } });
    this.fillBtn = el('button.acc', { text: 'FILL', 'data-tip': 'Fill: hold L (momentary) · click to latch', 'data-key': 'L', onclick: () => a.setFill(!a.seq.fill) });
    this.viewBtn = el('button', { text: 'MIX', 'data-tip': 'Toggle grid / mixer view', 'data-key': 'TAB', onclick: () => this.toggleView() });
    this.demoSel = el('select', { 'data-tip': 'Load a demo project' }, el('option', { value: '', text: 'DEMO' }), ...DEMOS.map((d, i) => el('option', { value: i, text: d.name })));
    this.demoSel.addEventListener('change', () => {
      const v = this.demoSel.value;
      if (v === 'new') { a.newProject(); this.msg('NEW PROJECT'); }
      else if (v !== '') { a.loadDemo(+v); this.msg(DEMOS[+v].name); }
      this.demoSel.value = ''; this.demoSel.blur();
    });
    this.ioGrp = el('div.grp');   // filled by export module (WAV / VIDEO / SAVE / LOAD)
    this.msgEl = el('span.msg');
    this.helpBtn = el('button', { text: '?', 'data-tip': 'Help & shortcuts', 'data-key': '?', onclick: () => this.toggleHelp() });
    const sep = () => el('span.sep');
    this.bar.append(
      el('div.grp', {}, this.playBtn), el('div.grp', {}, this.bpmEl, el('span.lbl', { text: 'BPM' })),
      el('div.grp', {}, el('span.lbl', { text: 'SW' }), this.swEl), this.posEl, sep(),
      el('div.grp', {}, el('span.lbl.opt', { text: 'PAT' }), ...this.patBtns), el('div.grp', {}, el('span.lbl', { text: 'BARS' }), ...this.barsBtns),
      el('div.grp', {}, this.chainBtn, this.chainStr), sep(),
      el('div.grp', {}, el('span.lbl', { text: 'PAGE' }), ...this.pageBtns, this.followBtn), sep(),
      this.fillBtn, el('span.spacer'), this.msgEl, this.ioGrp, sep(), this.demoSel, this.viewBtn, this.helpBtn,
    );
  }

  /** Make a number readout draggable (vertical), wheel-able. */
  dragNumber(node, get, set, sens, lo, hi) {
    let y0 = 0, v0 = 0, drag = false;
    node.addEventListener('pointerdown', (e) => { drag = true; y0 = e.clientY; v0 = get(); node.setPointerCapture(e.pointerId); });
    node.addEventListener('pointermove', (e) => { if (drag) set(clamp(v0 + (y0 - e.clientY) * sens * (e.shiftKey ? 0.2 : 1), lo, hi)); });
    node.addEventListener('pointerup', () => { drag = false; });
    node.addEventListener('wheel', (e) => { e.preventDefault(); set(clamp(get() - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1), lo, hi)); }, { passive: false });
  }

  // ---------------------------------------------------------------- grid
  buildGrid() {
    this.gridHead = el('div.sec-h', {}, el('span.title', { text: 'SEQUENCER' }), el('span.lbl', { text: 'click: toggle · hold / ⇧click: select step → knobs lock · keys Q–I A–K' }), el('span.spacer'));
    this.gridBody = el('div#grid-body');
    const nums = el('div.nums');
    this.numEls = [];
    for (let i = 0; i < 16; i++) { const n = el('span', { text: '' }); if (i % 4 === 0) n.classList.add('beat'); nums.append(n); this.numEls.push(n); }
    this.gridBody.append(el('div#grid', {}, el('div.grid-h', {}, el('span'), nums, el('span', { text: 'LEN SPD', style: { textAlign: 'right' } }))));
    this.rows = VOICES.map((v, t) => {
      const act = el('i.act');
      const name = el('div.tname', { style: { '--tc': TRACK_COLORS[t] }, 'data-tip': `Select ${v.name}`, 'data-key': `⇧${t + 1} / ↑↓`, onclick: () => this.selectTrack(t) },
        el('span.tc'), el('span.tn', { text: String(t + 1).padStart(2, '0') }), el('span.nm', { text: v.name }), act);
      const m = el('button.m', { text: 'M', 'data-tip': 'Mute', 'data-key': 'M', onclick: (e) => { e.stopPropagation(); this.app.setMix(t, 'mute', !this.p.tracks[t].mix.mute); } });
      const s = el('button.s', { text: 'S', 'data-tip': 'Solo', 'data-key': 'N', onclick: (e) => { e.stopPropagation(); this.app.setMix(t, 'solo', !this.p.tracks[t].mix.solo); } });
      name.append(el('div.ms', {}, m, s));
      const steps = el('div.steps');
      const cells = [];
      for (let k = 0; k < 16; k++) {
        const c = el('div.cell', {}, el('i.fill'), el('i.ratch'), el('i.prob'), el('i.cond'), el('i.lock'));
        c.dataset.k = k;
        steps.append(c); cells.push(c);
      }
      this.bindCells(t, steps, cells);
      const len = el('span', { 'data-tip': 'Track length (drag) — polymeter', });
      const spd = el('span.spd', { 'data-tip': 'Track speed (click to cycle)', onclick: () => this.cycleSpeed(t) });
      this.dragNumber(len, () => this.pat.tracks[t].len, (v) => this.setLen(t, Math.round(v)), 0.15, 1, MAX_STEPS);
      const row = el('div.row', {}, name, steps, el('div.tlen', {}, len, spd));
      this.gridBody.querySelector('#grid').append(row);
      return { row, cells, m, s, len, spd, act };
    });
    this.gridSec.append(this.gridHead, this.gridBody);
  }

  bindCells(t, steps, cells) {
    let st = null;
    const stepAt = (x, y) => { const c = document.elementFromPoint(x, y)?.closest('.cell'); return c && cells.includes(c) ? +c.dataset.k : -1; };
    steps.addEventListener('contextmenu', (e) => e.preventDefault());
    steps.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.cell'); if (!c) return;
      e.preventDefault();
      const k = +c.dataset.k, s = this.page * 16 + k;
      if (t !== this.selTrack) this.selectTrack(t);
      if (e.shiftKey || e.altKey || e.metaKey || e.button === 2) { this.toggleSel(s); return; }
      this.sel.clear();
      const tr = this.pat.tracks[t];
      this.app.pushUndo();
      const wasOn = !!tr.steps[s];
      if (!wasOn) tr.steps[s] = newStep();
      st = { s, wasOn, painted: new Set([k]), long: false, mode: wasOn ? 'off' : 'on' };
      st.timer = setTimeout(() => { if (!st) return; st.long = true; this.sel.add(s); this.refreshSel(); }, 330);
      steps.setPointerCapture(e.pointerId);
      this.afterEdit(t);
    });
    steps.addEventListener('pointermove', (e) => {
      if (!st || st.long) return;
      const k = stepAt(e.clientX, e.clientY);
      if (k < 0 || st.painted.has(k)) return;
      clearTimeout(st.timer);
      const tr = this.pat.tracks[t];
      if (st.mode === 'off' && st.painted.size === 1) tr.steps[st.s] = null;
      st.painted.add(k);
      const s = this.page * 16 + k;
      tr.steps[s] = st.mode === 'on' ? (tr.steps[s] || newStep()) : null;
      this.afterEdit(t);
    });
    const up = () => {
      if (!st) return;
      clearTimeout(st.timer);
      if (!st.long && st.wasOn && st.painted.size === 1) { this.pat.tracks[t].steps[st.s] = null; this.afterEdit(t); }
      st = null;
    };
    steps.addEventListener('pointerup', up);
    steps.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- mixer view
  buildMixer() {
    this.mixer = el('div#mixer');
    this.strips = VOICES.map((v, t) => {
      const kn = {};
      for (const k of ['vol', 'pan', 'dly', 'rev', 'flt', 'crush']) {
        kn[k] = new Knob({
          label: MIX_LABEL[k], size: 22, bipolar: !!BIPOLAR[k], def: k === 'vol' ? 0.8 : mixToKnob(k, 0), tip: MIX_TIP[k], format: mixFmt(k),
          onStart: () => this.app.pushUndo(), onChange: (n) => this.app.setMix(t, k, knobToMix(k, n)),
        });
      }
      const meter = el('div.meter', {}, el('i'));
      const m = el('button.m', { text: 'M', onclick: () => this.app.setMix(t, 'mute', !this.p.tracks[t].mix.mute) });
      const s = el('button.s', { text: 'S', onclick: () => this.app.setMix(t, 'solo', !this.p.tracks[t].mix.solo) });
      const node = el('div.strip', { onpointerdown: () => this.selectTrack(t) },
        el('div.nm', { text: v.name }), el('div.kk', {}, ...['vol', 'pan', 'dly', 'rev', 'flt', 'crush'].map((k) => kn[k].root)), el('div.ms', {}, m, s), meter);
      return { node, kn, meter: meter.firstChild, m, s, lvl: 0 };
    });
    const fx = this.p.fx;
    const a = this.app;
    const fxKnob = (label, group, key, conv, tip, steps, fmt) => new Knob({
      label, size: 24, steps, tip, format: fmt, def: conv.to(group === 'master' ? this.p.master[key] : fx[group][key]),
      onStart: () => a.pushUndo(),
      onChange: (n) => (group === 'master' ? a.setMaster(key, conv.from(n)) : a.setFx(group, key, conv.from(n))),
    });
    const id = { to: (v) => v, from: (n) => n };
    const div = { to: (v) => v / (DELAY_DIVS.length - 1), from: (n) => Math.round(n * (DELAY_DIVS.length - 1)) };
    const fb = { to: (v) => v / 0.93, from: (n) => n * 0.93 };
    this.fxKnobs = {
      'delay.div': fxKnob('TIME', 'delay', 'div', div, 'Delay time (tempo-synced)', DELAY_DIVS.length, (n) => DELAY_DIVS[Math.round(n * (DELAY_DIVS.length - 1))][0]),
      'delay.feedback': fxKnob('FDBK', 'delay', 'feedback', fb, 'Delay feedback', 0, pct),
      'delay.tone': fxKnob('TONE', 'delay', 'tone', id, 'Feedback low-pass (dark ↔ bright)', 0, pct),
      'delay.ping': fxKnob('PING', 'delay', 'ping', id, 'Ping-pong amount', 0, pct),
      'reverb.size': fxKnob('SIZE', 'reverb', 'size', id, 'Reverb size', 0, pct),
      'reverb.damp': fxKnob('DAMP', 'reverb', 'damp', id, 'Reverb damping (darker)', 0, pct),
      'master.duck': fxKnob('DUCK', 'master', 'duck', id, 'Sidechain ducking from KICK', 0, pct),
      'master.drive': fxKnob('DRIVE', 'master', 'drive', id, 'Master soft saturation', 0, pct),
      'master.volume': fxKnob('LEVEL', 'master', 'volume', id, 'Master level', 0, pct),
    };
    const fk = this.fxKnobs;
    this.masterMeter = el('div.meter', { style: { position: 'relative', height: '120px', width: '2px', background: 'var(--line)', margin: '6px auto 0' } }, el('i', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--fg)' } }));
    this.mixer.append(
      el('div.strips', {}, ...this.strips.map((s) => s.node)),
      el('div.fxsec', {}, el('span.lbl', { text: 'DELAY' }), el('div.kk', {}, fk['delay.div'].root, fk['delay.feedback'].root, fk['delay.tone'].root, fk['delay.ping'].root),
        el('span.lbl', { text: 'REVERB' }), el('div.kk', {}, fk['reverb.size'].root, fk['reverb.damp'].root)),
      el('div.fxsec', {}, el('span.lbl', { text: 'MASTER' }), el('div.kk', {}, fk['master.duck'].root, fk['master.drive'].root, fk['master.volume'].root, el('div', {}, this.masterMeter))),
    );
    this.gridSec.append(this.mixer);
  }

  // ---------------------------------------------------------------- macros
  buildMacros() {
    const a = this.app;
    const M = [
      ['depth', 'DEPTH', 'Sub weight, low end — and visual mass / scale', 0.5],
      ['entropy', 'ENTROPY', 'Randomness in sound and pattern — and visual chaos', 0],
      ['space', 'SPACE', 'Delay / reverb amount — and visual trails / afterglow', 0.35],
      ['mood', 'MOOD', 'Darker ↔ colder / brighter timbre — and visual palette / contrast', 0.5],
    ];
    this.macroKnobs = {};
    for (const [k, label, tip, def] of M) {
      this.macroKnobs[k] = new Knob({ label, size: 52, big: true, def, tip, format: pct, onChange: (v) => a.setMacro(k, v) });
    }
    this.macroKnobs.tempo = new Knob({
      label: 'TEMPO', size: 52, big: true, def: (124 - 40) / 180, tip: 'Tempo (40–220 BPM) — also −/=',
      format: (n) => (40 + n * 180).toFixed(1), onChange: (n) => a.setTempo(40 + n * 180),
    });
    this.macroKnobs.swing = new Knob({
      label: 'SWING', size: 52, big: true, def: 0, tip: 'Swing 50–75 % — also [ ]',
      format: (n) => Math.round(50 + n * 25) + '%', onChange: (n) => a.setSwing(Math.round(50 + n * 25)),
    });
    const g = el('div.mgrid', {}, ...['depth', 'entropy', 'space', 'mood', 'tempo', 'swing'].map((k) => this.macroKnobs[k].root));
    this.macroSec.append(el('div.sec-h', {}, el('span.title', { text: 'MACROS' }), el('span.spacer'), el('span.lbl', { text: 'SOUND + VISION' })), g);
  }

  // ---------------------------------------------------------------- inspector
  buildInspector() {
    const a = this.app, t = this.selTrack, v = VOICES[t], tr = this.p.tracks[t];
    const stepMode = this.stepMode;
    this.inspSec.innerHTML = '';
    this.inspSec.classList.toggle('mode-step', stepMode);
    this.inspKnobs = { voice: {}, mix: {}, step: {}, gen: {} };
    const tg = this.targets;
    const head = el('div.sec-h', {}, el('span', { style: { width: '2px', height: '12px', background: TRACK_COLORS[t] } }),
      el('span.title', { text: stepMode ? `${v.name} · ${tg.length === 1 ? 'STEP ' + String(tg[0] + 1).padStart(2, '0') : tg.length + ' STEPS'}` : `${String(t + 1).padStart(2, '0')} ${v.name}` }));
    if (!stepMode) {
      this.presetName = el('span', { text: v.presets[tr.preset]?.name || '—', 'data-tip': 'Preset', 'data-key': ', .' });
      head.append(el('div.preset', {},
        el('button', { text: '‹', onclick: () => this.stepPreset(-1) }), this.presetName, el('button', { text: '›', onclick: () => this.stepPreset(1) })));
    } else {
      head.append(el('span.spacer'), el('button', { text: 'CLR LOCKS', 'data-tip': 'Remove all parameter locks from the selected steps', onclick: () => this.clearLocks() }),
        el('button', { text: 'DONE', 'data-key': 'ESC', 'data-tip': 'Leave step edit', onclick: () => this.clearSel() }));
    }
    const body = el('div.insp-body');
    // first row: step params (step mode) or voice params
    const first = tg[0] !== undefined ? this.ptr.steps[tg[0]] : null;
    if (stepMode) {
      const sk = this.inspKnobs.step;
      const mk = (key, label, def, opts) => {
        sk[key] = new Knob({ label, size: 26, def, ...opts, onStart: () => a.pushUndo(), onChange: (n) => this.setStepParam(key, n) });
        return sk[key].root;
      };
      body.append(el('div.krow', {}, el('span.lbl', { text: 'STEP' }),
        mk('v', 'VEL', 0.85, { format: pct, tip: 'Velocity' }),
        mk('p', 'PROB', 1, { format: (n) => Math.round(n * 100) + '%', tip: 'Probability (uses DÉJÀ VU memory)' }),
        mk('c', 'COND', 0, { steps: CONDS.length, format: (n) => CONDS[Math.round(n * (CONDS.length - 1))], tip: 'Trig condition: A:B = A-th of every B loops · 1ST / !1ST · FILL · PRE = previous condition' }),
        mk('n', 'NUDGE', 0.5, { bipolar: true, format: (n) => { const x = Math.round((n - 0.5) * 100); return (x > 0 ? '+' : '') + x; }, tip: 'Micro-timing (± half a 16th)' }),
        mk('r', 'RATCH', 0, { steps: 4, format: (n) => '×' + (1 + Math.round(n * 3)), tip: 'Ratchet / retrig 1–4' })));
      this.syncStepKnobs(first);
    }
    // voice params
    const vk = this.inspKnobs.voice;
    const vrow = el('div.krow', {}, el('span.lbl', { text: 'SOUND' }));
    for (const p of v.params) {
      vk[p.id] = new Knob({
        label: p.name, size: 26, def: tr.params[p.id], format: fmtParam(p), steps: p.list ? p.list.length : p.step ? Math.round((p.max - p.min) / p.step) + 1 : 0,
        tip: stepMode ? `${p.name} — locks to the selected step(s) · dbl-click clears the lock` : p.name,
        onStart: () => a.pushUndo(),
        onChange: (n) => (this.stepMode ? this.writeLock(p.id, n) : a.setParam(t, p.id, n)),
        onReset: this.stepMode ? () => this.clearLock(p.id) : null,
      });
      vrow.append(vk[p.id].root);
    }
    body.append(vrow);
    // mix (lockable)
    const mxk = this.inspKnobs.mix;
    const mrow = el('div.krow', {}, el('span.lbl', { text: 'MIX' }));
    for (const k of [...(stepMode ? [] : ['vol']), ...MIX_LOCKABLE]) {
      mxk[k] = new Knob({
        label: MIX_LABEL[k], size: 26, bipolar: !!BIPOLAR[k], def: mixToKnob(k, k === 'vol' ? 0.8 : 0), format: mixFmt(k), tip: MIX_TIP[k] + (stepMode ? ' — locks to step' : ''),
        onStart: () => a.pushUndo(),
        onChange: (n) => (this.stepMode ? this.writeLock(k, knobToMix(k, n)) : a.setMix(t, k, knobToMix(k, n))),
        onReset: this.stepMode ? () => this.clearLock(k) : null,
      });
      mrow.append(mxk[k].root);
    }
    body.append(mrow);
    if (!stepMode) {
      // generators
      const gk = this.inspKnobs.gen;
      const ptr = this.ptr;
      gk.len = new Knob({ label: 'LEN', size: 26, def: (16 - 1) / 63, steps: 64, format: (n) => String(1 + Math.round(n * 63)), tip: 'Track length 1–64 (polymeter)', onStart: () => a.pushUndo(), onChange: (n) => this.setLen(t, 1 + Math.round(n * 63)) });
      gk.speed = new Knob({ label: 'SPD', size: 26, def: 2 / 3, steps: 4, format: (n) => SPEED_LABELS[Math.round(n * 3)], tip: 'Track speed', onStart: () => a.pushUndo(), onChange: (n) => this.setSpeed(t, SPEEDS[Math.round(n * 3)]) });
      gk.pulses = new Knob({ label: 'EUCLID', size: 26, def: 0.25, format: (n) => String(Math.round(n * ptr.len)), tip: 'Euclidean pulses — writes the rhythm', data: 1, onStart: () => a.pushUndo(), onChange: (n) => this.setEuclid('pulses', n) });
      gk.rot = new Knob({ label: 'ROT', size: 26, def: 0, format: (n) => String(Math.round(n * (ptr.len - 1))), tip: 'Euclidean rotation', onStart: () => a.pushUndo(), onChange: (n) => this.setEuclid('rot', n) });
      gk.mut = new Knob({ label: 'MUTATE', size: 26, def: 0, format: pct, tip: 'Live variation amount (non-destructive, follows DÉJÀ VU)', onChange: (n) => { tr.gen.mut = n; a.changed(); } });
      gk.dv = new Knob({ label: 'DÉJÀ VU', size: 26, def: 0, format: pct, tip: '0 = fresh randomness every pass · 100 = locked loop of random decisions', onChange: (n) => { tr.gen.dv = n; a.changed(); } });
      body.append(el('div.krow', {}, el('span.lbl', { text: 'GEN' }), ...['len', 'speed', 'pulses', 'rot', 'mut', 'dv'].map((k) => gk[k].root)));
      const B = (text, tip, key, fn) => el('button', { text, 'data-tip': tip, 'data-key': key, onclick: fn });
      body.append(el('div.btnrow', {},
        B('↻ DV', 'Re-roll the DÉJÀ VU memory (a new frozen variation)', '⇧D', () => this.reroll()),
        B('MUTATE', 'Bake a variation into the pattern (amount = MUTATE, min 30%)', '⇧M', () => this.bakeMutate()),
        B('RND', 'Random sparse pattern', '⇧R', () => this.rnd()),
        B('COPY', 'Copy track pattern', '⌘C', () => this.copy()),
        B('PASTE', 'Paste track pattern', '⌘V', () => this.paste()),
        B('CLEAR', 'Clear track pattern', '⌫', () => this.clearTrack()),
      ));
      this.syncGenKnobs();
    } else {
      body.append(el('div.hint', { text: 'turn a knob → lock it to the step · dbl-click → remove lock · ESC → done' }));
    }
    this.inspSec.append(head, body);
    this.syncInspector();
  }

  syncStepKnobs(st) {
    const sk = this.inspKnobs.step;
    if (!sk.v) return;
    st = st || { v: 0.85, p: 1, c: 0, n: 0, r: 1 };
    sk.v.set(st.v); sk.p.set(st.p); sk.c.set(st.c / (CONDS.length - 1)); sk.n.set(st.n + 0.5); sk.r.set((st.r - 1) / 3);
  }

  syncGenKnobs() {
    const gk = this.inspKnobs.gen, tr = this.p.tracks[this.selTrack], ptr = this.ptr;
    if (!gk.len) return;
    gk.len.set((ptr.len - 1) / 63);
    gk.speed.set(SPEEDS.indexOf(ptr.speed) / 3);
    gk.mut.set(tr.gen.mut); gk.dv.set(tr.gen.dv);
    gk.pulses.set(tr.gen.pulses / Math.max(1, ptr.len)); gk.rot.set(tr.gen.rot / Math.max(1, ptr.len - 1));
    gk.pulses.render(); gk.rot.render();
  }

  /** Update inspector knob values (without rebuilding). */
  syncInspector() {
    if (!this.inspKnobs) return;
    const t = this.selTrack, tr = this.p.tracks[t];
    const tg = this.targets;
    const st = tg.length ? this.ptr.steps[tg[0]] : null;
    for (const [id, k] of Object.entries(this.inspKnobs.voice)) {
      const lk = st && st.l && st.l[id] !== undefined;
      k.set(lk ? st.l[id] : tr.params[id]);
      k.setMode(this.stepMode ? (lk ? 'locked' : 'dimmed') : '');
    }
    for (const [key, k] of Object.entries(this.inspKnobs.mix)) {
      const lk = st && st.l && st.l[key] !== undefined;
      k.set(mixToKnob(key, lk ? st.l[key] : tr.mix[key]));
      k.setMode(this.stepMode ? (lk ? 'locked' : 'dimmed') : '');
    }
    if (this.stepMode) this.syncStepKnobs(st);
    else this.syncGenKnobs();
    if (this.presetName) this.presetName.textContent = VOICES[t].presets[tr.preset]?.name || '—';
  }

  // =====================================================================================
  // editing actions
  // =====================================================================================
  selectTrack(t) {
    if (t === this.selTrack) return;
    this.selTrack = t; this.sel.clear(); this.held.clear();
    this.refreshRows(); this.buildInspector(); this.refreshPages();
    this.strips.forEach((s, i) => s.node.classList.toggle('sel', i === t));
  }
  toggleSel(s) {
    if (this.sel.has(s)) this.sel.delete(s); else this.sel.add(s);
    this.refreshSel();
  }
  clearSel() { this.sel.clear(); this.refreshSel(); }
  refreshSel() { this.refreshRow(this.selTrack); this.buildInspector(); }

  /** Write a lock (voice param normalised, or mix value) to all target steps. */
  writeLock(key, val) {
    const ptr = this.ptr;
    for (const s of this.targets) {
      if (!ptr.steps[s]) ptr.steps[s] = newStep();
      const st = ptr.steps[s];
      st.l = st.l || {};
      st.l[key] = val;
    }
    this.held.forEach((h) => { h.edited = true; });
    this.afterEdit(this.selTrack, false);
    this.syncInspector();
  }
  clearLock(key) {
    this.app.pushUndo();
    for (const s of this.targets) {
      const st = this.ptr.steps[s];
      if (st && st.l) { delete st.l[key]; if (!Object.keys(st.l).length) st.l = null; }
    }
    this.afterEdit(this.selTrack, false); this.syncInspector();
  }
  clearLocks() {
    this.app.pushUndo();
    for (const s of this.targets) { const st = this.ptr.steps[s]; if (st) st.l = null; }
    this.afterEdit(this.selTrack, false); this.syncInspector();
  }
  setStepParam(key, n) {
    const ptr = this.ptr;
    for (const s of this.targets) {
      if (!ptr.steps[s]) ptr.steps[s] = newStep();
      const st = ptr.steps[s];
      if (key === 'v') st.v = Math.max(0.02, n);
      else if (key === 'p') st.p = Math.round(n * 100) / 100;
      else if (key === 'c') st.c = Math.round(n * (CONDS.length - 1));
      else if (key === 'n') st.n = Math.round((n - 0.5) * 100) / 100;
      else if (key === 'r') st.r = 1 + Math.round(n * 3);
    }
    this.held.forEach((h) => { h.edited = true; });
    this.afterEdit(this.selTrack, false);
  }

  /** After a pattern edit: redraw row, mark project dirty. */
  afterEdit(t, rebuild = false) {
    this.refreshRow(t);
    this.refreshPatButtons();
    if (rebuild) this.buildInspector();
    this.app.changed();
  }

  setLen(t, len) {
    len = clamp(len, 1, MAX_STEPS);
    this.pat.tracks[t].len = len;
    this.afterEdit(t); this.refreshPages(); if (t === this.selTrack) this.syncGenKnobs();
  }
  setSpeed(t, sp) { this.pat.tracks[t].speed = sp; this.afterEdit(t); if (t === this.selTrack) this.syncGenKnobs(); }
  cycleSpeed(t) { this.app.pushUndo(); const tr = this.pat.tracks[t]; this.setSpeed(t, SPEEDS[(SPEEDS.indexOf(tr.speed) + 1) % SPEEDS.length]); }
  setBars(b) {
    this.app.pushUndo();
    const pat = this.pat, old = pat.bars * 16;
    pat.bars = b;
    pat.tracks.forEach((tr) => { if (tr.len === old) tr.len = b * 16; });
    if (this.page >= b) this.setPage(b - 1);
    this.refreshAll(); this.app.changed();
  }
  setEuclid(which, n) {
    const tr = this.p.tracks[this.selTrack], ptr = this.ptr;
    if (which === 'pulses') tr.gen.pulses = Math.round(n * ptr.len);
    else tr.gen.rot = Math.round(n * (ptr.len - 1));
    applyEuclid(ptr, tr.gen.pulses, tr.gen.rot);
    this.afterEdit(this.selTrack);
  }
  bakeMutate() { this.app.pushUndo(); mutate(this.ptr, Math.max(0.3, this.p.tracks[this.selTrack].gen.mut)); this.afterEdit(this.selTrack); this.msg('MUTATED'); }
  rnd() { this.app.pushUndo(); randomize(this.ptr, 0.22 + Math.random() * 0.2); this.afterEdit(this.selTrack); this.msg('RANDOM'); }
  reroll() { this.app.seq.reroll(this.selTrack); this.app.changed(); this.msg('DÉJÀ VU ↻'); }
  copy() { this.clip = deepClone(this.ptr); this.msg('COPIED ' + VOICES[this.selTrack].name); }
  paste() {
    if (!this.clip) return;
    this.app.pushUndo();
    this.pat.tracks[this.selTrack] = deepClone(this.clip);
    this.afterEdit(this.selTrack); this.syncGenKnobs(); this.msg('PASTED');
  }
  clearTrack() {
    this.app.pushUndo();
    this.ptr.steps.fill(null);
    this.sel.clear();
    this.afterEdit(this.selTrack, true); this.msg('CLEARED');
  }
  stepPreset(d) {
    const v = VOICES[this.selTrack], tr = this.p.tracks[this.selTrack];
    this.app.pushUndo();
    this.app.setPreset(this.selTrack, (tr.preset + d + v.presets.length) % v.presets.length);
  }
  patternClick(i, e) {
    const p = this.p;
    if (e && e.shiftKey) {
      this.app.pushUndo();
      p.patterns[i] = deepClone(p.patterns[p.cur]);
      this.msg(`${PATTERN_NAMES[p.cur]} → ${PATTERN_NAMES[i]}`);
      this.refreshPatButtons(); this.app.changed();
      return;
    }
    if (e && e.altKey) {
      if (chainBars(p) + p.patterns[i].bars > 16) { this.msg('CHAIN FULL (16 BARS)'); return; }
      if (p.chain.length === 1 && !p.chainOn && p.chain[0] === p.cur && this._chainFresh !== true) { p.chain = []; this._chainFresh = true; }
      p.chain.push(i); p.chainOn = true;
      this.refreshBar(); this.app.changed();
      return;
    }
    this.app.seq.selectPattern(i);
    if (!this.app.seq.playing) { this.sel.clear(); this.refreshAll(); }
  }
  toggleChain() { this.p.chainOn = !this.p.chainOn; if (!this.p.chain.length) this.p.chain = [this.p.cur]; this.refreshBar(); this.app.changed(); }
  clearChain() { this.p.chain = [this.p.cur]; this.p.chainOn = false; this._chainFresh = false; this.refreshBar(); this.app.changed(); this.msg('CHAIN CLEARED'); }
  setPage(k) { this.page = clamp(k, 0, 3); this.refreshRows(); this.refreshPages(); }
  toggleView() {
    this.view = this.view === 'grid' ? 'mix' : 'grid';
    this.gridSec.classList.toggle('view-mix', this.view === 'mix');
    this.viewBtn.textContent = this.view === 'grid' ? 'MIX' : 'GRID';
    this.viewBtn.classList.toggle('on', this.view === 'mix');
    this.gridHead.querySelector('.title').textContent = this.view === 'grid' ? 'SEQUENCER' : 'MIXER';
    this.gridHead.querySelector('.lbl').textContent = this.view === 'grid' ? 'click: toggle · hold / ⇧click: select step → knobs lock · keys Q–I A–K' : 'volume · pan · sends · filter · crush · FX · master';
    this.refreshMixer();
  }
  toggleFull() { document.body.classList.toggle('fullvis'); dispatchEvent(new Event('resize')); }
  toggleHelp(on) { this.help.classList.toggle('on', on); }

  msg(text) {
    this.msgEl.textContent = text;
    this.msgEl.classList.add('on');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => this.msgEl.classList.remove('on'), 1400);
  }

  // =====================================================================================
  // rendering
  // =====================================================================================
  refreshAll() {
    this.refreshRows(); this.refreshBar(); this.refreshPages(); this.buildInspector(); this.refreshMacros(); this.refreshMixer(); this.refreshHUD();
  }
  refreshRows() { for (let t = 0; t < 8; t++) this.refreshRow(t); }
  refreshRow(t) {
    const r = this.rows[t], tr = this.pat.tracks[t], mix = this.p.tracks[t].mix;
    const anySolo = this.p.tracks.some((x) => x.mix.solo);
    r.row.classList.toggle('sel', t === this.selTrack);
    r.row.classList.toggle('muted', mix.mute || (anySolo && !mix.solo));
    r.m.classList.toggle('on', mix.mute); r.s.classList.toggle('on', mix.solo);
    r.len.textContent = tr.len; r.spd.textContent = SPEED_LABELS[SPEEDS.indexOf(tr.speed)];
    const tg = t === this.selTrack ? new Set(this.targets) : null;
    for (let k = 0; k < 16; k++) {
      const s = this.page * 16 + k, c = r.cells[k], st = tr.steps[s];
      c.classList.toggle('on', !!st);
      c.classList.toggle('beyond', s >= tr.len);
      c.classList.toggle('sel', !!(tg && tg.has(s)));
      c.classList.toggle('play', this.pos[t] === s);
      if (st) {
        c.style.setProperty('--v', (0.3 + 0.7 * st.v).toFixed(2));
        c.classList.toggle('p', st.p < 1);
        c.querySelector('.prob').style.width = Math.round(st.p * 100) + '%';
        c.classList.toggle('c', st.c > 0);
        c.querySelector('.cond').textContent = st.c > 0 ? CONDS[st.c] : '';
        c.classList.toggle('r', st.r > 1);
        if (st.r > 1) c.style.setProperty('--rw', (100 / st.r).toFixed(1) + '%');
        c.classList.toggle('l', !!(st.l && Object.keys(st.l).length));
        c.querySelector('.fill').style.transform = st.n ? `translateX(${(st.n * 40).toFixed(1)}%)` : '';
      } else {
        c.classList.remove('p', 'c', 'r', 'l');
      }
    }
    if (t === this.selTrack) for (let k = 0; k < 16; k++) this.numEls[k].textContent = this.page * 16 + k + 1;
  }
  refreshPatButtons() {
    const p = this.p, q = this.app.seq.queued;
    this.patBtns.forEach((b, i) => {
      b.classList.toggle('on', i === p.cur);
      b.classList.toggle('queued', i === q);
      b.classList.toggle('empty', !p.patterns[i].tracks.some((t) => t.steps.some(Boolean)));
    });
  }
  refreshBar() {
    const p = this.p;
    this.bpmEl.textContent = p.bpm.toFixed(1);
    this.swEl.textContent = Math.round(p.swing);
    this.refreshPatButtons();
    this.barsBtns.forEach((b, i) => b.classList.toggle('on', i + 1 === this.pat.bars));
    this.chainBtn.classList.toggle('on', p.chainOn);
    this.chainStr.textContent = p.chainOn ? p.chain.map((k) => PATTERN_NAMES[k]).join('') : '';
    this.followBtn.classList.toggle('on', this.follow);
    this.fillBtn.classList.toggle('on', this.app.seq.fill);
    this.playBtn.classList.toggle('on', this.app.seq.playing);
    this.playBtn.textContent = this.app.seq.playing ? '■' : '▶';
  }
  refreshPages() {
    const len = this.ptr.len;
    this.pageBtns.forEach((b, k) => { b.classList.toggle('on', k === this.page); b.classList.toggle('empty', k * 16 >= Math.max(len, this.pat.bars * 16)); });
  }
  refreshMacros() {
    const m = this.p.macros, k = this.macroKnobs;
    k.depth.set(m.depth); k.entropy.set(m.entropy); k.space.set(m.space); k.mood.set(m.mood);
    k.tempo.set((this.p.bpm - 40) / 180); k.swing.set((this.p.swing - 50) / 25);
  }
  refreshMixer() {
    const p = this.p;
    this.strips.forEach((s, t) => {
      const mix = p.tracks[t].mix;
      for (const [k, kn] of Object.entries(s.kn)) kn.set(mixToKnob(k, mix[k]));
      s.m.classList.toggle('on', mix.mute); s.s.classList.toggle('on', mix.solo);
      s.node.classList.toggle('sel', t === this.selTrack);
    });
    const fk = this.fxKnobs;
    fk['delay.div'].set(p.fx.delay.div / (DELAY_DIVS.length - 1)); fk['delay.feedback'].set(p.fx.delay.feedback / 0.93);
    fk['delay.tone'].set(p.fx.delay.tone); fk['delay.ping'].set(p.fx.delay.ping);
    fk['reverb.size'].set(p.fx.reverb.size); fk['reverb.damp'].set(p.fx.reverb.damp);
    fk['master.duck'].set(p.master.duck); fk['master.drive'].set(p.master.drive); fk['master.volume'].set(p.master.volume);
  }
  refreshHUD() {
    const v = this.p.visual;
    this.sceneBtns.forEach((b, i) => b.classList.toggle('on', i === v.scene));
    this.sceneName.textContent = String(v.scene + 1).padStart(2, '0') + ' ' + SCENE_NAMES[v.scene];
    const names = this.app.visual?.paramNames(v.scene) || ['P1', 'P2', 'P3'];
    const meta = this.app.visual?.paramMeta(v.scene) || {};
    this.sceneKnobs.forEach((k, i) => {
      k.setLabel(names[i]);
      k.o.steps = meta.steps?.[i] || 0;
      k.o.format = meta.formats?.[i] || pct;
      k.root.dataset.tip = `${SCENE_NAMES[v.scene]} · ${names[i]}`;
      k.set(v.params[v.scene][i]); k.render();
    });
    this.reactKnob.set(v.reactivity);
    this.autoBtn.classList.toggle('on', !!v.auto);
    this.freezeBtn.classList.toggle('on', !!this.app.visual?.frozen);
  }

  // =====================================================================================
  // app events
  // =====================================================================================
  bindApp() {
    const a = this.app;
    a.on('step', (pos) => {
      for (let t = 0; t < 8; t++) {
        const prev = this.playCells[t];
        if (prev) prev.classList.remove('play');
        this.pos[t] = pos[t];
        const s = pos[t];
        if (s >= 0 && Math.floor(s / 16) === this.page) { const c = this.rows[t].cells[s % 16]; c.classList.add('play'); this.playCells[t] = c; }
        else this.playCells[t] = null;
      }
      if (this.follow && a.seq.playing) {
        const s = pos[this.selTrack];
        if (s >= 0 && Math.floor(s / 16) !== this.page) this.setPage(Math.floor(s / 16));
      }
    });
    a.on('hitDraw', (ev) => { flash(this.rows[ev.track].act, 'flash', 70); this.strips[ev.track].lvl = Math.max(this.strips[ev.track].lvl, ev.vel); });
    a.on('beatDraw', (info) => { this.posEl.textContent = `${PATTERN_NAMES[info.pattern]} ${info.bar + 1}.${info.beat + 1}`; });
    a.on('transport', () => { this.refreshBar(); if (!a.seq.playing) this.posEl.textContent = ''; });
    a.on('pattern', () => { this.sel.clear(); this.refreshAll(); });
    a.on('queue', () => this.refreshPatButtons());
    a.on('tempo', () => { this.bpmEl.textContent = this.p.bpm.toFixed(1); this.macroKnobs.tempo.set((this.p.bpm - 40) / 180); });
    a.on('swing', () => { this.swEl.textContent = Math.round(this.p.swing); this.macroKnobs.swing.set((this.p.swing - 50) / 25); });
    a.on('fill', () => this.refreshBar());
    a.on('macro', (k, v) => { if (this.macroKnobs[k]) this.macroKnobs[k].set(v); });
    a.on('project', () => { this.sel.clear(); this.held.clear(); this.refreshAll(); });
    a.on('preset', (t) => { if (t === this.selTrack) this.syncInspector(); });
    a.on('param', (t) => { if (t === this.selTrack && !this.stepMode) this.syncInspector(); });
    a.on('mix', (t, k) => {
      this.refreshRow(t);
      const s = this.strips[t];
      if (s.kn[k]) s.kn[k].set(mixToKnob(k, this.p.tracks[t].mix[k]));
      s.m.classList.toggle('on', this.p.tracks[t].mix.mute); s.s.classList.toggle('on', this.p.tracks[t].mix.solo);
      if (k === 'mute' || k === 'solo') this.refreshRows();
      if (t === this.selTrack && !this.stepMode) this.syncInspector();
    });
    a.on('audio', () => this.start.classList.add('gone'));
    a.on('visual', () => this.refreshHUD());
  }

  /** Per-frame UI work (meters). */
  frame() {
    if (this.view !== 'mix' || !this.app.engine.ready) return;
    const e = this.app.engine;
    this.strips.forEach((s, t) => {
      const lv = e.stripLevel ? e.stripLevel(t) : s.lvl;
      s.lvl *= 0.85;
      s.meter.style.height = Math.min(100, Math.round(Math.sqrt(lv) * 100)) + '%';
    });
    const ml = e.masterLevel ? e.masterLevel() : 0;
    this.masterMeter.firstChild.style.height = Math.min(100, Math.round(Math.sqrt(ml) * 100)) + '%';
  }

  // =====================================================================================
  // keyboard
  // =====================================================================================
  bindKeys() {
    const a = this.app;
    addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (tag === 'SELECT' && e.code !== 'Space')) return;
      if (!a.engine.ready) a.ensureAudio();
      const mod = e.metaKey || e.ctrlKey;
      const code = e.code;
      // ---- modifier shortcuts
      if (mod) {
        const k = { KeyZ: () => (e.shiftKey ? a.redo() : a.undo()), KeyY: () => a.redo(), KeyC: () => this.copy(), KeyV: () => this.paste(), KeyS: () => a.io?.saveFile(), KeyO: () => a.io?.openFile() }[code];
        if (k) { e.preventDefault(); k(); }
        return;
      }
      if (e.repeat && (STEP_KEYS.includes(code) || code === 'KeyL')) { e.preventDefault(); return; }
      const si = STEP_KEYS.indexOf(code);
      if (si >= 0 && !e.shiftKey && !e.altKey) { e.preventDefault(); this.stepKeyDown(code, si); return; }
      const pi = PAT_KEYS.indexOf(code);
      if (pi >= 0) { e.preventDefault(); this.patternClick(pi, e); return; }
      if (/^Digit[1-8]$/.test(code)) {
        const n = +code.slice(5) - 1;
        e.preventDefault();
        if (e.shiftKey) this.selectTrack(n);
        else if (n < 5) a.visual?.setScene(n);
        return;
      }
      const sh = e.shiftKey;
      const act = {
        Space: () => { document.activeElement?.blur?.(); a.togglePlay(); },
        ArrowUp: () => this.selectTrack((this.selTrack + 7) % 8),
        ArrowDown: () => this.selectTrack((this.selTrack + 1) % 8),
        ArrowLeft: () => { this.follow = false; this.setPage(this.page - 1); this.refreshBar(); },
        ArrowRight: () => { this.follow = false; this.setPage(this.page + 1); this.refreshBar(); },
        KeyM: () => (sh ? this.bakeMutate() : a.setMix(this.selTrack, 'mute', !this.p.tracks[this.selTrack].mix.mute)),
        KeyN: () => a.setMix(this.selTrack, 'solo', !this.p.tracks[this.selTrack].mix.solo),
        KeyB: () => (sh ? this.clearChain() : this.toggleChain()),
        KeyL: () => (sh ? a.setFill(!a.seq.fill) : (this._fillHeld = true, a.setFill(true))),
        KeyP: () => a.visual?.toggleFreeze(),
        Digit0: () => a.visual?.toggleAuto(),
        Backquote: () => { this.hudBottom.classList.toggle('hidden'); this.hudTop.classList.toggle('hidden'); },
        Tab: () => this.toggleView(),
        Minus: () => a.setTempo(this.p.bpm - (sh ? 10 : 1)),
        Equal: () => a.setTempo(this.p.bpm + (sh ? 10 : 1)),
        BracketLeft: () => a.setSwing(this.p.swing - 1),
        BracketRight: () => a.setSwing(this.p.swing + 1),
        Comma: () => this.stepPreset(-1),
        Period: () => this.stepPreset(1),
        Escape: () => { this.toggleHelp(false); this.clearSel(); },
        Backspace: () => this.clearTrack(),
        Delete: () => this.clearTrack(),
        Slash: () => sh && this.toggleHelp(!this.help.classList.contains('on')),
      };
      if (sh) {
        Object.assign(act, {
          KeyE: () => { this.app.pushUndo(); const g = this.p.tracks[this.selTrack].gen; applyEuclid(this.ptr, g.pulses || 4, g.rot); this.afterEdit(this.selTrack); this.msg('EUCLID'); },
          KeyR: () => this.rnd(),
          KeyD: () => this.reroll(),
          KeyF: () => this.toggleFull(),
          KeyW: () => a.io?.toggleWav(),
          KeyO: () => a.io?.toggleVideo(),
        });
      }
      const f = act[code];
      if (f) { e.preventDefault(); f(); }
    });
    addEventListener('keyup', (e) => {
      if (STEP_KEYS.includes(e.code)) this.stepKeyUp(e.code);
      if (e.code === 'KeyL' && this._fillHeld) { this._fillHeld = false; this.app.setFill(false); }
    });
    addEventListener('blur', () => { if (this.held.size) { this.held.clear(); this.buildInspector(); this.refreshRow(this.selTrack); } });
    // drop a project file anywhere
    addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropzone'); });
    addEventListener('dragleave', () => document.body.classList.remove('dropzone'));
    addEventListener('drop', (e) => {
      e.preventDefault(); document.body.classList.remove('dropzone');
      const f = e.dataTransfer.files[0];
      if (f) f.text().then((t) => { try { this.app.importJSON(t); this.msg('LOADED'); } catch (err) { this.msg('INVALID FILE'); } });
    });
  }

  stepKeyDown(code, idx) {
    const s = this.page * 16 + idx;
    const ptr = this.ptr;
    this.app.pushUndo();
    const wasOn = !!ptr.steps[s];
    if (!wasOn) ptr.steps[s] = newStep();
    this.held.set(code, { s, wasOn, t0: performance.now(), edited: false });
    this.afterEdit(this.selTrack);
    this.buildInspector();
  }
  stepKeyUp(code) {
    const h = this.held.get(code);
    if (!h) return;
    this.held.delete(code);
    if (h.wasOn && !h.edited && performance.now() - h.t0 < 320) this.ptr.steps[h.s] = null;
    this.afterEdit(this.selTrack);
    this.buildInspector();
  }

  // =====================================================================================
  // help overlay
  // =====================================================================================
  buildHelp() {
    const sec = (title, rows) => el('div', {}, el('h3', { text: title }), el('dl', {}, ...rows.flatMap(([k, d]) => [el('dt', { text: k }), el('dd', { text: d })])));
    this.help = el('div#help', { onclick: (e) => { if (e.target === this.help) this.toggleHelp(false); } },
      el('h2', { html: 'UNI<b style="color:var(--accent);font-weight:normal">T</b> — SHORTCUTS' }),
      el('div.cols', {},
        el('div', {},
          sec('TRANSPORT', [['SPACE', 'play / stop'], ['− / =', 'tempo −1 / +1 (⇧ ±10)'], ['[ / ]', 'swing −1 / +1'], ['L (hold)', 'fill while held'], ['⇧L', 'latch fill']]),
          sec('PATTERNS', [['Z X C V', 'pattern A B C D (queued while playing)'], ['⇧Z…V', 'copy current pattern there'], ['⌥Z…V', 'append to chain'], ['B / ⇧B', 'chain on/off · clear chain'], ['← / →', 'page (bar 1–4)']]),
          sec('FILE', [['⌘S', 'save project (.json)'], ['⌘O', 'open project'], ['⇧W', 'record WAV'], ['⇧O', 'record video'], ['⌘Z / ⇧⌘Z', 'undo / redo'], ['drop file', 'load project']])),
        el('div', {},
          sec('TRACKS & STEPS', [['↑ / ↓  ⇧1…8', 'select track'], ['Q…I  A…K', 'steps 1–16: tap = toggle'], ['hold key + knob', 'parameter lock'], ['long-press / ⇧click', 'select step(s) for locks'], ['ESC', 'leave step edit'], ['M / N', 'mute / solo track'], [', / .', 'previous / next preset'], ['TAB', 'grid ↔ mixer']]),
          sec('GENERATORS', [['⇧E', 'write Euclid rhythm'], ['⇧M', 'bake mutation'], ['⇧R', 'random pattern'], ['⇧D', 're-roll DÉJÀ VU'], ['⌘C / ⌘V', 'copy / paste track'], ['⌫', 'clear track']])),
        el('div', {},
          sec('VISUALS', [['1 – 5', 'scene'], ['P', 'freeze'], ['0', 'auto-switch scene on pattern change'], ['⇧F', 'visuals only'], ['`', 'hide / show HUD']]),
          sec('KNOBS', [['drag ↕', 'change (⇧ = fine)'], ['wheel', 'change'], ['dbl-click', 'default (in step edit: remove lock)']]),
          el('p', { text: 'DÉJÀ VU: every random decision of a track (probability, MUTATE, ENTROPY) comes from a memory with one slot per step. 0 = fresh randomness every pass, 100 = the same "random" loop forever; in between it slowly evolves.' }),
          el('p', { text: 'Press ? or ESC to close.' }))));
    document.body.append(this.help);
  }
}
