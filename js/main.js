// UNIT — entry point: wires app core, UI, export and visuals; runs the frame loop.
// Visuals are loaded lazily so the groovebox still works if WebGL or the three.js CDN fails.

import { App } from './app.js';
import { UI } from './ui/ui.js';
import { IO } from './io/io.js';

const app = new App();
const ui = new UI(app);
app.io = new IO(app, ui);
let visuals = null;
window.unit = { app, ui, visuals: null }; // handy for debugging from the console

if (!window.Tone) {
  ui.start.querySelector('.lbl').textContent = 'COULD NOT LOAD TONE.JS (CDN) — CHECK YOUR CONNECTION AND RELOAD';
}

import('./visual/visuals.js')
  .then(({ VisualEngine }) => {
    visuals = new VisualEngine(app, ui.stage);
    app.visual = visuals;
    window.unit.visuals = visuals;
    ui.refreshHUD();
  })
  .catch((e) => {
    console.error('Visuals unavailable', e);
    ui.sceneName.textContent = 'VISUALS UNAVAILABLE (WEBGL / THREE.JS)';
  });

// first gesture starts audio (browser autoplay policy)
const boot = () => { app.ensureAudio(); };
addEventListener('pointerdown', boot, { once: true });
addEventListener('keydown', boot, { once: true });

let n = 0;
function frame(now) {
  if (visuals) {
    visuals.frame(now);
    app.io.vid.track?.requestFrame(); // video export: one captured frame per rendered frame
    if (++n % 30 === 0) ui.fps.textContent = Math.round(visuals.fpsAvg) + ' FPS';
  }
  ui.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
