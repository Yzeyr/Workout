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
import { worksFor } from './data/muscles.js';
import { MAIN } from './data/exercises.js';
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

/** Plan for today's pick. */
export function planToday(state, opts = {}) {
  const c = chooseSession(state, opts);
  const plan = planWorkout(state.prog, c.wid, { today: opts.today || iso(), custom: state.custom || [], upper: c.upper });
  return { ...plan, choice: c };
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
