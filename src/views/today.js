/* Readiness card (Train), insights (Body), badges and streak (Train/History). */

import { h, icon, sheet, block, toast } from '../dom.js';
import { get, change } from '../state.js';
import { readiness, insights, CHECKIN } from '../insights.js';
import { badges, streak, tonnage } from '../badges.js';
import { iso } from '../program.js';
import { health } from './body.js';
import { num, dayLabel } from '../util.js';

const LEVEL = {
  great: { text: 'Great', colour: 'var(--sq)' },
  good: { text: 'Good', colour: 'var(--bp)' },
  ok: { text: 'OK', colour: 'var(--dl)' },
  low: { text: 'Low', colour: 'var(--op)' },
};

/** A ring that fills to the score, coloured by level. */
export function ring(score, colour, size = 64, label = String(score)) {
  const r = 26, c = 2 * Math.PI * r;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ring');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="32" cy="32" r="' + r + '" class="track"/>'
    + '<circle cx="32" cy="32" r="' + r + '" class="fill" style="stroke:' + colour + '" stroke-dasharray="' + (c * score / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/>'
    + '<text x="32" y="38" text-anchor="middle">' + label + '</text>';
  return s;
}

let openCheckin = false;

/** Today's readiness, with the 3-tap check-in. gym: show the "lighter today" option. */
export function readinessCard({ gym = true } = {}) {
  const s = get(), today = iso();
  const r = readiness(s, health(), { today });
  const L = LEVEL[r.level];
  const st = streak(s.sessions || [], today);
  const c = s.checkins?.[today] || {};
  const complete = ['sleep', 'energy', 'sore'].every((k) => c[k]);
  const setCheck = (k, v) => { if (['sleep', 'energy', 'sore'].filter((x) => x !== k).every((x) => c[x])) openCheckin = false; return change((x) => { x.checkins = { ...(x.checkins || {}), [today]: { ...(x.checkins?.[today] || {}), [k]: v } }; }); };
  return h('section.today', { style: { '--c': L.colour } },
    h('div.today-top',
      ring(r.score, L.colour, 68),
      h('div.today-text',
        h('div.kicker', 'Readiness today'),
        h('b', L.text),
        h('small', r.reasons.slice(0, 2).map((x) => x.text).join(' · ') || (r.checkedIn ? 'No signals yet.' : 'Check in below for a better read.'))),
      h('button.streak', { type: 'button', 'aria-label': st.current + ' week streak', onclick: () => streakSheet(st) },
        icon('flame'), h('b', String(st.current)), h('small', 'wk'))),
    complete && !openCheckin ? h('button.textbtn', { type: 'button', style: { marginTop: '6px' }, onclick: () => { openCheckin = true; change(() => {}); } }, icon('check'), 'Checked in: ' + [['bad sleep', 'OK sleep', 'good sleep'][c.sleep - 1], ['low energy', 'OK energy', 'high energy'][c.energy - 1], ['very sore', 'a bit sore', 'not sore'][c.sore - 1]].join(' · '))
    : h('div.checkin', Object.entries(CHECKIN).map(([k, def]) => h('div.ci',
      h('span', def.label),
      h('div.seg.mini', def.options.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(c[k] === v), onclick: () => setCheck(k, v) }, t)))))),
    h('p.today-advice', r.advice),
    gym && r.level === 'low' && !s.prog?.deload && h('button.btn.secondary.wide', { type: 'button', onclick: () => {
      change((x) => { x.prog = { ...x.prog, deload: { left: 1 } }; });
      toast('Next workout is a lighter one: 90 %, half the sets');
    } }, 'Make today lighter'));
}

function streakSheet(st) {
  sheet((close) => h('div',
    h('h2', st.current + '-week streak'),
    h('p.muted.lead', 'Weeks in a row with at least 2 workouts. A short home session counts as half.'),
    h('div.stats', { style: { margin: '0 -16px', border: 'none' } },
      h('div', h('b', String(st.current)), h('small', 'now')),
      h('div', h('b', String(st.best)), h('small', 'best')),
      h('div', h('b', num(st.thisWeek)), h('small', 'this week'))),
    h('p', { style: { marginTop: '14px' } }, st.thisWeek >= st.per ? 'This week counts. Nice.' : 'One more workout this week' + (st.thisWeek ? '' : ' (two in total)') + ' keeps it going.'),
    h('div.btnrow', h('button.btn', { type: 'button', onclick: () => close() }, 'OK'))));
}

/* ---------- Insights ---------- */
const LV = { alert: { cls: 'alert', icon: 'warning', name: 'See a doctor' }, warn: { cls: 'warn', icon: 'warning', name: 'Needs attention' }, info: { cls: 'info', icon: 'info', name: 'Tip' }, good: { cls: 'good', icon: 'check', name: 'Good' } };
const AREA = { sleep: 'moon', heart: 'heart', recovery: 'heart', activity: 'run', body: 'body', training: 'train', data: 'info' };

export function insightsBlock() {
  const s = get();
  const list = insights(s, health(), { today: iso() });
  if (!list.length) return null;
  return block('Insights', list.filter((x) => x.level === 'alert' || x.level === 'warn').length + ' to look at',
    h('div.insights', list.map((x) => h('button.insight.' + LV[x.level].cls, { type: 'button', onclick: () => insightSheet(x) },
      h('span.ins-icon', icon(AREA[x.area] || 'info')),
      h('span.ins-text', h('b', x.title), h('small', LV[x.level].name)),
      x.value != null && h('span.ins-value', String(x.value))))),
    h('p.note', { style: { paddingTop: '4px' } }, 'Worked out on this phone from your data. Not medical advice.'));
}

function insightSheet(x) {
  sheet((close) => h('div',
    h('h2', x.title),
    h('p', { style: { marginBottom: '12px' } }, x.text),
    h('p.small.muted', 'This is general guidance from rules, not a diagnosis. Ask the coach for advice that weighs everything together.'),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => { close(); location.hash = '#coach'; } }, icon('coach'), 'Ask coach'),
      h('button.btn', { type: 'button', onclick: () => close() }, 'OK'))));
}

/* ---------- Badges ---------- */
export function badgesBlock() {
  const s = get(), today = iso();
  const list = badges(s, today);
  const earned = list.filter((b) => b.earned);
  // The next few to chase: highest progress first
  const next = list.filter((b) => !b.earned).sort((a, b) => b.progress - a.progress).slice(0, 6);
  return block('Badges', earned.length + ' of ' + list.length,
    h('div.badges', [...earned.slice().reverse(), ...next].map((b) => h('button.badge' + (b.earned ? '.got' : ''), {
      type: 'button', style: { '--c': 'var(--' + b.colour + ')' }, 'aria-label': b.name + (b.earned ? ', earned' : ', ' + Math.round(b.progress * 100) + ' %'),
      onclick: () => sheet((close) => h('div', h('h2', b.name), h('p.lead', b.desc), h('p.muted', b.earned ? 'Earned ' + dayLabel(b.earned, { year: true }) + '.' : Math.round(b.progress * 100) + ' % of the way.'), h('div.btnrow', h('button.btn', { type: 'button', onclick: () => close() }, 'OK')))),
    }, h('span.medal', icon(b.icon), !b.earned && h('i', { style: { height: Math.round(b.progress * 100) + '%' } })), h('small', b.name)))),
    h('p.note', { style: { paddingTop: '6px' } }, num(tonnage(s.sessions || []) / 1000) + ' tonnes lifted so far.'));
}
