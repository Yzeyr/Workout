import test from 'node:test';
import assert from 'node:assert/strict';
import { newProgram, planWorkout, startSession, applySession } from '../src/program.js';
import { planHome, sessionName } from '../src/home.js';
import { canDo, GEAR } from '../src/data/exercises.js';
import { sessionSets } from '../src/muscles.js';

const state = (gear = ['bar', 'db']) => ({
  prog: newProgram({ start: { sq: 60, bp: 50, dl: 80, op: 35 }, pullupMax: 5, today: '2026-11-01' }),
  sessions: [], custom: [], cardio: [], settings: { homeGear: gear },
});
const doAll = (s) => { for (const it of s.items) { for (const x of it.sets) x.done = x.reps; it.rating = 'ok'; } return s; };

test('full home workout covers every pattern with home gear only', () => {
  const st = state();
  const plan = planHome(st, 'full', { today: '2026-11-02' });
  assert.equal(plan.place, 'home');
  assert.deepEqual(plan.items.map((i) => i.slot), ['Pull', 'Squat', 'Push', 'Hinge', 'Row', 'Press', 'Core']);
  for (const it of plan.items) assert.ok(canDo(it.exId, ['bar', 'db']), it.exId + ' needs ' + GEAR[it.exId]);
  assert.ok(!plan.items.some((i) => i.kind === 't1' || i.kind === 't2'));
});

test('without gear, only bodyweight exercises and no pull-ups', () => {
  const plan = planHome(state([]), 'full', { today: '2026-11-02' });
  assert.ok(plan.items.length >= 3);
  assert.ok(!plan.items.some((i) => i.exId === 'pu'));
  for (const it of plan.items) assert.equal(GEAR[it.exId], 'none', it.exId);
});

test('a home workout leaves the gym rotation and barbell weights alone', () => {
  const st = state();
  const before = structuredClone(st.prog);
  const s = doAll(startSession(planHome(st, 'full', { today: '2026-11-02' }), new Date('2026-11-02T17:00')));
  const { prog } = applySession(st.prog, s);
  assert.equal(prog.next, before.next);
  for (const id of ['sq', 'bp', 'dl', 'op']) assert.equal(prog.lifts[id].w, before.lifts[id].w);
  assert.ok(prog.pu.total > before.pu.total, 'pull-ups on the bar at home still progress');
  assert.equal(sessionName(s), 'Home workout');
});

test('one-off balance extras wait for the gym', () => {
  const st = state();
  st.prog.extra = [{ id: 'lateral' }];
  const s = doAll(startSession(planHome(st, 'short', { today: '2026-11-02' }), new Date('2026-11-02T17:00')));
  const { prog } = applySession(st.prog, s);
  assert.deepEqual(prog.extra, [{ id: 'lateral' }]);
});

test('short session: three exercises of two sets, no very sore ones, easy pull-up practice', () => {
  const plan = planHome(state(), 'short', { today: '2026-11-02' });
  const work = plan.items.filter((i) => i.kind !== 'gtg');
  assert.equal(work.length, 3);
  for (const it of work) assert.equal(it.sets.length, 2);
  assert.ok(!plan.items.some((i) => i.exId === 'nordic'));
  const gtg = plan.items.find((i) => i.kind === 'gtg');
  assert.equal(gtg.sets[0].reps, 3); // half of max 5, rounded
  // Practice sets don't count as hard sets, and don't move pull-up targets
  const s = doAll(startSession(plan, new Date('2026-11-02T17:00')));
  assert.equal(sessionSets({ items: [s.items.find((i) => i.kind === 'gtg')] }).lats, 0);
  const st = state();
  const { prog } = applySession(st.prog, s);
  assert.equal(prog.pu.total, st.prog.pu.total);
});

test('short session skips muscles that are still tired', () => {
  const st = state();
  // A gym day just now: legs and chest tired
  const gym = doAll(startSession(planWorkout(st.prog, 'A', { today: '2026-11-02' }), new Date('2026-11-02T17:00')));
  gym.end = new Date('2026-11-02T18:00').toISOString();
  st.sessions = [gym];
  const plan = planHome(st, 'short', { today: '2026-11-02', now: new Date('2026-11-02T20:00') });
  for (const it of plan.items.filter((i) => i.kind !== 'gtg')) assert.ok(!['goblet', 'split', 'db-rdl', 'rdl'].includes(it.exId), it.exId);
});
