/* Body: measurements, Apple Health data and cardio. */

import { h, icon, clear, sheet, confirmSheet, block, row, fold, toast } from '../dom.js';
import { get, change, logMeasure, removeMeasure } from '../state.js';
import { MEASURES, CARDIO_TYPES } from '../data/exercises.js';
import { iso } from '../program.js';
import { num, dayLabel, parseNum, pace, spark, ago } from '../util.js';
import { KEYS, readJson, writeJson, remove } from '../store.js';
import { readHealthExport, summarizeHealth } from '../health.js';

export const HEALTH_METRICS = [
  { id: 'steps', name: 'Steps', unit: '', dec: 0, better: 'up' },
  { id: 'sleepH', name: 'Sleep', unit: 'h', dec: 1, better: 'up' },
  { id: 'restingHr', name: 'Resting pulse', unit: 'bpm', dec: 0, better: 'down' },
  { id: 'hrvMs', name: 'HRV', unit: 'ms', dec: 0, better: 'up' },
  { id: 'vo2max', name: 'VO₂ max', unit: '', dec: 1, better: 'up' },
  { id: 'weightKg', name: 'Weight', unit: 'kg', dec: 1, better: null },
  { id: 'activeKcal', name: 'Active energy', unit: 'kcal', dec: 0, better: 'up' },
  { id: 'exerciseMin', name: 'Exercise', unit: 'min', dec: 0, better: 'up' },
  { id: 'deepH', name: 'Deep sleep', unit: 'h', dec: 1, better: 'up' },
  { id: 'remH', name: 'REM sleep', unit: 'h', dec: 1, better: 'up' },
  { id: 'walkingHr', name: 'Walking pulse', unit: 'bpm', dec: 0, better: 'down' },
  { id: 'respiratoryRate', name: 'Breathing rate', unit: '/min', dec: 1, better: null },
  { id: 'spo2', name: 'Blood oxygen', unit: '%', dec: 0, better: null },
  { id: 'bodyFatPct', name: 'Body fat', unit: '%', dec: 1, better: 'down' },
  { id: 'distanceKm', name: 'Walking + running', unit: 'km', dec: 1, better: 'up' },
];

export function health() {
  const r = readJson(KEYS.health);
  return r.status === 'ok' ? r.value : null;
}

export function bodyView(root) {
  const s = get(), today = iso();
  const hd = health();

  const measureRow = (m) => {
    const list = s.body[m.id] || [];
    const last = list[list.length - 1], prev = list[list.length - 2];
    const delta = last && prev ? Math.round((last.value - prev.value) * 10) / 10 : null;
    return row({
      title: m.name,
      sub: last ? [dayLabel(last.date) + (delta ? ' · ' + (delta > 0 ? '+' : '') + num(delta) + ' ' + m.unit + ' since last' : ''), list.length > 2 && spark(list.slice(-20).map((e) => e.value))] : 'Not logged yet',
      value: last ? num(last.value) + ' ' + m.unit : h('span.chip', 'Log'),
      onclick: () => measureSheet(m),
    });
  };

  clear(root,
    h('div.top', h('div.titles', h('div.eyebrow', 'Measurements and health'), h('h1', 'Body')), h('a.iconbtn', { href: '#settings', 'aria-label': 'Settings' }, icon('settings'))),
    block('Measurements', 'tap to log', ...MEASURES.filter((m) => m.often).map(measureRow),
      fold('more-measures', { title: 'More measurements', sub: MEASURES.filter((m) => !m.often).map((m) => m.name).join(', ') }, MEASURES.filter((m) => !m.often).map(measureRow))),
    healthBlock(hd, today),
    cardioBlock(s),
  );
}

/* ---------- Measurements ---------- */
function measureSheet(m) {
  const content = h('div');
  let closeIt = () => {};
  const draw = () => {
    const list = (get().body[m.id] || []).slice().reverse();
    const input = h('input', { type: 'text', inputmode: 'decimal', placeholder: list[0] ? num(list[0].value) : '', 'aria-label': m.name + ' in ' + m.unit });
    const date = h('input', { type: 'date', value: iso(), max: iso() });
    const save = () => {
      const v = parseNum(input.value);
      if (!Number.isFinite(v) || v <= 0) { input.focus(); return; }
      logMeasure(m.id, v, date.value || iso());
      toast(m.name + ' saved');
      draw();
    };
    clear(content,
      h('h2', m.name),
      h('div.fields2', h('label.field', h('span', m.unit), input), h('label.field', h('span', 'Date'), date)),
      h('button.btn.wide', { type: 'button', onclick: save }, 'Save'),
      list.length > 0 && h('div', { style: { margin: '16px -16px 0' } },
        list.length > 2 && h('div', { style: { padding: '0 16px 8px' } }, spark(list.slice(0, 30).reverse().map((e) => e.value))),
        list.slice(0, 60).map((e) => h('div.row', { style: { gridTemplateColumns: '1fr auto 44px' } },
          h('div.main', h('b', dayLabel(e.date))), h('span.value', num(e.value) + ' ' + m.unit),
          h('button.iconbtn', { type: 'button', 'aria-label': 'Delete ' + dayLabel(e.date), style: { background: 'transparent', border: 'none' }, onclick: async () => {
            if (await confirmSheet({ title: 'Delete this entry?', text: dayLabel(e.date) + ': ' + num(e.value) + ' ' + m.unit, yes: 'Delete', danger: true })) { removeMeasure(m.id, e.date); draw(); }
          } }, icon('trash'))))),
      h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => closeIt() }, 'Done')));
  };
  draw();
  sheet((close) => { closeIt = close; return content; });
}

/* ---------- Apple Health ---------- */
function healthBlock(hd, today) {
  if (!hd) {
    return block('Apple Health', '', h('div.inner',
      h('p', { style: { marginBottom: '10px' } }, 'Bring in steps, sleep, resting pulse, HRV, VO₂ max, weight and workouts from your iPhone and Watch. The coach uses them for advice.'),
      h('ol.small.muted', { style: { margin: '0 0 12px', paddingLeft: '20px' } },
        h('li', 'Open the Health app and tap your picture (top right).'),
        h('li', 'Tap "Export All Health Data" and wait. It can take a few minutes.'),
        h('li', 'Choose "Save to Files".'),
        h('li', 'Come back here and pick the export.zip file.')),
      h('p.small.muted', { style: { marginBottom: '12px' } }, 'The file is read on this phone. Only daily summaries are kept, and nothing is sent anywhere unless you ask the coach.'),
      h('button.btn.wide', { type: 'button', onclick: importHealth }, icon('upload'), 'Choose export.zip')));
  }
  const sum = summarizeHealth(hd, { days: 30 });
  const shown = HEALTH_METRICS.filter((m) => sum.metrics[m.id]);
  const main = shown.slice(0, 6), rest = shown.slice(6);
  const metricRow = (m) => {
    const x = sum.metrics[m.id];
    const series = Object.keys(hd.days).sort().slice(-60).map((d) => hd.days[d][m.id]).filter((v) => v != null);
    const diff = x.prevAvg != null && x.avg != null ? x.avg - x.prevAvg : null;
    const good = m.better && diff != null && Math.abs(diff) > 0 ? ((diff > 0) === (m.better === 'up')) : null;
    const trend = x.trend === 'flat' || diff == null ? h('span.chip', 'steady') : h('span.chip.' + (good === false ? 'down' : good ? 'up' : 'gold'), (diff > 0 ? '↑ ' : '↓ ') + num(Math.abs(diff), m.dec) + (m.unit && m.unit !== '%' ? ' ' + m.unit : m.unit));
    return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
      h('div.main', h('b', m.name), h('small', '30-day average · ' + x.days + ' days with data'), series.length > 3 && spark(series)),
      h('span.value', h('span', num(x.avg, m.dec) + (m.unit ? ' ' + m.unit : '')), h('span', { style: { display: 'block', marginTop: '4px' } }, trend)));
  };
  return block('Apple Health', 'up to ' + dayLabel(sum.asOf),
    main.map(metricRow),
    rest.length > 0 && fold('health-more', { title: 'More health data', sub: rest.map((m) => m.name).join(', ') }, rest.map(metricRow)),
    sum.workouts.count > 0 && row({ title: 'Workouts from Apple Health', sub: Object.entries(sum.workouts.byType || {}).slice(0, 4).map(([t, n]) => t + ' ' + n).join(' · '), value: sum.workouts.count + ' in 30 days' }),
    h('p.note', { style: { paddingTop: '10px' } }, 'Imported ' + ago(hd.importedAt?.slice(0, 10) || today, today) + '. Arrows compare with the 30 days before. Export again from Health to update.'),
    h('div', { style: { display: 'flex', gap: '8px', padding: '0 16px 14px' } },
      h('button.btn.secondary', { type: 'button', style: { flex: '1' }, onclick: importHealth }, icon('upload'), 'Update'),
      h('button.btn.secondary', { type: 'button', onclick: async () => {
        if (await confirmSheet({ title: 'Remove health data?', text: 'The imported summaries are deleted from this phone. Your Health app is not touched.', yes: 'Remove', danger: true })) { remove(KEYS.health); change(() => {}); }
      } }, icon('trash'))));
}

function importHealth() {
  const input = h('input', { type: 'file', accept: '.zip,.xml,application/zip,text/xml' });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) runImport(f); });
  input.click();
}

function runImport(file) {
  const ctrl = new AbortController();
  const bar = h('i', { style: { width: '0%' } });
  const status = h('p.muted.lead', 'Reading ' + (file.name || 'the file') + ' (' + num(file.size / 1048576, 0) + ' MB). Keep the app open.');
  let closeIt = () => {};
  sheet((close) => { closeIt = close; return h('div',
    h('h2', 'Reading health data'), status, h('div.progress', bar),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => { ctrl.abort(); close(); } }, 'Cancel'))); }, { onClose: () => ctrl.abort() });
  const since = new Date(); since.setFullYear(since.getFullYear() - 2);
  readHealthExport(file, { since: iso(since), signal: ctrl.signal, onProgress: (f) => { bar.style.width = Math.round(f * 100) + '%'; } })
    .then((res) => {
      const ok = writeJson(KEYS.health, { ...res, importedAt: new Date().toISOString() });
      closeIt();
      if (ok) { toast('Health data imported: ' + Object.keys(res.days).length + ' days'); change(() => {}); }
    })
    .catch((e) => {
      if (ctrl.signal.aborted) return;
      status.textContent = e?.message || 'Could not read the file.';
      status.style.color = 'var(--oxide-text)';
    });
}

/* ---------- Cardio ---------- */
function cardioBlock(s) {
  const list = s.cardio.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return block('Cardio', list.length ? list.length + ' logged' : '',
    list.slice(0, 5).map(cardioRow),
    list.length > 5 && fold('cardio-more', { title: 'Older', sub: (list.length - 5) + ' more' }, list.slice(5).map(cardioRow)),
    h('div', { style: { padding: '10px 16px 14px' } }, h('button.btn.secondary.wide', { type: 'button', onclick: () => cardioSheet() }, icon('plus'), 'Log cardio')));
}

function cardioRow(c) {
  const t = CARDIO_TYPES.find((x) => x.id === c.type) || { name: c.type };
  return row({
    title: t.name + (c.km ? ' · ' + num(c.km, 2) + ' km' : ''),
    sub: [dayLabel(c.date) + ' · ' + num(c.min, 0) + ' min' + (pace(c.type, c.km, c.min) ? ' · ' + pace(c.type, c.km, c.min) : ''), c.note],
    onclick: () => cardioSheet(c),
  });
}

/** New cardio entry, or edit one. */
export function cardioSheet(existing = null) {
  const v = existing ? { ...existing } : { type: 'run', date: iso(), km: '', min: '', note: '' };
  const typeSeg = h('div.seg', CARDIO_TYPES.map((t) => h('button', {
    type: 'button', 'aria-pressed': String(v.type === t.id),
    onclick: (e) => { v.type = t.id; [...typeSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
  }, t.name)));
  const km = h('input', { type: 'text', inputmode: 'decimal', value: v.km === '' ? '' : num(v.km, 2), placeholder: '5' });
  const min = h('input', { type: 'text', inputmode: 'decimal', value: v.min === '' ? '' : num(v.min, 1), placeholder: '30' });
  const date = h('input', { type: 'date', value: v.date, max: iso() });
  const note = h('textarea', { placeholder: 'Route, how it felt (optional)', value: v.note || '' });
  sheet((close) => h('div',
    h('h2', existing ? 'Edit cardio' : 'Log cardio'),
    h('label.field', h('span', 'Type'), typeSeg),
    h('div.fields2', h('label.field', h('span', 'Distance (km)'), km), h('label.field', h('span', 'Time (min)'), min)),
    h('label.field', h('span', 'Date'), date),
    h('label.field', h('span', 'Note'), note),
    h('div.btnrow',
      existing ? h('button.btn.secondary', { type: 'button', onclick: async () => {
        if (await confirmSheet({ title: 'Delete this entry?', yes: 'Delete', danger: true })) { change((s) => { s.cardio = s.cardio.filter((c) => c.id !== existing.id); }); close(); }
      } }, icon('trash'), 'Delete') : h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => {
        const k = parseNum(km.value), m = parseNum(min.value);
        if (!Number.isFinite(m) || m <= 0) { min.focus(); return; }
        const entry = { id: existing?.id || 'c' + Date.now().toString(36), type: v.type, date: date.value || iso(), km: Number.isFinite(k) && k > 0 ? k : 0, min: m, note: note.value.trim() };
        change((s) => { s.cardio = [...s.cardio.filter((c) => c.id !== entry.id), entry]; });
        toast('Cardio saved');
        close();
      } }, 'Save'))));
}
