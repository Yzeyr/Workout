/* Muscles: a body map of weekly sets, warnings, recovery, ratios, and fixes. */

import { h, icon, clear, sheet, choose, block, row, fold, toast } from '../dom.js';
import { get, change } from '../state.js';
import { analyze, bestExercise, contributors } from '../muscles.js';
import { MUSCLE, MUSCLES, REGIONS } from '../data/muscles.js';
import { accessory } from '../data/exercises.js';
import { iso, daysBetween } from '../program.js';
import { num, dayLabel } from '../util.js';

const STATUS = {
  none: { text: 'nothing', cls: 'down' },
  low: { text: 'too little', cls: 'down' },
  ok: { text: 'good', cls: 'up' },
  high: { text: 'plenty', cls: 'gold' },
  extra: { text: 'optional', cls: '' },
};

/* ---------- Body map ---------- */
// Simple shapes per muscle, in a 120 × 250 box per view. e = ellipse [cx, cy, rx, ry], p = path.
const FRONT = {
  neck: [['p', 'M53,31 h14 v8 h-14 z']],
  frontDelts: [['e', 37, 50, 8, 8], ['e', 83, 50, 8, 8]],
  sideDelts: [['e', 28.5, 55, 4.5, 8], ['e', 91.5, 55, 4.5, 8]],
  chest: [['e', 49.5, 61, 11, 8.5], ['e', 70.5, 61, 11, 8.5]],
  biceps: [['e', 28, 80, 5.5, 11.5], ['e', 92, 80, 5.5, 11.5]],
  forearms: [['e', 23, 109, 5, 14], ['e', 97, 109, 5, 14]],
  abs: [['p', 'M51,72 h18 a2,2 0 0 1 2,2 v34 q-11,8 -22,0 v-34 a2,2 0 0 1 2,-2 z']],
  obliques: [['e', 44, 92, 4.5, 14], ['e', 76, 92, 4.5, 14]],
  quads: [['e', 49, 148, 9.5, 27], ['e', 71, 148, 9.5, 27]],
  adductors: [['e', 57, 137, 3.2, 13], ['e', 63, 137, 3.2, 13]],
  calves: [['e', 48.5, 209, 6, 18], ['e', 71.5, 209, 6, 18]],
};
const BACK = {
  neck: [['p', 'M53,31 h14 v6 h-14 z']],
  upperBack: [['p', 'M44,38 L76,38 L86,52 L60,74 L34,52 Z']],
  rearDelts: [['e', 33, 52, 7.5, 7], ['e', 87, 52, 7.5, 7]],
  lats: [['p', 'M40,60 Q33,84 50,102 L57,98 L57,72 Z'], ['p', 'M80,60 Q87,84 70,102 L63,98 L63,72 Z']],
  triceps: [['e', 28, 80, 5.5, 11.5], ['e', 92, 80, 5.5, 11.5]],
  forearms: [['e', 23, 109, 5, 14], ['e', 97, 109, 5, 14]],
  lowerBack: [['p', 'M52,96 h16 v18 h-16 z']],
  glutes: [['e', 50.5, 127, 10, 10], ['e', 69.5, 127, 10, 10]],
  hamstrings: [['e', 50, 159, 8.5, 22], ['e', 70, 159, 8.5, 22]],
  calves: [['e', 49, 207, 7, 18], ['e', 71, 207, 7, 18]],
};
// The figure underneath: head, torso, arms, legs
const BASE = '<circle cx="60" cy="18" r="11"/><rect x="38" y="38" width="44" height="80" rx="16"/><rect x="40" y="110" width="40" height="30" rx="12"/>'
  + '<path d="M36,46 Q24,60 24,84 L20,124" /><path d="M84,46 Q96,60 96,84 L100,124" /><path d="M50,136 L48,232" /><path d="M70,136 L72,232" />';

function fillFor(m) {
  if (!m || m.status === 'extra') return 'color-mix(in srgb, var(--muted) 30%, var(--panel2))';
  const share = m.target[0] ? m.projected / m.target[0] : 1;
  if (m.status === 'none') return 'color-mix(in srgb, var(--oxide-text) 30%, var(--panel2))';
  if (m.status === 'low') return 'color-mix(in srgb, var(--oxide-text) ' + Math.round(40 + 40 * (1 - share)) + '%, var(--panel2))';
  if (m.status === 'high') return 'var(--gold)';
  return 'color-mix(in srgb, var(--sq) ' + Math.round(55 + 45 * Math.min(1, (m.projected - m.target[0]) / Math.max(1, m.target[1] - m.target[0]))) + '%, var(--panel2))';
}

function bodyMap(a, onPick) {
  const svg = (shapes, label) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 120 250');
    s.setAttribute('class', 'bodymap');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
    let inner = '<g class="base">' + BASE + '</g>';
    for (const [id, list] of Object.entries(shapes)) {
      const m = a.by[id];
      const tired = m && m.recovered < 0.5;
      inner += '<g class="mz' + (tired ? ' tired' : '') + '" data-m="' + id + '" fill="' + fillFor(m) + '"><title>' + MUSCLE[id].name + '</title>'
        + list.map(([t, ...v]) => (t === 'e' ? '<ellipse cx="' + v[0] + '" cy="' + v[1] + '" rx="' + v[2] + '" ry="' + v[3] + '"/>' : '<path d="' + v[0] + '"/>')).join('') + '</g>';
    }
    s.innerHTML = inner;
    s.addEventListener('click', (e) => { const g = e.target.closest('[data-m]'); if (g) onPick(g.dataset.m); });
    return s;
  };
  return h('div.maps', h('figure', svg(FRONT, 'Front'), h('figcaption', 'Front')), h('figure', svg(BACK, 'Back'), h('figcaption', 'Back')));
}

/* ---------- Screen ---------- */
export function musclesView(root) {
  const s = get();
  if (!s.prog) { clear(root, h('p.muted', 'Set up the program first.')); return; }
  const a = analyze(s);
  const mode = s.settings?.balance || 'suggest';
  const bar = (m) => {
    const max = Math.max(m.target[1] * 1.3, m.projected, m.week, 1);
    const pct = (v) => Math.min(100, (v / max) * 100) + '%';
    return h('div.vol', { 'aria-hidden': 'true' },
      h('span.zone', { style: { left: pct(m.target[0]), width: 'calc(' + pct(m.target[1]) + ' - ' + pct(m.target[0]) + ')' } }),
      h('i', { style: { width: pct(m.projected), background: fillFor(m) } }),
      h('b', { style: { left: pct(m.week) }, title: 'This week' }));
  };
  const muscleRow = (m) => row({
    title: m.name + (m.focus ? ' ★' : ''),
    sub: [
      num(m.projected) + ' sets/week · aim ' + m.target[0] + '–' + m.target[1] + (m.week !== m.projected ? ' · ' + num(m.week) + ' in the last 7 days' : ''),
      bar(m),
      m.recovered < 0.6 ? 'Recovering: ' + Math.round(m.recovered * 100) + ' %' : m.daysSince != null ? 'Last trained ' + (m.daysSince === 0 ? 'today' : m.daysSince + ' d ago') : null,
    ],
    value: h('span.chip' + (STATUS[m.status].cls ? '.' + STATUS[m.status].cls : ''), STATUS[m.status].text),
    onclick: () => muscleSheet(m.id),
  });

  clear(root,
    h('div.top', h('a.iconbtn', { href: '#train', 'aria-label': 'Back' }, icon('back')),
      h('div.titles', h('div.eyebrow', a.basis === 'plan' ? 'From your plan (log 3 workouts for real numbers)' : 'Last 6 workouts at ' + num(a.freq) + '/week'), h('h1', 'Muscles'))),
    h('section.block.c-accent',
      bodyMap(a, muscleSheet),
      h('div.key', h('span', h('i', { style: { background: fillFor({ status: 'low', target: [1], projected: 0.3 }) } }), 'Too little'), h('span', h('i', { style: { background: fillFor({ status: 'ok', target: [1, 2], projected: 1.5 }) } }), 'Good'), h('span', h('i', { style: { background: 'var(--gold)' } }), 'Plenty'), h('span', h('i', { style: { background: 'var(--panel2)', outline: '2px dashed var(--muted)' } }), 'Recovering')),
      h('p.note', 'Tap a muscle. Sets per week: 1 for the muscle an exercise mainly trains, ½ for helpers.')),
    alertsBlock(a, s, { all: true }),
    ratiosBlock(a),
    ...REGIONS.map((r) => block(r, '', a.muscles.filter((m) => m.region === r).map(muscleRow))),
    block('Settings', '',
      row({ title: 'Balance help', sub: { off: 'Off', suggest: 'Show suggestions on Train', auto: 'Add the most needed exercise to the next workout automatically' }[mode], value: { off: 'Off', suggest: 'Suggest', auto: 'Auto' }[mode], onclick: async () => {
        const v = await choose({ title: 'Balance help', selected: mode, options: [
          { value: 'suggest', text: 'Suggest', sub: 'Warnings and one-tap fixes on Train' },
          { value: 'auto', text: 'Auto', sub: 'Up to two exercises added to the next workout when something is clearly missing' },
          { value: 'off', text: 'Off', sub: 'Only on this screen' }] });
        if (v) change((x) => { x.settings = { ...(x.settings || {}), balance: v }; });
      } }),
      row({ title: 'Focus muscles', sub: (s.prog.focus || []).map((id) => MUSCLE[id]?.name).join(', ') || 'None — tap a muscle and mark it as focus to raise its target 30 %' })),
  );
}

/* ---------- Warnings with fixes (also used on Train) ---------- */
export function alertsBlock(a, s, { all = false } = {}) {
  const list = a.alerts.filter((x) => x.severity > 0 && (all || x.severity >= 2));
  if (!list.length) return all ? block('Balance', 'all good', h('p.note', { style: { paddingTop: '0' } }, 'Every muscle gets enough from the program at your pace. Nice.')) : null;
  const planned = new Set([...(s.prog.extra || []).map((x) => x.id)]);
  const items = list.slice(0, all ? 12 : 3).map((al) => {
    if (al.kind === 'skipped') return skippedAlert(al, a, s);
    if (al.kind === 'replaced') return h('div.alert.sev' + al.severity, h('div.alert-head', icon('info'), h('b', al.title)), h('p', al.text));
    const ex = bestExercise(a, al.muscle, { custom: s.custom, exclude: [...s.prog.t3.A, ...s.prog.t3.B].filter((id) => !planned.has(id)) });
    const already = ex && planned.has(ex.id);
    return h('div.alert.sev' + al.severity,
      h('div.alert-head', icon(al.severity >= 3 ? 'warning' : 'info'), h('b', al.title)),
      h('p', al.text),
      ex && h('p.fix', 'Fix: ', h('b', ex.name), ' · ' + Object.entries(ex.works).filter(([, f]) => f >= 1).map(([m]) => MUSCLE[m]?.name.toLowerCase()).join(', ')),
      ex && h('div.alert-actions',
        already ? h('span.chip.up', '✓ In the next workout')
          : h('button.btn.secondary', { type: 'button', onclick: () => { change((x) => { x.prog.extra = [...(x.prog.extra || []).filter((e) => e.id !== ex.id), { id: ex.id, muscle: al.muscle, why: MUSCLE[al.muscle].name }]; }); toast(ex.name + ' added to the next workout'); } }, icon('plus'), 'Next time'),
        h('button.btn.ghost', { type: 'button', onclick: async () => {
          const w = await choose({ title: 'Always do ' + ex.name + ' in…', options: [{ value: 'A', text: 'Workout A', sub: accNames(s.prog.t3.A, s) }, { value: 'B', text: 'Workout B', sub: accNames(s.prog.t3.B, s) }] });
          if (w) { change((x) => { if (!x.prog.t3[w].includes(ex.id)) x.prog.t3[w] = [...x.prog.t3[w], ex.id]; x.prog.extra = (x.prog.extra || []).filter((e) => e.id !== ex.id); }); toast(ex.name + ' is now part of workout ' + w); }
        } }, 'Always')));
  });
  const more = a.alerts.filter((x) => x.severity > 0).length - list.length;
  return h('section.block.c-oxide', h('header', h('h3', 'Muscle balance'), h('span', list.length + (list.length === 1 ? ' thing' : ' things') + ' to fix')),
    h('div.alerts', items),
    !all && h('a.row', { href: '#muscles', style: { color: 'inherit', textDecoration: 'none' } }, h('div.main', h('b', 'All muscles'), h('small', more > 0 ? more + ' smaller notes, the body map and recovery' : 'Body map, sets per muscle and recovery')), h('span.value', ''), h('span.chev', icon('chevron'))));
}
/** A program exercise that keeps getting skipped: swap it, remove it, or (for main lifts) just a nudge. */
function skippedAlert(al, a, s) {
  const inA = s.prog.t3.A.includes(al.exId), inB = s.prog.t3.B.includes(al.exId);
  const own = inA || inB;
  const swap = own && bestExercise(a, al.muscle, { custom: s.custom, exclude: [al.exId, ...s.prog.t3.A, ...s.prog.t3.B] });
  const replace = (next) => change((x) => { for (const w of ['A', 'B']) x.prog.t3[w] = x.prog.t3[w].flatMap((id) => (id === al.exId ? (next ? [next] : []) : [id])); });
  return h('div.alert.sev' + al.severity,
    h('div.alert-head', icon(al.severity >= 3 ? 'warning' : 'info'), h('b', al.title)),
    h('p', own ? al.text : 'It is one of the main parts of the program. If something stops you (time, a sore spot, no bar free), tell the coach — it can adjust the plan around it.'),
    own && h('div.alert-actions',
      swap && h('button.btn.secondary', { type: 'button', onclick: () => { replace(swap.id); toast('Swapped for ' + swap.name); } }, icon('swap'), 'Swap: ' + swap.name),
      h('button.btn.ghost', { type: 'button', onclick: () => { replace(null); toast('Removed from the program'); } }, 'Remove')));
}

const accNames = (ids, s) =>ids.map((id) => accessory(id, s.custom)?.name).filter(Boolean).join(', ') || 'no accessories';

function ratiosBlock(a) {
  const r = a.ratios;
  const line = (title, v, good, sub) => v == null ? null : h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.main', h('b', title), h('small', sub)), h('span.value', h('span.chip.' + (v >= good ? 'up' : 'down'), num(v) + ' : 1')));
  return block('Balance between muscles', '',
    line('Pull : push (rows vs bench)', r.horizontal, 1, 'Aim for at least 1 : 1. Convention for shoulder health, not a tested rule.'),
    line('Pull : push (pull-ups vs press)', r.vertical, 1, 'Same idea, overhead.'),
    line('Hamstrings : quads', r.hamQuad, 0.6, 'Squats load the front of the thigh much more than the back.'));
}

/* ---------- One muscle ---------- */
function muscleSheet(id) {
  const s = get();
  const a = analyze(s);
  const m = a.by[id];
  const today = iso();
  const recent = s.sessions.filter((x) => daysBetween(x.date, today) < 28);
  const from = contributors(recent, id, s.custom);
  const ex = bestExercise(a, id, { custom: s.custom });
  const max = Math.max(1, ...m.trend, m.target[1]);
  const bars = h('div.weeks', m.trend.map((v, i) => h('div', { title: num(v) + ' sets' },
    h('i', { style: { height: Math.round((v / max) * 100) + '%', background: v < m.target[0] ? 'var(--op)' : 'var(--sq)' } }),
    h('small', i === m.trend.length - 1 ? 'now' : '−' + (m.trend.length - 1 - i)))));
  sheet((close) => h('div',
    h('h2', m.name),
    h('p.muted.lead', num(m.projected) + ' sets a week from the program · aim ' + m.target[0] + '–' + m.target[1] + '. ' + (m.last ? 'Last real work ' + dayLabel(m.last) + '.' : 'Not trained yet.')),
    h('div.stats', { style: { margin: '0 -16px', borderBottom: '1px solid var(--line)' } },
      h('div', h('b', num(m.week)), h('small', 'last 7 days')),
      h('div', h('b', num(m.perSession)), h('small', 'per workout')),
      h('div', h('b', Math.round(m.recovered * 100) + ' %'), h('small', 'recovered'))),
    h('p.small.muted', { style: { margin: '14px 0 6px', fontWeight: '600' } }, 'Sets per week, last 8 weeks'),
    bars,
    from.length > 0 && h('div', { style: { margin: '14px -16px 0' } },
      h('p.small.muted', { style: { margin: '0 16px 4px', fontWeight: '600' } }, 'Where the sets came from (4 weeks)'),
      from.map((c) => h('div.row', { style: { gridTemplateColumns: '1fr auto' } }, h('div.main', h('b', c.name), h('small', c.share === 1 ? 'main muscle' : 'helper, counts ½')), h('span.value', num(c.sets) + ' sets')))),
    ex && h('p.small', { style: { marginTop: '14px' } }, 'Best extra exercise right now: ', h('b', ex.name), '.'),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => {
        change((x) => { const f = new Set(x.prog.focus || []); if (f.has(id)) f.delete(id); else f.add(id); x.prog.focus = [...f]; });
        close(); toast(m.focus ? m.name + ' is no longer a focus' : m.name + ' is a focus: target +30 %');
      } }, m.focus ? 'Remove focus' : '★ Focus'),
      ex ? h('button.btn', { type: 'button', onclick: () => {
        change((x) => { x.prog.extra = [...(x.prog.extra || []).filter((e) => e.id !== ex.id), { id: ex.id, muscle: id, why: m.name }]; });
        close(); toast(ex.name + ' added to the next workout');
      } }, icon('plus'), 'Next time') : h('button.btn', { type: 'button', onclick: () => close() }, 'Close'))));
}

export { MUSCLES };
