// UNIT — application core: owns the project, the audio engine and the sequencer, and
// offers one place for every state change (so UI, keyboard, autosave and undo stay in sync).

import { AudioEngine, MIX_LOCKABLE } from './audio/engine.js';
import { Sequencer } from './seq/sequencer.js';
import { DEMOS } from './seq/demos.js';
import { newProject, serialize, deserialize, presetNorms } from './seq/model.js';
import { Emitter, debounce, deepClone } from './core/util.js';

const STORE_KEY = 'unit.project.v1';

export class App extends Emitter {
  constructor() {
    super();
    this.engine = new AudioEngine();
    this.project = this.loadAutosave() || DEMOS[0].make();
    this.undoStack = []; this.redoStack = [];
    this.seq = new Sequencer(this.engine, () => this.project, {
      onStep: (t, pos) => this.emit('step', pos),
      onHit: (ev) => this.emit('hit', ev),
      onHitDraw: (ev) => this.emit('hitDraw', ev),
      onPattern: (t, k) => this.emit('pattern', k),
      onQueue: (k) => this.emit('queue', k),
      onBeat: (t, info) => this.emit('beat', t, info),
      onBeatDraw: (info) => this.emit('beatDraw', info),
      onTransport: (on) => this.emit('transport', on),
    });
    this.seq.seedAll();
    this.autosave = debounce(() => this.saveAutosave(), 800);
  }

  /** Audio needs a user gesture: build the graph on first interaction. */
  async ensureAudio() {
    if (!this.engine.ready) {
      if (!this._audioP) {
        this._audioP = this.engine.init().then(() => { this.applyProject(); this.emit('audio'); });
      }
      await this._audioP;
    }
    if (this.engine.ctx.state !== 'running') await this.engine.ctx.resume();
  }

  /** Push the whole project into the engine (after load / demo switch). */
  applyProject() {
    const p = this.project, e = this.engine;
    this.seq.seedAll();
    if (!e.ready) return;
    this.seq.setTempo(p.bpm);
    e.setFx(p.fx);
    e.setMaster(p.master);
    e.setMacros(p.macros);
    p.tracks.forEach((t, i) => { for (const k of ['vol', ...MIX_LOCKABLE]) e.setMix(i, k, t.mix[k]); });
    e.applyMutes(p.tracks);
  }

  setProject(p, { keepPlaying = true } = {}) {
    const wasPlaying = this.seq.playing;
    if (wasPlaying) this.seq.stop();
    this.project = p;
    this.applyProject();
    this.emit('project');
    this.changed();
    if (wasPlaying && keepPlaying) this.seq.start();
  }

  loadDemo(i) { this.pushUndo(); this.setProject(DEMOS[i].make()); }
  newProject() { this.pushUndo(); this.setProject(newProject(), { keepPlaying: false }); }

  // ---- transport ----
  async togglePlay() { await this.ensureAudio(); this.seq.toggle(); }
  setTempo(bpm) { bpm = Math.max(40, Math.min(220, Math.round(bpm * 10) / 10)); this.seq.setTempo(bpm); this.emit('tempo', bpm); this.changed(); }
  setSwing(s) { this.project.swing = Math.max(50, Math.min(75, s)); this.emit('swing', this.project.swing); this.changed(); }
  setFill(on) { this.seq.fill = on; this.emit('fill', on); }

  // ---- sound / mix ----
  setParam(i, id, v) { this.project.tracks[i].params[id] = v; this.emit('param', i, id); this.changed(); }
  setPreset(i, k) {
    const t = this.project.tracks[i];
    t.preset = k; t.params = presetNorms(i, k);
    this.emit('preset', i); this.changed();
  }
  setMix(i, k, v) {
    const t = this.project.tracks[i];
    t.mix[k] = v;
    if (k === 'mute' || k === 'solo') this.engine.ready && this.engine.applyMutes(this.project.tracks);
    else if (this.engine.ready) this.engine.setMix(i, k, v);
    this.emit('mix', i, k); this.changed();
  }
  setMacro(k, v) {
    if (k === 'tempo') return this.setTempo(v);
    if (k === 'swing') return this.setSwing(v);
    this.project.macros[k] = v;
    if (this.engine.ready) this.engine.setMacros({ [k]: v });
    this.emit('macro', k, v); this.changed();
  }
  setFx(group, k, v) {
    this.project.fx[group][k] = v;
    if (this.engine.ready) this.engine.setFx(this.project.fx);
    this.emit('fx', group, k); this.changed();
  }
  setMaster(k, v) {
    this.project.master[k] = v;
    if (this.engine.ready) this.engine.setMaster({ [k]: v });
    this.emit('master', k); this.changed();
  }

  // ---- undo (pattern + sound snapshots) ----
  snapshot() { return JSON.stringify(serialize(this.project)); }
  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() { this._swap(this.undoStack, this.redoStack); }
  redo() { this._swap(this.redoStack, this.undoStack); }
  _swap(from, to) {
    if (!from.length) return;
    to.push(this.snapshot());
    const p = deserialize(JSON.parse(from.pop()));
    p.cur = this.project.cur;
    this.project = p;
    this.applyProject();
    this.emit('project');
    this.changed();
  }

  // ---- persistence ----
  changed() { this.emit('changed'); this.autosave(); }
  saveAutosave() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize(this.project))); } catch (e) { /* storage full / blocked */ }
  }
  loadAutosave() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      return s ? deserialize(JSON.parse(s)) : null;
    } catch (e) { return null; }
  }
  exportJSON() { return JSON.stringify(serialize(this.project), null, 1); }
  importJSON(text) {
    const p = deserialize(JSON.parse(text));
    this.pushUndo();
    this.setProject(p);
  }
  clone() { return deepClone(this.project); }
}
