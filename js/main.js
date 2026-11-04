// UNIT — entry point: wires app core, UI and visuals; runs the frame loop.

import { App } from './app.js';
import { UI } from './ui/ui.js';
import { VisualEngine } from './visual/visuals.js';

const app = new App();
const ui = new UI(app);
let visuals = null;
try {
  visuals = new VisualEngine(app, ui.stage);
  app.visual = visuals;
} catch (e) {
  console.error('WebGL unavailable — visuals disabled', e);
}
ui.refreshHUD();
window.unit = { app, ui, visuals }; // handy for debugging from the console

// first gesture starts audio (browser autoplay policy)
const boot = () => { app.ensureAudio(); };
addEventListener('pointerdown', boot, { once: true });
addEventListener('keydown', boot, { once: true });

let n = 0;
function frame(now) {
  if (visuals) visuals.frame(now);
  ui.frame();
  if (visuals && ++n % 30 === 0) ui.fps.textContent = Math.round(visuals.fpsAvg) + ' FPS';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
