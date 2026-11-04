# UNIT

**A minimal, deep, browser-based groovebox and synthesizer with audio-reactive visuals.**

UNIT is an 8-track sequencer in the spirit of an Elektron box with a Teenage-Engineering-clear
surface. Its sound world comes from Alva Noto, Ryoji Ikeda and Raster-Noton: deep sub
pressure, precise clicks, data textures, dark drones, and nothing sampled. It works for strict
16-step techno and for evolving, controlled-random structures.

The visuals run on the same clock as the sound. Five WebGL scenes (oscilloscope, datamatics,
cymatic sphere, signal, reaction-diffusion) react to the exact sequencer events and to live
analysis of the master output.

- Static site: `index.html` at the root, no build step, no backend. It is ready for GitHub Pages.
- Tone.js (CDN) provides the clock, lookahead scheduling and Draw sync. Custom Web Audio DSP
  and AudioWorklets run on the same context.
- three.js (CDN) and custom GLSL drive the visuals: GPGPU particles, feedback buffers and
  instanced lines.

→ **[User guide and all shortcuts](docs/GUIDE.md)** · **[Research notes](docs/RESEARCH.md)**

---

## Run it

**GitHub Pages**: in the repository settings, open *Pages*, choose *Deploy from a branch*, and
select your branch and folder `/ (root)`. Then open the published URL.

**Locally**: ES modules need an HTTP server (`file://` is blocked by the browser). Start one:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

Click once to start audio, then press **SPACE**.

Targets: laptop, Chrome first. Safari 16.4+ should work (it needs import maps, AudioWorklet
and WebGL2). An internet connection is needed on first load for the two CDN scripts.

---

## What's inside

### Sound engine

| Track | Synthesis |
|---|---|
| KICK | sine; exponential pitch sweep; JS-rendered click transient; tanh drive; mono choke |
| SUB | pure sine; glide from the previous note; saturation for harmonics on laptop speakers |
| CLICK | single-sample impulse / doublet / noise grain → resonant TPT state-variable filter, rendered per hit |
| HAT | six band-limited (polyBLEP) squares at inharmonic ratios + noise, 24 dB high-pass |
| NOISE | gated white-noise blocks with 1 ms edges, sample-and-hold rate reduction, LP/BP/HP |
| TONE | 2-operator FM sine with its own modulation envelope |
| DATA | seeded FSK bit streams, impulse trains, stutters and noise slices, bit-crushed |
| DRONE | sine root + two detuned, panned, low-passed saws with slow LFO movement |

The short voices are rendered in JavaScript into AudioBuffers. Each hit is exact to the sample,
cached by parameter hash, and deterministic for a given random seed. That is what lets
**DÉJÀ VU** repeat even the noise.

**Channel strip**: DJ-style bipolar filter → AudioWorklet bit/rate crusher → pan → fader →
mute → sends.

**FX**: a tempo-synced ping-pong delay with LP + HP filters in the feedback path, and a small,
dark convolution reverb with a generated, progressively damped IR.

**Master**:

- event-based sidechain ducking from KICK, scheduled on the kick's own timestamps
- LR4 crossover at 120 Hz with the lows summed to mono
- soft-knee saturation and a limiter

### Sequencer

- Tone.Transport ticks every 32nd note. It processes **one tick ahead**, so negative
  micro-timing still lands in the future. Every event uses the exact AudioContext time Tone
  supplies, so timing doesn't drift.
- Patterns A–D (1–4 bars) can be queued or chained up to 16 bars.
- Each track has its own length (1–64) and speed (¼×–2×), which allows polymeter.
- Each step has velocity, probability, a trig condition (`A:B`, `1ST`, `!1ST`, `FILL`,
  `!FILL`, `PRE`, `!PRE`), nudge, a 1–4 ratchet and parameter locks for any sound or mix
  parameter.
- Generators: Euclid with rotation, live **MUTATE**, a destructive mutate, random, and
  copy/paste/clear.
- **DÉJÀ VU** is Marbles-style controlled chaos: every random decision reads a per-step
  memory slot. Each slot is refreshed with probability `1 − DV`, so 0 is fresh randomness and
  100 is a locked loop.

### Visual engine

- Each scene renders into its own float target. The engine then:
  - crossfades between scenes,
  - keeps a feedback trail buffer (SPACE),
  - adds a quarter-resolution light bloom,
  - grades the image with MOOD (palette, contrast), grain and a vignette.
- **Sync**: sequencer hits reach the visuals through `Tone.Draw` at their audible time, offset
  by the output latency. Continuous features come from `AnalyserNode`s:
  - RMS,
  - sub/low/mid/high band energy,
  - spectral centroid,
  - spectral-flux transients,
  - a 128-band log spectrum,
  - the stereo waveform.
- If frames run long, the pixel ratio adapts to hold 60 fps.

### Export and files

- **WAV**: an AudioWorklet captures the master between two exact frame indices (bar-quantised)
  and writes 16-bit PCM with dither.
- **Video**: canvas frames plus master audio go to MediaRecorder. The output is MP4 (H.264 +
  AAC) where the browser supports it, otherwise WebM (VP9 + Opus).
- The project autosaves to localStorage, saves and loads as JSON, and accepts dropped files.
  Undo and redo are available.

---

## Code map

```
index.html            page shell, CDN scripts (Tone.js UMD, three.js via import map)
css/style.css         black / thin lines / monospace / one cold accent
js/main.js            boot, lazy visuals, frame loop
js/app.js             project state, actions, undo, autosave
js/core/util.js       math, seeded PRNG, events
js/audio/
  engine.js           context, strips, FX sends, master bus, ducking
  voices.js           the 8 voices (params, presets, ENTROPY weights, play())
  dsp.js              SVF, polyBLEP, crusher, curves, buffer cache
  fx.js               delay, reverb
  worklets.js         crusher + recorder AudioWorklet processors (Blob URL)
js/seq/
  model.js            project / pattern / step model, (de)serialisation
  sequencer.js        clock, conditions, DÉJÀ VU, MUTATE, ENTROPY, p-locks
  generators.js       Euclid, mutate, random
  demos.js            curated demo projects
js/ui/                widgets (knob, tooltip), formatting, the UI + keyboard map
js/visual/
  visuals.js          engine: scenes, crossfade, trails, bloom, grade
  features.js         audio analysis + event envelopes
  gl.js, text.js      passes, render targets, GLSL snippets, GPU text
  scenes/             oscilloscope, datamatics, cymatic, signal, reaction
js/io/                WAV recorder + encoder, video export, project files
docs/                 GUIDE.md (manual + shortcuts), RESEARCH.md
```

## Demo projects

| Demo | Character |
|---|---|
| **STRICT 4/4** | minimal techno; A/B chain `AAAB` with fill-only trigs |
| **POLYMETER HYPNOSIS** | tracks of 16, 15, 13, 12 (2×), 11, 9 and 7 steps drifting against each other |
| **DRONE + CLICKS** | slow, a void drone, ratcheted impulses, long dub delay |
| **BROKEN EXPERIMENTAL** | high ENTROPY, MUTATE and DÉJÀ VU, odd lengths, glide and locks |
| **PULSE / DATA** | driven kick, probability-gated data bursts, locked random loops |
