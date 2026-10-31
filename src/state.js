/* The app's saved data, in one object under "workout:state".

   {
     v, created,
     profile: { birthYear, sex, heightCm },
     prog,                // the program (program.js)
     active,              // the session in progress, or null
     sessions: [],        // finished sessions, oldest first
     custom: [],          // own exercises (same shape as ACCESSORIES)
     body: { weight: [{ date, value }], waist: [...], ... },
     cardio: [{ id, date, type, km, min, note }],
     settings: { theme, sound },
   } */

import { KEYS, readJson, writeJson, rescueBroken } from './store.js';
import { newProgram, iso } from './program.js';

let state = null;
const listeners = new Set();

export function blank() {
  return { v: 1, created: iso(), profile: {}, prog: null, active: null, sessions: [], custom: [], body: {}, cardio: [], settings: {} };
}

/** Loads the state. Broken data is copied aside first, so it is never lost. */
export function load() {
  const r = readJson(KEYS.state);
  if (r.status === 'broken') rescueBroken(KEYS.state, r.raw);
  state = r.status === 'ok' && r.value && typeof r.value === 'object' ? fixShape(r.value) : blank();
  return { state, broken: r.status === 'broken' };
}

function fixShape(s) {
  const b = blank();
  for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
  if (!Array.isArray(s.sessions)) s.sessions = [];
  if (!Array.isArray(s.cardio)) s.cardio = [];
  if (!Array.isArray(s.custom)) s.custom = [];
  if (!s.body || typeof s.body !== 'object') s.body = {};
  return s;
}

export const get = () => state;

/** Changes the state with fn(state), saves, and tells the screens. */
export function change(fn, { quiet = false } = {}) {
  fn(state);
  const ok = writeJson(KEYS.state, state);
  if (!quiet) for (const l of listeners) { try { l(state); } catch (e) { console.error(e); } }
  return ok;
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setupProgram(opts) {
  change((s) => { s.prog = newProgram(opts); });
}

/** Replaces everything (import of a backup). */
export function replaceAll(next) {
  state = fixShape(next);
  writeJson(KEYS.state, state);
  for (const l of listeners) l(state);
}

/* ---------- Body log ---------- */
export function logMeasure(id, value, date = iso()) {
  change((s) => {
    const list = (s.body[id] = s.body[id] || []);
    const same = list.find((e) => e.date === date);
    if (same) same.value = value; else list.push({ date, value });
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
  });
}

export function removeMeasure(id, date) {
  change((s) => { s.body[id] = (s.body[id] || []).filter((e) => e.date !== date); });
}

export function latest(id) {
  const list = state.body[id] || [];
  return list.length ? list[list.length - 1] : null;
}
