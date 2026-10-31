/* Train: the next workout, and the workout in progress. */

import { h, icon, clear, sheet, confirmSheet, choose, block, row, fold, toast } from '../dom.js';
import { get, change, setupProgram } from '../state.js';
import {
  planWorkout, startSession, applySession, outcome, deloadReason, startDeload, skipDeload,
  plates, liftStatus, iso, BAR, loadable,
} from '../program.js';
import { MAIN, MAIN_IDS, ACCESSORIES, GROUPS, REST_TIPS, accessory } from '../data/exercises.js';
import { startRest, stopRest, unlockSound } from '../timer.js';
import { num, ago, parseNum, minutes, dayLabel } from '../util.js';
import { later } from '../store.js';
import { cardioSheet } from './body.js';
import { go } from '../nav.js';

const TIER = { t1: 'Main lift', t2: 'Second lift', pu: 'Pull-ups', t3: 'Accessory' };
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
  const plan = planWorkout(prog, prog.next, { today, custom: s.custom });
  const last = s.sessions[s.sessions.length - 1];
  const reason = deloadReason(prog, s.sessions, today);

  const planRows = plan.items.map((it) => {
    const top = Math.max(...it.sets.map((x) => x.w));
    const reps = it.sets.map((x) => x.reps);
    const same = reps.every((r) => r === reps[0]);
    const scheme = it.kind === 'pu' ? it.sets.length + ' sets' : same ? it.sets.length + ' × ' + reps[0] + (it.sets.some((x) => x.amrap) ? '+' : '') : it.sets.length + ' sets';
    const weight = it.bodyweight ? (top > 0 ? '+' + num(top) : 'BW') : it.accKind && it.accKind !== 'weight' ? '' : num(top);
    return h('li', { style: { '--c': 'var(--' + it.colour + ')' } }, h('span.dot'),
      h('div', h('b', it.name), h('small', TIER[it.kind] + ' · ' + scheme + (it.unit === 's' ? ' s' : ''))),
      h('span.w', weight));
  });

  clear(root,
    header('Train', last ? 'Last trained ' + ago(last.date, today) : 'First workout'),
    reason && h('div.banner', icon('info'), h('div.text', h('b', 'A lighter couple of sessions?'), reason + ' Two sessions at 90 % with half the sets lets fatigue drop. You keep your strength.'),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('button', { type: 'button', onclick: () => change((x) => { x.prog = startDeload(x.prog); }) }, 'Yes'),
        h('button', { type: 'button', onclick: () => change((x) => { x.prog = skipDeload(x.prog); }) }, 'No'))),
    h('div.hero',
      h('div.kicker', plan.deload ? 'Next · lighter session' : 'Next'),
      h('h2', plan.name),
      h('p.why', plan.items.filter((i) => i.kind === 't1').map((i, n) => (n ? MAIN[i.exId].short.toLowerCase() : MAIN[i.exId].short)).join(' and ') + ' heavy, ' + plan.items.filter((i) => i.kind === 't2').map((i) => MAIN[i.exId].short.toLowerCase()).join(', ') + ' lighter, then pull-ups and accessories.'),
      h('ul.plan', planRows),
      [...plan.notes, ...plan.items.filter((i) => i.note && i.kind === 't1' && /days|Stalled|Missed|Wave/.test(i.note)).map((i) => MAIN[i.exId].short + ': ' + i.note)]
        .map((n) => h('p.muted.small', { style: { marginTop: '10px' } }, n)),
      h('div.btnrow',
        h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => begin(plan) }, 'Start workout'),
        h('button.btn.secondary', { type: 'button', onclick: () => change((x) => { x.prog.next = x.prog.next === 'A' ? 'B' : 'A'; }) }, icon('swap'), plan.wid === 'A' ? 'B' : 'A'))),
    goalsBlock(prog, today),
    block('More', '',
      row({ title: 'Log cardio', sub: 'Run, walk, bike, row or swim', onclick: () => cardioSheet() }),
      row({ title: 'Accessories in each workout', sub: 'A: ' + names(prog.t3.A, s.custom) + ' · B: ' + names(prog.t3.B, s.custom), onclick: () => accessoriesSheet() })),
  );
}

const names = (ids, custom) => ids.map((id) => accessory(id, custom)?.name).filter(Boolean).join(', ') || 'none';

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
    header(ses.wid === 'A' ? 'Workout A' : 'Workout B', (ses.deload ? 'Lighter session · ' : '') + minutes(ses.start) + ' min · ' + doneItems + ' of ' + ses.items.length + ' started'),
    ses.items.map((it, i) => exerciseCard(it, i)),
    h('div.btnrow', { style: { marginTop: '4px' } },
      h('button.btn.secondary', { type: 'button', onclick: discard }, 'Discard'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: finishSheet }, icon('check'), 'Finish workout')),
  );
}

function editActive(fn, opts) { change((s) => { if (s.active) fn(s.active); }, opts); }

function exerciseCard(it, i) {
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
      h('div.t', h('div.tier', TIER[it.kind]), h('div.name', it.name),
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
  sheet((close) => h('div',
    h('h2', 'Finish workout'),
    h('p.muted.lead', started.length + ' of ' + ses.items.length + ' exercises done · ' + minutes(ses.start) + ' min. Exercises you didn\'t start are skipped — they stay the same next time.'),
    h('label.field', h('span', 'How do you feel?'), beat),
    h('label.field', h('span', 'Note'), note),
    h('div.btnrow',
      h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Back'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => { close(); finish(note.value); } }, 'Save workout'))));
}

function finish(noteText) {
  stopRest();
  let changes = [];
  change((s) => {
    const ses = s.active;
    ses.note = noteText;
    ses.end = new Date().toISOString();
    for (const it of ses.items) if (outcome(it) !== 'skip' && !it.rating) it.rating = 'ok';
    const r = applySession(s.prog, ses, { custom: s.custom });
    changes = r.changes;
    ses.changes = changes;
    s.prog = r.prog;
    if (ses.items.some((it) => outcome(it) !== 'skip')) s.sessions.push(ses);
    s.active = null;
  });
  try { wakeLock?.release(); } catch { /* fine */ }
  scrollTo(0, 0);
  summarySheet(changes);
}

function summarySheet(changes) {
  sheet((close) => h('div',
    h('h2', 'Saved'),
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
      h('p.muted.lead', 'Extra work after the main lifts. 1–3 per workout is plenty. They go up by reps first, then weight.'),
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
