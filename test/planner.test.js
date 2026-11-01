import test from 'node:test';
import assert from 'node:assert/strict';
import { newProgram, planWorkout, startSession, applySession } from '../src/program.js';
import { chooseSession, planToday, options, scoreLift } from '../src/planner.js';
import { iso } from '../src/program.js';
import { analyze } from '../src/muscles.js';

function setup() {
  return { prog: newProgram({ start: { sq: 60, bp: 50, dl: 80, op: 35 }, pullupMax: 5, today: '2026-11-01' }), sessions: [], custom: [], cardio: [], checkins: {} };
}
function train(st, date, wid, upper) {
  const s = startSession(planWorkout(st.prog, wid, { today: date, upper }), new Date(date + 'T17:00'));
  for (const it of s.items) { for (const x of it.sets) x.done = x.reps; it.rating = 'ok'; }
  s.end = new Date(date + 'T18:00').toISOString();
  st.sessions.push(s);
  st.prog = applySession(st.prog, s).prog;
}
const at = (d, h = '09') => ({ today: d, now: new Date(d + 'T' + h + ':00') });

test('first workout: squat and bench (the lifts that come up most)', () => {
  const c = chooseSession(setup(), at('2026-11-02'));
  assert.equal(c.lower, 'sq');
  assert.equal(c.upper, 'bp');
});

test('after squat + bench, the next workout is deadlift + press', () => {
  const st = setup();
  train(st, '2026-11-02', 'A', 'bp');
  const c = chooseSession(st, at('2026-11-04'));
  assert.equal(c.lower, 'dl');
  assert.equal(c.upper, 'op');
});

test('a press yesterday makes bench less ready than after a few days', () => {
  const a = setup(); train(a, '2026-11-02', 'B', 'op');
  const b = setup(); train(b, '2026-11-02', 'B', 'op');
  const tired = scoreLift(a, analyze(a, at('2026-11-03')), 'bp', '2026-11-03');
  const fresh = scoreLift(b, analyze(b, at('2026-11-06')), 'bp', '2026-11-06');
  assert.ok(tired.rec < fresh.rec - 0.2, tired.rec + ' vs ' + fresh.rec);
  const c = chooseSession(a, at('2026-11-03'));
  assert.ok(c.reasons.some((r) => /still recovering/.test(r)), c.reasons.join(' | '));
});

test('the planned workout never has bench and press together', () => {
  const st = setup();
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11']) {
    const plan = planToday(st, at(d));
    const ids = plan.items.map((i) => i.exId);
    assert.ok(!(ids.includes('bp') && ids.includes('op')), d + ': ' + ids.join(','));
    train(st, d, plan.wid, plan.upper);
  }
  // Over two weeks every lift came up, squat and bench most often
  const heavy = (id) => st.sessions.filter((s) => s.items.some((i) => i.kind === 't1' && i.exId === id)).length;
  assert.ok(heavy('sq') >= 2 && heavy('bp') >= 2 && heavy('dl') >= 1 && heavy('op') >= 1);
});

test('your own pick holds for today and is gone after the workout', () => {
  const st = setup();
  st.prog.pick = { date: '2026-11-02', lower: 'dl', upper: 'bp' };
  const c = chooseSession(st, at('2026-11-02'));
  assert.equal(c.manual, true);
  assert.equal(c.lower, 'dl');
  assert.equal(c.upper, 'bp');
  assert.equal(chooseSession(st, at('2026-11-03')).manual, false);
  train(st, '2026-11-02', 'B', 'bp');
  assert.equal(st.prog.pick, null);
});

test('options list all four combinations, the suggestion first', () => {
  const list = options(setup(), at('2026-11-02'));
  assert.equal(list.length, 4);
  assert.ok(list[0].best);
  assert.equal(list[0].lower + list[0].upper, 'sqbp');
});

import { buildAccessories, estimateMinutes } from '../src/planner.js';

function runWeeks(st, days) {
  for (const d of days) {
    const plan = planToday(st, at(d));
    const s = startSession(plan, new Date(d + 'T17:00'));
    for (const it of s.items) { for (const x of it.sets) x.done = x.reps; it.rating = 'ok'; }
    s.end = new Date(d + 'T18:00').toISOString();
    st.sessions.push(s);
    st.prog = applySession(st.prog, s).prog;
  }
}

test('more time gives more accessories; 45 min drops the light squat', () => {
  const st = setup();
  const n = (m) => { st.settings = { sessionMin: m }; return planToday(st, at('2026-11-02')).items.filter((i) => i.kind === 't3').length; };
  assert.ok(n(45) <= n(60) && n(60) < n(75), [n(45), n(60), n(75)].join(','));
  st.settings = { sessionMin: 45 };
  st.prog.pick = { date: '2026-11-02', lower: 'dl', upper: 'op' };
  assert.ok(!planToday(st, at('2026-11-02')).items.some((i) => i.kind === 't2'));
  st.settings = { sessionMin: 60 };
  assert.ok(planToday(st, at('2026-11-02')).items.some((i) => i.kind === 't2'));
});

test('accessories go to what lags, each with a reason', () => {
  const st = setup();
  const b = buildAccessories(st, { lower: 'sq', upper: 'bp', wid: 'A', today: '2026-11-02', minutes: 75 });
  assert.ok(b.ids.length >= 2);
  // The default plan leaves hamstrings and calves short: the first picks fix that
  assert.ok(b.ids.some((id) => ['rdl', 'leg-curl', 'db-rdl', 'nordic'].includes(id)), b.ids.join(','));
  for (const id of b.ids) assert.match(b.why[id], /^For /);
});

test('no hinge accessory straight after heavy deadlifts', () => {
  const st = setup();
  const b = buildAccessories(st, { lower: 'dl', upper: 'op', wid: 'B', today: '2026-11-02', minutes: 75 });
  assert.ok(!b.ids.includes('rdl') && !b.ids.includes('db-rdl'), b.ids.join(','));
});

test('an exercise is kept going for weeks, then varied', () => {
  const st = setup();
  const days = [];
  for (let i = 0; i < 24; i++) { const d = new Date('2026-11-02T12:00'); d.setDate(d.getDate() + Math.round(i * 7 / 3)); days.push(iso(d)); }
  runWeeks(st, days);
  // Over 8 weeks the same accessory comes back (so it can progress), but not only one per muscle
  const used = new Map();
  for (const s of st.sessions) for (const it of s.items) if (it.kind === 't3') used.set(it.exId, (used.get(it.exId) || 0) + 1);
  assert.ok(Math.max(...used.values()) >= 4, JSON.stringify([...used]));
  assert.ok(used.size >= 4, JSON.stringify([...used]));
});

test('time estimate is in a sensible range', () => {
  const st = setup();
  const m = estimateMinutes(planToday(st, at('2026-11-02')).items);
  assert.ok(m >= 40 && m <= 80, String(m));
});
