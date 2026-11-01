/* Home workouts, built from the gear at home and the muscle balance.

   Two kinds:
   - Full: for a day you can't get to the gym. It trains the same patterns as a
     gym day (squat, push, hinge, row, press, core, plus pull-ups on the bar),
     each with the best home exercise for what is lacking right now.
   - Short (10–20 min): between gym days. Two sets each of 3 exercises for the
     muscles that lack the most and are recovered, plus easy pull-up practice
     ("grease the groove": half your max, never to failure).

   The heavy barbell lifts wait for the gym. Home sessions never move the A/B
   rotation or the squat/bench/deadlift/press weights. Accessories and pull-ups
   progress as usual. */

import { ACCESSORIES, canDo, GEAR_NAMES } from './data/exercises.js';
import { MUSCLE } from './data/muscles.js';
import { analyze, bestExercise } from './muscles.js';
import { planPullups, planT3, iso } from './program.js';

export const DEFAULT_GEAR = ['bar', 'db'];
// Very sore-making exercises stay out of short sessions between gym days
const SORE = ['nordic'];

const FULL_SLOTS = [
  { slot: 'Squat', muscle: 'quads' },
  { slot: 'Push', muscle: 'chest' },
  { slot: 'Hinge', muscle: 'hamstrings' },
  { slot: 'Row', muscle: 'upperBack' },
  { slot: 'Press', muscle: 'frontDelts' },
  { slot: 'Core', muscle: 'abs' },
];

export const gearOf = (state) => state.settings?.homeGear || DEFAULT_GEAR;
export const gearText = (gear) => (gear.length ? gear.map((g) => GEAR_NAMES[g]).filter(Boolean).join(', ') : 'Bodyweight only');

/** Exercises that can't be done at home, for bestExercise's exclude list. */
function notAtHome(gear, custom) {
  return [...ACCESSORIES, ...custom].filter((a) => !canDo(a.id, gear, custom)).map((a) => a.id);
}

/** A home workout plan. kind: 'full' | 'short'. */
export function planHome(state, kind = 'full', { today = iso(), now = new Date() } = {}) {
  const prog = state.prog, custom = state.custom || [];
  const gear = gearOf(state);
  const a = analyze(state, { today, now });
  const exclude = notAtHome(gear, custom);
  const items = [];
  const chosen = [];
  const pick = (muscle) => {
    const ex = bestExercise(a, muscle, { custom, exclude: [...exclude, ...chosen] });
    if (!ex) return null;
    chosen.push(ex.id);
    return ex;
  };
  const acc = (id) => [...ACCESSORIES, ...custom].find((x) => x.id === id);

  if (kind === 'full') {
    if (gear.includes('bar')) items.push({ ...planPullups(prog, prog.next, today, false), slot: 'Pull' });
    for (const s of FULL_SLOTS) {
      const ex = pick(s.muscle);
      if (ex) items.push({ ...planT3(prog, acc(ex.id), false), slot: s.slot, colour: slotColour(s.slot) });
    }
    return {
      wid: 'H', place: 'home', kind: 'full', name: 'Home workout', items, deload: false,
      notes: ['The barbell lifts wait for the gym. Your next gym day is unchanged.'],
    };
  }

  // Short: the muscles that lack the most and are fresh enough
  exclude.push(...SORE);
  const needs = a.muscles
    .filter((m) => !m.quiet && (!m.optional || m.focus) && m.recovered >= 0.7)
    .map((m) => ({ m, need: Math.max(0, 1 - m.projected / Math.max(1, m.target[0])) + (m.streak >= 2 ? 0.3 : 0) }))
    .sort((x, y) => y.need - x.need);
  // Low-fatigue fallbacks when nothing lacks: core, rear delts, calves
  const order = [...needs.filter((x) => x.need > 0.05).map((x) => x.m.id), 'abs', 'rearDelts', 'calves', 'sideDelts', 'biceps'];
  for (const mId of order) {
    if (items.length >= 3) break;
    if (items.some((it) => (it.works || {})[mId] >= 1)) continue;
    const ex = pick(mId);
    if (!ex) continue;
    const it = planT3(prog, acc(ex.id), false);
    items.push({ ...it, sets: it.sets.slice(0, 2), works: ex.works, colour: 'acc', note: 'For ' + MUSCLE[mId].name.toLowerCase() + '. ' + it.note });
  }
  if (gear.includes('bar') && prog.pu.max > 0) {
    const r = Math.max(1, Math.round(prog.pu.max * 0.5));
    items.push({
      key: 'gtg', kind: 'gtg', exId: 'pu', name: 'Pull-up practice', colour: 'pu', bodyweight: true, rest: 60, warmup: [], gap: 1,
      sets: [0, 1, 2].map(() => ({ w: 0, reps: r })),
      note: 'Easy sets of ' + r + ' (half your max), never to failure. Practice, not a workout — it doesn\'t change your pull-up targets.',
    });
  }
  return {
    wid: 'S', place: 'home', kind: 'short', name: 'Short home session', items, deload: false,
    notes: ['10–20 minutes, short of failure. It fills gaps without tiring you for the next gym day.'],
  };
}

function slotColour(slot) {
  return { Squat: 'sq', Push: 'bp', Hinge: 'dl', Press: 'op', Row: 'pu', Core: 'acc' }[slot] || 'acc';
}

export function sessionName(ses) {
  if (ses.place === 'home') return ses.kind === 'short' ? 'Short home session' : 'Home workout';
  if (ses.lower && ses.upper) return ({ sq: 'Squat', dl: 'Deadlift' })[ses.lower] + ' + ' + ({ bp: 'bench', op: 'press' })[ses.upper];
  return ses.wid === 'A' ? 'Workout A' : 'Workout B';
}
