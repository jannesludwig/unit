// UNIT — entry point: wires app core, UI and (later) visuals; runs the frame loop.

import { App } from './app.js';
import { UI } from './ui/ui.js';

const app = new App();
const ui = new UI(app);
window.unit = { app, ui }; // handy for debugging from the console

// first gesture starts audio (browser autoplay policy)
const boot = () => { app.ensureAudio(); };
addEventListener('pointerdown', boot, { once: true });
addEventListener('keydown', boot, { once: true });

function frame() {
  ui.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
