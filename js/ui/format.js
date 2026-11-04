// UNIT — value formatting for knobs and readouts.

import { denorm } from '../core/util.js';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

export function fmtReal(p, v) {
  if (p.list) return String(v);
  switch (p.unit) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'k' : Math.round(v) + 'Hz';
    case 's': return v < 1 ? (v < 0.01 ? (v * 1000).toFixed(1) : Math.round(v * 1000)) + 'ms' : v.toFixed(2) + 's';
    case 'note': return noteName(v);
    case 'oct': return v.toFixed(1);
    case 'bd': return Math.round(v) + '';
    default: return Math.round(((v - p.min) / (p.max - p.min)) * 100) + '';
  }
}

export const fmtParam = (p) => (n) => fmtReal(p, denorm(p, n));
export const pct = (n) => Math.round(n * 100) + '';
export const bip = (n) => { const v = Math.round((n * 2 - 1) * 100); return (v > 0 ? '+' : '') + v; };
export const panFmt = (n) => { const v = Math.round((n * 2 - 1) * 100); return v === 0 ? 'C' : v < 0 ? 'L' + -v : 'R' + v; };
export const fltFmt = (n) => { const v = n * 2 - 1; return Math.abs(v) < 0.02 ? 'OFF' : (v < 0 ? 'LP' : 'HP') + Math.round(Math.abs(v) * 100); };
