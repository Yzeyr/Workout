import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, insights, vo2Band } from '../src/insights.js';
import { newProgram, planWorkout, startSession, iso } from '../src/program.js';

const base = () => ({ prog: newProgram({ start: { sq: 60, bp: 50, dl: 80, op: 35 }, today: '2026-10-01' }), sessions: [], custom: [], cardio: [], body: {}, profile: {}, checkins: {} });
const TODAY = '2026-11-02';

/** Health days ending `end`, value per metric from fn(i) where i = days back. */
function healthDays(end, n, fn) {
  const days = {};
  for (let i = 0; i < n; i++) { const d = new Date(end + 'T12:00'); d.setDate(d.getDate() - i); days[iso(d)] = fn(i); }
  return { days, workouts: [], profile: { birthDate: '1994-05-01', sex: 'male' } };
}

test('readiness: a good check-in on a rested day is high, a bad one is low', () => {
  const s = base();
  s.checkins[TODAY] = { sleep: 3, energy: 3, sore: 3 };
  const good = readiness(s, null, { today: TODAY });
  assert.ok(good.score >= 80, String(good.score));
  assert.equal(good.level, 'great');
  s.checkins[TODAY] = { sleep: 1, energy: 1, sore: 1 };
  const bad = readiness(s, null, { today: TODAY });
  assert.equal(bad.level, 'low');
  assert.ok(bad.reasons.some((r) => /slept badly/.test(r.text)));
  assert.match(bad.advice, /lighter day/);
});

test('readiness uses fresh Health data, ignores stale', () => {
  const s = base();
  const h = healthDays(TODAY, 40, (i) => ({ restingHr: i === 0 ? 62 : 54, hrvMs: i === 0 ? 40 : 60, sleepH: i === 0 ? 5.2 : 7.5 }));
  const r = readiness(s, h, { today: TODAY });
  assert.ok(r.sources.includes('Apple Health'));
  assert.ok(r.reasons.some((x) => /above your normal/.test(x.text)));
  assert.ok(r.reasons.some((x) => /HRV/.test(x.text)));
  assert.ok(r.reasons.some((x) => /5.2 h sleep/.test(x.text)));
  const stale = readiness(s, h, { today: '2026-11-20' });
  assert.ok(!stale.sources.includes('Apple Health'));
});

test('readiness notices muscles still recovering from yesterday', () => {
  const s = base();
  // Today's workout is A (squat + press). Do A yesterday evening.
  const ses = startSession(planWorkout(s.prog, 'A', { today: '2026-11-01' }), new Date('2026-11-01T18:00'));
  for (const it of ses.items) { for (const x of it.sets) x.done = x.reps; it.rating = 'ok'; }
  ses.end = new Date('2026-11-01T19:00').toISOString();
  s.sessions = [ses];
  const r = readiness(s, null, { today: TODAY, now: new Date(TODAY + 'T08:00') });
  assert.ok(r.reasons.some((x) => /recover/.test(x.text)), JSON.stringify(r.reasons));
});

test('insights: short sleep, pulse up, low steps, and a doctor alert for very high pulse', () => {
  const s = base();
  const h = healthDays(TODAY, 40, (i) => ({ sleepH: 6.1, restingHr: i < 7 ? 63 : 56, steps: 4200 }));
  const list = insights(s, h, { today: TODAY });
  const ids = list.map((x) => x.id);
  assert.ok(ids.includes('sleep') && list.find((x) => x.id === 'sleep').level === 'warn');
  assert.ok(ids.includes('rhr-up'));
  assert.equal(list.find((x) => x.id === 'steps').level, 'warn');
  const h2 = healthDays(TODAY, 20, () => ({ restingHr: 104 }));
  const l2 = insights(s, h2, { today: TODAY });
  assert.equal(l2[0].level, 'alert');
  assert.match(l2[0].text, /doctor/);
});

test('insights: weight loss while lifting, protein target from bodyweight', () => {
  const s = base();
  s.body.weight = [{ date: '2026-10-05', value: 86 }, { date: '2026-10-19', value: 84.5 }, { date: '2026-11-01', value: 83 }];
  const list = insights(s, null, { today: TODAY });
  assert.ok(list.some((x) => x.id === 'weight-down'));
  const p = list.find((x) => x.id === 'protein');
  assert.match(p.title, /133 g/);
});

test('insights: cardio minutes from the app log, and stale health data is flagged', () => {
  const s = base();
  s.cardio = [{ date: '2026-11-01', type: 'run', min: 40 }, { date: '2026-10-30', type: 'bike', min: 120 }];
  const h = healthDays('2026-10-01', 10, () => ({ steps: 9000 }));
  const list = insights(s, h, { today: TODAY });
  assert.equal(list.find((x) => x.id === 'cardio').level, 'good');
  assert.ok(list.some((x) => x.id === 'stale'));
});

test('VO2 max bands by age and sex', () => {
  assert.equal(vo2Band(52, 32, 'male'), 'high');
  assert.equal(vo2Band(40, 32, 'male'), 'fair');
  assert.equal(vo2Band(30, 32, 'male'), 'low');
  assert.equal(vo2Band(36, 32, 'female'), 'good');
});
