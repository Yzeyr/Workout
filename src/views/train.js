/* Train: the next workout, and the workout in progress. */

import { h, icon, clear, sheet, confirmSheet, choose, block, row, fold, toast } from '../dom.js';
import { get, change, setupProgram } from '../state.js';
import {
  planWorkout, startSession, applySession, outcome, deloadReason, startDeload, skipDeload,
  plates, liftStatus, iso, BAR, loadable, planT1, overlap,
} from '../program.js';
import { MAIN, MAIN_IDS, ACCESSORIES, GROUPS, REST_TIPS, accessory } from '../data/exercises.js';
import { startRest, stopRest, unlockSound } from '../timer.js';
import { num, ago, parseNum, minutes, dayLabel } from '../util.js';
import { later, uiGet, uiSet } from '../store.js';
import { planHome, gearOf, gearText, sessionName } from '../home.js';
import { GEAR_NAMES, canDo } from '../data/exercises.js';
import { cardioSheet } from './body.js';
import { go } from '../nav.js';
import { analyze, balanceExtras } from '../muscles.js';
import { alertsBlock } from './muscles.js';
import { planToday, options, SESSION_MINUTES } from '../planner.js';
import { readinessCard } from './today.js';
import { badges, newBadges } from '../badges.js';
import { worksFor, MUSCLE } from '../data/muscles.js';

const TIER = { t1: 'Main lift', t2: 'Second lift', pu: 'Pull-ups', t3: 'Accessory', gtg: 'Practice' };
const RATINGS = [['easy', 'Easy'], ['ok', 'OK'], ['hard', 'Hard'], ['fail', 'Failed']];

export function trainView(root) {
  const s = get();
  if (!s.prog) return setupView(root);
  if (s.active) return sessionView(root);
  return nextView(root);
}

/* ---------- First start ---------- */
function setupView(root) {
  const val = { sq: '', bp: '', dl: '', op: '', pu: '3', jump: 2.5 };
  const field = (id, label, hint) => h('label.field', h('span', label),
    h('input', { type: 'text', inputmode: 'decimal', placeholder: hint, value: val[id], oninput: (e) => { val[id] = e.target.value; } }));
  const jumpSeg = h('div.seg', [[2.5, '2.5 kg'], [1, '1 kg'], [1.25, '1.25 kg']].map(([v, t]) => h('button', {
    type: 'button', 'aria-pressed': String(val.jump === v),
    onclick: (e) => { val.jump = v; [...jumpSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
  }, t)));
  clear(root,
    header('Set up', 'Workout'),
    h('p.muted', { style: { marginBottom: '14px' } }, 'A program for squat, bench, deadlift, press and pull-ups, in two workouts (A and B) that take turns. Train when you can: the app always shows the next workout, and a missed day is never a failure.'),
    block('Starting weights', 'kg', h('div.inner',
      h('p.muted.small', { style: { marginBottom: '12px' } }, 'A weight you can lift 3 × 5 with 1–2 reps to spare. Not sure? Start light — the first weeks go up fast. Empty bar is 20.'),
      h('div.fields2', field('sq', 'Squat', '20'), field('bp', 'Bench', '20'), field('dl', 'Deadlift', '40'), field('op', 'Overhead press', '20')),
      field('pu', 'Pull-ups in one set (strict)', '3'))),
    block('Smallest jump on the bar', '', h('div.inner',
      h('p.muted.small', { style: { marginBottom: '10px' } }, '2.5 kg means 1.25 kg plates on each side. With smaller plates the press and bench can go up in smaller steps.'),
      jumpSeg)),
    h('button.btn.wide', { type: 'button', style: { marginTop: '6px' }, onclick: () => {
      const n = (v, d) => { const x = parseNum(v); return Number.isFinite(x) && x >= 0 ? x : d; };
      setupProgram({
        start: { sq: n(val.sq, 20), bp: n(val.bp, 20), dl: n(val.dl, 40), op: n(val.op, 20) },
        pullupMax: Math.round(n(val.pu, 3)), jump: val.jump, today: iso(),
      });
      toast('Program ready. First up: workout A.');
    } }, 'Start the program'));
}

function header(title, eyebrow, right = null) {
  return h('div.top', h('div.titles', eyebrow && h('div.eyebrow', eyebrow), h('h1', title)),
    right, h('a.iconbtn', { href: '#settings', 'aria-label': 'Settings' }, icon('settings')));
}

/* ---------- Next workout ---------- */
function nextView(root) {
  const s = get(), prog = s.prog, today = iso();
  const plan = planToday(s, { today });
  const last = s.sessions[s.sessions.length - 1];
  const reason = deloadReason(prog, s.sessions, today);

  if (uiGet('place', 'gym') === 'home') return homeView(root, last, today);
  const planRows = planList(plan.items);

  clear(root,
    header('Train', last ? 'Last trained ' + ago(last.date, today) : 'First workout'),
    placeSeg('gym'),
    readinessCard({ gym: true }),
    reason && h('div.banner', icon('info'), h('div.text', h('b', 'A lighter couple of sessions?'), reason + ' Two sessions at 90 % with half the sets lets fatigue drop. You keep your strength.'),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('button', { type: 'button', onclick: () => change((x) => { x.prog = startDeload(x.prog); }) }, 'Yes'),
        h('button', { type: 'button', onclick: () => change((x) => { x.prog = skipDeload(x.prog); }) }, 'No'))),
    h('div.hero',
      h('div.kicker', (plan.deload ? 'Today · lighter session' : plan.choice.manual ? 'Today · your choice' : 'Today') + ' · about ' + plan.minutes + ' min'),
      h('h2', plan.name),
      h('p.why', whyLine(plan)),
      h('ul.plan', planRows),
      [...plan.choice.reasons, ...plan.notes, ...plan.items.filter((i) => i.note && i.kind === 't1' && /days|Stalled|Missed|Wave/.test(i.note)).map((i) => MAIN[i.exId].short + ': ' + i.note)]
        .map((n) => h('p.muted.small', { style: { marginTop: '10px' } }, n)),
      h('div.timechoice', h('span', 'Time today'),
        h('div.seg.mini', SESSION_MINUTES.map((m) => h('button', { type: 'button', 'aria-pressed': String(plan.target === m), onclick: () => change((x) => { x.settings = { ...(x.settings || {}), sessionMin: m }; }) }, m + ' min')))),
      h('div.btnrow',
        h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => begin(plan) }, 'Start workout'),
        h('button.btn.secondary', { type: 'button', onclick: () => changeSheet() }, icon('swap'), 'Change'))),
    (s.settings?.balance || 'suggest') !== 'off' && alertsBlock(analyze(s, { today }), s),
    goalsBlock(prog, today),
    block('More', '',
      row({ title: 'Log your own workout', sub: 'Did something else? Add exercises as you go, or log one afterwards', onclick: beginFree }),
      row({ title: 'Muscles', sub: 'Body map, sets per muscle, recovery and balance', onclick: () => go('muscles') }),
      row({ title: 'Log cardio', sub: 'Run, walk, bike, row or swim', onclick: () => cardioSheet() }),
      row({ title: 'Accessories in each workout', sub: 'A: ' + names(prog.t3.A, s.custom) + ' · B: ' + names(prog.t3.B, s.custom), onclick: () => accessoriesSheet() })),
  );
}

/** The exercises of a plan as a short list: name, tier and scheme, weight. */
function planList(items) {
  return items.map((it) => {
    const top = Math.max(...it.sets.map((x) => x.w));
    const reps = it.sets.map((x) => x.reps);
    const same = reps.every((r) => r === reps[0]);
    const scheme = it.kind === 'pu' ? it.sets.length + ' sets' : same ? it.sets.length + ' × ' + reps[0] + (it.sets.some((x) => x.amrap) ? '+' : '') : it.sets.length + ' sets';
    const weight = it.bodyweight ? (top > 0 ? '+' + num(top) : 'BW') : it.accKind && it.accKind !== 'weight' ? '' : top > 0 ? num(top) : 'BW';
    const label = it.slot && it.kind !== 'pu' ? it.slot : it.extra ? 'Balance' : it.why || TIER[it.kind];
    return h('li', { style: { '--c': 'var(--' + it.colour + ')' } }, h('span.dot'),
      h('div', h('b', it.name), h('small', label + ' · ' + scheme + (it.unit === 's' ? ' s' : ''))),
      h('span.w', weight));
  });
}

/** Gym or home, one tap. Remembered for next time. */
function placeSeg(place) {
  return h('div.seg.place', { role: 'group', 'aria-label': 'Where are you training?' },
    [['gym', 'Gym'], ['home', 'Home']].map(([v, t]) => h('button', {
      type: 'button', 'aria-pressed': String(place === v),
      onclick: () => { if (place !== v) { uiSet('place', v); change(() => {}); } },
    }, t)));
}

/* ---------- Home ---------- */
function homeView(root, last, today) {
  const s = get();
  const gear = gearOf(s);
  const full = planHome(s, 'full', { today });
  const short = planHome(s, 'short', { today });
  const card = (plan, kicker, minutesText, why) => h('div.hero',
    h('div.kicker', kicker),
    h('h2', plan.name),
    h('p.why', why),
    h('ul.plan', planList(plan.items)),
    h('div.btnrow', h('button.btn' + (plan.kind === 'short' ? '.secondary' : ''), { type: 'button', style: { flex: '1' }, onclick: () => begin(plan) }, 'Start · ' + minutesText)));
  clear(root,
    header('Train', last ? 'Last trained ' + ago(last.date, today) : 'First workout'),
    placeSeg('home'),
    readinessCard({ gym: false }),
    h('div.banner', icon('info'), h('div.text', h('b', 'The barbell lifts wait for the gym'), 'The next gym day stays the same, with the same weights (' + planToday(s, { today }).name.toLowerCase() + ' if it were today). Home sessions train the same muscles with what you have.')),
    card(full, 'Can\'t get to the gym', '~40 min', 'Squat, push, hinge, row, press and core' + (gear.includes('bar') ? ', plus pull-ups' : '') + ' — picked for what your muscles need now.'),
    card(short, 'Between gym days', '10–20 min', 'Fills the biggest gaps with muscles that are recovered, short of failure, so you are fresh for the gym.'),
    (s.settings?.balance || 'suggest') !== 'off' && alertsBlock(analyze(s, { today }), s),
    block('Home', '',
      row({ title: 'Equipment at home', sub: gearText(gear), onclick: gearSheet }),
      row({ title: 'Log your own workout', sub: 'Add exercises as you go, or log one afterwards', onclick: beginFree }),
      row({ title: 'Muscles', sub: 'Body map, sets per muscle, recovery and balance', onclick: () => go('muscles') }),
      row({ title: 'Log cardio', sub: 'Run, walk, bike, row or swim', onclick: () => cardioSheet() })),
  );
}

export function gearSheet() {
  const sel = new Set(gearOf(get()));
  const list = h('div.optlist', Object.entries(GEAR_NAMES).map(([id, name]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(sel.has(id)), onclick: () => {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      b.setAttribute('aria-pressed', String(sel.has(id)));
      clear(b, h('span', name), sel.has(id) && icon('check'));
    } }, h('span', name), sel.has(id) && icon('check'));
    return b;
  }));
  sheet((close) => h('div',
    h('h2', 'Equipment at home'),
    h('p.muted.lead', 'Bodyweight exercises are always included. Home workouts only use what you tick here.'),
    list,
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => { change((x) => { x.settings = { ...(x.settings || {}), homeGear: [...sel] }; }); close(); toast('Saved'); } }, 'Save'))));
}

const names = (ids, custom) =>ids.map((id) => accessory(id, custom)?.name).filter(Boolean).join(', ') || 'none';

function goalsBlock(prog, today) {
  const rows = MAIN_IDS.map((id) => {
    const st = liftStatus(prog, id, today);
    const L = prog.lifts[id];
    const work = L.mode === 'wave' ? 'training max ' + num(L.tm) + ' kg' : num(L.w) + ' kg × ' + (L.stage ? [null, '5×3', '6×2'][L.stage] : '3×' + L.reps);
    return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
      h('div.main', h('b', MAIN[id].name),
        h('small', 'Now ' + work + ' · est. max ' + num(st.now) + ' kg'),
        h('div.bar', { style: { '--c': 'var(--' + MAIN[id].colour + ')', marginTop: '6px' } }, h('i', { style: { width: Math.round(st.pct * 100) + '%' } }))),
      h('span.value', h('span', num(st.goal) + ' kg'), h('small.muted', { style: { display: 'block', fontSize: '13px', fontWeight: '600' } }, st.status)));
  });
  const P = prog.pu;
  rows.push(h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.main', h('b', 'Pull-ups'), h('small', 'Best set ' + P.max + ' reps'),
      h('div.bar', { style: { '--c': 'var(--pu)', marginTop: '6px' } }, h('i', { style: { width: Math.round(Math.min(1, P.max / (prog.goals.pu || 20)) * 100) + '%' } }))),
    h('span.value', (prog.goals.pu || 20) + ' reps')));
  return h('section.block.c-accent',
    fold('goals', { title: 'Two-year goals', sub: 'Pace is fast early and slows down — that is how strength grows.', strong: true }, rows, { open: false }));
}

/* ---------- Start ---------- */
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not allowed: fine */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && get()?.active) keepAwake(); });

/** One line on what today is and why these lifts. */
function whyLine(plan) {
  const t1 = plan.items.filter((i) => i.kind === 't1').map((i, n) => (n ? MAIN[i.exId].short.toLowerCase() : MAIN[i.exId].short));
  const t2 = plan.items.filter((i) => i.kind === 't2').map((i) => MAIN[i.exId].short.toLowerCase());
  return t1.join(' and ') + ' heavy' + (t2.length ? ', a light ' + t2.join(', ') : '') + ', then pull-ups and accessories. ' + (plan.choice?.manual ? 'Your choice for today.' : 'Picked from what is due and what is recovered.');
}

/** Pick today's lifts yourself: the four combinations, best first, with how due and recovered each lift is. */
function changeSheet() {
  const s = get();
  const list = options(s);
  const cur = planToday(s).choice;
  const name = (o) => ({ sq: 'Squat', dl: 'Deadlift' })[o.lower] + ' + ' + ({ bp: 'bench', op: 'press' })[o.upper];
  sheet((close) => h('div',
    h('h2', 'Today’s lifts'),
    h('p.muted.lead', 'One heavy leg lift and one heavy upper-body lift. Bench and press are never together: they tire the same shoulders and triceps.'),
    h('div.optlist', list.map((o) => h('button', {
      type: 'button', 'aria-pressed': String(o.lower === cur.lower && o.upper === cur.upper),
      onclick: () => { change((x) => { x.prog.pick = o.best ? null : { date: iso(), lower: o.lower, upper: o.upper }; }); close(); },
    }, h('span', name(o) + (o.best ? ' · suggested' : ''), h('small', o.scores.map((sc) => sc.name + ': ' + sc.text).join(' — '))),
    o.lower === cur.lower && o.upper === cur.upper && icon('check')))),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Close'))));
}

function begin(plan) {
  unlockSound();
  change((s) => { s.active = startSession(plan); });
  keepAwake();
  scrollTo(0, 0);
}

/* ---------- Session ---------- */
function sessionView(root) {
  const s = get(), ses = s.active;
  keepAwake();
  const doneItems = ses.items.filter((it) => outcome(it) !== 'skip').length;
  clear(root,
    header(sessionName(ses), (ses.place === 'home' ? 'Home · ' : '') + (ses.deload ? 'Lighter session · ' : '') + minutes(ses.start) + ' min · ' + doneItems + ' of ' + ses.items.length + ' started'),
    ses.items.map((it, i) => exerciseCard(it, i)),
    h('button.btn.ghost.wide', { type: 'button', onclick: addExercise }, icon('plus'), 'Add an exercise'),
    h('div.btnrow', { style: { marginTop: '12px' } },
      h('button.btn.secondary', { type: 'button', onclick: discard }, 'Discard'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: finishSheet }, icon('check'), 'Finish workout')),
  );
}

function editActive(fn, opts) { change((s) => { if (s.active) fn(s.active); }, opts); }

function exerciseCard(it, i) {
  if (it.replacedBy) {
    return h('article.ex.done', { style: { '--c': 'var(--' + it.colour + ')' } },
      h('div.head', h('div.t', h('div.tier', TIER[it.kind] + ' · replaced'), h('div.name', it.name), h('div.meta', 'You did ' + it.replacedBy.toLowerCase() + ' instead. ' + (it.kind === 't3' ? '' : 'Same weight next time.'))),
        h('button.iconbtn', { type: 'button', 'aria-label': 'Undo replace', style: { background: 'transparent' }, onclick: () => undoInstead(i) }, icon('undo'))));
  }
  const res = outcome(it);
  const allDone = it.sets.every((x) => x.done != null);
  const uniform = it.sets.every((x) => x.w === it.sets[0].w);
  const top = Math.max(...it.sets.map((x) => x.w));
  const isWeight = !it.bodyweight && (!it.accKind || it.accKind === 'weight');

  const weightBox = isWeight && uniform ? h('label.weight',
    h('input', {
      type: 'text', inputmode: 'decimal', value: num(it.sets[0].w, 2), 'aria-label': it.name + ' weight in kg',
      onchange: (e) => {
        const v = parseNum(e.target.value);
        if (!Number.isFinite(v) || v < 0) { e.target.value = num(it.sets[0].w, 2); return; }
        editActive((a) => { const x = a.items[i]; x.sets.forEach((st) => { st.w = v; }); x.manual = true; });
      },
    }), h('span', 'kg')) : it.bodyweight && top > 0 ? h('span.chip.gold', '+' + num(top) + ' kg') : null;

  const sets = h('div.sets', it.sets.map((st, j) => {
    const done = st.done != null;
    const short = done && st.done < st.reps;
    const label = st.amrap ? st.reps + '+' : String(st.reps);
    return h('button.set' + (done && !short ? '.on' : '') + (short ? '.fail' : '') + (st.amrap ? '.amrap' : ''), {
      type: 'button', 'aria-pressed': String(done),
      'aria-label': 'Set ' + (j + 1) + ': ' + label + (it.unit === 's' ? ' seconds' : ' reps') + (isWeight || st.w ? ' at ' + num(st.w) + ' kg' : '') + (done ? ', done ' + st.done : ''),
      onclick: () => tapSet(i, j),
    },
    h('b', done ? (short ? String(st.done) : '✓') : label),
    h('small', it.unit === 's' ? 'sec' : st.neg ? 'neg.' : !uniform || (it.bodyweight && st.w) ? num(st.w) + (it.bodyweight ? '+' : '') : st.amrap ? 'max' : 'reps'));
  }));

  const info = [];
  if (it.warmup?.length && !it.sets.some((x) => x.done != null)) info.push(h('div.info', h('b', 'Warm-up '), it.warmup.map((w) => num(w.w) + '×' + w.reps).join(' · ')));
  if (isWeight && (it.kind === 't1' || it.kind === 't2') && top > BAR) info.push(h('div.info', plates(top)));
  if (it.note) info.push(h('div.info', it.note));

  return h('article.ex' + (res !== 'skip' && allDone ? '.done' : ''), { style: { '--c': 'var(--' + it.colour + ')' } },
    h('div.head',
      h('div.t', h('div.tier', it.extra ? 'Balance · ' + TIER[it.kind] : it.why ? TIER[it.kind] + ' · ' + it.why : TIER[it.kind]), h('div.name', it.name),
        h('div.meta', setsSummary(it))),
      weightBox,
      h('button.iconbtn', { type: 'button', 'aria-label': 'More for ' + it.name, onclick: () => itemMenu(i), style: { background: 'transparent' } }, icon('more'))),
    sets,
    info,
    allDone && h('div.howhard', h('p', 'How was the last set?'),
      h('div.seg', RATINGS.map(([v, t]) => h('button', {
        type: 'button', 'aria-pressed': String(it.rating === v),
        onclick: () => editActive((a) => { a.items[i].rating = a.items[i].rating === v ? null : v; }),
      }, t)))),
  );
}

function setsSummary(it) {
  const reps = it.sets.map((x) => x.reps);
  const same = reps.every((r) => r === reps[0]);
  const unit = it.unit === 's' ? ' s' : '';
  return (same ? it.sets.length + ' × ' + reps[0] + unit : reps.join(' · ')) + (it.sets.some((x) => x.amrap) ? ' · last set as many as you can' : '');
}

function tapSet(i, j) {
  const it = get().active.items[i], st = it.sets[j];
  if (st.done == null && !st.amrap) {
    editActive((a) => { a.items[i].sets[j].done = st.reps; });
    restAfter(i, j);
    return;
  }
  repsSheet(i, j);
}

function restAfter(i, j) {
  const ses = get().active, it = ses.items[i];
  const lastSetOfAll = i === ses.items.length - 1 && j === it.sets.length - 1;
  if (lastSetOfAll) { stopRest(); return; }
  const tips = REST_TIPS[it.exId] || [];
  const tip = it.kind === 't1' && tips.length ? 'Between sets: ' + tips[Math.floor(Math.random() * tips.length)] : '';
  startRest(it.rest || 90, it.name, tip);
}

/** Pick how many reps were done (for "as many as you can" sets, or to correct a set). */
function repsSheet(i, j) {
  const it = get().active.items[i], st = it.sets[j];
  const max = st.amrap ? Math.max(st.reps + 10, 15) : st.reps;
  const step = it.unit === 's' ? 5 : 1;
  const values = [];
  for (let v = 0; v <= max; v += step) values.push(v);
  sheet((close) => h('div',
    h('h2', 'Set ' + (j + 1)),
    h('p.muted.lead', st.amrap ? 'How many clean reps did you get?' : 'How many ' + (it.unit === 's' ? 'seconds' : 'reps') + ' did you get? Target ' + st.reps + '.'),
    h('div.seg', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' } }, values.map((v) => h('button', {
      type: 'button', 'aria-pressed': String(st.done === v),
      onclick: () => { const was = st.done; editActive((a) => { a.items[i].sets[j].done = v; }); close(); if (was == null) restAfter(i, j); },
    }, String(v)))),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => { editActive((a) => { a.items[i].sets[j].done = null; }); close(); } }, 'Not done'),
      h('button.btn', { type: 'button', onclick: () => close() }, 'Close'))));
}

function itemMenu(i) {
  const it = get().active.items[i];
  sheet((close) => h('div',
    h('h2', it.name),
    it.note && h('p.muted.lead', it.note),
    it.warmup?.length > 0 && h('p.small', { style: { marginBottom: '12px' } }, h('b', 'Warm-up: '), it.warmup.map((w) => num(w.w) + ' × ' + w.reps).join(' · ')),
    h('div.optlist',
      h('button', { type: 'button', onclick: () => { editActive((a) => { a.items[i].sets.forEach((x) => { x.done = x.reps; }); }); close(); } }, h('span', 'Mark all sets done')),
      h('button', { type: 'button', onclick: () => { editActive((a) => { a.items[i].sets.forEach((x) => { x.done = null; }); a.items[i].rating = null; }); close(); } }, h('span', 'Clear sets', h('small', 'Nothing done means skipped: no change next time'))),
      it.kind !== 't1' && h('button', { type: 'button', onclick: () => { editActive((a) => { a.items[i].sets.push({ ...a.items[i].sets[a.items[i].sets.length - 1], done: null, amrap: false, test: false }); }); close(); } }, h('span', 'Add a set')),
      !it.instead && h('button', { type: 'button', onclick: () => { close(); insteadOf(i); } }, h('span', 'I did something else instead', h('small', 'Log what you did. It counts for the muscles; ' + (it.kind === 't3' ? 'this one stays as it is.' : 'this lift keeps its weight and comes back.')))),
      it.kind === 't3' && h('button', { type: 'button', onclick: async () => { close(); swapAccessory(i); } }, h('span', 'Swap for another exercise', h('small', 'For today only'))),
    ),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Close'))));
}

async function swapAccessory(i) {
  const s = get();
  const all = [...ACCESSORIES, ...s.custom];
  const id = await choose({ title: 'Swap for', options: all.map((a) => ({ value: a.id, text: a.name, sub: GROUPS[a.group] || 'Own exercise' })), selected: s.active.items[i].exId });
  if (!id) return;
  const plan = planWorkout({ ...s.prog, t3: { A: [id], B: [id] } }, 'A', { custom: s.custom });
  const fresh = startSession({ ...plan, items: plan.items.filter((x) => x.kind === 't3') }).items[0];
  if (fresh) editActive((a) => { a.items[i] = fresh; });
}

async function discard() {
  const ok = await confirmSheet({ title: 'Discard this workout?', text: 'Nothing from it is saved, and the program does not change.', yes: 'Discard', danger: true });
  if (!ok) return;
  stopRest();
  change((s) => { s.active = null; });
  try { wakeLock?.release(); } catch { /* fine */ }
}

function finishSheet() {
  const ses = get().active;
  const started = ses.items.filter((it) => outcome(it) !== 'skip');
  const note = h('textarea', { placeholder: 'How it went, anything that hurt, sleep, food, work…', value: ses.note || '', oninput: (e) => later('note', () => editActive((a) => { a.note = e.target.value; }, { quiet: true })) });
  const beat = h('div.seg', [[false, 'Felt fine'], [true, 'Beat up']].map(([v, t]) => h('button', {
    type: 'button', 'aria-pressed': String(!!ses.beatUp === v),
    onclick: (e) => { editActive((a) => { a.beatUp = v; }, { quiet: true }); [...beat.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
  }, t)));
  // When it was: today by default, or a day you log afterwards
  const today = iso();
  const yday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); })();
  let dato = ses.date || today;
  const datoFelt = h('input', { type: 'date', value: dato, max: today, style: { flex: '1.2', minHeight: '44px' }, onchange: (e) => { if (e.target.value) { dato = e.target.value; mark(); } } });
  const knapp = (d, t) => h('button', { type: 'button', 'data-d': d, onclick: () => { dato = d; datoFelt.value = d; mark(); } }, t);
  const when = h('div.seg', { style: { alignItems: 'center' } }, knapp(today, 'Today'), knapp(yday, 'Yesterday'), datoFelt);
  const mark = () => [...when.querySelectorAll('button')].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === dato)));
  mark();
  sheet((close) => h('div',
    h('h2', 'Finish workout'),
    h('p.muted.lead', started.length + ' of ' + ses.items.length + ' exercises done · ' + minutes(ses.start) + ' min. Exercises you didn\'t start are skipped — they stay the same next time.'),
    h('label.field', h('span', 'When'), when),
    h('label.field', h('span', 'How do you feel?'), beat),
    h('label.field', h('span', 'Note'), note),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Back'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => { close(); finish(note.value, dato); } }, 'Save workout'))));
}

function finish(noteText, dato = iso()) {
  stopRest();
  let changes = [];
  const before = badges(get());
  change((s) => {
    const ses = s.active;
    ses.note = noteText;
    ses.end = new Date().toISOString();
    // Logged afterwards: move it to that day, same time of day and length
    if (dato && dato !== ses.date) {
      const len = new Date(ses.end) - new Date(ses.start);
      const st = new Date(dato + ses.start.slice(10));
      const at = Number.isFinite(st.getTime()) ? st : new Date(dato + 'T17:00');
      ses.date = dato; ses.start = at.toISOString(); ses.end = new Date(at.getTime() + len).toISOString();
    }
    for (const it of ses.items) if (outcome(it) !== 'skip' && !it.rating) it.rating = 'ok';
    const r = applySession(s.prog, ses, { custom: s.custom });
    changes = r.changes;
    ses.changes = changes;
    s.prog = r.prog;
    if (ses.items.some((it) => outcome(it) !== 'skip')) {
      s.sessions.push(ses);
      s.sessions.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)); // a late log goes in its place
    }
    s.active = null;
    // Auto balance: put the most needed exercises into the next workout
    if (s.settings?.balance === 'auto') {
      const a = analyze(s);
      s.prog.extra = balanceExtras(a, planToday(s), { custom: s.custom });
      if (s.prog.extra.length) changes.push({ exId: '', name: 'Balance', text: 'Added to the next workout: ' + s.prog.extra.map((x) => accessory(x.id, s.custom)?.name).join(', ') + '.', dir: 0 });
    }
  });
  try { wakeLock?.release(); } catch { /* fine */ }
  scrollTo(0, 0);
  summarySheet(changes, newBadges(before, badges(get())));
}

function summarySheet(changes, won = []) {
  sheet((close) => h('div',
    h('h2', 'Saved'),
    won.length > 0 && h('div.won', won.map((b) => h('div.badge.got.big', { style: { '--c': 'var(--' + b.colour + ')' } }, h('span.medal', icon(b.icon)), h('b', 'New badge: ' + b.name), h('small', b.desc)))),
    h('p.muted.lead', 'What changes next time:'),
    h('div', { style: { margin: '0 -16px' } }, changes.length ? changes.map((c) => h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
      h('div.main', h('b', c.name), h('small', c.text)),
      h('span.value', c.dir > 0 ? h('span.chip.up', 'up') : c.dir < 0 ? h('span.chip.down', 'down') : h('span.chip', 'same')))) : h('p.empty', 'Nothing changes.')),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => { close(); go('coach'); } }, icon('coach'), 'Ask coach'),
      h('button.btn', { type: 'button', onclick: () => close() }, 'Done'))));
}

/* ---------- Accessories per workout ---------- */
export function accessoriesSheet() {
  const content = h('div');
  const draw = () => {
    const s = get();
    const all = [...ACCESSORIES, ...s.custom];
    clear(content,
      h('h2', 'Accessories'),
      h('p.muted.lead', (get().settings?.accMode || 'auto') === 'auto' ? 'The app picks accessories for each workout from what lags behind. The ones here are favourites: they get picked a little more often. They go up by reps first, then weight.' : 'Extra work after the main lifts. 1–3 per workout is plenty. They go up by reps first, then weight.'),
      ['A', 'B'].map((w) => h('div', { style: { margin: '0 -16px 12px' } },
        h('div.row', { style: { gridTemplateColumns: '1fr auto' } }, h('div.main', h('b', 'Workout ' + w)), h('span.value', s.prog.t3[w].length + ' chosen')),
        s.prog.t3[w].map((id) => {
          const a = accessory(id, s.custom);
          const st = s.prog.acc[id];
          return row({ title: a?.name || id, sub: st ? (a?.kind === 'weight' ? num(st.w) + ' kg × ' + st.reps : st.reps + (a?.kind === 'time' ? ' s' : ' reps')) : 'Not done yet', value: h('span.chip.down', 'Remove'), onclick: () => { change((x) => { x.prog.t3[w] = x.prog.t3[w].filter((y) => y !== id); }); draw(); } });
        }),
        h('div', { style: { padding: '8px 16px' } }, h('button.textbtn', { type: 'button', onclick: async () => {
          const id = await choose({ title: 'Add to workout ' + w, options: all.filter((a) => !s.prog.t3[w].includes(a.id)).map((a) => ({ value: a.id, text: a.name, sub: (GROUPS[a.group] || 'Own exercise') + ' · ' + a.range[0] + '–' + a.range[1] + (a.kind === 'time' ? ' s' : ' reps') })) });
          if (id) { change((x) => { x.prog.t3[w] = [...x.prog.t3[w], id]; }); draw(); }
        } }, icon('plus'), 'Add exercise')))),
      h('div.btnrow',
        h('button.btn.secondary', { type: 'button', onclick: () => { closeIt(); go('settings'); } }, 'Own exercises'),
        h('button.btn', { type: 'button', onclick: () => closeIt() }, 'Done')));
  };
  let closeIt = () => {};
  draw();
  sheet((close) => { closeIt = close; return content; });
}

export { loadable, dayLabel };

/* ---------- Add an exercise during a workout ---------- */
async function addExercise() {
  const s = get();
  const id = await pickExercise({ title: 'Add an exercise', includeMain: s.active.kind === 'free' });
  if (!id) return;
  const item = makeItem(get(), id);
  if (item) editActive((x) => { x.items.push(item); });
}

/** A session item for any exercise: a main lift (with its program weights) or an accessory. */
function makeItem(s, id) {
  if (MAIN[id]) return startSession({ wid: 'F', items: [planT1(s.prog, id, iso(), false)] }).items[0];
  const plan = planWorkout({ ...s.prog, extra: [{ id }] }, 'A', { custom: s.custom, t3: [] });
  const item = startSession(plan).items.find((it) => it.exId === id && it.kind === 't3');
  return item && { ...item, extra: false, key: 't3-' + id, note: item.note.replace(/^Added for balance\. /, '') };
}

/**
 * Pick an exercise. like: an exercise id; those that train the same muscles come first
 * (for "did something else instead"). Otherwise what the muscles lack comes first.
 * Includes "+ New exercise" for things that are not in the list.
 */
async function pickExercise({ title, like = null, includeMain = false }) {
  const s = get();
  const a = analyze(s);
  const inSession = new Set((s.active?.items || []).map((it) => it.exId));
  const atHome = s.active?.place === 'home';
  const gear = gearOf(s);
  let all = [...ACCESSORIES, ...s.custom].filter((x) => !inSession.has(x.id) && (!atHome || canDo(x.id, gear, s.custom)));
  if (includeMain) all = [...MAIN_IDS.filter((id) => !inSession.has(id)).map((id) => ({ id, name: MAIN[id].name })), ...all];
  const need = (id) => Object.entries(worksFor(id, s.custom)).reduce((sum, [m, f]) => {
    const x = a.by[m];
    return sum + (x && !x.quiet && (!x.optional || x.focus) ? f * Math.max(0, 1 - x.projected / Math.max(1, x.target[0])) : 0);
  }, 0);
  const score = like ? (x) => overlap(like, x.id, s.custom) : (x) => need(x.id);
  const sorted = all.map((x) => ({ x, n: score(x) })).sort((p, q) => q.n - p.n);
  const muscles = (id) => Object.entries(worksFor(id, s.custom)).filter(([, f]) => f >= 1).map(([m]) => MUSCLE[m]?.name).join(', ');
  const id = await choose({ title, options: [
    { value: '__new', text: '+ New exercise', sub: 'Not in the list? Name it and pick the body part' },
    ...sorted.map(({ x, n }) => ({ value: x.id, text: x.name, sub: (like ? (n >= 1 ? 'Same muscles: ' : '') : n > 0.3 ? 'Helps: ' : '') + muscles(x.id) })),
  ] });
  if (id === '__new') return newExerciseSheet(like);
  return id;
}

/** Make a new own exercise on the spot. Resolves its id, or null. */
function newExerciseSheet(like = null) {
  const guess = { bp: 'chest', op: 'shoulders', sq: 'legs', dl: 'legs', pu: 'back' }[like] || accessory(like, get().custom)?.group || 'chest';
  const v = { group: guess, kind: 'weight' };
  const name = h('input', { type: 'text', placeholder: 'Cable flyes', autocomplete: 'off' });
  const seg = (opts, key) => {
    const el = h('div.seg', opts.map(([val, t]) => h('button', {
      type: 'button', 'aria-pressed': String(v[key] === val),
      onclick: (e) => { v[key] = val; [...el.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
    }, t)));
    return el;
  };
  return new Promise((resolve) => {
    let answer = null;
    sheet((close) => h('div',
      h('h2', 'New exercise'),
      h('p.muted.lead', 'It is saved with your own exercises. The body part tells the app which muscles it trains.'),
      h('label.field', h('span', 'Name'), name),
      h('label.field', h('span', 'Body part'), seg(Object.entries(GROUPS), 'group')),
      h('label.field', h('span', 'Progress by'), seg([['weight', 'Weight'], ['reps', 'Reps'], ['time', 'Time']], 'kind')),
      h('div.btnrow',
        h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
        h('button.btn', { type: 'button', onclick: () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          const ex = { id: 'own-' + Date.now().toString(36), name: n.slice(0, 50), group: v.group, kind: v.kind, range: v.kind === 'time' ? [20, 60] : [8, 12], step: 2.5, start: 0, own: true };
          change((x) => { x.custom = [...(x.custom || []), ex]; }, { quiet: true });
          answer = ex.id;
          close();
        } }, 'Add'))),
    { onClose: () => resolve(answer) });
  });
}

/** You did something else instead of this exercise: log that one, and mark this one as replaced. */
async function insteadOf(i) {
  const it = get().active.items[i];
  const id = await pickExercise({ title: 'What did you do instead of ' + it.name.toLowerCase() + '?', like: it.exId });
  if (!id) return;
  const item = makeItem(get(), id);
  if (!item) return;
  editActive((a) => {
    const orig = a.items[i];
    orig.sets.forEach((x) => { x.done = null; });
    orig.rating = null;
    orig.replacedBy = item.name;
    a.items.splice(i + 1, 0, { ...item, instead: orig.exId, why: 'Instead of ' + orig.name.toLowerCase() });
  });
  toast(item.name + ' counts for the muscles. ' + it.name + ' keeps its plan.');
}

function undoInstead(i) {
  editActive((a) => {
    const orig = a.items[i];
    const j = a.items.findIndex((x, k) => k > i && x.instead === orig.exId);
    if (j > i) a.items.splice(j, 1);
    delete orig.replacedBy;
  });
}

/** An empty workout: add whatever you did (any exercise, main lifts too). */
function beginFree() {
  unlockSound();
  change((s) => { s.active = startSession({ wid: 'F', place: uiGet('place', 'gym'), kind: 'free', name: 'Own workout', items: [] }); });
  keepAwake();
  scrollTo(0, 0);
}
