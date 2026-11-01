import test from 'node:test';
import assert from 'node:assert/strict';
import { newProgram, planWorkout, startSession, applySession } from '../src/program.js';
import { chooseSession, planToday, options, scoreLift } from '../src/planner.js';
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
