import test from 'node:test';
import assert from 'node:assert/strict';
import { streak, badges, newBadges, tonnage } from '../src/badges.js';
import { newProgram } from '../src/program.js';

const ses = (date, items, extra = {}) => ({ date, items, ...extra });
const lift = (exId, w, reps = 5, n = 3) => ({ exId, kind: 't1', sets: Array.from({ length: n }, () => ({ w, reps, done: reps })) });

test('streak counts weeks with 2+ workouts; short home sessions count half', () => {
  const s = [
    ses('2026-10-05', [lift('sq', 60)]), ses('2026-10-07', [lift('bp', 50)]),
    ses('2026-10-12', [lift('sq', 62.5)]), ses('2026-10-14', [lift('bp', 52.5)]),
    ses('2026-10-19', [lift('sq', 65)]), ses('2026-10-21', [lift('bp', 55)], { place: 'home', kind: 'short' }),
    ses('2026-10-26', [lift('sq', 67.5)]), ses('2026-10-28', [lift('bp', 57.5)]),
  ];
  const r = streak(s, '2026-10-29');
  assert.equal(r.current, 1); // the week of the 19th had only 1.5
  assert.equal(r.best, 2);
  assert.equal(r.thisWeek, 2);
});

test('plate and pull-up badges, with progress for the ones not earned', () => {
  const state = { prog: newProgram({ start: { sq: 60, bp: 50, dl: 80, op: 35 } }), sessions: [
    ses('2026-10-05', [lift('bp', 60), lift('dl', 102.5), { exId: 'pu', kind: 'pu', sets: [{ w: 0, reps: 5, done: 6 }] }]),
  ], cardio: [], checkins: {} };
  const b = Object.fromEntries(badges(state, '2026-10-06').map((x) => [x.id, x]));
  assert.equal(b.bp60.earned, '2026-10-05');
  assert.equal(b.dl100.earned, '2026-10-05');
  assert.equal(b.pu5.earned, '2026-10-05');
  assert.equal(b.n1.earned, '2026-10-05');
  assert.equal(b.bp100.earned, null);
  assert.ok(Math.abs(b.bp100.progress - 0.6) < 0.01);
  assert.equal(b.pu10.earned, null);
});

test('new badges after a workout', () => {
  const st = { prog: null, sessions: [], cardio: [], checkins: {} };
  const before = badges(st, '2026-10-05');
  st.sessions.push(ses('2026-10-05', [lift('sq', 100)]));
  const after = badges(st, '2026-10-05');
  assert.deepEqual(newBadges(before, after).map((x) => x.id).sort(), ['n1', 'sq100']);
});

test('tonnage adds weight × reps of done sets', () => {
  assert.equal(tonnage([ses('2026-10-05', [lift('sq', 100, 5, 3)])]), 1500);
});
