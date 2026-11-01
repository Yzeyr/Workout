/* Muscle balance: how much each muscle gets, whether something is left out,
   how recovered each muscle is, and which exercise would fix a gap.

   Counting rules (docs/research.md):
   - A work set counts when it was done (done > 0). Warm-ups never count.
   - 1 set for a muscle the exercise mainly trains, 0.5 for a helper muscle.
   - "This week" is the last 7 days. "Your program gives" is the average per
     session over the last 6 sessions × how often you actually train (last 4
     weeks, at least 2 a week). That keeps a busy work week from flagging
     everything, while a muscle the program keeps missing is still caught.
   - Before 3 sessions are logged, the planned workouts A and B stand in.
   - Recovery: each set leaves fatigue that halves every 24 h (small muscles)
     or 32 h (large ones). Cardio adds a little leg fatigue. */

import { MUSCLES, MUSCLE, WORKS, CARDIO_FATIGUE, worksFor } from './data/muscles.js';
import { ACCESSORIES, accessory } from './data/exercises.js';
import { outcome, planWorkout, iso, daysBetween } from './program.js';

const HALF_LIFE_H = { large: 32, small: 24 };
const FULLY_TIRED = 6; // set-equivalents of fresh fatigue = 0 % recovered

const zero = () => Object.fromEntries(MUSCLES.map((m) => [m.id, 0]));
const add = (acc, works, n) => { for (const [m, f] of Object.entries(works)) if (m in acc) acc[m] += f * n; return acc; };
const round1 = (v) => Math.round(v * 10) / 10;

/** Hard sets per muscle in one session (or one plan). */
export function sessionSets(ses, custom = []) {
  const acc = zero();
  for (const it of ses.items || []) {
    if (it.kind === 'gtg') continue; // easy practice sets are not hard sets
    const n = it.sets.filter((s) => (s.done === undefined ? true : s.done != null && s.done > 0)).length;
    if (n) add(acc, worksFor(it.exId, custom), n);
  }
  return acc;
}

/** Which exercises gave a muscle its sets, in a list of sessions. */
export function contributors(sessions, muscleId, custom = []) {
  const by = new Map();
  for (const ses of sessions) for (const it of ses.items || []) {
    const f = worksFor(it.exId, custom)[muscleId];
    if (!f) continue;
    const n = it.sets.filter((s) => s.done != null && s.done > 0).length;
    if (!n) continue;
    const e = by.get(it.name) || { name: it.name, sets: 0, share: f };
    e.sets += n * f;
    by.set(it.name, e);
  }
  return [...by.values()].sort((a, b) => b.sets - a.sets).map((e) => ({ ...e, sets: round1(e.sets) }));
}

function within(sessions, today, days) {
  return sessions.filter((s) => { const d = daysBetween(s.date, today); return d >= 0 && d < days; });
}

/** Sessions per week lately (last 28 days), never below 2 so the projection stays useful. */
export function frequency(sessions, today) {
  const list = within(sessions, today, 28);
  if (!list.length) return 2;
  // Divide by the weeks actually covered, so a new program isn't counted as four weeks
  const first = list.reduce((a, s) => (s.date < a ? s.date : a), today);
  const weeks = Math.max(1, Math.min(4, (daysBetween(first, today) + 1) / 7));
  return Math.max(2, Math.round(list.length / weeks * 10) / 10);
}

/** Fatigue per muscle right now, from sessions and cardio, as set-equivalents. */
export function fatigue(sessions, cardio, now = new Date(), custom = []) {
  const acc = zero();
  const t = now.getTime();
  const decay = (m, hours) => Math.pow(0.5, hours / HALF_LIFE_H[MUSCLE[m].size]);
  for (const ses of sessions) {
    const at = new Date(ses.end || ses.start || ses.date + 'T18:00').getTime();
    const hours = (t - at) / 3600000;
    if (hours < 0 || hours > 24 * 7) continue;
    const sets = sessionSets(ses, custom);
    for (const m of Object.keys(acc)) acc[m] += sets[m] * decay(m, hours);
  }
  for (const c of cardio || []) {
    const hours = (t - new Date(c.date + 'T18:00').getTime()) / 3600000;
    if (hours < 0 || hours > 24 * 5) continue;
    const per = CARDIO_FATIGUE[c.type] || {};
    for (const [m, f] of Object.entries(per)) if (m in acc) acc[m] += f * ((c.min || 30) / 30) * decay(m, hours);
  }
  return acc;
}
export const recovered = (f) => Math.max(0, Math.min(1, 1 - f / FULLY_TIRED));

/** Weekly sets per muscle for the last `weeks` weeks (oldest first). */
export function weeklyTrend(sessions, today, weeks = 8, custom = []) {
  const out = Object.fromEntries(MUSCLES.map((m) => [m.id, []]));
  for (let w = weeks - 1; w >= 0; w--) {
    const end = new Date(today + 'T12:00'); end.setDate(end.getDate() - w * 7);
    const list = within(sessions, iso(end), 7);
    const acc = zero();
    for (const s of list) add(acc, Object.fromEntries(Object.entries(sessionSets(s, custom))), 1);
    for (const m of MUSCLES) out[m.id].push(round1(acc[m.id]));
  }
  return out;
}

/** The full picture. state: the app state. Returns { muscles, alerts, ratios, freq, basis }. */
export function analyze(state, { today = iso(), now = new Date() } = {}) {
  const sessions = state.sessions || [];
  const custom = state.custom || [];
  const focus = new Set(state.prog?.focus || []);
  const freq = frequency(sessions, today);

  // What the program gives per session: real sessions when there are enough, else the plan
  const recent = sessions.slice(-6);
  let perSession = zero(), basis = 'log';
  if (recent.length >= 3) {
    for (const s of recent) add(perSession, sessionSets(s, custom), 1 / recent.length);
  } else if (state.prog) {
    basis = 'plan';
    for (const wid of ['A', 'B']) add(perSession, sessionSets(planWorkout(state.prog, wid, { today, custom })), 0.5);
  }
  const week = zero();
  for (const s of within(sessions, today, 7)) add(week, sessionSets(s, custom), 1);
  const tired = fatigue(sessions, state.cardio, now, custom);
  const trend = weeklyTrend(sessions, today, 8, custom);

  const muscles = MUSCLES.map((m) => {
    const [lo0, hi] = m.target;
    const lo = focus.has(m.id) ? Math.round(lo0 * 1.3) : lo0;
    const projected = round1(perSession[m.id] * freq);
    // Sessions in a row (newest first) where this muscle got less than one set
    let streak = 0;
    for (let i = sessions.length - 1; i >= 0; i--) { if (sessionSets(sessions[i], custom)[m.id] >= 1) break; streak++; }
    let last = null;
    for (let i = sessions.length - 1; i >= 0 && !last; i--) if (sessionSets(sessions[i], custom)[m.id] >= 1) last = sessions[i].date;
    const status = m.quiet && projected < Math.max(lo, 0.5) ? 'extra' : projected <= 0.01 ? 'none' : projected < lo ? 'low' : projected > hi * 1.25 ? 'high' : 'ok';
    return {
      id: m.id, name: m.name, region: m.region, size: m.size, optional: !!m.optional, quiet: !!m.quiet, focus: focus.has(m.id),
      target: [lo, hi], week: round1(week[m.id]), projected, perSession: round1(perSession[m.id]),
      status, streak, last, daysSince: last ? daysBetween(last, today) : null,
      fatigue: round1(tired[m.id]), recovered: recovered(tired[m.id]), trend: trend[m.id],
    };
  });

  const by = Object.fromEntries(muscles.map((m) => [m.id, m]));
  const ratios = {
    horizontal: ratio(by.upperBack.projected, by.chest.projected),
    vertical: ratio(by.lats.projected, by.frontDelts.projected),
    pull: ratio(by.lats.projected + by.upperBack.projected + by.rearDelts.projected * 0.5, by.chest.projected + by.frontDelts.projected + by.triceps.projected * 0.5),
    hamQuad: ratio(by.hamstrings.projected, by.quads.projected),
  };

  const alerts = [];
  const enough = sessions.length >= 3;

  // Exercises in the program that were skipped workout after workout
  const skipped = skippedRuns(sessions);
  for (const x of skipped) {
    if (x.run < 2) continue;
    const w = worksFor(x.exId, custom);
    const hits = Object.entries(w).filter(([, f]) => f >= 1).map(([m]) => MUSCLE[m].name.toLowerCase());
    // Done something else instead every time: the muscles got work, only the lift itself is missing
    if (x.replaced === x.run) {
      if (x.kind !== 't1' && x.kind !== 'pu') continue;
      alerts.push({ id: 'repl-' + x.exId, kind: 'replaced', exId: x.exId, muscle: Object.entries(w).sort((p, q) => q[1] - p[1])[0]?.[0], severity: x.run >= 3 ? 2 : 1,
        title: x.name + ' replaced in your last ' + x.run + ' workouts',
        text: 'You did ' + x.by.join(', ').toLowerCase() + ' instead, so the muscles got their work. Strength in the ' + x.name.toLowerCase() + ' itself only grows from doing it — try it next time, lighter is fine.' });
      continue;
    }
    alerts.push({
      id: 'skip-' + x.exId, kind: 'skipped', exId: x.exId,
      muscle: Object.entries(w).sort((p, q) => q[1] - p[1])[0]?.[0],
      severity: x.run >= 3 && (x.kind === 't1' || x.kind === 'pu') ? 3 : 2,
      title: x.name + ' skipped in your last ' + x.run + ' workouts',
      text: 'It is in the program for ' + (hits.join(', ') || 'balance') + '. Do it next time, swap it for something you will do, or remove it.',
    });
  }
  const skippedFor = (mId) => skipped.filter((x) => x.run >= 2 && (worksFor(x.exId, custom)[mId] || 0) >= 0.5).map((x) => x.name);

  for (const m of muscles) {
    // Quiet muscles never warn; optional ones (obliques, adductors) only when you put them in focus
    if (MUSCLE[m.id].quiet || (m.optional && !m.focus)) continue;
    const limit = m.optional ? 5 : 3;
    if (enough && m.streak >= limit) {
      // When skipped program exercises explain it, that warning comes first and this one is a detail
      alerts.push({ id: 'neglect-' + m.id, muscle: m.id, kind: 'neglect', severity: m.optional || skippedFor(m.id).length ? 1 : 3,
        title: m.name + ': nothing in your last ' + m.streak + ' workouts',
        skipped: skippedFor(m.id),
        text: (m.daysSince != null ? 'Last real work ' + m.daysSince + ' days ago. ' : '')
          + (skippedFor(m.id).length ? 'In the program but skipped: ' + skippedFor(m.id).join(', ') + '.' : 'Add a little to the next workout so it doesn\'t fall behind.') });
      continue;
    }
    if (m.status === 'none' || m.status === 'low') {
      const share = m.target[0] ? m.projected / m.target[0] : 1;
      const sev = m.optional ? (share < 0.5 ? 1 : 0) : share < 0.6 ? 2 : 1;
      if (sev > 0) alerts.push({ id: 'low-' + m.id, muscle: m.id, kind: 'low', severity: sev,
        title: m.name + ': about ' + num(m.projected) + ' sets a week',
        text: (basis === 'plan' ? 'The program as planned gives ' : 'At your pace (' + num(freq) + ' workouts a week) the program gives ') + num(m.projected) + ' sets; ' + m.target[0] + '–' + m.target[1] + ' is the useful range.' });
    }
    if (m.week > m.target[1] * 1.4 && m.week >= 12) alerts.push({ id: 'high-' + m.id, muscle: m.id, kind: 'high', severity: 0,
      title: m.name + ': ' + num(m.week) + ' sets this week', text: 'Plenty. More here mostly adds fatigue.' });
  }
  if (ratios.horizontal != null && ratios.horizontal < 0.75 && by.chest.projected >= 4) alerts.push({ id: 'ratio-push', muscle: 'upperBack', kind: 'ratio', severity: 2,
    title: 'More pushing than pulling', text: 'Let rows and rear-delt work at least match your pressing. It helps shoulders stay healthy, and supports the bench.' });
  if (ratios.hamQuad != null && ratios.hamQuad < 0.5 && by.quads.projected >= 6) alerts.push({ id: 'ratio-ham', muscle: 'hamstrings', kind: 'ratio', severity: 1,
    title: 'Hamstrings lag behind quads', text: 'Squats train the front of the thigh much more than the back. A hamstring exercise evens it out.' });
  alerts.sort((a, b) => b.severity - a.severity);
  return { muscles, by, alerts, ratios, freq, basis, sessions: sessions.length };
}

/** For each exercise, how many of the latest workouts in a row had it planned but not done. */
export function skippedRuns(sessions) {
  const out = new Map();
  for (let i = sessions.length - 1; i >= 0; i--) {
    for (const it of sessions[i].items || []) {
      const e = out.get(it.exId) || { exId: it.exId, name: it.name, kind: it.kind, run: 0, replaced: 0, by: [], open: true };
      if (e.open) {
        if (outcome(it) === 'skip') { e.run++; if (it.replacedBy) { e.replaced++; if (!e.by.includes(it.replacedBy)) e.by.push(it.replacedBy); } }
        else e.open = false;
      }
      out.set(it.exId, e);
    }
  }
  return [...out.values()].filter((e) => e.run > 0).sort((a, b) => b.run - a.run);
}

function ratio(a, b) { return b > 0.5 ? Math.round((a / b) * 100) / 100 : null; }
const num = (v) => String(Math.round(v * 10) / 10);

/* ---------- Suggestions ---------- */
/** The accessory that best fills the gap for `muscleId`, given everything else.
    Prefers exercises that mainly train it, also help other lagging muscles,
    don't load muscles that are already tired or over target, and aren't in the plan already. */
export function bestExercise(analysis, muscleId, { custom = [], exclude = [] } = {}) {
  const by = analysis.by;
  const deficit = (m) => { const x = by[m]; return x ? Math.max(0, 1 - x.projected / Math.max(1, x.target[0])) : 0; };
  const candidates = [...ACCESSORIES, ...custom].filter((a) => !exclude.includes(a.id));
  // Only exercises that mainly train the muscle, unless there are none
  const direct = candidates.filter((a) => (worksFor(a.id, custom)[muscleId] || 0) >= 1);
  let best = null;
  for (const a of direct.length ? direct : candidates) {
    const w = worksFor(a.id, custom);
    if (!w[muscleId]) continue;
    let score = w[muscleId] * 3;
    if (a.kind === 'weight') score += 0.25; // loadable exercises are easier to progress
    score += 0.1 * Object.keys(w).length; // on a tie, the compound movement
    for (const [m, f] of Object.entries(w)) {
      if (m === muscleId) continue;
      const x = by[m];
      if (!x || x.quiet) continue; // grip and neck never count against an exercise
      score += f * deficit(m);               // helps other lagging muscles
      if (x.status === 'high') score -= f;    // already plenty
      if (x.recovered < 0.5) score -= f * 0.5; // still tired
    }
    if (by[muscleId].recovered < 0.5) score -= 0.5;
    if (!best || score > best.score) best = { id: a.id, name: a.name, score, works: w };
  }
  return best;
}

/** Up to `max` one-off extras for the next workout, for the most urgent gaps. */
export function balanceExtras(analysis, plan, { custom = [], max = 2 } = {}) {
  const inPlan = plan.items.map((i) => i.exId);
  const out = [];
  for (const al of analysis.alerts) {
    if (al.severity < 2 || out.length >= max) continue;
    if (out.some((x) => worksFor(x.id, custom)[al.muscle])) continue; // already covered by an earlier pick
    const ex = bestExercise(analysis, al.muscle, { custom, exclude: [...inPlan, ...out.map((x) => x.id)] });
    if (ex) out.push({ id: ex.id, muscle: al.muscle, why: MUSCLE[al.muscle].name });
  }
  return out;
}

export { WORKS, accessory };
