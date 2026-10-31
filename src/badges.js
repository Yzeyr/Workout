/* Streaks and badges. Worked out from the log every time, never stored, so
   they can't get out of step with what actually happened. */

import { MAIN } from './data/exercises.js';
import { iso, daysBetween, outcome } from './program.js';

const monday = (isoDate) => { const d = new Date(isoDate + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };

/** Weeks in a row (Mon–Sun) with at least `per` workouts. A short home session counts as half. */
export function streak(sessions, today = iso(), per = 2) {
  const weeks = new Map();
  for (const s of sessions) {
    if (!s.items?.some((it) => outcome(it) !== 'skip')) continue;
    const w = monday(s.date);
    weeks.set(w, (weeks.get(w) || 0) + (s.place === 'home' && s.kind === 'short' ? 0.5 : 1));
  }
  const thisWeek = monday(today);
  const count = (w) => weeks.get(w) || 0;
  // This week still counts while it is going on, if it already has enough
  let cur = 0;
  let w = count(thisWeek) >= per ? thisWeek : (() => { const d = new Date(thisWeek + 'T12:00'); d.setDate(d.getDate() - 7); return iso(d); })();
  while (count(w) >= per) { cur++; const d = new Date(w + 'T12:00'); d.setDate(d.getDate() - 7); w = iso(d); }
  let best = 0, run = 0;
  const all = [...weeks.keys()].sort();
  if (all.length) {
    for (let d = new Date(all[0] + 'T12:00'); iso(d) <= thisWeek; d.setDate(d.getDate() + 7)) {
      run = count(iso(d)) >= per ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return { current: cur, best: Math.max(best, cur), thisWeek: count(thisWeek), per };
}

/** Total kilos lifted (weight × reps of every done set). */
export function tonnage(sessions) {
  let kg = 0;
  for (const s of sessions) for (const it of s.items || []) for (const x of it.sets) if (x.done > 0 && x.w > 0) kg += x.w * x.done;
  return Math.round(kg);
}

/** The heaviest weight done for full reps on each main lift, with the date. */
function bestLifts(sessions) {
  const best = {};
  for (const s of sessions) for (const it of s.items || []) {
    if (!MAIN[it.exId] || it.kind === 't3') continue;
    for (const x of it.sets) if (x.done >= 1 && x.w > (best[it.exId]?.w || 0)) best[it.exId] = { w: x.w, date: s.date };
  }
  return best;
}

/** Every badge, earned or not: { id, name, desc, icon, colour, earned: date|null, progress 0–1 }. */
export function badges(state, today = iso()) {
  const sessions = state.sessions || [];
  const out = [];
  const add = (id, name, desc, icon, colour, earned, progress) => out.push({ id, name, desc, icon, colour, earned: earned || null, progress: earned ? 1 : Math.max(0, Math.min(0.99, progress || 0)) });
  const done = sessions.filter((s) => s.items?.some((it) => outcome(it) !== 'skip'));

  // Workouts
  for (const n of [1, 10, 25, 50, 100, 200]) add('n' + n, n === 1 ? 'First workout' : n + ' workouts', n === 1 ? 'You started.' : n + ' workouts logged.', 'train', 'acc', done[n - 1]?.date, done.length / n);

  // Plate milestones (20 kg plates per side on a 20 kg bar: 60, 100, 140, 180)
  const best = bestLifts(sessions);
  const plates = { bp: [60, 100], sq: [100, 140], dl: [100, 140, 180], op: [60] };
  for (const [id, list] of Object.entries(plates)) for (const kg of list) {
    const b = best[id];
    const p = (kg - 20) / 40;
    add(id + kg, MAIN[id].short + ' ' + kg, p + (p === 1 ? ' plate' : ' plates') + ' a side on the ' + MAIN[id].short.toLowerCase() + '.', 'train', MAIN[id].colour, b && b.w >= kg ? b.date : null, b ? b.w / kg : 0);
  }

  // Pull-ups
  const puTests = [];
  for (const s of sessions) for (const it of s.items || []) if (it.kind === 'pu') for (const x of it.sets) if (x.done != null) puTests.push({ reps: x.done, date: s.date });
  for (const n of [1, 5, 10, 15, 20]) {
    const hit = puTests.find((t) => t.reps >= n);
    const max = Math.max(0, ...puTests.map((t) => t.reps), state.prog?.pu?.max || 0);
    add('pu' + n, n === 1 ? 'First pull-up' : n + ' pull-ups', n === 1 ? 'One clean rep.' : n + ' in one set.', 'body', 'pu', hit?.date, max / n);
  }

  // Two-year goals
  if (state.prog) for (const id of Object.keys(MAIN)) {
    const goal = state.prog.goals[id];
    const b = best[id];
    add('goal-' + id, MAIN[id].short + ' goal', 'Lift ' + goal + ' kg — your two-year goal.', 'flame', 'gold', b && b.w >= goal ? b.date : null, b ? b.w / goal : 0);
  }

  // Streaks
  const st = streak(sessions, today);
  for (const n of [4, 12, 26]) add('streak' + n, n + '-week streak', n + ' weeks in a row with 2+ workouts.', 'flame', 'op', st.best >= n ? today : null, st.best / n);

  // Tonnage
  const t = tonnage(sessions);
  for (const kg of [10000, 50000, 100000, 250000]) add('t' + kg, (kg / 1000) + ' tonnes', 'Lifted ' + (kg / 1000) + ' tonnes in total.', 'train', 'dl', t >= kg ? today : null, t / kg);

  // Habits
  const cardio = state.cardio || [];
  add('cardio10', '10 cardio sessions', 'Ten runs, walks, rides, rows or swims logged.', 'run', 'sq', cardio.length >= 10 ? [...cardio].sort((a, b) => (a.date < b.date ? -1 : 1))[9].date : null, cardio.length / 10);
  const homeN = sessions.filter((s) => s.place === 'home').length;
  add('home5', 'Home hero', 'Five home sessions.', 'body', 'acc', homeN >= 5 ? sessions.filter((s) => s.place === 'home')[4].date : null, homeN / 5);
  const ci = Object.keys(state.checkins || {}).sort();
  let ciRun = 0, ciBest = 0;
  for (let i = 0; i < ci.length; i++) { ciRun = i && daysBetween(ci[i - 1], ci[i]) === 1 ? ciRun + 1 : 1; ciBest = Math.max(ciBest, ciRun); }
  add('checkin7', 'Know thyself', 'Checked in seven days in a row.', 'heart', 'op', ciBest >= 7 ? today : null, ciBest / 7);
  return out;
}

/** Badges earned in `after` but not in `before` (for a "new badge" moment). */
export function newBadges(before, after) {
  const had = new Set(before.filter((b) => b.earned).map((b) => b.id));
  return after.filter((b) => b.earned && !had.has(b.id));
}
