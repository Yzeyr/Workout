/* History: consistency, strength over time, and every session. */

import { h, icon, clear, sheet, confirmSheet, block, row, fold } from '../dom.js';
import { get, change } from '../state.js';
import { MAIN, MAIN_IDS, CARDIO_TYPES } from '../data/exercises.js';
import { outcome, e1rm, RIR, iso, liftStatus } from '../program.js';
import { num, dayLabel, minutes, MONTHS_LONG, pace, spark } from '../util.js';
import { cardioSheet } from './body.js';

export function historyView(root) {
  const s = get(), today = iso();
  if (!s.prog) { clear(root, h('div.top', h('div.titles', h('h1', 'History'))), h('p.muted', 'Set up the program on the Train tab first.')); return; }
  const sessions = s.sessions.slice().reverse();

  // Group sessions and cardio by month, newest first
  const byMonth = new Map();
  for (const x of [...sessions.map((ses) => ({ date: ses.date, ses })), ...s.cardio.map((c) => ({ date: c.date, c }))].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const k = x.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(x);
  }
  const thisMonth = today.slice(0, 7);
  const months = [...byMonth.entries()].map(([k, list]) => {
    const n = list.filter((x) => x.ses).length, c = list.filter((x) => x.c).length;
    const title = MONTHS_LONG[Number(k.slice(5)) - 1] + ' ' + k.slice(0, 4);
    return fold('m-' + k, { title, sub: [n && n + ' workout' + (n > 1 ? 's' : ''), c && c + ' cardio'].filter(Boolean).join(' · '), strong: true },
      list.map((x) => (x.ses ? sessionRow(x.ses) : cardioRow(x.c))), { open: k === thisMonth || byMonth.size === 1 });
  });

  clear(root,
    h('div.top', h('div.titles', h('div.eyebrow', s.sessions.length + (s.sessions.length === 1 ? ' workout' : ' workouts') + ' since ' + dayLabel(s.prog.started)), h('h1', 'History')), h('a.iconbtn', { href: '#settings', 'aria-label': 'Settings' }, icon('settings'))),
    heatBlock(s, today),
    strengthBlock(s, today),
    h('section.block', h('header', h('h3', 'Workouts and cardio')),
      months.length ? months : h('p.empty', 'Nothing logged yet. Your first workout shows up here.')),
  );
  const heat = root.querySelector('.heat');
  if (heat) heat.scrollLeft = heat.scrollWidth;
}

/* ---------- Consistency ---------- */
function heatBlock(s, today) {
  const done = new Map();
  for (const ses of s.sessions) {
    const full = ses.items.filter((it) => it.kind === 't1').every((it) => outcome(it) !== 'skip');
    done.set(ses.date, Math.max(done.get(ses.date) || 0, full ? 2 : 1));
  }
  const cardio = new Set(s.cardio.map((c) => c.date));
  // From the program start (at least 8 weeks, at most 26), up to this week
  const weeks = Math.max(8, Math.min(26, Math.ceil((Date.now() - new Date(s.prog.started + 'T00:00').getTime()) / 604800000) + 1));
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cells = [], months = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    let label = '';
    for (let i = 0; i < 7; i++) {
      const day = iso(d);
      const v = done.get(day);
      const cls = v === 2 ? 's2' : v === 1 ? 's1' : cardio.has(day) ? 'c' : '';
      cells.push(h('i' + (cls ? '.' + cls : '') + (day === today ? '.today' : ''), { title: day }));
      if (i === 0 && d.getMonth() !== lastMonth) { label = MONTHS_LONG[d.getMonth()].slice(0, 3); lastMonth = d.getMonth(); }
      d.setDate(d.getDate() + 1);
    }
    months.push(h('span', label));
  }
  // This week, last 4 weeks
  const since = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return iso(x); };
  const last28 = s.sessions.filter((x) => x.date > since(28)).length;
  const last7 = s.sessions.filter((x) => x.date > since(7)).length;
  return block('Consistency', last7 + ' this week · ' + num(last28 / 4, 1) + '/week lately',
    h('div.heat', h('div.months', months), h('div.grid', cells)),
    h('div.key', h('span', h('i', { style: { background: 'var(--accent-text)' } }), 'Workout'), h('span', h('i', { style: { background: 'color-mix(in srgb, var(--accent-text) 45%, var(--panel2))' } }), 'Partial'), h('span', h('i', { style: { background: 'color-mix(in srgb, var(--gold) 70%, var(--panel2))' } }), 'Cardio only')));
}

/* ---------- Strength ---------- */
function strengthBlock(s, today) {
  const rows = MAIN_IDS.map((id) => {
    const series = [];
    for (const ses of s.sessions) {
      const it = ses.items.find((x) => x.kind === 't1' && x.exId === id);
      if (!it || outcome(it) === 'skip') continue;
      let best = 0;
      for (const st of it.sets) if (st.done > 0) best = Math.max(best, e1rm(st.w, st.done, st.amrap ? 0 : RIR[it.rating || 'ok']));
      if (best) series.push(best);
    }
    const st = liftStatus(s.prog, id, today);
    const first = series[0], last = series[series.length - 1];
    return h('div.row', { style: { gridTemplateColumns: '1fr auto', '--c': 'var(--' + MAIN[id].colour + ')' } },
      h('div.main', h('b', MAIN[id].name), h('small', series.length ? series.length + (series.length === 1 ? ' heavy session' : ' heavy sessions') + (first && last > first ? ' · +' + num(last - first) + ' kg' : '') : 'No heavy sessions yet'), spark(series.slice(-30))),
      h('span.value', num(st.now) + ' kg', h('small.muted', { style: { display: 'block', fontSize: '13px' } }, 'est. max')));
  });
  const pu = s.sessions.flatMap((x) => x.items.filter((it) => it.kind === 'pu').flatMap((it) => it.sets.filter((st) => st.test && st.done != null).map((st) => st.done)));
  rows.push(h('div.row', { style: { gridTemplateColumns: '1fr auto', '--c': 'var(--pu)' } },
    h('div.main', h('b', 'Pull-ups'), h('small', pu.length ? pu.length + ' max tests' : 'Tested every third pull-up day'), spark(pu)),
    h('span.value', s.prog.pu.max + ' reps')));
  return block('Strength', 'estimated 1-rep max', rows);
}

/* ---------- Rows and details ---------- */
function sessionRow(ses) {
  const t1 = ses.items.filter((it) => it.kind === 't1' && outcome(it) !== 'skip');
  const sub = t1.map((it) => MAIN[it.exId].short + ' ' + num(Math.max(...it.sets.map((x) => x.w))) + (outcome(it) === 'fail' ? ' ✗' : '')).join(' · ');
  return row({
    title: dayLabel(ses.date) + ' · ' + (ses.wid === 'A' ? 'Workout A' : 'Workout B') + (ses.deload ? ' (light)' : ''),
    sub: [sub, ses.note && '“' + ses.note.slice(0, 80) + (ses.note.length > 80 ? '…' : '') + '”'],
    value: ses.end ? minutes(ses.start, ses.end) + ' min' : '',
    onclick: () => sessionSheet(ses.id),
  });
}

function cardioRow(c) {
  const t = CARDIO_TYPES.find((x) => x.id === c.type) || { name: c.type };
  return row({ title: dayLabel(c.date) + ' · ' + t.name, sub: [(c.km ? num(c.km, 2) + ' km · ' : '') + num(c.min, 0) + ' min' + (pace(c.type, c.km, c.min) ? ' · ' + pace(c.type, c.km, c.min) : ''), c.note], onclick: () => cardioSheet(c) });
}

function sessionSheet(id) {
  const ses = get().sessions.find((x) => x.id === id);
  if (!ses) return;
  sheet((close) => h('div',
    h('h2', (ses.wid === 'A' ? 'Workout A' : 'Workout B')),
    h('p.muted.lead', dayLabel(ses.date, { year: true }) + (ses.end ? ' · ' + minutes(ses.start, ses.end) + ' min' : '') + (ses.beatUp ? ' · felt beat up' : '')),
    ses.note && h('p', { style: { marginBottom: '12px', fontStyle: 'italic' } }, '“' + ses.note + '”'),
    h('div', { style: { margin: '0 -16px' } }, ses.items.filter((it) => outcome(it) !== 'skip').map((it) => h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
      h('div.main', h('b', it.name), h('small', it.sets.filter((x) => x.done != null).map((x) => (x.w ? num(x.w) + '×' : '') + x.done + (x.done < x.reps ? '✗' : '')).join('  ')),
        it.rating && h('small', 'Last set: ' + it.rating)),
      h('span.value', outcome(it) === 'fail' ? h('span.chip.down', 'short') : h('span.chip.up', 'done'))))),
    ses.changes?.length > 0 && h('div', { style: { margin: '14px 0 0' } }, h('p.small.muted', { style: { marginBottom: '6px', fontWeight: '600' } }, 'What changed after it'),
      ses.changes.map((c) => h('p.small', { style: { marginBottom: '4px' } }, h('b', c.name + ': '), c.text))),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: async () => {
        const ok = await confirmSheet({ title: 'Delete this workout?', text: 'It is removed from the history. The program weights are not changed back.', yes: 'Delete', danger: true });
        if (ok) { change((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); }); close(); }
      } }, icon('trash'), 'Delete'),
      h('button.btn', { type: 'button', onclick: () => close() }, 'Close'))));
}
