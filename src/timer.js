/* Rest timer.

   It counts from a stored end time, not by ticking down, so it is still right
   after the screen has been locked or the app was in the background. iPhone has
   no vibration for web apps, so the end is a short beep. Safari only lets a page
   play sound after a tap, so the sound is unlocked on the tap that starts the
   timer. The timer survives a reload: the end time is saved. */

import { h, clear } from './dom.js';
import { uiGet, uiSet } from './store.js';

let el = null, tick = null, audio = null;
let state = null; // { endAt, label, tip, total }

export function unlockSound() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

function beep() {
  if (uiGet('sound', '1') !== '1' || !audio) return;
  try {
    const t = audio.currentTime;
    for (const [at, f] of [[0, 880], [0.22, 880], [0.44, 1320]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      o.start(t + at); o.stop(t + at + 0.2);
    }
  } catch { /* no sound is fine */ }
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
}

const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

/** Starts (or restarts) the timer. seconds, label: what you rest for, tip: optional line. */
export function startRest(seconds, label, tip = '') {
  unlockSound();
  state = { endAt: Date.now() + seconds * 1000, label, tip, total: seconds, beeped: false };
  uiSet('timer', JSON.stringify(state));
  show();
}

export function stopRest() {
  state = null;
  uiSet('timer', '');
  clearInterval(tick); tick = null;
  el?.remove(); el = null;
  document.body.classList.remove('timer-on');
}

function add(seconds) {
  if (!state) return;
  const left = Math.max(0, state.endAt - Date.now());
  state.endAt = Date.now() + left + seconds * 1000;
  state.beeped = false;
  uiSet('timer', JSON.stringify(state));
  draw();
}

function draw() {
  if (!state || !el) return;
  const left = Math.ceil((state.endAt - Date.now()) / 1000);
  const go = left <= 0;
  if (go && !state.beeped) { state.beeped = true; uiSet('timer', JSON.stringify(state)); beep(); }
  // "Go" stays up until it is tapped away, so you don't miss it. After 10 minutes it clears itself.
  if (left < -600) { stopRest(); return; }
  el.classList.toggle('go', go);
  clear(el,
    h('span.clock', go ? 'Go' : fmt(left)),
    h('div.what', go ? 'Rest is over' : 'Rest · ' + state.label, state.tip && h('small', state.tip)),
    !go && h('button', { type: 'button', onclick: () => add(30), 'aria-label': 'Add 30 seconds' }, '+30'),
    h('button', { type: 'button', onclick: stopRest }, go ? 'OK' : 'Skip'));
}

function show() {
  if (!el) { el = h('div.timer', { role: 'timer', 'aria-live': 'off' }); document.body.append(el); }
  document.body.classList.add('timer-on');
  draw();
  clearInterval(tick);
  tick = setInterval(draw, 250);
}

/** Picks the timer back up after a reload or when the app comes back. */
export function resumeRest() {
  try {
    const saved = JSON.parse(uiGet('timer', '') || 'null');
    if (saved && saved.endAt && saved.endAt - Date.now() > -600000) { state = saved; show(); }
  } catch { /* nothing to resume */ }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) draw(); });
