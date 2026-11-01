/* The AI coach: Claude, with tools that read this app's data.

   The request goes straight from the phone to Anthropic with the owner's own
   API key. The key stays in this browser and is never in a backup. Data is only
   sent when the owner asks the coach something, and only what the coach looks
   up with its tools. The SDK is loaded the first time the coach is used, so the
   rest of the app works offline.

   The conversation is append-only: earlier turns are never edited, because the
   model's thinking blocks are only valid in the exact history that made them. */

import { KEYS, read, write, remove, readJson, writeJson } from './store.js';
import { get, change } from './state.js';
import { MAIN, MAIN_IDS, ACCESSORIES, accessory } from './data/exercises.js';
import { planWorkout, outcome, liftStatus, iso, loadable, startDeload, e1rm, RIR, daysBetween } from './program.js';
import { summarizeHealth } from './health.js';
import { health } from './views/body.js';
import { analyze, bestExercise } from './muscles.js';
import { MUSCLE } from './data/muscles.js';
import { readiness, insights } from './insights.js';
import { planToday } from './planner.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const MODEL = 'claude-opus-5-5';

export const hasKey = () => !!read(KEYS.apiKey);
export const saveKey = (k) => write(KEYS.apiKey, String(k).trim());
export const forgetKey = () => remove(KEYS.apiKey);

/* ---------- Conversation storage ---------- */
export function loadChat() {
  const r = readJson(KEYS.chat);
  const c = r.status === 'ok' && r.value ? r.value : null;
  return c && Array.isArray(c.messages) ? c : { messages: [], decided: {} };
}
export function saveChat(c) { return writeJson(KEYS.chat, c); }
export function clearChat() { remove(KEYS.chat); }

/* ---------- Instructions ---------- */
const SYSTEM = `You are the personal coach inside "Workout", a training app on the owner's iPhone.

The owner is a Norwegian house painter (physically active job, irregular hours) who started barbell training in August 2026 from the empty bar. Goals over two years: squat 155 kg, bench 130 kg, deadlift 210 kg, overhead press 80 kg, 20 pull-ups — and, in their words, to become "the healthiest version of myself".

How the app's program works (the "brain" — don't contradict it without saying why):
- Each gym workout has one heavy lower lift (squat or deadlift) and one heavy upper lift (bench or press), picked each day by the planner from how due each lift is (squat and bench ~2×/week, deadlift ~1×, press ~1.3×) and how recovered its muscles are. Bench and press are never in the same workout. Deadlift days add a light squat. The owner can change today's pick. No calendar; a missed day is never a failure.
- Main lifts (T1) are 3×5. After each lift the owner rates the last set easy/ok/hard/failed. Ok adds one step, easy two, hard repeats. A miss repeats the weight; the next miss switches to 5×3, then 6×2, then the weight resets −10 % to 3×5. Two resets within 8 weeks moves that lift to 3-week waves with a training max.
- Second lifts (T2) run 3×8–10 double progression. Accessories (T3) go up by reps, then weight.
- After a break, the load drops by days since that lift was done (≤13 days: same; 14–20: −10 %; 21–34: −15 %; 35–60: −25 %; more: −40 %), then climbs back in double steps.
- Deloads are only offered when something calls for it (hard/failed lifts, resets, feeling beat up): 2 sessions at 90 % with half the sets.
- Home: the owner can pick Gym or Home on the Train tab. A full home workout (when the gym is out) uses the home equipment for squat/push/hinge/row/press/core + pull-ups; a short home session (10–20 min) fills muscle gaps between gym days. Home sessions never move the A/B rotation or the barbell weights — the heavy lifts wait for the gym.
- Pull-ups: a total-rep target in sets just short of max, a max test every third pull-up day, weighted work from 8+ reps.
- Muscle balance: every exercise is mapped to muscles (1 set for the main muscle, 0.5 for helpers). The app compares weekly sets per muscle with a target range, warns when a muscle is left out several workouts in a row or the program gives too little, checks pull:push and hamstring:quad balance, and models recovery per muscle. Use get_muscle_balance for this; fix gaps with propose_change kind "extra" (one-off, next workout) or "accessory_add" (permanent).

Your job:
- Look at the data before you answer anything about it. Use the tools; don't guess numbers. Start with get_overview unless the question is purely general.
- Be concrete and practical for a busy person with a physical job: what to do this week, in what amounts, and why. Prioritise the few changes with the biggest effect (sleep, protein and total food, daily movement, consistency, recovery) over long lists.
- Use evidence-based guidance and say when something is uncertain or just convention.
- Health data comes from Apple Health exports and wearables. Wearable numbers (HRV, VO₂ max, sleep stages, calories) are estimates; treat trends as more meaningful than single values.
- You are not a doctor. Don't diagnose. If you see something that deserves medical attention (for example resting pulse persistently above ~100 or rising sharply, blood oxygen often below ~92 %, big unexplained weight change, chest pain, fainting, or anything the owner describes as worrying), say so plainly and suggest seeing a doctor.
- When a change to the program would help (a weight, an accessory, a goal, a deload), call propose_change. The owner sees it as a card and decides; never claim it is already applied.
- Write for a phone screen: short paragraphs, plain words, bullet lists where they help, **bold** for the key numbers. No tables. Answer in the language the owner writes in (often Norwegian or English).`;

/* ---------- Tools ---------- */
const accIds = () => [...ACCESSORIES, ...(get().custom || [])].map((a) => a.id);

function tools() {
  const lifts = [...MAIN_IDS, 'pu'];
  return [
    { name: 'get_overview', description: 'Profile, program state (working weights, stage, estimated maxes, goals and pace), the next planned workout, training frequency, and the latest bodyweight. Call this first.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'get_training_log', description: 'Finished workouts within the last N days, oldest first: every exercise with sets (weight × reps done / target), the rating of the last set, notes, and what the program changed afterwards.', input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 730, description: 'How many days back. Default 42.' } }, additionalProperties: false } },
    { name: 'get_health', description: 'Apple Health data: averages over the last N days compared with the N days before (steps, sleep, deep/REM sleep, resting pulse, HRV, VO2 max, weight, body fat, active energy, exercise minutes, walking pulse, breathing rate, blood oxygen), trends, workouts recorded by the watch, and the last 14 days as rows. Optionally daily values for chosen metrics.', input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 7, maximum: 365, description: 'Averaging window. Default 30.' }, daily: { type: 'array', items: { type: 'string', enum: ['steps', 'sleepH', 'deepH', 'remH', 'restingHr', 'hrvMs', 'vo2max', 'weightKg', 'bodyFatPct', 'activeKcal', 'exerciseMin', 'walkingHr', 'respiratoryRate', 'spo2', 'distanceKm'] }, description: 'Metrics to return day by day for the window (max 120 days).' } }, additionalProperties: false } },
    { name: 'get_muscle_balance', description: 'Weekly hard sets per muscle group (projected from the last 6 workouts × training frequency, and the last 7 days), target ranges, status, workouts in a row without that muscle, recovery % right now, 8-week trend, pull:push and hamstring:quad ratios, the app’s own warnings, and the best accessory to fix each gap.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'get_insights', description: 'Today’s readiness score (0–100) with its reasons and the owner’s check-in, plus the app’s rule-based health insights (sleep, resting pulse, HRV, steps, cardio minutes, VO2 max band, weight trend, protein target, consistency) with levels alert/warn/info/good.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'get_body_and_cardio', description: 'Body measurements logged in the app (bodyweight, waist, chest, arm, thigh, neck, hips, body fat, resting pulse) with dates, and cardio sessions (type, km, minutes, pace) within the last N days.', input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 730, description: 'Default 90.' } }, additionalProperties: false } },
    {
      name: 'propose_change',
      description: 'Suggest one change to the program. It is shown to the owner as a card with Apply / No thanks; it is not applied until they tap Apply. kind: "weight" sets the working weight (or training max in wave mode) of a main lift; "goal" sets a two-year goal (lift "pu" = pull-up reps); "accessory_add" / "accessory_remove" changes the accessories of workout A or B; "extra" adds an accessory (exercise_id) to the next workout only; "deload" starts two lighter sessions.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['kind', 'reason'],
        properties: {
          kind: { type: 'string', enum: ['weight', 'goal', 'accessory_add', 'accessory_remove', 'extra', 'deload'] },
          lift: { type: 'string', enum: lifts },
          value: { type: 'number', description: 'kg for weight/goal, reps for the pull-up goal' },
          workout: { type: 'string', enum: ['A', 'B'] },
          exercise_id: { type: 'string', enum: accIds() },
          reason: { type: 'string', description: 'One short sentence the owner sees on the card.' },
        },
      },
    },
  ].map((t) => ({ ...t, eager_input_streaming: true }));
}

const clampInt = (v, lo, hi, d) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

function overview() {
  const s = get(), today = iso(), prog = s.prog;
  const hd = health();
  const birthYear = s.profile.birthYear || (hd?.profile?.birthDate ? Number(hd.profile.birthDate.slice(0, 4)) : null);
  const plan = prog ? planToday(s, { today }) : null;
  const freq = (n) => Math.round(s.sessions.filter((x) => x.date > daysAgo(n)).length / (n / 7) * 10) / 10;
  const latest = (id) => { const l = s.body[id] || []; return l.length ? l[l.length - 1] : null; };
  return {
    today,
    profile: { age: birthYear ? new Date().getFullYear() - birthYear : null, sex: s.profile.sex || hd?.profile?.sex || null, heightCm: s.profile.heightCm || hd?.profile?.heightCm || null },
    program: prog ? {
      started: prog.started, smallestJumpKg: prog.jump,
      lifts: Object.fromEntries(MAIN_IDS.map((id) => {
        const L = prog.lifts[id], st = liftStatus(prog, id, today);
        return [MAIN[id].name, {
          mode: L.mode, working: L.mode === 'wave' ? { trainingMaxKg: L.tm, wave: (L.wave % 3) + 1 } : { kg: L.w, scheme: L.stage ? ['3x' + L.reps, '5x3', '6x2'][L.stage] : '3x' + L.reps, missesInARow: L.miss },
          secondLift: { kg: L.t2.w, reps: L.t2.reps }, resets: L.resets, lastDone: L.last,
          estimatedMaxKg: st.now, startEstimatedMaxKg: st.start, goalKg: st.goal, expectedByNowKg: st.pace, status: st.status,
        }];
      })),
      pullups: { maxReps: prog.pu.max, startMax: prog.pu.start, totalRepTarget: prog.pu.total, weightedAddKg: prog.pu.add, goal: prog.goals.pu },
      accessories: { A: prog.t3.A.map((id) => accessory(id, s.custom)?.name), B: prog.t3.B.map((id) => accessory(id, s.custom)?.name) },
      deloadInProgress: !!prog.deload,
      next: plan && { workout: plan.name, items: plan.items.map((it) => ({ name: it.name, sets: it.sets.map((x) => (x.w ? x.w + 'kg×' : '') + x.reps + (x.amrap ? '+' : '')).join(', '), note: it.note || undefined })) },
    } : 'Program not set up yet',
    training: {
      totalWorkouts: s.sessions.length, lastWorkout: s.sessions[s.sessions.length - 1]?.date || null,
      perWeekLast4Weeks: freq(28), perWeekLast12Weeks: freq(84),
      cardioLast4Weeks: s.cardio.filter((c) => c.date > daysAgo(28)).length,
      homeSessionsLast4Weeks: s.sessions.filter((x) => x.place === 'home' && x.date > daysAgo(28)).length,
      homeEquipment: (s.settings?.homeGear || ['bar', 'db']).join(', ') || 'bodyweight only',
    },
    body: { bodyweight: latest('weight'), waist: latest('waist'), restingPulse: latest('rhr') },
    appleHealth: hd ? { importedAt: hd.importedAt?.slice(0, 10), from: hd.range?.from, to: hd.range?.to } : 'Not imported. Suggest Body tab → Apple Health if health advice is wanted.',
  };
}

function trainingLog(days) {
  const s = get(), from = daysAgo(days);
  return s.sessions.filter((x) => x.date >= from).map((x) => ({
    date: x.date, workout: x.place === 'home' ? (x.kind === 'short' ? 'home-short' : 'home-full') : (x.lower ? x.lower + '+' + x.upper : x.wid), minutes: x.end ? Math.round((new Date(x.end) - new Date(x.start)) / 60000) : null,
    light: x.deload || undefined, feltBeatUp: x.beatUp || undefined, note: x.note || undefined,
    exercises: x.items.filter((it) => outcome(it) !== 'skip').map((it) => ({
      name: it.name, tier: it.kind,
      sets: it.sets.filter((st) => st.done != null).map((st) => (st.w ? st.w + '×' : '') + st.done + '/' + st.reps + (st.amrap ? '+' : '')).join(' '),
      lastSet: it.rating, result: outcome(it),
      e1rm: it.kind === 't1' ? Math.max(0, ...it.sets.filter((st) => st.done > 0).map((st) => e1rm(st.w, st.done, st.amrap ? 0 : RIR[it.rating || 'ok']))) : undefined,
    })),
    programChanges: (x.changes || []).map((c) => c.name + ': ' + c.text),
  }));
}

function healthData(days, daily) {
  const hd = health();
  if (!hd) return { error: 'No Apple Health data imported yet. The owner can import it on the Body tab (Health app → profile picture → Export All Health Data → pick export.zip).' };
  const out = summarizeHealth(hd, { days });
  if (daily?.length) {
    const from = daysAgo(Math.min(days, 120));
    out.daily = Object.keys(hd.days).sort().filter((d) => d >= from).map((d) => [d, ...daily.map((m) => hd.days[d][m] ?? null)]);
    out.dailyColumns = ['date', ...daily];
  }
  return out;
}

function muscleBalance() {
  const s = get();
  if (!s.prog) return { error: 'Program not set up yet' };
  const a = analyze(s);
  return {
    basis: a.basis === 'plan' ? 'planned workouts (fewer than 3 logged)' : 'last 6 workouts', workoutsPerWeek: a.freq,
    muscles: a.muscles.map((m) => ({ muscle: m.name, setsPerWeek: m.projected, last7Days: m.week, target: m.target.join('-'), status: m.status, workoutsWithout: m.streak, recoveredPct: Math.round(m.recovered * 100), trend8w: m.trend.join(','), focus: m.focus || undefined })),
    ratios: { pullToPushRows: a.ratios.horizontal, pullToPushVertical: a.ratios.vertical, hamstringsToQuads: a.ratios.hamQuad },
    warnings: a.alerts.map((al) => ({ severity: al.severity, title: al.title, fix: bestExercise(a, al.muscle, { custom: s.custom })?.id })),
    plannedExtrasForNextWorkout: (s.prog.extra || []).map((x) => x.id),
  };
}

function bodyAndCardio(days) {
  const s = get(), from = daysAgo(days);
  const body = {};
  for (const [k, list] of Object.entries(s.body)) {
    const l = list.filter((e) => e.date >= from);
    if (l.length) body[k] = l.map((e) => e.date + ': ' + e.value);
  }
  return {
    measurements: body,
    cardio: s.cardio.filter((c) => c.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1)).map((c) => ({ date: c.date, type: c.type, km: c.km || null, min: c.min, note: c.note || undefined })),
  };
}

/** Checks a propose_change input. Returns an error string, or null when it can be shown. */
export function checkProposal(p) {
  if (!p || typeof p !== 'object' || typeof p.reason !== 'string') return 'reason is required';
  if (p.kind === 'weight' || p.kind === 'goal') {
    if (!(p.kind === 'goal' ? [...MAIN_IDS, 'pu'] : MAIN_IDS).includes(p.lift)) return 'lift must be one of ' + MAIN_IDS.join(', ');
    if (!(typeof p.value === 'number' && p.value > 0 && p.value < 500)) return 'value must be a positive number';
    return null;
  }
  if (p.kind === 'extra') return accIds().includes(p.exercise_id) ? null : 'unknown exercise_id';
  if (p.kind === 'accessory_add' || p.kind === 'accessory_remove') {
    if (!['A', 'B'].includes(p.workout)) return 'workout must be A or B';
    if (!accIds().includes(p.exercise_id)) return 'unknown exercise_id';
    return null;
  }
  if (p.kind === 'deload') return null;
  return 'unknown kind';
}

/** Words for a proposal card. */
export function describeProposal(p) {
  const s = get();
  if (p.kind === 'weight') {
    const L = s.prog?.lifts[p.lift];
    return (L?.mode === 'wave' ? 'Training max for ' : 'Working weight for ') + MAIN[p.lift].name.toLowerCase() + ': ' + (L?.mode === 'wave' ? L.tm : L?.w) + ' → ' + loadable(p.value, s.prog?.jump || 2.5) + ' kg';
  }
  if (p.kind === 'goal') return 'Two-year goal for ' + (p.lift === 'pu' ? 'pull-ups: ' + Math.round(p.value) + ' reps' : MAIN[p.lift].name.toLowerCase() + ': ' + p.value + ' kg');
  if (p.kind === 'accessory_add') return 'Add ' + (accessory(p.exercise_id, s.custom)?.name || p.exercise_id) + ' to workout ' + p.workout;
  if (p.kind === 'accessory_remove') return 'Remove ' + (accessory(p.exercise_id, s.custom)?.name || p.exercise_id) + ' from workout ' + p.workout;
  if (p.kind === 'extra') return 'Add ' + (accessory(p.exercise_id, s.custom)?.name || p.exercise_id) + ' to the next workout';
  if (p.kind === 'deload') return 'Two lighter sessions (90 %, half the sets)';
  return 'Change';
}

export function applyProposal(p) {
  change((s) => {
    const prog = s.prog;
    if (!prog) return;
    if (p.kind === 'weight') {
      const L = prog.lifts[p.lift], w = loadable(p.value, prog.jump);
      if (L.mode === 'wave') L.tm = w; else { L.w = w; L.miss = 0; }
    } else if (p.kind === 'goal') prog.goals[p.lift] = p.lift === 'pu' ? Math.round(p.value) : p.value;
    else if (p.kind === 'accessory_add') { if (!prog.t3[p.workout].includes(p.exercise_id)) prog.t3[p.workout].push(p.exercise_id); }
    else if (p.kind === 'accessory_remove') prog.t3[p.workout] = prog.t3[p.workout].filter((x) => x !== p.exercise_id);
    else if (p.kind === 'extra') prog.extra = [...(prog.extra || []).filter((x) => x.id !== p.exercise_id), { id: p.exercise_id, why: 'coach' }];
    else if (p.kind === 'deload') s.prog = startDeload(prog);
  });
}

export function runTool(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'get_overview': return overview();
    case 'get_training_log': return trainingLog(clampInt(i.days, 1, 730, 42));
    case 'get_health': return healthData(clampInt(i.days, 7, 365, 30), Array.isArray(i.daily) ? i.daily.filter((x) => typeof x === 'string').slice(0, 8) : null);
    case 'get_muscle_balance': return muscleBalance();
    case 'get_insights': { const s = get(); return { readiness: readiness(s, health()), checkInToday: s.checkins?.[iso()] || null, insights: insights(s, health()) }; }
    case 'get_body_and_cardio': return bodyAndCardio(clampInt(i.days, 1, 730, 90));
    case 'propose_change': {
      const err = checkProposal(i);
      if (err) return { error: err };
      return { shown: true, note: 'Shown to the owner as a card. They decide whether to apply it; do not say it is done.' };
    }
    default: return { error: 'Unknown tool' };
  }
}

export const TOOL_LABEL = {
  get_overview: 'Looked at your program',
  get_training_log: 'Read your training log',
  get_health: 'Read your health data',
  get_body_and_cardio: 'Read body measurements and cardio',
  get_muscle_balance: 'Checked muscle balance',
  get_insights: 'Checked readiness and health insights',
};

/* ---------- Asking ---------- */
/**
 * Sends a question and runs the tool loop. Calls onUpdate() whenever the chat
 * changes (text streamed, tool used). deep: a fuller answer (higher effort).
 * Throws an Error with a readable message on failure; the question stays in the chat.
 */
export async function ask(chat, question, { onUpdate = () => {}, deep = false, signal } = {}) {
  const apiKey = read(KEYS.apiKey);
  if (!apiKey) throw new Error('Add your Anthropic API key first.');
  if (!navigator.onLine) throw new Error('The coach needs an internet connection.');

  let Anthropic;
  try { ({ default: Anthropic } = await import(SDK_URL)); }
  catch { throw new Error('Could not load the coach. Check the connection.'); }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const text = { type: 'text', text: 'Today is ' + iso() + '.\n\n' + question };
  const lastMsg = chat.messages[chat.messages.length - 1];
  // After a failed turn the last message is still ours: add to it instead of
  // starting a second user turn in a row. Nothing earlier is changed.
  if (lastMsg && lastMsg.role === 'user') lastMsg.content = [...lastMsg.content, text];
  else chat.messages.push({ role: 'user', content: [text] });
  chat.pending = '';
  saveChat(chat); onUpdate();

  const toolList = tools();
  for (let turn = 0; turn < 10; turn++) {
    let message;
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: deep ? 'high' : 'medium' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
        tools: toolList,
        messages: chat.messages,
      }, { signal });
      stream.on('text', (delta) => { chat.pending = (chat.pending || '') + delta; onUpdate(); });
      message = await stream.finalMessage();
    } catch (e) {
      chat.pending = '';
      if (signal?.aborted) throw new Error('Stopped.');
      throw readable(e, Anthropic);
    }
    chat.pending = '';
    if (message.stop_reason === 'refusal') {
      chat.messages.push({ role: 'assistant', content: message.content.filter((b) => b.type !== 'tool_use') });
      saveChat(chat); onUpdate();
      throw new Error('The coach could not answer that one. Try asking another way.');
    }
    const uses = message.content.filter((b) => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' && uses.length) throw new Error('The answer got too long. Try a narrower question.');
    chat.messages.push({ role: 'assistant', content: message.content });
    saveChat(chat); onUpdate();
    if (message.stop_reason === 'pause_turn') continue;
    if (!uses.length) return;

    const results = uses.map((u) => {
      let out;
      try { out = runTool(u.name, u.input); } catch (e) { out = { error: String(e?.message || e) }; }
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: !!out?.error || undefined };
    });
    chat.messages.push({ role: 'user', content: results });
    saveChat(chat); onUpdate();
  }
}

function readable(e, A) {
  if (A && e instanceof A.AuthenticationError) return new Error('The API key was not accepted. Check it in Settings.');
  if (A && e instanceof A.PermissionDeniedError) return new Error('The key has no access. Check your Anthropic account.');
  if (A && e instanceof A.RateLimitError) return new Error('Too many requests right now. Wait a moment and try again.');
  if (A && e instanceof A.BadRequestError) return new Error('The request was rejected: ' + (e.message || 'unknown error'));
  if (A && e instanceof A.APIConnectionError) return new Error('Could not reach the coach. Check the connection.');
  if (A && e instanceof A.APIError && e.status === 402) return new Error('Your Anthropic account is out of credit.');
  if (A && e instanceof A.APIError) return new Error('The coach service answered with an error (' + (e.status || '?') + '). Try again later.');
  return e instanceof Error ? e : new Error(String(e));
}

/** Rough size of the stored conversation, to suggest starting fresh when it gets long. */
export function chatSize(chat) { try { return JSON.stringify(chat.messages).length; } catch { return 0; } }

export { daysBetween };
