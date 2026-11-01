/* The planner: which heavy lifts today, instead of a blind A, B, A, B.

   Every gym workout has one heavy lower lift (squat or deadlift) and one heavy
   upper lift (bench or press). For each lift the planner weighs:
   - How due it is: days since it was last trained heavy, against how often it
     should come up (squat and bench about twice a week, deadlift once, press a
     bit more than once). 1.0 = right on time.
   - How recovered its muscles are now (muscle model in muscles.js, weighted by
     how much the lift uses each muscle). Below 60 % it is pushed back, below 80 %
     it gets a smaller penalty. So bench the day after a heavy press (front delts
     and triceps still tired) loses to the other choice, or waits.
   - A small push for a lift that is behind its two-year pace.
   You can override today's pick; the override only lasts for today. */

import { analyze } from './muscles.js';
import { worksFor, MUSCLE } from './data/muscles.js';
import { MAIN, ACCESSORIES } from './data/exercises.js';
import { planWorkout, liftStatus, daysBetween, iso, outcome } from './program.js';

export const PER_WEEK = { sq: 2, bp: 2, dl: 1, op: 1.3 };
const LOWER = ['sq', 'dl'], UPPER = ['bp', 'op'];

/** Last date a lift was done as a heavy main lift (not the light squat on deadlift days). */
function lastHeavy(sessions, id) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const it = sessions[i].items?.find((x) => x.kind === 't1' && x.exId === id);
    if (it && outcome(it) !== 'skip') return sessions[i].date;
  }
  return null;
}

/** How recovered the muscles a lift uses are, 0–1, weighted by how much it uses each. */
export function liftRecovery(analysis, id) {
  let s = 0, n = 0;
  for (const [m, f] of Object.entries(worksFor(id))) {
    const x = analysis.by[m];
    if (!x) continue;
    s += f * x.recovered; n += f;
  }
  return n ? s / n : 1;
}

/** Score for one lift today, with the reasons in plain words. */
export function scoreLift(state, analysis, id, today) {
  const last = lastHeavy(state.sessions || [], id);
  const days = last ? daysBetween(last, today) : null;
  const due = (days ?? 10) * PER_WEEK[id] / 7;
  const rec = liftRecovery(analysis, id);
  const st = state.prog ? liftStatus(state.prog, id, today) : null;
  const behind = st && st.now < st.pace * 0.97;
  let score = due + (behind ? 0.15 : 0);
  if (rec < 0.6) score -= 1.5;
  else if (rec < 0.8) score -= 0.4;
  const parts = [];
  parts.push(days == null ? 'not done yet' : days === 0 ? 'done today' : days === 1 ? 'yesterday' : days + ' days ago');
  parts.push(Math.round(rec * 100) + ' % recovered');
  if (behind) parts.push('behind pace');
  return { id, name: MAIN[id].short, days, due, rec, behind, score, text: parts.join(' · ') };
}

/** Today's pick: { wid, lower, upper, scores, reasons, manual }. */
export function chooseSession(state, { today = iso(), now = new Date() } = {}) {
  const a = analyze(state, { today, now });
  const scores = Object.fromEntries([...LOWER, ...UPPER].map((id) => [id, scoreLift(state, a, id, today)]));
  const pick = state.prog?.pick;
  let lower, upper, manual = false;
  if (pick && pick.date === today && LOWER.includes(pick.lower) && UPPER.includes(pick.upper)) {
    lower = pick.lower; upper = pick.upper; manual = true;
  } else {
    lower = LOWER.slice().sort((x, y) => scores[y].score - scores[x].score)[0];
    upper = UPPER.slice().sort((x, y) => scores[y].score - scores[x].score)[0];
  }
  const reasons = [];
  if (!manual) {
    const other = (id, list) => list.find((x) => x !== id);
    for (const [id, list] of [[lower, LOWER], [upper, UPPER]]) {
      const me = scores[id], alt = scores[other(id, list)];
      if (alt.rec < 0.6 && me.rec >= alt.rec) reasons.push(alt.name + ' waits: its muscles are still recovering (' + Math.round(alt.rec * 100) + ' %).');
      else if (me.days != null && me.due >= 1.3) reasons.push(me.name + ' is due (' + me.days + ' days).');
    }
    const tired = [scores[lower], scores[upper]].filter((x) => x.rec < 0.6);
    if (tired.length) reasons.push(tired.map((x) => x.name + ' muscles at ' + Math.round(x.rec * 100) + ' %').join(', ') + ' — still recovering from the last workout. Go by feel, make today lighter, or do a short home session instead.');
  }
  return { wid: lower === 'dl' ? 'B' : 'A', lower, upper, scores, reasons, manual, analysis: a };
}

/** Plan for today's pick, with accessories built for today (unless fixed lists are chosen). */
export function planToday(state, opts = {}) {
  const today = opts.today || iso(), now = opts.now || new Date();
  const c = chooseSession(state, { today, now });
  const minutes = state.settings?.sessionMin || 60;
  let t3 = null, why = {};
  if ((state.settings?.accMode || 'auto') === 'auto') {
    const b = buildAccessories(state, { lower: c.lower, upper: c.upper, wid: c.wid, today, analysis: c.analysis, minutes });
    t3 = b.ids; why = b.why;
  }
  const plan = planWorkout(state.prog, c.wid, { today, custom: state.custom || [], upper: c.upper, t3, why, short: minutes <= 45 });
  return { ...plan, choice: c, minutes: estimateMinutes(plan.items), target: minutes };
}

/* ---------- Building the accessories ---------- */
export const SESSION_MINUTES = [45, 60, 75];

/** Rough minutes for a workout: working sets, rest and a short warm-up. */
export function estimateMinutes(items) {
  let m = 3; // getting started
  for (const it of items) {
    const n = it.sets.length;
    if (it.kind === 't1') m += 4 + n * ((it.rest || 180) / 60 + 0.75);
    else if (it.kind === 't2') m += 2 + n * ((it.rest || 120) / 60 + 0.75);
    else if (it.kind === 'pu') m += n * ((it.rest || 120) / 60 + 0.5);
    else if (it.kind === 't3') m += n * ((it.rest || 90) / 60 + 0.75);
  }
  return Math.round(m / 5) * 5;
}

// Exercises that make you very sore: only when nothing else fits
const SORE = new Set(['nordic']);

/** When each accessory was done (dates, oldest first). */
function accessoryHistory(sessions) {
  const h = new Map();
  for (const s of sessions) for (const it of s.items || []) {
    if (it.kind !== 't3' || outcome(it) === 'skip') continue;
    if (!h.has(it.exId)) h.set(it.exId, []);
    h.get(it.exId).push(s.date);
  }
  return h;
}

/**
 * Today's accessories. Picks one at a time, the one that does most for the muscles that lag
 * behind most, then counts what it adds before picking the next, so the picks spread out.
 * - Need per muscle: how far below its weekly target the program leaves it, more if it has
 *   been left out workouts in a row. Muscles still recovering, and muscles today's heavy lifts
 *   already load hard, count much less.
 * - Keeps an exercise that has been used lately (so its weight can go up), but after ~6 weeks
 *   in a row another one gets the edge, for variety.
 * - Exercises in your workout lists count as favourites.
 * Returns { ids, why: { id: 'For hamstrings and glutes' } }.
 */
export function buildAccessories(state, { lower, upper, wid, today = iso(), analysis, minutes = 60 }) {
  const custom = state.custom || [];
  const a = analysis || analyze(state, { today });
  const prog = state.prog;
  // Time left after the heavy lifts and pull-ups decides how many
  const mainTime = estimateMinutes(planWorkout(prog, wid, { today, custom, upper, t3: [], short: minutes <= 45 }).items.filter((i) => i.kind !== 't3'));
  const slots = Math.max(minutes <= 45 ? 0 : 1, Math.min(4, Math.floor((minutes - mainTime) / 7)));

  // What today's heavy lifts and pull-ups load already
  const todayLoad = {};
  const loadFrom = (id, sets) => { for (const [m, f] of Object.entries(worksFor(id, custom))) todayLoad[m] = (todayLoad[m] || 0) + f * sets; };
  loadFrom(lower, 3); loadFrom(upper, 3); if (lower === 'dl') loadFrom('sq', 3); loadFrom('pu', 4);

  const need = {};
  for (const m of a.muscles) {
    if (m.quiet || (m.optional && !m.focus)) continue;
    let n = Math.max(0, 1 - m.projected / Math.max(1, m.target[0])) + (m.streak >= 2 ? 0.3 : 0) + 0.05;
    if (m.recovered < 0.6) n *= 0.2;
    if ((todayLoad[m.id] || 0) >= 3) n *= 0.4;
    need[m.id] = n;
  }

  const hist = accessoryHistory(state.sessions || []);
  const favourites = new Set([...(prog.t3?.A || []), ...(prog.t3?.B || [])]);
  const candidates = [...ACCESSORIES, ...custom].filter((x) => !MAIN[x.id]);
  const score = (x) => {
    const w = worksFor(x.id, custom);
    let s = 0;
    for (const [m, f] of Object.entries(w)) {
      s += f * (need[m] || 0);
      // Loading muscles the heavy lifts already hit hard today costs a little
      if ((todayLoad[m] || 0) >= 2.5) s -= f * 0.3;
    }
    const used = hist.get(x.id) || [];
    const last = used[used.length - 1];
    if (last && daysBetween(last, today) <= 28) {
      s += 0.3; // keep it going, so the weight can go up
      // Used without a break of 3+ weeks for over 6 weeks: time for something new
      let start = last;
      for (let i = used.length - 2; i >= 0 && daysBetween(used[i], start) <= 21; i--) start = used[i];
      if (daysBetween(start, today) > 42) s -= 0.45;
    }
    if (favourites.has(x.id)) s += 0.2;
    if (SORE.has(x.id)) s -= 0.5;
    return s;
  };

  const ids = [], why = {};
  for (let k = 0; k < slots; k++) {
    let best = null, bestScore = 0.05;
    for (const x of candidates) {
      if (ids.includes(x.id)) continue;
      const sc = score(x);
      if (sc > bestScore) { best = x; bestScore = sc; }
    }
    if (!best) break;
    ids.push(best.id);
    const w = worksFor(best.id, custom);
    const helps = Object.entries(w).filter(([m, f]) => f >= 1 && (need[m] || 0) > 0.2).map(([m]) => MUSCLE[m]?.name.toLowerCase()).filter(Boolean);
    const main = Object.entries(w).filter(([, f]) => f >= 1).map(([m]) => MUSCLE[m]?.name.toLowerCase()).filter(Boolean);
    why[best.id] = 'For ' + (helps.length ? helps : main).join(' and ');
    // What it adds lowers the need for those muscles before the next pick
    for (const [m, f] of Object.entries(w)) if (need[m] != null) {
      const x = a.by[m];
      need[m] = Math.max(0, need[m] - f * 3 / Math.max(1, x ? x.target[0] : 6));
    }
  }
  // Nothing lags: keep the favourites going
  for (const id of (prog.t3?.[wid] || [])) {
    if (ids.length >= slots) break;
    if (!ids.includes(id)) { ids.push(id); why[id] = 'Regular'; }
  }
  return { ids, why, slots };
}

/** All four combinations, best first, for the "change" sheet. */
export function options(state, { today = iso(), now = new Date() } = {}) {
  const c = chooseSession({ ...state, prog: { ...state.prog, pick: null } }, { today, now });
  const out = [];
  for (const lower of LOWER) for (const upper of UPPER) {
    out.push({ lower, upper, score: c.scores[lower].score + c.scores[upper].score, best: lower === c.lower && upper === c.upper, scores: [c.scores[lower], c.scores[upper]] });
  }
  return out.sort((x, y) => y.score - x.score);
}
