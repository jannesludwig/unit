# UNIT — guide

UNIT is an 8-track groovebox and synthesizer with audio-reactive visuals. Every sound is
synthesized; nothing is sampled. Visuals and sound share one clock, so every hit is drawn on
the frame you hear it.

---

## The first minute

1. **Click anywhere** (or press any key). Browsers only allow audio after a gesture.
2. Press **SPACE**. The demo *STRICT 4/4* plays.
3. Tap **Q W E R T Y U I / A S D F G H J K** to toggle steps 1–16 on the selected track.
   Change track with **↑ / ↓**.
4. Turn the big **MACROS** on the right: DEPTH, ENTROPY, SPACE, MOOD.
5. Press **1–5** to switch visual scenes. Use **DEMO ▾** to load other starting points.

Your work is saved automatically in the browser.

---

## Screen

```
┌──────────────────────────── VISUALS (scene, HUD at the bottom) ────────────────────────────┐
├─ ▶ BPM SW position │ PAT A–D │ BARS │ CHAIN │ PAGE │ FILL      ● WAV ● VID SAVE LOAD DEMO MIX ? ─┤
├─ SEQUENCER (or MIXER, Tab) ──────────────────┬─ INSPECTOR ───────────────┬─ MACROS ────────┤
│ 8 tracks × 16 steps, LEN / SPD per track     │ sound · mix · generators  │ DEPTH  ENTROPY  │
│                                              │ (or the selected step)    │ SPACE  MOOD     │
│                                              │                           │ TEMPO  SWING    │
└──────────────────────────────────────────────┴───────────────────────────┴─────────────────┘
```

Hover over any control for a tooltip. The tooltip also shows the control's keyboard shortcut.

---

## Tracks

| # | Track | Parameters | Character |
|---|---|---|---|
| 1 | **KICK** | PITCH, DECAY, SWEEP, CLICK, DRIVE | sine with an exponential pitch sweep; ducks the rest of the mix |
| 2 | **SUB** | PITCH, DECAY, GLIDE, SAT, ATTACK | pure sine pulse, glides from the previous note |
| 3 | **CLICK** | FREQ, LENGTH, RESO, CRUSH, SHAPE | single-sample impulses, doublets, noise grains through a resonant filter |
| 4 | **HAT** | TONE, DECAY, FILTER, METAL | six inharmonic squares and noise, steep high-pass |
| 5 | **NOISE** | TYPE, CUTOFF, GATE, S.RATE, RESO | gated noise blocks, sample-rate reduction |
| 6 | **TONE** | PITCH, FM, RATIO, DECAY, FM ENV | short sine / 2-operator FM tones |
| 7 | **DATA** | RATE, CHAOS, LENGTH, CRUSH, FREQ | FSK bit streams, stutters, impulse trains |
| 8 | **DRONE** | PITCH, DETUNE, FILTER, MOVE, LENGTH | low, slow, filtered pad |

Each track has five curated **presets**. Step through them with **‹ ›** in the inspector, or
with **, / .** on the keyboard.

**Mix** (inspector or mixer view): VOL, PAN, DLY (delay send), REV (reverb send), FLT and CRSH.
FLT is a one-knob filter: turn it left for low-pass, right for high-pass, or leave it centred
for off. CRSH reduces bit depth and sample rate together.

---

## Sequencer

- **Patterns A–D**: each pattern is 1–4 **BARS** long. While playing, selecting a pattern
  *queues* it, and it starts when the current pattern ends.
- **CHAIN**: ⌥-click patterns (or press ⌥Z…⌥V) to append them to the chain, up to 16 bars, for
  example `AAAB`. Click the chain text to clear it.
- **Per-track LEN (1–64) and SPD (¼×, ½×, 1×, 2×)**: give tracks different lengths for
  polymeter, such as 15 steps against 16. Drag the LEN number or click SPD in the grid row.
- **PAGE 1–4** shows steps 1–16, 17–32, 33–48 and 49–64. With FOLLOW on, the page follows the
  playhead.
- **SWING** delays every second step by up to 75 %.
- **FILL**: hold **L** to play fills. Click FILL or press ⇧L to latch it on.

### Steps, parameter locks

- **Click** a step to toggle it. **Drag** across steps to paint them on or off.
- **Hold a step** to edit it: long-press, ⇧click or right-click it, or hold its key (Q…K). The
  inspector switches to **STEP** mode:
  - **VEL** sets velocity and **PROB** sets probability.
  - **COND** sets a trig condition (see below).
  - **NUDGE** sets micro-timing (±½ of a 16th) and **RATCH** sets 1–4 ratchets.
  - Every **SOUND** and **MIX** knob now writes a **parameter lock** to the held step(s). Locked
    knobs turn cyan. Double-click a knob to remove its lock. **CLR LOCKS** removes all locks
    from the selected steps.
- Press **ESC** or click **DONE** to leave step edit.

In the grid, a step shows its settings as small marks: a **cyan dot** for locks, a **bar at the
bottom** for probability, a **label** for its condition, **stripes** for ratchets, and an
offset for nudge.

### Trig conditions

| Condition | Plays when |
|---|---|
| `A:B` (1:2, 2:4, 1:4 …) | on the A-th of every B passes of the track |
| `1ST` / `!1ST` | only on the first pass / on every pass except the first |
| `FILL` / `!FILL` | only while FILL is held / only while it is not |
| `PRE` / `!PRE` | the previous condition on this track was true / was false |

### Generators (inspector, GEN row)

- **EUCLID / ROT**: writes a Euclidean rhythm with *k* pulses over the track length.
- **MUTATE**: live, non-destructive variation. Some steps drop, ghost hits appear, velocity
  and ratchets vary. **MUTATE** under the knobs bakes a variation into the pattern (undo with ⌘Z).
- **DÉJÀ VU**: every random decision a track makes reads from a memory with one slot per step.
  These decisions include probability, MUTATE, ENTROPY jitter, and the noise and data seeds.
  At **0** the randomness is fresh on every pass. At **100** it is a locked loop: the same
  "random" variation repeats exactly, in step with the track length. Values in between evolve
  slowly. **↻ DV** rolls a new memory.
- **RND** writes a sparse random pattern. **COPY / PASTE / CLEAR** act on the track's pattern.

---

## Macros

Each macro moves sound and visuals together.

| Macro | Sound | Visuals |
|---|---|---|
| **DEPTH** | sub and kick weight, low shelf, saturation | mass, scale, beam width |
| **ENTROPY** | MUTATE on every track, timing and parameter jitter, DATA chaos | glitches, scatter, chaos |
| **SPACE** | delay and reverb amount, reverb size, delay feedback | trails and afterglow, bloom |
| **MOOD** | dark ↔ cold/bright tilt, filter colour, FM brightness | palette, contrast; dark MOOD adds amber in SIGNAL |
| **TEMPO / SWING** | 40–220 BPM / 50–75 % | scan speed, lattice drift |

---

## Mixer, FX, master (Tab)

- Each of the 8 strips has VOL, PAN, DLY, REV, FLT, CRSH, mute and solo, plus a meter.
- **DELAY**: tempo-synced TIME (1/32 to 1/2, dotted and triplet), FDBK, TONE (low-pass in the
  feedback path) and PING (ping-pong amount).
- **REVERB**: SIZE and DAMP. The reverb is small and dark, and its input is high-passed.
- **MASTER**:
  - **DUCK** sets the depth of the sidechain from KICK. The duck triggers on the kick events
    themselves, not on an envelope follower.
  - **DRIVE** sets soft saturation. **LEVEL** sets the output level.
  - Everything below 120 Hz is summed to mono, and a limiter follows.

---

## Visuals

Press **1–5** for scenes. Scenes crossfade into each other. The HUD at the bottom of the
visuals appears when you move the mouse over them. It has:

- the scene buttons,
- three **scene parameters**,
- **REACT** (how strongly the visuals follow the audio),
- **FREEZE** (P),
- **AUTO** (0), which switches scene whenever the pattern changes,
- a button for visuals-only mode (⇧F).

| Scene | Parameters | Reacts to |
|---|---|---|
| 1 **OSCILLOSCOPE** | MODE (SCOPE / XY / PHASE), PERSIST, GAIN | the real master signal; KICK flares the beam; DATA, NOISE and CLICK tear the trace; PHASE draws circles for sines |
| 2 **DATAMATICS** | DENSITY, PERSPECT, DATA | spectrum-history line field; KICK inverts or shifts bands; CLICK and DATA fire barcode bursts; readouts show live values |
| 3 **CYMATIC SPHERE** | RESOLUTION, COMPLEX, SCATTER | the SUB and KICK pitch choose the spherical-harmonic mode (a new bass note reorganises the form); bass energy agitates; transients send shock rings |
| 4 **SIGNAL** | DENSITY, CHAOS, DEPTH | each track's bundle of traces re-routes on its hits; DRONE and SUB light the lattice; KICK pulses it; DATA and CLICK cut out spectrum columns |
| 5 **REACTION-DIFFUSION** | PRESET, SPEED, SEEDS | bass feeds growth, CLICK seeds spots, NOISE disturbs, DRONE drifts the pattern type |

---

## Export and files

- **● WAV** (⇧W) records the master output, captured sample-accurately in an AudioWorklet, to a
  16-bit stereo WAV. Choose the length (1–32 bars, or ∞ to stop manually) in the selector
  next to the button. Recording starts on the next downbeat, and transport starts if needed,
  so a 4-bar take is exactly 4 bars and loops seamlessly.
- **● VID** (⇧O) records the visuals plus master audio. It writes MP4 where the browser can
  encode H.264 and AAC (for example Safari), and WebM (VP9 + Opus) otherwise. It uses the same
  bar length setting.
- **SAVE** (⌘S) and **LOAD** (⌘O) save and load the project as `.unit.json`. You can also drop a
  project file onto the window.
- **Autosave**: the current project is kept in the browser's localStorage.
- **Undo / redo**: ⌘Z / ⇧⌘Z cover pattern edits, sound changes and generators.

---

## All shortcuts

On Windows and Linux, use **Ctrl** wherever this guide says **⌘**.

| Key | Action |
|---|---|
| **Transport** | |
| SPACE | play / stop |
| − / = | tempo −1 / +1 BPM (with ⇧: ±10) |
| [ / ] | swing −1 / +1 % |
| L (hold) | fill while held |
| ⇧L | latch fill |
| **Patterns** | |
| Z X C V | select pattern A B C D (queued while playing) |
| ⇧Z … ⇧V | copy the current pattern into A … D |
| ⌥Z … ⌥V | append A … D to the chain |
| B / ⇧B | chain on/off / clear chain |
| ← / → | previous / next page |
| **Tracks & steps** | |
| ↑ / ↓ | previous / next track |
| ⇧1 … ⇧8 | select track 1–8 |
| Q W E R T Y U I | steps 1–8 of the page (tap = toggle) |
| A S D F G H J K | steps 9–16 of the page (tap = toggle) |
| hold step key + turn knob | parameter lock |
| long-press / ⇧click / right-click step | select step(s) for editing |
| ESC | leave step edit / close help |
| M / N | mute / solo the selected track |
| , / . | previous / next preset |
| TAB | grid ↔ mixer |
| **Generators** | |
| ⇧E | write the Euclid rhythm |
| ⇧M | bake a mutation |
| ⇧R | random pattern |
| ⇧D | re-roll DÉJÀ VU memory |
| ⌘C / ⌘V | copy / paste the track pattern |
| ⌫ / DEL | clear the track pattern |
| **Visuals** | |
| 1 – 5 | scene |
| P | freeze |
| 0 | auto-switch scene on pattern change |
| ⇧F | visuals only (again to return) |
| ` | hide / show the HUD |
| **Files & export** | |
| ⌘S / ⌘O | save / open project |
| ⇧W | record WAV |
| ⇧O | record video |
| ⌘Z / ⇧⌘Z | undo / redo |
| ? | help overlay |
| **Knobs** | |
| drag ↕ | change (hold ⇧ for fine) |
| wheel / ↑↓ when focused | change |
| double-click | reset to default (in step edit: remove the lock) |
