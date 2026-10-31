import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newProgram, planWorkout, startSession, applySession, outcome, loadable, e1rm, gapFactor,
  warmup, plates, deloadReason, startDeload, onPace, liftStatus,
} from '../src/program.js';

const start = { sq: 60, bp: 50, dl: 80, op: 35 };
const fresh = () => newProgram({ start, pullupMax: 4, today: '2026-11-01' });

/** Does every set of every item, at target, with a rating. */
function doAll(session, rating = 'ok', only = null) {
  for (const it of session.items) {
    if (only && !only.includes(it.key)) continue;
    for (const s of it.sets) s.done = s.reps;
    it.rating = rating;
  }
  return session;
}
function run(prog, date, fn = (s) => doAll(s)) {
  const plan = planWorkout(prog, prog.next, { today: date });
  const s = startSession(plan, new Date(date + 'T17:00:00'));
  fn(s);
  return applySession(prog, s);
}
const t1 = (prog, id) => prog.lifts[id];

test('loadable rounds to plates and never below the bar', () => {
  assert.equal(loadable(10), 20);
  assert.equal(loadable(61), 60);
  assert.equal(loadable(61.3), 62.5);
  assert.equal(loadable(61, 1), 61);
  assert.equal(plates(20), 'Empty bar');
  assert.equal(plates(62.5), '20 + 1.25 per side');
});

test('e1rm counts reps in reserve', () => {
  assert.equal(e1rm(100, 5), 116.7);
  assert.equal(e1rm(100, 5, 2), 123.3);
  assert.equal(e1rm(0, 5), 0);
});

test('workout A then B, alternating', () => {
  let p = fresh();
  const a = planWorkout(p);
  assert.equal(a.wid, 'A');
  assert.deepEqual(a.items.filter((i) => i.kind === 't1').map((i) => i.exId), ['sq', 'op']);
  assert.ok(a.items.some((i) => i.kind === 't2' && i.exId === 'bp'));
  assert.ok(a.items.some((i) => i.kind === 'pu'));
  p = run(p, '2026-11-02').prog;
  assert.equal(p.next, 'B');
  const b = planWorkout(p);
  assert.deepEqual(b.items.filter((i) => i.kind === 't1').map((i) => i.exId), ['bp', 'dl']);
});

test('a skipped session changes nothing and keeps the rotation', () => {
  const p = fresh();
  const r = run(p, '2026-11-02', (s) => s);
  assert.equal(r.prog.next, 'A');
  assert.equal(t1(r.prog, 'sq').w, 60);
});

test('ok adds one step, easy two, hard repeats', () => {
  let p = fresh();
  p = run(p, '2026-11-02', (s) => doAll(s, 'ok')).prog;
  assert.equal(t1(p, 'sq').w, 62.5);
  p = run(p, '2026-11-04', (s) => doAll(s, 'easy')).prog; // B: dl easy
  assert.equal(t1(p, 'dl').w, 90);
  p = run(p, '2026-11-06', (s) => doAll(s, 'hard')).prog; // A: squat hard
  assert.equal(t1(p, 'sq').w, 62.5);
});

test('press adds reps before weight when the bar cannot move 1.25 kg', () => {
  let p = fresh();
  p = run(p, '2026-11-02').prog;
  assert.equal(t1(p, 'op').w, 35);
  assert.equal(t1(p, 'op').reps, 6);
  const plan = planWorkout(p, 'A', { today: '2026-11-04' });
  assert.equal(plan.items.find((i) => i.exId === 'op').sets[0].reps, 6);
  p = run(p, '2026-11-04').prog; // B
  p = run(p, '2026-11-06').prog; // A → 7
  p = run(p, '2026-11-08').prog; // B
  p = run(p, '2026-11-10').prog; // A → 37.5 × 5
  assert.equal(t1(p, 'op').w, 37.5);
  assert.equal(t1(p, 'op').reps, 5);
});

test('failure ladder: repeat, 5×3, 6×2, then −10 %', () => {
  let p = fresh();
  const failSquat = (s) => { doAll(s); const it = s.items.find((i) => i.key === 't1-sq'); it.sets[it.sets.length - 1].done = it.sets[it.sets.length - 1].reps - 1; return s; };
  const days = ['2026-11-02', '2026-11-06', '2026-11-10', '2026-11-14'];
  // Only A days have squat as T1; B in between is done normally.
  p = run(p, days[0], failSquat).prog;
  assert.equal(t1(p, 'sq').w, 60); assert.equal(t1(p, 'sq').miss, 1);
  p = run(p, '2026-11-04').prog;
  p = run(p, days[1], failSquat).prog;
  assert.equal(t1(p, 'sq').stage, 1);
  assert.equal(planWorkout(p, 'A', { today: '2026-11-08' }).items[0].sets.length, 5);
  p = run(p, '2026-11-08').prog;
  p = run(p, days[2], failSquat).prog; // miss at 5×3 → repeat
  p = run(p, '2026-11-12').prog;
  p = run(p, days[3], failSquat).prog; // → 6×2
  assert.equal(t1(p, 'sq').stage, 2);
  p = run(p, '2026-11-16').prog;
  p = run(p, '2026-11-18', failSquat).prog;
  p = run(p, '2026-11-20').prog;
  p = run(p, '2026-11-22', failSquat).prog; // reset
  assert.equal(t1(p, 'sq').stage, 0);
  assert.equal(t1(p, 'sq').w, 55);
  assert.equal(t1(p, 'sq').resets.length, 1);
});

test('two resets within 8 weeks moves the lift to waves', () => {
  let p = fresh();
  p.lifts.sq.resets = ['2026-11-01'];
  p.lifts.sq.stage = 2; p.lifts.sq.miss = 1; p.lifts.sq.best = 80;
  const r = run(p, '2026-11-20', (s) => { doAll(s); s.items[0].sets[0].done = 1; return s; });
  assert.equal(t1(r.prog, 'sq').mode, 'wave');
  assert.equal(t1(r.prog, 'sq').tm, 72.5);
  const plan = planWorkout(r.prog, 'A', { today: '2026-11-24' });
  const sq = plan.items[0];
  assert.equal(sq.sets.length, 6);
  assert.ok(sq.sets[2].amrap);
  assert.equal(sq.sets[2].w, loadable(72.5 * 0.85));
});

test('wave: top set reps move the training max', () => {
  let p = fresh();
  Object.assign(p.lifts.sq, { mode: 'wave', tm: 100, wave: 2 });
  const r = run(p, '2026-11-02', (s) => { doAll(s); const it = s.items[0]; it.sets[2].done = 7; return s; });
  assert.equal(t1(r.prog, 'sq').tm, 110); // 6 extra reps → double step
  assert.equal(t1(r.prog, 'sq').wave, 0);
});

test('break table and climbing back with double steps', () => {
  assert.equal(gapFactor(5).f, 1);
  assert.equal(gapFactor(10).f, 1);
  assert.equal(gapFactor(16).f, 0.9);
  assert.equal(gapFactor(25).f, 0.85);
  assert.equal(gapFactor(40).f, 0.75);
  assert.equal(gapFactor(90).f, 0.6);
  let p = fresh();
  p = run(p, '2026-11-02').prog; // squat 60 → 62.5
  p = run(p, '2026-11-04').prog;
  const plan = planWorkout(p, 'A', { today: '2026-11-25' }); // 23 days since squat
  assert.equal(plan.items[0].sets[0].w, loadable(62.5 * 0.85));
  assert.match(plan.items[0].note, /15 %/);
  const r = run(p, '2026-11-25');
  assert.equal(t1(r.prog, 'sq').w, loadable(loadable(62.5 * 0.85) + 5)); // double step while climbing
});

test('T2 double progression 8 → 10 reps, then weight', () => {
  let p = fresh();
  const w0 = p.lifts.bp.t2.w;
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08', '2026-11-10']) p = run(p, d).prog;
  // Bench was T2 on the three A days: 8 → 9 → 10 → weight
  assert.equal(p.lifts.bp.t2.reps, 8);
  assert.equal(p.lifts.bp.t2.w, loadable(w0 + 2.5));
});

test('pull-ups: total grows, test day sets the max', () => {
  let p = fresh();
  const pu0 = p.pu.total;
  p = run(p, '2026-11-02').prog;
  assert.equal(p.pu.total, pu0 + 2);
  p = run(p, '2026-11-04').prog;
  const plan = planWorkout(p, p.next, { today: '2026-11-06' });
  const pu = plan.items.find((i) => i.kind === 'pu');
  assert.ok(pu.sets[0].test);
  const r = run(p, '2026-11-06', (s) => { doAll(s); s.items.find((i) => i.kind === 'pu').sets[0].done = 6; return s; });
  assert.equal(r.prog.pu.max, 6);
});

test('accessories: reps go up to the top of the range, then weight', () => {
  let p = fresh();
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08', '2026-11-10']) p = run(p, d).prog;
  // row-db is in A: 8 → 10 → 12 → 18 kg × 8
  assert.equal(p.acc['row-db'].w, 18);
  assert.equal(p.acc['row-db'].reps, 8);
});

test('deload: offered after hard sessions, runs two lighter sessions', () => {
  let p = fresh();
  const log = [];
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-06']) {
    const plan = planWorkout(p, p.next, { today: d });
    const s = doAll(startSession(plan, new Date(d + 'T17:00:00')), 'hard');
    log.push(s);
    p = applySession(p, s).prog;
  }
  assert.ok(deloadReason(p, log, '2026-11-06'));
  p = startDeload(p);
  const plan = planWorkout(p, p.next, { today: '2026-11-08' });
  assert.ok(plan.deload);
  assert.equal(plan.items[0].sets.length, 2);
  const before = structuredClone(p.lifts);
  p = run(p, '2026-11-08').prog;
  assert.equal(p.deload.left, 1);
  assert.equal(p.lifts.bp.w, before.bp.w); // no progression on a deload day
  p = run(p, '2026-11-10').prog;
  assert.equal(p.deload, null);
});

test('outcome: skip, done, fail', () => {
  const it = { sets: [{ reps: 5, done: null }, { reps: 5, done: null }], rating: null };
  assert.equal(outcome(it), 'skip');
  it.sets[0].done = 5; it.sets[1].done = 5;
  assert.equal(outcome(it), 'done');
  it.sets[1].done = 4;
  assert.equal(outcome(it), 'fail');
});

test('warm-up ramps without duplicates', () => {
  const w = warmup(100, 'sq');
  assert.deepEqual(w.map((s) => s.w), [20, 20, 40, 60, 80]);
  assert.ok(warmup(100, 'dl').every((s) => s.w > 20));
  assert.deepEqual(warmup(22.5, 'op'), []);
});

test('goal pace is fast early, slow late', () => {
  const half = onPace(100, 200, '2026-01-01', '2027-01-01');
  assert.ok(half > 150 && half < 180, String(half));
  assert.equal(onPace(100, 200, '2026-01-01', '2028-01-01'), 200);
  const p = fresh();
  const st = liftStatus(p, 'sq', '2026-11-01');
  assert.equal(st.status, 'on pace');
});
