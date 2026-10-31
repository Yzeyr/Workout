/* Small UI building blocks: elements, icons, toast and bottom sheets. */

/** h('div.card', { onclick }, ...children). Classes with dots, attributes as an object. */
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x; } }
    else if (k === 'value' || k === 'checked') el[k] = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    // `list.length && h(...)` gives 0 for an empty list; that should not show.
    // Numbers meant as text are always passed as strings.
    if (k == null || k === false || k === 0 || k === '') continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function clear(el, ...kids) { el.textContent = ''; add(el, kids); return el; }
export function fill(el, ...kids) { add(el, kids); return el; }

/* Line icons, 24×24. */
const PATHS = {
  train: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  history: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8 14h3M8 17h6"/>',
  body: '<circle cx="12" cy="5" r="2.2"/><path d="M6 9.5l6 1 6-1M12 10.5v5M12 15.5l-3 5.5M12 15.5l3 5.5"/>',
  coach: '<path d="M12 3.5l1.6 4.4L18 9.5l-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 2.5h4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7M9 7V4.5h6V7"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  undo: '<path d="M8 5L4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  download: '<path d="M12 4v11.5M7.5 11L12 15.5 16.5 11"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 19.5h14"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  flame: '<path d="M12 21c-3.6 0-6-2.5-6-5.7 0-3.6 3-5.4 3.6-9.3 2.5 1.6 3.9 3.8 3.9 6.2.9-.6 1.6-1.6 1.8-2.9 1.6 1.5 2.7 3.6 2.7 6 0 3.2-2.4 5.7-6 5.7z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  run: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2.5V21M6 12.5l3-4 4 1 2.5 3.5H19M11 15l-1.5-6.5"/>',
  send: '<path d="M4.5 12L20 4.5 15 20l-3-6.5z"/><path d="M12 13.5L20 4.5"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  skip: '<path d="M6 6l8 6-8 6zM17 6v12"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
};

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[name] || '';
  return s;
}

/* ---------- Toast ---------- */
let toastEl = null, toastTimer = null;
/** Short message at the bottom. With undo it gets an "Undo" button. */
export function toast(text, { undo = null, ms = 2800 } = {}) {
  if (!toastEl) { toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  const hide = () => toastEl.classList.remove('show');
  clear(toastEl, h('span', text), undo && h('button', { type: 'button', onclick: () => { hide(); undo(); } }, 'Undo'));
  clearTimeout(toastTimer);
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hide, undo ? Math.max(ms, 5000) : ms);
}

/* ---------- Sheets ---------- */
/** Opens a sheet from the bottom. build(close) returns the content. Returns close(). */
export function sheet(build, { onClose } = {}) {
  const d = h('dialog.sheet');
  const inner = h('div.sheet-inner');
  d.append(inner);
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    try { d.close(); } catch { /* already closed */ }
    d.remove();
    unlock();
    onClose && onClose(value);
  };
  d.addEventListener('click', (e) => { if (e.target === d) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dragToClose(d, inner, close);
  inner.append(h('button.sheet-close', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x')), build(close));
  document.body.append(d);
  lock();
  d.showModal();
  return close;
}

/* iPhone scrolls the page behind an open sheet. Lock it, and restore the position after. */
let locks = 0, lockY = 0;
function lock() {
  if (locks++ > 0) return;
  lockY = scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0', width: '100%' });
}
function unlock() {
  if (locks === 0 || --locks > 0) return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  scrollTo(0, lockY);
}

/* The sheet follows the finger down and closes when dragged far or fast enough —
   only when its content is scrolled to the top, so normal scrolling still works. */
function dragToClose(d, inner, close) {
  let y0 = null, last = 0, t = 0, speed = 0, dragging = false;
  inner.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || inner.scrollTop > 0) { y0 = null; return; }
    y0 = e.touches[0].clientY; last = y0; t = e.timeStamp; dragging = false;
  }, { passive: true });
  inner.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const y = e.touches[0].clientY, dy = y - y0;
    if (!dragging && (dy < 6 || inner.scrollTop > 0)) return;
    dragging = true;
    e.preventDefault();
    speed = (y - last) / Math.max(1, e.timeStamp - t); last = y; t = e.timeStamp;
    d.style.transition = 'none';
    d.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const release = () => {
    if (y0 == null || !dragging) { y0 = null; return; }
    const dy = last - y0;
    y0 = null; dragging = false;
    if (dy > 110 || speed > 0.7) {
      d.style.transition = 'transform .18s ease-in';
      d.style.transform = 'translateY(100%)';
      setTimeout(() => close(), 170);
    } else {
      d.style.transition = 'transform .2s ease-out';
      d.style.transform = '';
    }
  };
  inner.addEventListener('touchend', release);
  inner.addEventListener('touchcancel', release);
}

/** Yes/no question as a sheet. Resolves true/false. */
export function confirmSheet({ title, text, yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    sheet((close) => h('div',
      h('h2', title),
      text && h('p.muted.lead', text),
      h('div.btnrow',
        h('button.btn.secondary', { type: 'button', onclick: () => close() }, no),
        h('button.btn' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { answer = true; close(); } }, yes)),
    ), { onClose: () => resolve(answer) });
  });
}

/** Pick one of several options in a sheet. options: [{ value, text, sub? }]. Resolves value or null. */
export function choose({ title, options, selected }) {
  return new Promise((resolve) => {
    let answer = null;
    sheet((close) => h('div',
      h('h2', title),
      h('div.optlist', options.map((o) => h('button', {
        type: 'button', 'aria-pressed': String(o.value === selected),
        onclick: () => { answer = o.value; close(); },
      }, h('span', o.text, o.sub && h('small', o.sub)), o.value === selected && icon('check')))),
    ), { onClose: () => resolve(answer) });
  });
}

/** A titled section with a coloured left edge (--c). right: short text in the header. */
export function block(title, right, ...content) {
  return h('section.block', h('header', h('h3', title), right && h('span', right)), ...content);
}

/** A row: title and lines on the left, a value in a fixed column, a chevron when tappable. */
export function row({ title, sub = [], value = '', onclick = null, strong = false, cls = '' }) {
  const attrs = onclick ? { role: 'button', tabindex: '0', onclick, onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onclick(); } } } : {};
  return h('div.row' + (strong ? '.strong' : '') + (cls ? '.' + cls : ''), attrs,
    h('div.main', h('b', title), [].concat(sub).filter(Boolean).map((s) => (s instanceof Node ? s : h('small', s)))),
    h('span.value', value),
    h('span.chev', onclick ? icon('chevron') : ''));
}

// Which collapsible groups are open, so they stay open when the page redraws
const openGroups = new Set();
/** A row that opens and closes the content under it. Remembers its state. */
export function fold(key, head, content, { open = false } = {}) {
  if (open && !openGroups.has('!' + key)) openGroups.add(key);
  const under = h('div.fold-body', { hidden: !openGroups.has(key) }, content);
  const r = row({ ...head, onclick: () => {
    if (openGroups.has(key)) { openGroups.delete(key); openGroups.add('!' + key); } else { openGroups.add(key); openGroups.delete('!' + key); }
    const isOpen = openGroups.has(key);
    under.hidden = !isOpen;
    r.setAttribute('aria-expanded', String(isOpen));
  } });
  r.classList.add('fold');
  r.setAttribute('aria-expanded', String(openGroups.has(key)));
  return h('div', r, under);
}

/** Copies text, with a fallback for older browsers. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}
