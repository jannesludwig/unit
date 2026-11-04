// UNIT — pattern generators: Euclidean rhythms, destructive MUTATE, random fill.

import { newStep, DEFAULT_VEL } from './model.js';

/** Bjorklund-equivalent Euclidean rhythm (Bresenham form), rotated. */
export function euclid(steps, pulses, rot = 0) {
  const out = new Array(steps).fill(false);
  if (pulses <= 0 || steps <= 0) return out;
  pulses = Math.min(pulses, steps);
  for (let i = 0; i < steps; i++) out[i] = ((i * pulses) % steps) < pulses;
  // rotate right by rot
  const r = ((rot % steps) + steps) % steps;
  return out.map((_, i) => out[(i - r + steps) % steps]);
}

/** Write a Euclidean rhythm into a pattern track (keeps existing step settings where on). */
export function applyEuclid(track, pulses, rot) {
  const pat = euclid(track.len, pulses, rot);
  for (let i = 0; i < track.len; i++) {
    if (pat[i]) track.steps[i] = track.steps[i] || newStep(i % 4 === 0 ? 1 : DEFAULT_VEL);
    else track.steps[i] = null;
  }
}

/**
 * Destructive mutation by `amount` (0..1): move some trigs by ±1, drop a few, add a few,
 * vary velocity / probability / ratchets. Uses Math.random — undo restores.
 */
export function mutate(track, amount) {
  const L = track.len, s = track.steps;
  const a = Math.max(0.05, amount);
  const on = [];
  for (let i = 0; i < L; i++) if (s[i]) on.push(i);
  // shift
  for (const i of on) {
    if (Math.random() < a * 0.35) {
      const j = (i + (Math.random() < 0.5 ? -1 : 1) + L) % L;
      if (!s[j]) { s[j] = s[i]; s[i] = null; }
    }
  }
  for (let i = 0; i < L; i++) {
    if (s[i]) {
      if (Math.random() < a * 0.2) { s[i] = null; continue; }
      if (Math.random() < a * 0.5) s[i].v = Math.max(0.2, Math.min(1, s[i].v + (Math.random() - 0.5) * a));
      if (Math.random() < a * 0.15) s[i].r = 1 + ((Math.random() * 3) | 0);
      if (Math.random() < a * 0.2) s[i].p = Math.round((0.4 + Math.random() * 0.6) * 20) / 20;
    } else if (Math.random() < a * 0.12) {
      s[i] = newStep(0.4 + Math.random() * 0.4);
    }
  }
}

/** Sparse random pattern (used by the RND action). */
export function randomize(track, density = 0.3) {
  for (let i = 0; i < track.len; i++) {
    track.steps[i] = Math.random() < density ? newStep(0.5 + Math.random() * 0.5) : null;
  }
}
