/* Navigation and banners, shared by all screens. */

import { h, icon } from './dom.js';

let router = () => {};
export function setRouter(fn) { router = fn; }

/** Goes to a hash address. replace: without a new history step. */
export function go(hash, { replace = false } = {}) {
  const next = '#' + String(hash).replace(/^#/, '');
  if (replace) { history.replaceState(history.state, '', next); router(); return; }
  if (location.hash === next) { router(); return; }
  location.hash = next;
}

/* ---------- Banners ---------- */
const banners = new Map();
const root = () => document.getElementById('banners');

export function showBanner(id, { title, text, type = '', button, onButton, closable = true }) {
  const el = h('div.banner' + (type ? '.' + type : ''), { role: type === 'danger' ? 'alert' : 'status' },
    icon(type === 'danger' ? 'warning' : 'info'),
    h('div.text', title && h('b', title), text),
    button && h('button', { type: 'button', onclick: onButton }, button),
    closable && h('button', { type: 'button', 'aria-label': 'Close', onclick: () => hideBanner(id) }, '✕'));
  banners.get(id)?.remove();
  banners.set(id, el);
  root()?.append(el);
}
export function hideBanner(id) { banners.get(id)?.remove(); banners.delete(id); }
