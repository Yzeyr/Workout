/* The brain: what the next workout is, what to lift, and how the program
   moves after each session. Pure functions, no DOM, so they can be tested.

   The rules come from the research notes (docs/research.md):
   - A/B rotation, "the next workout" instead of calendar days. A missed day is never a failure.
   - T1 3×5 → on a miss repeat → 5×3 → 6×2 → −10 % and back to 3×5 (failure ladder).
   - The lifter rates the last set: easy / ok / hard / fail. Easy doubles the jump, hard repeats.
   - Two resets of the same lift within 8 weeks moves that lift to waves with a training max.
   - Load after a break depends on the days since that lift was last done.
   - Deloads only when something says so (hard/failed lifts, resets, feeling beat up). */

import { MAIN, MAIN_IDS, WORKOUTS, DEFAULT_T3, accessory } from './data/exercises.js';

export const BAR = 20;
export const RIR = { easy: 3, ok: 1.5, hard: 0, fail: 0 };
const STAGES = [{ sets: 3, reps: 5 }, { sets: 5, reps: 3 }, { sets: 6, reps: 2 }];
const WAVE = [
  [[0.65, 5], [0.75, 5], [0.85, 5, true]],
  [[0.70, 3], [0.80, 3], [0.90, 3, true]],
  [[0.75, 5], [0.85, 3], [0.95, 1, true]],
];
export const REST = { t1: 180, t2: 120, t3: 90, pu: 120 };

/* ---------- Dates ---------- */
export const iso = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

/* ---------- Maths ---------- */
/** Estimated 1-rep max (Epley), counting reps left in the tank. Only trusted up to ~10 reps. */
export function e1rm(w, reps, rir = 0) {
  if (!(w > 0) || !(reps > 0)) return 0;
  const r = Math.min(12, reps + rir);
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

/** Rounds to a weight you can load: bar plus pairs of plates, in steps of `jump` kg. */
export function loadable(w, jump = 2.5) {
  if (!(w > BAR)) return BAR;
  return Math.round((BAR + Math.round((w - BAR) / jump) * jump) * 100) / 100;
}
const roundStep = (w, step) => (step > 0 ? Math.max(0, Math.round(Math.round(w / step) * step * 100) / 100) : w);

/** Plates per side, e.g. "20 + 5 + 1.25". */
export function plates(w, have = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5]) {
  if (w <= BAR) return 'Empty bar';
  let side = (w - BAR) / 2;
  const out = [];
  for (const p of have) while (side >= p - 1e-6) { out.push(p); side -= p; }
  return out.join(' + ') + ' per side';
}

/** Warm-up ramp up to a work weight. */
export function warmup(work, lift) {
  if (work <= BAR + 5) return [];
  const steps = lift === 'dl' ? [] : [[BAR, 10], [BAR, 5]];
  for (const [p, r] of [[0.4, 5], [0.6, 3], [0.8, 2]]) steps.push([loadable(work * p), r, true]);
  const out = [];
  for (const [w, r, pct] of steps) {
    if (w >= work) continue;
    const prev = out[out.length - 1];
    // Ramp steps must add at least 10 kg on the one before (or on the empty bar)
    if (pct && (w - (prev ? prev.w : lift === 'dl' ? 0 : BAR) < 10)) continue;
    out.push({ w, reps: r });
  }
  return out;
}

/* ---------- Breaks ---------- */
/** How much to take off after `days` without that lift. Strength holds for ~4 weeks;
    the drop is mostly about soreness and groove, so it is gentle early. */
export function gapFactor(days) {
  if (days == null || days <= 7) return { f: 1, note: '' };
  if (days <= 13) return { f: 1, note: days + ' days since last time — same weight as last time.', hold: true };
  if (days <= 20) return { f: 0.9, note: days + ' days off — 10 % lighter, then quick steps back up.' };
  if (days <= 34) return { f: 0.85, note: days + ' days off — 15 % lighter, then quick steps back up.' };
  if (days <= 60) return { f: 0.75, note: days + ' days off — 25 % lighter, then quick steps back up.' };
  return { f: 0.6, note: 'Over two months off — 40 % lighter. Build back over a few sessions.' };
}

/* ---------- New program ---------- */
/** start: working weights for 3×5 now. jump: smallest total jump you can load (2.5 with 1.25 kg plates). */
export function newProgram({ start = {}, pullupMax = 3, jump = 2.5, goals = null, today = iso() } = {}) {
  const lifts = {};
  for (const id of MAIN_IDS) {
    const w = loadable(start[id] ?? (id === 'dl' ? 40 : BAR), jump);
    lifts[id] = {
      mode: 'linear', w, reps: 5, stage: 0, miss: 0, resets: [], last: null, peak: w, n: 0,
      best: 0, startW: w,
      t2: { w: loadable(w * 0.85, jump), reps: 8, miss: 0 },
      tm: null, wave: 0, waveMiss: 0,
    };
  }
  return {
    v: 1, started: today, jump, next: 'A', deload: null, sinceBreak: 0,
    goals: goals || { sq: 155, bp: 130, dl: 210, op: 80, pu: 20 },
    lifts,
    pu: { max: Math.max(0, pullupMax | 0), start: Math.max(0, pullupMax | 0), total: Math.max(3, 3 * pullupMax), add: 0, n: 0, last: null, miss: 0 },
    acc: {},
    t3: { A: [...DEFAULT_T3.A], B: [...DEFAULT_T3.B] },
  };
}

/** The jump this lift wants. Small lifts go slower than the bar allows, by adding reps first. */
function wantedInc(id, lift) {
  if (id === 'op') return 1.25;
  if (id === 'bp') return lift.w >= 60 ? 1.25 : 2.5;
  if (id === 'dl') return lift.resets.length ? 2.5 : 5;
  return 2.5;
}

/* ---------- Planning ---------- */
/** The workout to do next, with weights. Nothing is changed. */
export function planWorkout(prog, wid = prog.next, { today = iso(), custom = [] } = {}) {
  const w = WORKOUTS[wid];
  const deload = !!(prog.deload && prog.deload.left > 0);
  const items = [];
  const notes = [];
  if (deload) notes.push('Lighter session: 90 % weights, half the sets. Lets fatigue drop without losing strength.');

  for (const id of w.t1) items.push(planT1(prog, id, today, deload));
  for (const id of w.t2) items.push(planT2(prog, id, today, deload));
  items.push(planPullups(prog, wid, today, deload));
  for (const aid of (prog.t3[wid] || [])) {
    const a = accessory(aid, custom);
    if (a) items.push(planT3(prog, a, deload));
  }
  return { wid, name: w.name, items, notes, deload };
}

function gapOf(last, today) { return last ? daysBetween(last, today) : null; }

function planT1(prog, id, today, deload) {
  const L = prog.lifts[id], def = MAIN[id], jump = prog.jump;
  const gap = gapFactor(gapOf(L.last, today));
  let sets, info = '';
  if (L.mode === 'wave') {
    const tm = loadable(L.tm * gap.f, jump);
    const wave = WAVE[L.wave % 3];
    sets = wave.map(([p, reps, amrap]) => ({ w: loadable(tm * p, jump), reps, amrap: !!amrap && !deload }));
    // Extra volume at the first-set weight
    for (let i = 0; i < 3; i++) sets.push({ w: sets[0].w, reps: 5 });
    info = 'Wave ' + (L.wave % 3 + 1) + ' of 3 · training max ' + tm + ' kg';
  } else {
    const st = STAGES[L.stage];
    const work = loadable(L.w * gap.f, jump);
    const reps = L.stage === 0 ? L.reps : st.reps;
    sets = Array.from({ length: st.sets }, () => ({ w: work, reps }));
    // Every third exposure at 3×5: the last set is "as many as you can" — a free check on the weight.
    if (L.stage === 0 && L.n % 3 === 2 && !deload && !gap.note) sets[sets.length - 1].amrap = true;
    if (L.stage > 0) info = 'Stalled at 3×5 — same weight as ' + st.sets + '×' + st.reps + '.';
    else if (L.miss) info = 'Missed last time — same weight again.';
  }
  if (deload) sets = sets.slice(0, Math.ceil(sets.length / 2)).map((s) => ({ ...s, w: loadable(s.w * 0.9, jump), amrap: false }));
  const top = Math.max(...sets.map((s) => s.w));
  return {
    key: 't1-' + id, kind: 't1', exId: id, name: def.name, colour: def.colour, sets,
    rest: REST.t1, warmup: warmup(top, id), gap: gap.f, gapDays: gapOf(L.last, today),
    note: [gap.note, info].filter(Boolean).join(' '),
  };
}

function planT2(prog, id, today, deload) {
  const L = prog.lifts[id], def = MAIN[id];
  const gap = gapOf(L.last, today);
  const f = gap != null && gap > 20 ? 0.85 : 1;
  let w = loadable(L.t2.w * f, prog.jump);
  let n = 3;
  if (deload) { w = loadable(w * 0.9, prog.jump); n = 2; }
  return {
    key: 't2-' + id, kind: 't2', exId: id, name: def.name, colour: def.colour,
    sets: Array.from({ length: n }, () => ({ w, reps: L.t2.reps })),
    rest: REST.t2, warmup: [{ w: loadable(w * 0.6, prog.jump), reps: 5 }].filter((s) => s.w > BAR && s.w < w), gap: f,
    note: 'Lighter, more reps. ' + L.t2.reps + ' of 8–10 reps; at 10 the weight goes up.',
  };
}

function planPullups(prog, wid, today, deload) {
  const P = prog.pu;
  const test = P.n % 3 === 2 && !deload;
  const sets = [];
  let note = '', add = 0;
  if (P.max <= 0) {
    for (let i = 0; i < 3; i++) sets.push({ w: 0, reps: 3, neg: true });
    note = 'Negatives: jump up, lower yourself in 5 seconds. Builds the first pull-up.';
  } else if (test) {
    sets.push({ w: 0, reps: P.max, amrap: true, test: true });
    const r = Math.max(1, P.max - 1);
    for (let i = 0; i < 2; i++) sets.push({ w: 0, reps: r });
    note = 'Test day: first set as many as you can (clean reps). It sets your next targets.';
  } else if (P.max <= 7) {
    const r = Math.max(1, P.max - 1);
    const n = Math.max(2, Math.ceil(P.total / r));
    for (let i = 0; i < n; i++) sets.push({ w: 0, reps: r });
    note = 'Total ' + P.total + ' reps in sets of ' + r + '. Finish with 2 slow negatives.';
  } else if (P.max <= 12) {
    if (wid === 'B') {
      add = P.add;
      for (let i = 0; i < 4; i++) sets.push({ w: add, reps: 4 });
      note = add ? 'Weighted: +' + add + ' kg on a belt or in a backpack.' : 'Strict and slow. When all 4×4 feel ok, add weight.';
    } else {
      const r = Math.max(3, Math.round(P.max * 0.65));
      const n = Math.max(3, Math.ceil((P.total || P.max * 3.5) / r));
      for (let i = 0; i < n; i++) sets.push({ w: 0, reps: r });
      note = 'Volume: ' + n + ' × ' + r + ', short of failure.';
    }
  } else {
    const rounds = Math.max(2, Math.ceil(P.max * 3 / 15));
    for (let i = 0; i < rounds; i++) for (const r of [1, 2, 3, 4, 5]) sets.push({ w: 0, reps: r });
    note = rounds + ' ladders of 1-2-3-4-5.';
  }
  const finalSets = deload ? sets.slice(0, Math.ceil(sets.length / 2)) : sets;
  return {
    key: 'pu', kind: 'pu', exId: 'pu', name: 'Pull-ups', colour: 'pu', sets: finalSets, bodyweight: true,
    rest: add ? 180 : REST.pu, warmup: [], gap: 1, note,
  };
}

function planT3(prog, a, deload) {
  const S = prog.acc[a.id] || { w: a.start ?? 0, reps: a.range[0], miss: 0 };
  const n = deload ? 2 : (a.sets || 3);
  return {
    key: 't3-' + a.id, kind: 't3', exId: a.id, name: a.name, colour: 'acc', accKind: a.kind,
    sets: Array.from({ length: n }, () => ({ w: a.kind === 'weight' ? S.w : 0, reps: S.reps })),
    rest: REST.t3, warmup: [], gap: 1, unit: a.kind === 'time' ? 's' : 'reps',
    note: a.kind === 'weight' ? a.range[0] + '–' + a.range[1] + ' reps. At ' + a.range[1] + ' on every set the weight goes up.'
      : a.kind === 'time' ? a.range[0] + '–' + a.range[1] + ' seconds.'
        : a.range[0] + '–' + a.range[1] + ' reps.',
  };
}

/* ---------- Sessions ---------- */
/** A fresh session from a plan. Each set's `done` is the reps actually done (null = not yet). */
export function startSession(plan, now = new Date()) {
  return {
    id: 's' + now.getTime().toString(36),
    wid: plan.wid, date: iso(now), start: now.toISOString(), end: null,
    deload: plan.deload, note: '', beatUp: false,
    items: plan.items.map((it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, done: null })), rating: null, manual: false })),
  };
}

/** How an item went: 'skip' (nothing done), 'done' (every set at target), 'fail'. */
export function outcome(item) {
  const done = item.sets.filter((s) => s.done != null);
  if (!done.length) return 'skip';
  if (item.rating === 'fail') return 'fail';
  const short = item.sets.some((s) => s.done == null || (!s.amrap && s.done < s.reps) || (s.amrap && s.done < s.reps));
  return short ? 'fail' : 'done';
}

/** Applies a finished session. Returns { prog, changes: [{ exId, name, text, dir }] }. */
export function applySession(prog0, session, { custom = [] } = {}) {
  const prog = structuredClone(prog0);
  const today = session.date;
  const changes = [];
  const say = (it, text, dir = 0) => changes.push({ exId: it.exId, name: it.name, text, dir });

  // A real break resets the "sessions since a break" count used for deload offers
  const lastAny = Math.max(0, ...MAIN_IDS.map((id) => (prog.lifts[id].last ? parse(prog.lifts[id].last).getTime() : 0)));
  if (lastAny && daysBetween(iso(new Date(lastAny)), today) >= 7) prog.sinceBreak = 0;

  for (const it of session.items) {
    const res = outcome(it);
    if (res === 'skip') continue;
    if (session.deload) { markDone(prog, it, today); continue; }
    if (it.kind === 't1') applyT1(prog, it, res, today, say);
    else if (it.kind === 't2') applyT2(prog, it, res, today, say);
    else if (it.kind === 'pu') applyPullups(prog, it, res, today, say);
    else if (it.kind === 't3') applyT3(prog, it, res, accessory(it.exId, custom), say);
  }
  if (session.deload && prog.deload) {
    prog.deload.left -= 1;
    if (prog.deload.left <= 0) prog.deload = null;
    changes.push({ exId: '', name: 'Deload', text: prog.deload ? 'One lighter session left.' : 'Deload done. Normal weights next time.', dir: 0 });
  }
  const trained = session.items.some((it) => outcome(it) !== 'skip');
  if (trained) {
    prog.next = session.wid === 'A' ? 'B' : 'A';
    prog.sinceBreak = (prog.sinceBreak || 0) + 1;
  }
  return { prog, changes };
}

function markDone(prog, it, today) {
  if (it.kind === 't1' || it.kind === 't2') prog.lifts[it.exId].last = today;
  if (it.kind === 'pu') prog.pu.last = today;
}

function topSet(it) {
  let best = null;
  for (const s of it.sets) if (s.done > 0 && (!best || s.w > best.w || (s.w === best.w && s.done > best.done))) best = s;
  return best;
}

function applyT1(prog, it, res, today, say) {
  const id = it.exId, L = prog.lifts[id], jump = prog.jump;
  const gapDays = it.gapDays;
  if (gapDays != null && gapDays >= 8) { L.miss = 0; L.waveMiss = 0; }
  const used = Math.max(...it.sets.map((s) => s.w));
  const top = topSet(it);
  if (top) L.best = Math.max(L.best || 0, e1rm(top.w, top.done, top.amrap ? 0 : RIR[it.rating || 'ok']));
  L.last = today;
  L.n = (L.n || 0) + 1;

  if (L.mode === 'wave') return applyWave(prog, id, it, res, say);

  const before = L.w;
  if (res === 'done') {
    L.miss = 0;
    L.peak = Math.max(L.peak || 0, used);
    if (it.rating === 'hard') { L.w = used; say(it, 'Hard but done — same weight next time.'); return; }
    const amrap = it.sets.find((s) => s.amrap);
    let mult = it.rating === 'easy' || (amrap && amrap.done >= 10) ? 2 : 1;
    const climbing = used < (L.peak || 0) - 0.01 || (it.gap || 1) < 1;
    if (climbing) mult = Math.max(mult, 2);
    const inc = wantedInc(id, L);
    if (inc < jump && L.stage === 0 && !climbing) {
      // The bar can't move that little: add a rep per set first, then the weight.
      if (L.reps < 7) { L.reps += 1; L.w = used; say(it, '3×' + L.reps + ' at ' + used + ' kg next time.', 1); return; }
      L.reps = 5; L.w = loadable(used + jump, jump);
    } else {
      L.w = loadable(used + Math.max(inc, jump) * mult, jump);
      if (climbing && L.w > L.peak && used < L.peak) L.w = loadable(L.peak, jump);
    }
    say(it, (L.w > before ? 'Up to ' : 'Next: ') + L.w + ' kg' + (mult > 1 ? ' (big step)' : '') + '.', L.w > before ? 1 : 0);
    return;
  }
  // Failed
  if (L.miss === 0) { L.miss = 1; L.w = used; say(it, 'Missed — same weight next time.', 0); return; }
  L.miss = 0;
  if (L.stage < 2) {
    L.stage += 1; L.w = used;
    const st = STAGES[L.stage];
    say(it, 'Stalled — next time ' + st.sets + '×' + st.reps + ' at the same weight.', 0);
    return;
  }
  L.stage = 0; L.reps = 5;
  L.w = loadable(used * 0.9, jump);
  L.resets = [...(L.resets || []), today].filter((d) => daysBetween(d, today) <= 120);
  const recent = L.resets.filter((d) => daysBetween(d, today) <= 56);
  if (recent.length >= 2) {
    L.mode = 'wave'; L.wave = 0; L.waveMiss = 0;
    L.tm = loadable((L.best || e1rm(used, 2)) * 0.9, jump);
    say(it, 'Two resets in 8 weeks — this lift moves to waves (training max ' + L.tm + ' kg). Slower, steadier progress.', -1);
    return;
  }
  say(it, 'Reset to ' + L.w + ' kg (−10 %) and back to 3×5. Normal and part of the plan.', -1);
}

function applyWave(prog, id, it, res, say) {
  const L = prog.lifts[id], jump = prog.jump;
  if ((it.gap || 1) < 1) L.tm = loadable(L.tm * it.gap, jump);
  const step = MAIN[id].lower ? 5 : 2.5;
  const amrap = it.sets.find((s) => s.amrap);
  const missed = res === 'fail' && (!amrap || amrap.done == null || amrap.done < amrap.reps || it.sets.some((s) => !s.amrap && s.done != null && s.done < s.reps));
  if (missed) {
    L.waveMiss = (L.waveMiss || 0) + 1;
    if (L.waveMiss >= 2) { L.tm = loadable(L.tm * 0.9, jump); L.wave = 0; L.waveMiss = 0; say(it, 'Two misses in a wave — training max down to ' + L.tm + ' kg, wave starts over.', -1); return; }
    say(it, 'Short on reps — the wave goes on; another miss lowers the training max.', 0);
  }
  if (L.wave % 3 === 2) {
    const extra = amrap && amrap.done != null ? amrap.done - amrap.reps : -1;
    const before = L.tm;
    if (extra < 0) L.tm = loadable(L.tm * 0.9, jump);
    else if (extra >= 6) L.tm = loadable(L.tm + 2 * step, jump);
    else if (extra >= 2) L.tm = loadable(L.tm + step, jump);
    L.wave = 0; L.waveMiss = 0;
    say(it, L.tm > before ? 'Wave done — training max up to ' + L.tm + ' kg.' : L.tm < before ? 'Top set fell short — training max down to ' + L.tm + ' kg.' : 'Wave done — training max stays ' + L.tm + ' kg.', Math.sign(L.tm - before));
    return;
  }
  L.wave += 1;
  if (!missed) say(it, 'Wave ' + (L.wave + 1) + ' of 3 next time.', 0);
}

function applyT2(prog, it, res, today, say) {
  const T = prog.lifts[it.exId].t2, jump = prog.jump;
  prog.lifts[it.exId].last = today; // a T2 day counts as training the lift, for the break rules
  const used = it.sets[0].w;
  if (res === 'done') {
    T.miss = 0; T.w = used;
    if (it.rating === 'hard') { say(it, 'Same next time.'); return; }
    if (T.reps < 10) { T.reps += 1; say(it, it.sets.length + '×' + T.reps + ' next time.', 1); return; }
    T.reps = 8; T.w = loadable(used + jump, jump);
    say(it, 'Up to ' + T.w + ' kg, back to 8 reps.', 1);
    return;
  }
  T.miss += 1; T.w = used;
  if (T.miss >= 2) { T.miss = 0; T.reps = 8; T.w = loadable(used * 0.9, jump); say(it, 'Down to ' + T.w + ' kg × 8.', -1); return; }
  say(it, 'Same again next time.', 0);
}

function applyPullups(prog, it, res, today, say) {
  const P = prog.pu;
  P.last = today; P.n = (P.n || 0) + 1;
  const test = it.sets.find((s) => s.test);
  if (test && test.done != null) {
    const before = P.max;
    P.max = test.done;
    P.total = Math.max(P.total, P.max * 3);
    say(it, P.max > before ? 'New max: ' + P.max + ' pull-ups!' : 'Max test: ' + P.max + '.', Math.sign(P.max - before));
    return;
  }
  if (P.max <= 0) {
    if (res === 'done' && it.rating !== 'hard') say(it, 'Good. Next test day shows if the first rep is there.', 0);
    return;
  }
  const weighted = it.sets.some((s) => s.w > 0) || (P.max > 7 && P.max <= 12 && it.sets.length === 4 && it.sets.every((s) => s.reps === 4));
  if (res === 'done' && it.rating !== 'hard') {
    P.miss = 0;
    if (weighted) { P.add = Math.round(((P.add || 0) + 1.25) * 100) / 100; say(it, 'Next weighted day: +' + P.add + ' kg.', 1); }
    else { P.total += P.max <= 7 ? 2 : 3; say(it, 'Total up to ' + P.total + ' reps.', 1); }
    return;
  }
  if (res === 'fail') { P.miss = (P.miss || 0) + 1; if (P.miss >= 2 && !weighted) { P.total = Math.max(P.max * 2, P.total - 3); P.miss = 0; } say(it, 'Same target next time.', 0); }
}

function applyT3(prog, it, res, a, say) {
  if (!a) return;
  const S = prog.acc[a.id] || { w: a.start ?? 0, reps: a.range[0], miss: 0 };
  const [lo, hi] = a.range;
  if (res === 'done' && it.rating !== 'hard') {
    S.miss = 0;
    if (a.kind === 'weight') {
      if (S.reps >= hi) { S.w = roundStep((it.sets[0].w || 0) + (a.step || 2.5), a.step || 2.5); S.reps = lo; say(it, 'Up to ' + S.w + ' kg × ' + lo + '.', 1); }
      else { S.reps = Math.min(hi, S.reps + 2); S.w = it.sets[0].w; say(it, S.reps + ' reps next time.', 1); }
    } else {
      const stepUp = a.kind === 'time' ? 5 : 1;
      if (S.reps >= hi) say(it, 'Top of the range — pick a harder version, or add weight.', 0);
      else { S.reps = Math.min(hi, S.reps + stepUp); say(it, S.reps + (a.kind === 'time' ? ' s' : ' reps') + ' next time.', 1); }
    }
  } else if (res === 'fail') {
    S.miss = (S.miss || 0) + 1;
    if (S.miss >= 2 && a.kind === 'weight' && S.w > 0) { S.w = roundStep(S.w * 0.9, a.step || 2.5); S.reps = lo; S.miss = 0; say(it, 'Down to ' + S.w + ' kg.', -1); }
  }
  prog.acc[a.id] = S;
}

/* ---------- Deload ---------- */
/** Says when a lighter couple of sessions would help, or null. */
export function deloadReason(prog, sessions, today = iso()) {
  if (prog.deload) return null;
  const recent = sessions.filter((s) => !s.deload).slice(-3);
  const tough = recent.flatMap((s) => s.items.filter((it) => it.kind === 't1' && (it.rating === 'hard' || outcome(it) === 'fail'))).length;
  if (recent.length >= 3 && tough >= 2) return 'Your main lifts have felt hard or fallen short ' + tough + ' times in the last 3 sessions.';
  const resets = MAIN_IDS.flatMap((id) => prog.lifts[id].resets || []).filter((d) => daysBetween(d, today) <= 14);
  if (resets.length >= 2) return 'Two lifts were reset in the last two weeks.';
  const last2 = sessions.slice(-2);
  if (last2.length === 2 && last2.every((s) => s.beatUp)) return 'You felt beat up after the last two sessions.';
  const waveLifts = MAIN_IDS.filter((id) => prog.lifts[id].mode === 'wave').length;
  if (waveLifts >= 2 && (prog.sinceBreak || 0) >= 15) return prog.sinceBreak + ' sessions without a break.';
  return null;
}

export function startDeload(prog) { return { ...structuredClone(prog), deload: { left: 2 } }; }
export function skipDeload(prog) { return { ...structuredClone(prog), sinceBreak: 0 }; }

/* ---------- Goals ---------- */
/** Where you "should" be on a curve that is fast early and slows down (novice gains come first). */
export function onPace(start, goal, startDate, today = iso(), years = 2) {
  const t = Math.max(0, Math.min(1, daysBetween(startDate, today) / (365 * years)));
  const f = (1 - Math.exp(-2 * t)) / (1 - Math.exp(-2));
  return Math.round((start + (goal - start) * f) * 10) / 10;
}

/** Current strength for a lift as e1RM (from the best set) and its goal status. */
export function liftStatus(prog, id, today = iso()) {
  const L = prog.lifts[id];
  const now = L.best || e1rm(L.w, 5, 1.5);
  const start = e1rm(L.startW, 5, 1.5);
  const goal = prog.goals[id];
  const pace = onPace(start, goal, prog.started, today);
  const pct = goal > start ? Math.max(0, Math.min(1, (now - start) / (goal - start))) : 1;
  const status = now >= pace * 0.97 ? 'on pace' : now >= pace * 0.9 ? 'a bit behind' : 'behind';
  return { now, start, goal, pace, pct, status };
}

/** Next workout as a short line, e.g. "Workout B · Bench 62.5 · Deadlift 90". */
export function nextLine(plan) {
  return plan.name + ' · ' + plan.items.filter((i) => i.kind === 't1').map((i) => MAIN[i.exId].short + ' ' + Math.max(...i.sets.map((s) => s.w))).join(' · ');
}
