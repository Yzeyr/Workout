/* Settings: profile, goals, program, own exercises, coach key, backup. */

import { h, icon, clear, sheet, confirmSheet, choose, block, row, toast } from '../dom.js';
import { get, change, replaceAll } from '../state.js';
import { MAIN, MAIN_IDS, GROUPS } from '../data/exercises.js';
import { loadable, iso, newProgram } from '../program.js';
import { num, parseNum, dayLabel } from '../util.js';
import { KEYS, read, write, readJson, writeJson, uiGet, uiSet } from '../store.js';
import { hasKey, forgetKey } from '../coach.js';
import { keySheet } from './coach.js';
import { applyTheme } from '../main.js';
import { gearSheet } from './train.js';
import { gearOf, gearText } from '../home.js';

export function settingsView(root) {
  const s = get();
  const prog = s.prog;
  const lastBackup = read(KEYS.lastBackup);
  const theme = uiGet('theme', 'system');
  clear(root,
    h('div.top', h('a.iconbtn', { href: '#train', 'aria-label': 'Back' }, icon('back')), h('div.titles', h('div.eyebrow', 'Workout'), h('h1', 'Settings'))),
    block('You', '',
      row({ title: 'Profile', sub: [s.profile.birthYear && 'Born ' + s.profile.birthYear, s.profile.sex, s.profile.heightCm && s.profile.heightCm + ' cm'].filter(Boolean).join(' · ') || 'Age, sex and height help the coach', onclick: profileSheet }),
      prog && row({ title: 'Two-year goals', sub: MAIN_IDS.map((id) => MAIN[id].short + ' ' + prog.goals[id]).join(' · ') + ' · Pull-ups ' + prog.goals.pu, onclick: goalsSheet })),
    prog && h('section.block.c-accent', h('header', h('h3', 'Program'), h('span', 'since ' + dayLabel(prog.started))),
      MAIN_IDS.map((id) => {
        const L = prog.lifts[id];
        return row({ title: MAIN[id].name, sub: L.mode === 'wave' ? 'Waves · training max ' + num(L.tm) + ' kg' : num(L.w) + ' kg · ' + ['3×' + L.reps, '5×3', '6×2'][L.stage] + ' · second lift ' + num(L.t2.w) + ' kg × ' + L.t2.reps, onclick: () => liftSheet(id) });
      }),
      row({ title: 'Pull-ups', sub: 'Max ' + prog.pu.max + ' · total target ' + prog.pu.total + (prog.pu.add ? ' · +' + prog.pu.add + ' kg weighted' : ''), onclick: pullupSheet }),
      row({ title: 'Smallest jump on the bar', value: num(prog.jump, 2) + ' kg', onclick: async () => {
        const v = await choose({ title: 'Smallest jump', options: [{ value: 2.5, text: '2.5 kg', sub: '1.25 kg plates' }, { value: 1.25, text: '1.25 kg', sub: '0.625 kg plates' }, { value: 1, text: '1 kg', sub: '0.5 kg plates' }], selected: prog.jump });
        if (v) change((x) => { x.prog.jump = v; });
      } }),
      row({ title: 'Equipment at home', sub: gearText(gearOf(s)), onclick: gearSheet }),
      row({ title: 'Accessories', sub: (s.settings?.accMode || 'auto') === 'auto' ? 'Built for each workout from what lags behind and what is recovered' : 'Fixed lists for squat days and deadlift days', value: (s.settings?.accMode || 'auto') === 'auto' ? 'Built' : 'Fixed', onclick: async () => {
        const v = await choose({ title: 'Accessories', selected: s.settings?.accMode || 'auto', options: [
          { value: 'auto', text: 'Built each time', sub: 'Picks 1–4 accessories for the muscles that lag most, keeps an exercise going for weeks so it can progress, then varies it' },
          { value: 'fixed', text: 'Fixed lists', sub: 'The same accessories every squat day and every deadlift day (Train → Accessories)' }] });
        if (v) change((x) => { x.settings = { ...(x.settings || {}), accMode: v }; });
      } }),
      row({ title: 'Own exercises', sub: s.custom.length ? s.custom.map((c) => c.name).join(', ') : 'Add exercises the catalog lacks', onclick: customSheet })),
    block('App', '',
      row({ title: 'Rest timer sound', value: uiGet('sound', '1') === '1' ? 'On' : 'Off', onclick: () => { uiSet('sound', uiGet('sound', '1') === '1' ? '0' : '1'); settingsView(root); } }),
      row({ title: 'Appearance', value: { system: 'Follow phone', dark: 'Dark', light: 'Light' }[theme], onclick: async () => {
        const v = await choose({ title: 'Appearance', options: [{ value: 'system', text: 'Follow phone' }, { value: 'dark', text: 'Dark' }, { value: 'light', text: 'Light' }], selected: theme });
        if (v) { uiSet('theme', v); applyTheme(); settingsView(root); }
      } }),
      row({ title: 'Coach (API key)', sub: hasKey() ? 'Saved on this phone' : 'Not added', value: hasKey() ? h('span.chip.down', 'Remove') : h('span.chip.up', 'Add'), onclick: async () => {
        if (!hasKey()) { keySheet(() => settingsView(root)); return; }
        if (await confirmSheet({ title: 'Remove the API key?', text: 'The coach stops working on this phone until you add a key again.', yes: 'Remove', danger: true })) { forgetKey(); settingsView(root); }
      } })),
    block('Backup', lastBackup ? 'last ' + dayLabel(lastBackup) : 'none yet',
      h('p.note', { style: { paddingTop: '0' } }, 'Everything lives on this phone. Save a backup now and then — to iCloud Drive, not "On My iPhone", so it survives a lost phone. The API key is never included.'),
      row({ title: 'Export backup', sub: 'Program, log, body, cardio, health summaries and the coach chat', onclick: exportBackup }),
      row({ title: 'Import backup', sub: 'Replaces what is on this phone', onclick: importBackup })),
    block('More', '',
      h('a.row', { href: 'v1/', style: { color: 'inherit', textDecoration: 'none' } }, h('div.main', h('b', 'Old app (Block 01)'), h('small', 'Your earlier log, unchanged, at /Workout/v1/')), h('span.value', ''), h('span.chev', icon('chevron'))),
      row({ title: 'Start over', sub: 'Deletes the program and log on this phone', onclick: startOver })),
  );
}

/* ---------- Sheets ---------- */
function numField(label, value, opts = {}) {
  const input = h('input', { type: 'text', inputmode: opts.int ? 'numeric' : 'decimal', value: value ?? '', placeholder: opts.placeholder || '' });
  return { el: h('label.field', h('span', label), input), get: () => parseNum(input.value) };
}

function profileSheet() {
  const p = get().profile;
  const year = numField('Birth year', p.birthYear, { int: true, placeholder: '1994' });
  const height = numField('Height (cm)', p.heightCm, { int: true });
  let sex = p.sex || '';
  const seg = h('div.seg', [['male', 'Male'], ['female', 'Female'], ['', 'Skip']].map(([v, t]) => h('button', {
    type: 'button', 'aria-pressed': String(sex === v),
    onclick: (e) => { sex = v; [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
  }, t)));
  sheet((close) => h('div', h('h2', 'Profile'),
    h('p.muted.lead', 'Used by the coach to judge pulse, VO₂ max, sleep and food needs. Stays on this phone.'),
    h('div.fields2', year.el, height.el), h('label.field', h('span', 'Sex'), seg),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => {
        const y = year.get(), hc = height.get();
        change((s) => { s.profile = { birthYear: y > 1900 && y < 2020 ? Math.round(y) : null, heightCm: hc > 100 && hc < 250 ? Math.round(hc) : null, sex: sex || null }; });
        close(); toast('Profile saved');
      } }, 'Save'))));
}

function goalsSheet() {
  const g = get().prog.goals;
  const f = Object.fromEntries([...MAIN_IDS, 'pu'].map((id) => [id, numField(id === 'pu' ? 'Pull-ups (reps)' : MAIN[id].name + ' (kg)', g[id])]));
  sheet((close) => h('div', h('h2', 'Two-year goals'),
    h('p.muted.lead', 'The goal bars compare you with a curve that is fast early and slows down.'),
    h('div.fields2', ...Object.values(f).map((x) => x.el)),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => {
        change((s) => { for (const [id, x] of Object.entries(f)) { const v = x.get(); if (v > 0) s.prog.goals[id] = id === 'pu' ? Math.round(v) : v; } });
        close(); toast('Goals saved');
      } }, 'Save'))));
}

function liftSheet(id) {
  const L = get().prog.lifts[id];
  const work = numField(L.mode === 'wave' ? 'Training max (kg)' : 'Working weight for 3×5 (kg)', num(L.mode === 'wave' ? L.tm : L.w, 2));
  const t2 = numField('Second lift weight (kg)', num(L.t2.w, 2));
  sheet((close) => h('div', h('h2', MAIN[id].name),
    h('p.muted.lead', L.mode === 'wave' ? 'This lift runs in 3-week waves from a training max.' : 'Change it if the program is off — for example after an injury, or if it feels far too light.'),
    h('div.fields2', work.el, t2.el),
    (L.stage > 0 || L.mode === 'wave') && h('button.btn.ghost.wide', { type: 'button', style: { marginBottom: '8px' }, onclick: () => {
      change((s) => { const x = s.prog.lifts[id]; if (x.mode === 'wave') { x.w = loadable(x.tm * 0.8, s.prog.jump); } x.mode = 'linear'; x.stage = 0; x.miss = 0; x.reps = 5; x.resets = []; });
      close(); toast(MAIN[id].short + ': back to 3×5');
    } }, 'Back to plain 3×5'),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => {
        const w = work.get(), w2 = t2.get();
        change((s) => {
          const x = s.prog.lifts[id], j = s.prog.jump;
          if (w > 0) { if (x.mode === 'wave') x.tm = loadable(w, j); else { x.w = loadable(w, j); x.miss = 0; } }
          if (w2 > 0) x.t2.w = loadable(w2, j);
        });
        close(); toast('Saved');
      } }, 'Save'))));
}

function pullupSheet() {
  const P = get().prog.pu;
  const max = numField('Best set (reps)', P.max, { int: true });
  const total = numField('Total reps target', P.total, { int: true });
  const add = numField('Added weight on weighted days (kg)', P.add);
  sheet((close) => h('div', h('h2', 'Pull-ups'),
    h('p.muted.lead', 'Every third pull-up day is a max test that sets these for you.'),
    h('div.fields3', max.el, total.el, add.el),
    h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', onclick: () => {
        change((s) => { const m = max.get(), t = total.get(), a = add.get(); if (m >= 0) s.prog.pu.max = Math.round(m); if (t > 0) s.prog.pu.total = Math.round(t); if (a >= 0) s.prog.pu.add = a; });
        close(); toast('Saved');
      } }, 'Save'))));
}

function customSheet() {
  const content = h('div');
  let closeIt = () => {};
  const draw = () => {
    const list = get().custom;
    clear(content, h('h2', 'Own exercises'),
      h('p.muted.lead', 'Add them to workout A or B under Train → Accessories. They go up by reps through the range, then by weight.'),
      h('div', { style: { margin: '0 -16px 8px' } }, list.length ? list.map((c) => row({ title: c.name, sub: (GROUPS[c.group] || '') + ' · ' + c.range[0] + '–' + c.range[1] + (c.kind === 'time' ? ' s' : ' reps') + (c.kind === 'weight' ? ' · +' + c.step + ' kg steps' : ''), onclick: () => editCustom(c, draw) })) : h('p.empty', 'None yet.')),
      h('div.btnrow', h('button.btn.secondary', { type: 'button', onclick: () => closeIt() }, 'Done'), h('button.btn', { type: 'button', onclick: () => editCustom(null, draw) }, icon('plus'), 'New')));
  };
  draw();
  sheet((close) => { closeIt = close; return content; });
}

function editCustom(c, after) {
  const v = c ? structuredClone(c) : { id: 'own-' + Date.now().toString(36), name: '', group: 'back', kind: 'weight', range: [8, 12], step: 2.5, start: 0, own: true };
  const name = h('input', { type: 'text', value: v.name, placeholder: 'Cable row' });
  const lo = numField('Reps from', v.range[0], { int: true }), hi = numField('to', v.range[1], { int: true });
  const step = numField('Weight step (kg)', v.step), start = numField('Start weight (kg)', v.start);
  const segOf = (opts, key) => { const seg = h('div.seg', opts.map(([val, t]) => h('button', { type: 'button', 'aria-pressed': String(v[key] === val), onclick: (e) => { v[key] = val; [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t))); return seg; };
  sheet((close) => h('div', h('h2', c ? 'Edit exercise' : 'New exercise'),
    h('label.field', h('span', 'Name'), name),
    h('label.field', h('span', 'Body part'), segOf(Object.entries(GROUPS), 'group')),
    h('label.field', h('span', 'Progress by'), segOf([['weight', 'Weight'], ['reps', 'Reps'], ['time', 'Time']], 'kind')),
    h('div.fields2', lo.el, hi.el, step.el, start.el),
    h('div.btnrow',
      c ? h('button.btn.secondary', { type: 'button', onclick: async () => {
        if (!(await confirmSheet({ title: 'Delete ' + c.name + '?', text: 'It is also removed from workout A and B.', yes: 'Delete', danger: true }))) return;
        change((s) => { s.custom = s.custom.filter((x) => x.id !== c.id); if (s.prog) { s.prog.t3.A = s.prog.t3.A.filter((x) => x !== c.id); s.prog.t3.B = s.prog.t3.B.filter((x) => x !== c.id); } });
        close(); after();
      } }, icon('trash')) : h('button.btn.secondary', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.btn', { type: 'button', style: { flex: '2' }, onclick: () => {
        const n = name.value.trim();
        if (!n) { name.focus(); return; }
        const a = Math.round(lo.get()), b = Math.round(hi.get());
        Object.assign(v, { name: n.slice(0, 50), range: [a > 0 ? a : 8, b >= a && b > 0 ? b : Math.max(a, 12)], step: step.get() > 0 ? step.get() : 2.5, start: start.get() >= 0 ? start.get() : 0 });
        change((s) => { s.custom = [...s.custom.filter((x) => x.id !== v.id), v]; });
        close(); after();
      } }, 'Save'))));
}

/* ---------- Backup ---------- */
function exportBackup() {
  const data = { app: 'workout', version: 1, exported: new Date().toISOString(), state: get(), health: readJson(KEYS.health).value || null, chat: readJson(KEYS.chat).value || null };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'workout-backup-' + iso() + '.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  write(KEYS.lastBackup, iso());
  toast('Backup saved');
}

function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      let data;
      try { data = JSON.parse(r.result); } catch { toast('That file could not be read.'); return; }
      if (!data || data.app !== 'workout' || !data.state) { toast('That is not a Workout backup.'); return; }
      const ok = await confirmSheet({ title: 'Replace everything?', text: 'The backup from ' + (data.exported ? dayLabel(data.exported.slice(0, 10), { year: true }) : 'the file') + ' replaces what is on this phone now.', yes: 'Replace', danger: true });
      if (!ok) return;
      if (data.health) writeJson(KEYS.health, data.health);
      if (data.chat) writeJson(KEYS.chat, data.chat);
      replaceAll(data.state);
      toast('Backup restored');
    };
    r.readAsText(f);
  });
  input.click();
}

async function startOver() {
  if (!(await confirmSheet({ title: 'Start over?', text: 'The program, training log, measurements and cardio on this phone are deleted. Export a backup first if you might want them.', yes: 'Continue', danger: true }))) return;
  if (!(await confirmSheet({ title: 'Are you sure?', text: 'This cannot be undone.', yes: 'Delete everything', danger: true }))) return;
  replaceAll({ v: 1, created: iso(), profile: get().profile, prog: null, active: null, sessions: [], custom: [], body: {}, cardio: [], settings: {} });
  toast('Deleted. Set up a new program.');
  location.hash = '#train';
}

export { newProgram };
