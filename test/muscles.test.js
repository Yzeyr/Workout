import test from 'node:test';
import assert from 'node:assert/strict';
import { newProgram, planWorkout, startSession, applySession, iso } from '../src/program.js';
import { analyze, sessionSets, bestExercise, balanceExtras, frequency, fatigue, recovered, contributors } from '../src/muscles.js';
import { ACCESSORIES } from '../src/data/exercises.js';
import { WORKS, MUSCLES } from '../src/data/muscles.js';

const start = { sq: 60, bp: 50, dl: 80, op: 35 };

/** Runs n workouts, `perWeek` a week. skip: exercise ids left undone. */
function simulate(n, perWeek = 3, { skip = [], t3 = null } = {}) {
  let prog = newProgram({ start, pullupMax: 4, today: '2026-11-01' });
  if (t3) prog.t3 = t3;
  const sessions = [];
  const d0 = new Date('2026-11-02T12:00');
  for (let i = 0; i < n; i++) {
    const d = new Date(d0); d.setDate(d.getDate() + Math.round(i * 7 / perWeek));
    const date = iso(d);
    const s = startSession(planWorkout(prog, prog.next, { today: date }), new Date(date + 'T17:00'));
    for (const it of s.items) {
      if (skip.includes(it.exId)) continue;
      for (const x of it.sets) x.done = x.reps;
      it.rating = 'ok';
    }
    s.end = new Date(date + 'T18:15').toISOString();
    sessions.push(s);
    prog = applySession(prog, s).prog;
  }
  return { prog, sessions, today: sessions[sessions.length - 1].date };
}

test('every accessory and main lift is mapped to muscles that exist', () => {
  const ids = new Set(MUSCLES.map((m) => m.id));
  for (const a of ACCESSORIES) assert.ok(WORKS[a.id], a.id + ' has no muscle map');
  for (const [ex, w] of Object.entries(WORKS)) for (const m of Object.keys(w)) assert.ok(ids.has(m), ex + ' → ' + m);
});

test('sets count 1 for the main muscle and 0.5 for helpers; undone sets do not count', () => {
  const ses = { items: [{ exId: 'bp', sets: [{ done: 5 }, { done: 5 }, { done: null }] }] };
  const s = sessionSets(ses);
  assert.equal(s.chest, 2);
  assert.equal(s.triceps, 1);
  assert.equal(s.quads, 0);
});

test('the default program is balanced at 2–3 workouts a week', () => {
  for (const f of [2, 3]) {
    const { prog, sessions, today } = simulate(8, f);
    const a = analyze({ prog, sessions, custom: [], cardio: [] }, { today });
    const serious = a.alerts.filter((x) => x.severity >= 2);
    assert.deepEqual(serious.map((x) => x.title), [], f + '/week');
  }
});

test('frequency counts only the weeks the program has run', () => {
  const { sessions, today } = simulate(6, 3);
  assert.ok(Math.abs(frequency(sessions, today) - 3) < 0.6, String(frequency(sessions, today)));
  assert.equal(frequency([], '2026-11-01'), 2);
});

test('skipping back work three workouts in a row raises a warning', () => {
  const { prog, sessions, today } = simulate(6, 3, { skip: ['pu', 'row-db', 'facepull', 'dl'] });
  const a = analyze({ prog, sessions, custom: [], cardio: [] }, { today });
  // The skipped program exercises are named first…
  const pu = a.alerts.find((x) => x.kind === 'skipped' && x.exId === 'pu');
  assert.ok(pu, a.alerts.map((x) => x.title).join(' / '));
  assert.equal(pu.severity, 3);
  assert.match(pu.title, /Pull-ups skipped in your last 6 workouts/);
  // …and the muscle warning says why
  const lats = a.alerts.find((x) => x.muscle === 'lats' && x.kind === 'neglect');
  assert.ok(lats);
  assert.match(lats.text, /skipped: Pull-ups/);
  // A fix must mainly train the muscle (not a grip exercise that only helps)
  const ex = bestExercise(a, 'lats');
  assert.equal(ex.works.lats, 1, ex.id);
});

test('too much pressing for the pulling flags the ratio', () => {
  const { prog, sessions, today } = simulate(6, 3, { skip: ['pu', 'row-db', 'facepull'], t3: { A: ['dips', 'inc-db'], B: ['pushup', 'db-fly'] } });
  const a = analyze({ prog, sessions, custom: [], cardio: [] }, { today });
  assert.ok(a.alerts.some((x) => x.id === 'ratio-push'));
});

test('before three workouts the plan stands in for the log', () => {
  const prog = newProgram({ start, today: '2026-11-01' });
  const a = analyze({ prog, sessions: [], custom: [], cardio: [] }, { today: '2026-11-01' });
  assert.equal(a.basis, 'plan');
  assert.ok(a.by.chest.projected > 0);
  assert.equal(a.alerts.filter((x) => x.kind === 'neglect').length, 0);
});

test('fatigue fades: squats yesterday, legs mostly back after three days', () => {
  const { sessions } = simulate(1, 3);
  const end = new Date(sessions[0].end);
  const later = (h) => fatigue(sessions, [], new Date(end.getTime() + h * 3600000));
  assert.ok(recovered(later(2).quads) < recovered(later(72).quads));
  assert.ok(recovered(later(72).quads) > 0.7);
  const run = fatigue([], [{ date: sessions[0].date, type: 'run', min: 60 }], new Date(sessions[0].date + 'T20:00'));
  assert.ok(run.calves > 2);
  assert.equal(run.chest, 0);
});

test('balance extras pick one exercise per gap and avoid the plan', () => {
  const { prog, sessions, today } = simulate(6, 3, { skip: ['pu', 'row-db', 'facepull', 'dl'] });
  const a = analyze({ prog, sessions, custom: [], cardio: [] }, { today });
  const plan = planWorkout(prog, prog.next, { today });
  const extras = balanceExtras(a, plan);
  assert.ok(extras.length >= 1 && extras.length <= 2);
  for (const x of extras) assert.ok(!plan.items.some((i) => i.exId === x.id));
  // An extra shows up in the next plan and is used up after the workout
  prog.extra = extras;
  const p2 = planWorkout(prog, prog.next, { today });
  assert.ok(p2.items.some((i) => i.extra && i.exId === extras[0].id));
});

test('own exercises use their muscles, or a guess from the body part', () => {
  const custom = [{ id: 'own-1', name: 'Cable row', group: 'back', kind: 'weight', range: [8, 12] }];
  const s = sessionSets({ items: [{ exId: 'own-1', sets: [{ done: 10 }] }] }, custom);
  assert.equal(s.upperBack, 1);
  const c2 = [{ id: 'own-2', name: 'Sled push', group: 'legs', works: { quads: 1, calves: 1 } }];
  assert.equal(sessionSets({ items: [{ exId: 'own-2', sets: [{ done: 1 }] }] }, c2).calves, 1);
});

test('contributors list where a muscle got its sets', () => {
  const { sessions } = simulate(4, 3);
  const c = contributors(sessions, 'lats');
  assert.equal(c[0].name, 'Pull-ups');
});

test('a lift replaced by something else: muscles count, the lift is noted, not nagged as missing', async () => {
  const { planWorkout: pw, startSession: ss, applySession: ap, newProgram: np } = await import('../src/program.js');
  let prog = np({ start: { sq: 60, bp: 50, dl: 80, op: 35 }, today: '2026-11-01' });
  const sessions = [];
  for (const d of ['2026-11-02', '2026-11-06', '2026-11-10']) {
    const s = ss(pw(prog, 'A', { today: d }), new Date(d + 'T17:00'));
    for (const it of s.items) {
      if (it.exId === 'bp') { it.replacedBy = 'Dumbbell fly'; continue; }
      for (const x of it.sets) x.done = x.reps; it.rating = 'ok';
    }
    s.items.push({ kind: 't3', exId: 'db-fly', name: 'Dumbbell fly', instead: 'bp', sets: [{ w: 10, reps: 12, done: 12 }, { w: 10, reps: 12, done: 12 }, { w: 10, reps: 12, done: 12 }] });
    s.end = new Date(d + 'T18:00').toISOString();
    sessions.push(s);
    const before = prog.lifts.bp.w;
    prog = ap(prog, s).prog;
    assert.equal(prog.lifts.bp.w, before, 'bench keeps its weight');
  }
  const a = analyze({ prog, sessions, custom: [], cardio: [] }, { today: '2026-11-10' });
  assert.ok(a.by.chest.week >= 3, 'flyes count for the chest');
  const r = a.alerts.find((x) => x.kind === 'replaced' && x.exId === 'bp');
  assert.ok(r, a.alerts.map((x) => x.title).join(' / '));
  assert.match(r.text, /dumbbell fly/);
  assert.ok(!a.alerts.some((x) => x.kind === 'skipped' && x.exId === 'bp'));
});

test('an own workout logged afterwards leaves the rotation alone', async () => {
  const { startSession: ss, applySession: ap, newProgram: np, planT1 } = await import('../src/program.js');
  const prog = np({ start: { sq: 60, bp: 50, dl: 80, op: 35 }, today: '2026-11-01' });
  const s = ss({ wid: 'F', place: 'gym', kind: 'free', items: [planT1(prog, 'bp', '2026-11-02', false)] }, new Date('2026-11-02T17:00'));
  for (const x of s.items[0].sets) x.done = x.reps;
  s.items[0].rating = 'ok';
  const r = ap(prog, s).prog;
  assert.equal(r.next, prog.next);
  assert.ok(r.lifts.bp.w > prog.lifts.bp.w, 'a bench done in an own workout still progresses');
  // Logged for an older date: "last done" does not move backwards
  const later = { ...r, lifts: { ...r.lifts, bp: { ...r.lifts.bp, last: '2026-11-05' } } };
  const old = ss({ wid: 'F', place: 'gym', kind: 'free', items: [planT1(later, 'bp', '2026-11-03', false)] }, new Date('2026-11-03T17:00'));
  for (const x of old.items[0].sets) x.done = x.reps;
  assert.equal(ap(later, old).prog.lifts.bp.last, '2026-11-05');
});
