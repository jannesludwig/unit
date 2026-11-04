// UNIT — export & files: WAV (sample-accurate, bar-quantised), video (canvas + master audio via
// MediaRecorder; MP4 where supported, else WebM), project save / load as JSON.

import { MasterRecorder, encodeWav } from './wav.js';
import { el } from '../ui/widgets.js';

const BAR_OPTS = [1, 2, 4, 8, 16, 32, 0]; // 0 = open-ended (stop manually)

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = (s) => (s || 'unit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unit';
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  // MP4 only with explicit H.264 + AAC support (Safari, Chrome with platform encoders);
  // otherwise WebM, which every Chromium records reliably. Bare 'video/mp4' is a last resort.
  const c = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4',
  ];
  return c.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

export class IO {
  constructor(app, ui) {
    this.app = app; this.ui = ui;
    this.bars = 4;
    this.wav = { state: 'idle' };      // idle | armed | rec | encoding
    this.vid = { state: 'idle' };
    this.build();
    app.on('beat', (t, info) => this.onBeat(t, info));
    addEventListener('beforeunload', () => app.saveAutosave());
  }

  build() {
    const ui = this.ui;
    this.barSel = el('select', { 'data-tip': 'Length of WAV / video recordings (starts on the next bar)' },
      ...BAR_OPTS.map((b) => el('option', { value: b, text: b ? `${b} BAR${b > 1 ? 'S' : ''}` : '∞ MANUAL' })));
    this.barSel.value = '4';
    this.barSel.addEventListener('change', () => { this.bars = +this.barSel.value; this.barSel.blur(); });
    this.wavBtn = el('button.rec', { text: '● WAV', 'data-tip': 'Record the master to a 16-bit WAV (bar-quantised, sample-accurate)', 'data-key': '⇧W', onclick: () => this.toggleWav() });
    this.vidBtn = el('button.rec', { text: '● VID', 'data-tip': `Record visuals + audio (${(pickVideoMime() || 'unsupported').split(';')[0]})`, 'data-key': '⇧O', onclick: () => this.toggleVideo() });
    this.saveBtn = el('button', { text: 'SAVE', 'data-tip': 'Save project as JSON', 'data-key': '⌘S', onclick: () => this.saveFile() });
    this.loadBtn = el('button', { text: 'LOAD', 'data-tip': 'Load a project JSON (or drop it on the window)', 'data-key': '⌘O', onclick: () => this.openFile() });
    this.fileIn = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    this.fileIn.addEventListener('change', () => {
      const f = this.fileIn.files[0];
      if (f) f.text().then((t) => { try { this.app.importJSON(t); ui.msg('LOADED ' + f.name.toUpperCase()); } catch (e) { ui.msg('INVALID FILE'); } });
      this.fileIn.value = '';
    });
    ui.ioGrp.append(this.barSel, this.wavBtn, this.vidBtn, this.saveBtn, this.loadBtn, this.fileIn);
    const sel = ui.demoSel;
    sel.append(el('option', { value: 'new', text: '— NEW (EMPTY)' }));
  }

  barDur() { return (60 / this.app.project.bpm) * 4; }

  // ------------------------------------------------------------------ WAV
  async toggleWav() {
    const w = this.wav;
    if (w.state === 'rec') { this.recorder.stop(); return; }
    if (w.state === 'armed') { w.state = 'idle'; this.refresh(); return; }
    if (w.state !== 'idle') return;
    await this.app.ensureAudio();
    if (!this.app.engine.hasWorklet) { this.ui.msg('WAV NEEDS AUDIOWORKLET'); return; }
    if (!this.recorder) this.recorder = new MasterRecorder(this.app.engine);
    w.state = 'armed'; w.bars = this.bars;
    this.refresh();
    if (!this.app.seq.playing) this.app.seq.start();
  }

  startWav(t) {
    const w = this.wav;
    w.state = 'rec';
    const end = w.bars ? t + w.bars * this.barDur() : null;
    this.refresh();
    this.recorder.onProgress = (s) => { this.wavBtn.textContent = '■ ' + s.toFixed(1) + 's'; };
    this.recorder.record(t, end).then(({ l, r, sampleRate }) => {
      w.state = 'encoding'; this.refresh();
      setTimeout(() => {
        const blob = encodeWav(l, r, sampleRate);
        const p = this.app.project;
        download(blob, `${slug(p.name)}_${Math.round(p.bpm)}bpm_${w.bars ? w.bars + 'bars' : stamp()}.wav`);
        this.ui.msg(`WAV ${(l.length / sampleRate).toFixed(1)}s`);
        w.state = 'idle'; this.refresh();
      }, 30);
    });
  }

  // ------------------------------------------------------------------ video
  async toggleVideo() {
    const v = this.vid;
    if (v.state === 'rec') { this.stopVideo(); return; }
    if (v.state === 'armed') { this.discardVideo(); return; }
    if (v.state !== 'idle') return;
    const mime = pickVideoMime();
    const canvas = this.app.visual?.canvas;
    if (!mime || !canvas || !canvas.captureStream) { this.ui.msg('VIDEO NOT SUPPORTED'); return; }
    await this.app.ensureAudio();
    v.mime = mime; v.bars = this.bars;
    this.prepareVideo();
    v.state = 'armed';
    this.refresh();
    if (!this.app.seq.playing) this.app.seq.start();
  }

  /** Build stream + recorder up front so the start on the downbeat is instant. */
  prepareVideo() {
    const v = this.vid, e = this.app.engine;
    if (!this.dest) { this.dest = e.ctx.createMediaStreamDestination(); e.out.connect(this.dest); }
    // push a frame for every rendered visual frame (requestFrame), else let the browser sample at 60 fps
    const canvas = this.app.visual.canvas;
    let vt = canvas.captureStream(0).getVideoTracks()[0];
    if (!vt || typeof vt.requestFrame !== 'function') { vt?.stop(); vt = canvas.captureStream(60).getVideoTracks()[0]; v.track = null; } else v.track = vt;
    const stream = new MediaStream([vt, ...this.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: v.mime, videoBitsPerSecond: 16e6, audioBitsPerSecond: 256000 });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => {
      stream.getVideoTracks().forEach((tr) => tr.stop());
      v.track = null;
      clearInterval(v.iv);
      if (v.discard) { v.discard = false; return; }
      const blob = new Blob(chunks, { type: v.mime.split(';')[0] });
      const ext = v.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      if (blob.size < 2048) this.ui.msg('VIDEO FAILED');
      else {
        download(blob, `${slug(this.app.project.name)}_${stamp()}.${ext}`);
        this.ui.msg(`VIDEO ${(blob.size / 1e6).toFixed(1)} MB`);
      }
      v.state = 'idle'; this.refresh();
    };
    v.rec = rec; v.stream = stream;
    // warm the encoder up now (start + pause); resume exactly on the downbeat
    rec.start(500);
    rec.pause();
  }

  discardVideo() {
    const v = this.vid;
    v.state = 'idle';
    if (v.rec) { if (v.rec.state !== 'inactive') { v.discard = true; v.rec.stop(); } else v.stream?.getVideoTracks().forEach((tr) => tr.stop()); }
    v.track = null;
    this.refresh();
  }

  /** Start on the downbeat (timers against the audio clock), stop after N bars. */
  startVideo(t) {
    const v = this.vid, ctx = this.app.engine.ctx;
    v.state = 'rec';
    const lead = Math.max(0, t - ctx.currentTime);
    setTimeout(() => {
      if (v.state !== 'rec' || v.rec.state !== 'paused') return;
      v.rec.resume();
      v.t0 = performance.now();
      v.iv = setInterval(() => { this.vidBtn.textContent = '■ ' + ((performance.now() - v.t0) / 1000).toFixed(1) + 's'; }, 100);
      if (v.bars) setTimeout(() => { if (v.state === 'rec') this.stopVideo(); }, Math.max(0, t + v.bars * this.barDur() - ctx.currentTime) * 1000);
    }, lead * 1000);
    this.refresh();
  }

  stopVideo() {
    const v = this.vid;
    if (v.rec && v.rec.state !== 'inactive') v.rec.stop();
    v.state = 'encoding'; this.refresh();
  }

  /** Both recorders start on the first downbeat after being armed. */
  onBeat(t, info) {
    if (info.beat !== 0) return;
    if (this.wav.state === 'armed') this.startWav(t);
    if (this.vid.state === 'armed') this.startVideo(t);
  }

  refresh() {
    const set = (btn, st, label) => {
      btn.classList.toggle('armed', st === 'armed');
      btn.classList.toggle('on', st === 'rec');
      if (st === 'idle') btn.textContent = '● ' + label;
      else if (st === 'armed') btn.textContent = '◌ ' + label;
      else if (st === 'encoding') btn.textContent = '… ' + label;
    };
    set(this.wavBtn, this.wav.state, 'WAV');
    set(this.vidBtn, this.vid.state, 'VID');
  }

  // ------------------------------------------------------------------ project files
  saveFile() {
    const p = this.app.project;
    download(new Blob([this.app.exportJSON()], { type: 'application/json' }), `${slug(p.name)}.unit.json`);
    this.ui.msg('SAVED');
  }
  openFile() { this.fileIn.click(); }
}
