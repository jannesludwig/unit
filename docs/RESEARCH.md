# UNIT — research notes

Short notes collected before building the engine. They describe the *sound world* and the
*sequencing ideas* UNIT borrows from, and what each one means for the implementation.
(Sources at the bottom; where sources were thin, the notes say so and fall back on
well-known, documented practice.)

---

## 1. Sound: Alva Noto, Ryoji Ikeda, Byetone, Raster-Noton

**Alva Noto (Carsten Nicolai)**
- Works by meticulous waveform editing: sounds are reduced to their sleekest forms —
  sinusoids, clicks, short pulses — "reducing electronic music to its mathematical
  fundamentals". *Unieqav* (2018, Noton; the last part of the Uni trilogy) pushes this toward
  the club: "a mania of precise digital blips and mountainous, throbbing bass".
- Nicolai has said musical instruments rarely give *precise* sine waves, which is why he worked
  with laboratory test equipment. Precision (exact frequency, exact length, exact level) is
  the aesthetic.
- Visuals are part of the composition (with collaborator NIBO): scientific phenomena —
  frequency, light, interference — rendered directly.

**Ryoji Ikeda**
- Palette of "raw" materials: sine tones and white noise (the album *+/-* is built exclusively
  from them), single-sample pulses, frequencies at the edges of hearing. Ikeda frames the
  pairing as reason (sine) vs. feeling (noise).
- Rhythm is built from discrete tones and noise "to create the semblance of a drum machine".
- Data sonification/visualisation is the core thread (*datamatics*, *test pattern*): binary
  data becomes barcode-like streams of pulses, and the screen shows the same data as stripes,
  numbers and lines.

**Byetone (Olaf Bender), Frank Bretschneider (Komet), Raster-Noton**
- Byetone layers sine tones into complex fabrics; digital clicks are essential for rhythm;
  extreme highs and extreme lows; sine-wave bass pulses; later records add distorted,
  clipped, Pan Sonic-like bass and "super minimal clipped beats".
- Bretschneider: "clipped pulses, chirping sine waves, rhythmic white noise and throbbing
  bass", dubwise delay, precise polyrhythms — one of the definers of *clicks + cuts*.
- Label aesthetic: grid, typography, reduction, sound/art/design as one system.

**What this means for UNIT's voices**
| Principle | Implementation |
|---|---|
| Sine as the core material | KICK, SUB, TONE, DRONE are oscillator voices with sample-accurate envelopes; KICK and SUB start at phase 0 so there is no onset click unless asked for. |
| Precise, very short events | CLICK, HAT, NOISE, DATA are rendered *per hit in JavaScript* into tiny AudioBuffers: single-sample impulses, resonant ringing, sample-and-hold, bit-depth quantisation — exact to the sample, cached by parameter hash. |
| Noise as a block, not a bed | NOISE is a *gated* burst with 1 ms edges — never a constant hiss. |
| Data → sound | DATA renders FSK-like bit streams, stutters and impulse trains from a seeded RNG, so with DÉJÀ VU at 100 the same "data" repeats exactly. |
| Throbbing sub pressure | SUB is a pure sine with glide; master mono-sums everything below 120 Hz (LR4 crossover), event-based sidechain ducking from KICK, soft tanh saturation for harmonics on laptop speakers. |
| Dry and clean by default | Sends are 0 by default; reverb is small and dark (damped, high-passed input); delay is tempo-synced with a filter in the feedback path (dub). |
| Avoid | Bright detuned saws, sweet pads, cheesy pitched blips, round "organic" basses, constant hiss. Pitched elements are kept short, low, and mostly sine/FM. |

---

## 2. Sequencing: Elektron

- **Parameter locks**: any parameter can take a per-step value; hold a step and turn a knob.
  The locked value lasts for that trig only.
- **Trig conditions** decide whether a trig plays:
  - `A:B` — plays on the A-th of every B loops (counted per track here, so polymeter works).
  - `1ST` — only the first time the pattern plays; `!1ST` (not first) afterwards.
  - `FILL` / `!FILL` — only while FILL is held / only while it is not.
  - `PRE` / `!PRE` — result of the last evaluated condition on the same track (trigs without
    a condition are not evaluated, as on the hardware).
  - (`NEI` checks the neighbour track; skipped here to keep the UI small.)
- **Probability** (%), **micro-timing** (nudge off the grid), **retrigs/ratchets**.
- **Per-track length and scale** → polymeter (15 against 16 slowly phases).
- Fill mode is a temporary variation — "drum fill" — played while a button is held.

**In UNIT**: each step stores `vel / prob / cond / nudge / ratchet / locks{}`. Tracks have
length 1–64 and speed ¼×, ½×, 1×, 2×. Patterns A–D (1–4 bars) can be chained up to 16 bars.

---

## 3. Controlled chaos: Mutable Instruments Marbles

- Marbles generates random gates and voltages. Its **DÉJÀ VU** knob controls the probability
  of *recycling* previous random decisions instead of generating fresh ones: fully CCW =
  completely random; at noon = locked loop (no fresh random data); a separate LENGTH sets
  the loop size. (Past noon it jumps randomly within the loop — random permutations of the
  same decisions.)

**In UNIT**: every random decision a track makes (probability rolls, MUTATE flips, ENTROPY
jitter, noise/data seeds) is read from a per-track *random memory* with one slot per step.
Before a step reads its slots, each slot is refreshed with probability `1 − DÉJÀ VU`.
- DÉJÀ VU 0 → fresh randomness every pass.
- DÉJÀ VU 100 → the loop of random decisions is frozen: the variation repeats exactly,
  locked to the track length (so a 15-step track carries a 15-step "random" loop).
- In between → the loop slowly evolves; it remembers, but forgets a little each pass.
The memory is seeded per project, so a saved project with DÉJÀ VU 100 sounds identical on
reload. "↻" re-rolls the memory (a new frozen variation).

---

## 4. Visuals: TouchDesigner techniques in WebGL

- GPU particles in float textures (ping-pong), point sprites, instancing.
- Feedback buffers for trails/afterglow; very light bloom and film grain — restrained.
- Phosphor oscilloscope: draw each sample-to-sample segment as a Gaussian beam whose
  intensity falls with segment length (fast beam = dim), additive blending into a decaying
  buffer (the classic "woscope" approach).
- Chladni/cymatic forms: particles on a sphere descend the gradient of `Y_lm²` (a spherical
  harmonic), so they gather on nodal lines — the way sand collects on a vibrating plate;
  agitation scales with `|Y_lm|·energy`.
- Gray–Scott reaction–diffusion on the GPU; drawing iso-lines instead of filled colour keeps
  it thin and high-contrast.

---

## Sources
- Tiny Mix Tapes — Alva Noto, *Unieqav* review: https://www.tinymixtapes.com/music-review/alva-noto-unieqav
- CDM — Alva Noto Unieqav: https://cdm.link/alva-noto-unieqav/
- L.E.V. Festival — Alva Noto: UNIEQAV: https://levfestival.com/22/en/lev-madrid/alva-noto-unieqav/
- Cyclic Defrost — "What is a frequency" interview: https://www.cyclicdefrost.com/2018/03/alva-noto-carsten-nicolai-what-is-a-frequency-interview-by-innerversitysound/
- Sound On Sound — Alva Noto: https://www.soundonsound.com/people/alva-noto
- Wikipedia — Ryoji Ikeda: https://en.wikipedia.org/wiki/Ryoji_Ikeda
- Muziekgebouw — Sine waves and white noise: https://muziekgebouw.nl/en/pQV6Jf0
- YCAM — datamatics profile: https://special.ycam.jp/datamatics/en/profile.html
- MUTEK — Byetone: https://2022.montreal.mutek.org/en/artists/byetone
- Amoeba — Byetone biography: https://amoeba.com/byetone/artist/188794/bio
- Amoeba — Frank Bretschneider biography: https://amoeba.com/frank-bretschneider/artist/59660/bio
- Raster-Noton (wiki mirror): https://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq.ipfs.4everland.io/wiki/Raster-Noton.html
- Mutable Instruments — Marbles quickstart: https://mutable-instruments.net/modules/marbles/downloads/marbles_quickstart.pdf
- Elektron Cycles manual (fill mode, trig conditions): https://manualslib.com/manual/1790470/Elektron-Cycles.html?page=32
- Elektronauts — NEI and PRE trig conditions: https://www.elektronauts.com/t/nei-and-pre-trig-conditions/51959
- woscope (phosphor beam rendering technique): https://github.com/m1el/woscope
