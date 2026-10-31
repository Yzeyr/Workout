/* Start-up, tabs and routing. */

import { h, icon, clear } from './dom.js';
import { load, onChange, get } from './state.js';
import { onSaveError, askPersistent, uiGet, flushPending } from './store.js';
import { setRouter, showBanner } from './nav.js';
import { resumeRest } from './timer.js';
import { trainView } from './views/train.js';
import { historyView } from './views/history.js';
import { bodyView } from './views/body.js';
import { coachView } from './views/coach.js';
import { settingsView } from './views/settings.js';

const TABS = [
  { id: 'train', name: 'Train', icon: 'train', view: trainView },
  { id: 'history', name: 'History', icon: 'history', view: historyView },
  { id: 'body', name: 'Body', icon: 'body', view: bodyView },
  { id: 'coach', name: 'Coach', icon: 'coach', view: coachView },
];
const OTHER = { settings: settingsView };

export function applyTheme() {
  const t = uiGet('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

let current = null;
function route() {
  const id = (location.hash || '#train').slice(1).split('/')[0] || 'train';
  const tab = TABS.find((t) => t.id === id);
  const view = tab ? tab.view : OTHER[id] || trainView;
  const changed = current !== id;
  current = id;
  const root = document.getElementById('view');
  const y = scrollY;
  try { view(root); } catch (e) {
    console.error(e);
    clear(root, h('p', { style: { padding: '20px 0' } }, 'Something went wrong on this screen: ' + (e?.message || e)));
  }
  if (changed) scrollTo(0, 0); else scrollTo(0, y);
  for (const a of document.querySelectorAll('#tabs a')) {
    if (a.dataset.tab === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function start() {
  applyTheme();
  const { broken } = load();
  clear(document.getElementById('tabs'), TABS.map((t) => h('a', { href: '#' + t.id, 'data-tab': t.id }, icon(t.icon), t.name)));
  if (broken) showBanner('broken', { title: 'Saved data could not be read', text: 'A copy was kept aside. The app started empty. Import a backup in Settings if you have one.', type: 'danger' });
  onSaveError(({ message }) => showBanner('save', { title: 'Not saved', text: message, type: 'danger' }));
  setRouter(route);
  window.addEventListener('hashchange', route);
  // Redraw on changes, except while the user is typing in a field on the page
  onChange(() => {
    const a = document.activeElement;
    if (a && a.matches?.('#view input, #view textarea') && !a.closest('dialog')) return;
    route();
  });
  route();
  resumeRest();
  askPersistent();
  registerWorker();
  // Keep the session clock fresh while training
  setInterval(() => { if (get()?.active && current === 'train' && !document.querySelector('dialog[open]') && !document.activeElement?.matches?.('input, textarea')) route(); }, 60000);
  window.addEventListener('pagehide', flushPending);
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // first install also fires controllerchange
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  // A new version took over: reload only if no workout is in progress, otherwise on the next app start.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || get()?.active) return;
    if (!hadController) return;
    reloading = true;
    location.reload();
  });
}

start();
