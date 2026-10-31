/* Saving in localStorage, with errors shown instead of lost.

   The origin yzeyr.github.io is shared with the owner's other apps
   (Malerguiden, Handleliste, Bitetid, and the old Workout at /Workout/v1/).
   So: never localStorage.clear(), and only keys starting with "workout:". */

export const KEYS = {
  state: 'workout:state',      // program, log, body, cardio
  health: 'workout:health',    // daily summaries from the Apple Health export
  chat: 'workout:chat',        // coach conversation
  apiKey: 'workout:api-key',   // stays on this device, never in backups
  lastBackup: 'workout:last-backup',
  ui: 'workout:ui:',
};

const errorListeners = new Set();
/** fn({ key, error, message }) runs every time a write fails. */
export function onSaveError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); }

function report(key, error, message) {
  for (const fn of errorListeners) { try { fn({ key, error, message }); } catch { /* a listener must not stop saving */ } }
}

export function isFull(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Writes a string. Returns true/false and reports failures. */
export function write(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) {
    report(key, e, isFull(e)
      ? 'Storage on this phone is full. The last change was not saved. Export a backup and remove old health data.'
      : 'Could not save. Is private browsing on?');
    return false;
  }
}

export function remove(key) { try { localStorage.removeItem(key); } catch { /* nothing to do */ } }

/** Reads JSON. Tells "missing" apart from "there, but broken": { status: 'empty'|'ok'|'broken', value, raw } */
export function readJson(key) {
  const raw = read(key);
  if (raw == null || raw === '') return { status: 'empty', value: null, raw };
  try { return { status: 'ok', value: JSON.parse(raw), raw }; }
  catch { return { status: 'broken', value: null, raw }; }
}

export function writeJson(key, value) { return write(key, JSON.stringify(value)); }

/** Keeps data that could not be read, so it is never overwritten. */
export function rescueBroken(key, raw) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(key + ':broken-') && localStorage.getItem(k) === raw) return k;
    }
  } catch { /* try to save the copy anyway */ }
  const copy = key + ':broken-' + Date.now();
  try { localStorage.setItem(copy, raw); return copy; } catch { return null; }
}

/* ---------- Deferred saving ----------
   Text fields save a moment after the last keystroke. If the app goes to the
   background first, the save is forced right away (iOS may kill the app). */
const pending = new Map();

export function later(key, fn, ms = 300) {
  const old = pending.get(key);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => { pending.delete(key); fn(); }, ms);
  pending.set(key, { timer, fn });
}

export function flushPending() {
  for (const [key, { timer, fn }] of pending) {
    clearTimeout(timer);
    pending.delete(key);
    try { fn(); } catch { /* already reported by write() */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
}

/** Without this, iOS may clear the data when the phone runs low on space. */
export async function askPersistent() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

/* Small UI choices (open/closed, last tab). Failures here don't matter. */
export function uiGet(name, fallback = null) { const v = read(KEYS.ui + name); return v == null ? fallback : v; }
export function uiSet(name, value) { try { localStorage.setItem(KEYS.ui + name, String(value)); } catch { /* unimportant */ } }
