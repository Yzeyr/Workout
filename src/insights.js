/* Rules that turn health data and the training log into advice, on the phone,
   without the AI coach. Two parts:

   1. Readiness ("dagsform") for today, 0–100, from a 3-tap check-in (sleep,
      energy, soreness), fresh Apple Health numbers when there are any (last
      night's sleep, resting pulse and HRV against your own normal), how
      recovered today's muscles are, and how the last workouts went.
   2. Insights: sleep, resting pulse, HRV, steps, cardio minutes, VO₂ max,
      bodyweight trend, protein, training consistency — each with a level and
      one concrete thing to do.

   Thresholds are common guidance, not a diagnosis:
   - Sleep: adults need 7+ hours (AASM/SRS consensus, Watson 2015).
   - Steps: the drop in mortality levels off around 7,000–10,000 a day for
     adults under 60 (Paluch 2022, Lancet Public Health).
   - Activity: 150+ min moderate cardio a week (WHO 2020).
   - Protein for strength: about 1.6 g/kg/day, up to ~2.2 (Morton 2018).
   - Resting pulse 5+ bpm above your normal, or HRV 15 %+ below it, often goes
     with poor recovery, stress or getting ill (convention in wearables).
   - VO₂ max norms are rough bands by age and sex (ACSM / FRIEND registry). */

import { analyze } from './muscles.js';
import { planWorkout, outcome, iso, daysBetween } from './program.js';
import { worksFor } from './data/muscles.js';

const add = (isoDate, n) => { const d = new Date(isoDate + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const avg = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Values of one metric between two dates (inclusive), from the Health days map. */
function series(days, key, from, to) {
  const out = [];
  for (const d of Object.keys(days || {}).sort()) if (d >= from && d <= to && days[d][key] != null) out.push(days[d][key]);
  return out;
}

/** The newest day with any Health data, and how old it is. */
function freshness(health, today) {
  const keys = Object.keys(health?.days || {}).sort();
  const last = keys[keys.length - 1] || null;
  return { last, age: last ? daysBetween(last, today) : null };
}

/* ---------- Readiness ---------- */
export const CHECKIN = {
  sleep: { label: 'Sleep last night', options: [[1, 'Bad'], [2, 'OK'], [3, 'Good']] },
  energy: { label: 'Energy', options: [[1, 'Low'], [2, 'OK'], [3, 'High']] },
  sore: { label: 'Sore muscles', options: [[3, 'None'], [2, 'A bit'], [1, 'Very']] },
};

/**
 * Today's readiness. Returns { score 0–100, level, reasons: [{ text, effect }], advice, checkedIn, sources }.
 * level: 'great' (≥80) | 'good' (65–79) | 'ok' (50–64) | 'low' (<50)
 */
export function readiness(state, health, { today = iso(), now = new Date() } = {}) {
  const reasons = [];
  let score = 75;
  const sources = [];
  const push = (effect, text) => { score += effect; reasons.push({ effect, text }); };

  // 1. Check-in (the most reliable signal: it is today's)
  const c = state.checkins?.[today];
  if (c) {
    sources.push('check-in');
    if (c.sleep === 1) push(-12, 'You slept badly');
    else if (c.sleep === 3) push(5, 'You slept well');
    if (c.energy === 1) push(-12, 'Low energy');
    else if (c.energy === 3) push(6, 'Plenty of energy');
    if (c.sore === 1) push(-10, 'Very sore');
    else if (c.sore === 2) push(-3, 'A bit sore');
  }

  // 2. Fresh Health data (only if the export is from the last 2 days)
  const f = freshness(health, today);
  if (health && f.age != null && f.age <= 2) {
    sources.push('Apple Health');
    const d = health.days;
    const lastSleep = d[f.last]?.sleepH;
    if (lastSleep != null && !c?.sleep) {
      if (lastSleep < 6) push(-10, 'Only ' + r1(lastSleep) + ' h sleep');
      else if (lastSleep >= 7.5) push(4, r1(lastSleep) + ' h sleep');
    }
    const base = (k) => avg(series(d, k, add(f.last, -30), add(f.last, -1)));
    const rhr = d[f.last]?.restingHr, rhrBase = base('restingHr');
    if (rhr != null && rhrBase != null) {
      if (rhr - rhrBase >= 5) push(-10, 'Resting pulse ' + Math.round(rhr - rhrBase) + ' bpm above your normal');
      else if (rhr - rhrBase <= -3) push(3, 'Resting pulse below your normal');
    }
    const hrv = d[f.last]?.hrvMs, hrvBase = base('hrvMs');
    if (hrv != null && hrvBase) {
      const rel = (hrv - hrvBase) / hrvBase;
      if (rel <= -0.15) push(-8, 'HRV ' + Math.round(-rel * 100) + ' % below your normal');
      else if (rel >= 0.1) push(3, 'HRV above your normal');
    }
  }

  // 3. Muscles for today's planned workout: how recovered are they?
  if (state.prog) {
    const a = analyze(state, { today, now });
    const plan = planWorkout(state.prog, state.prog.next, { today, custom: state.custom || [] });
    const main = new Map();
    for (const it of plan.items.filter((i) => i.kind === 't1')) for (const [m, w] of Object.entries(worksFor(it.exId))) if (w >= 1) main.set(m, true);
    const rec = [...main.keys()].map((m) => a.by[m]).filter(Boolean);
    const worst = rec.sort((x, y) => x.recovered - y.recovered)[0];
    if (worst && worst.recovered < 0.5) push(-10, worst.name + ' still recovering (' + Math.round(worst.recovered * 100) + ' %)');
    else if (worst && worst.recovered < 0.75) push(-4, worst.name + ' not fully recovered');
    else if (rec.length) push(3, 'Muscles for today are recovered');
    sources.push('training log');
  }

  // 4. How the last workouts went
  const gym = (state.sessions || []).filter((s) => s.place !== 'home');
  const last = gym[gym.length - 1];
  if (last) {
    const days = daysBetween(last.date, today);
    if (days === 0) push(-8, 'You already trained today');
    if (last.beatUp && days <= 2) push(-6, 'You felt beat up last time');
    const tough = gym.slice(-2).flatMap((s) => s.items.filter((it) => it.kind === 't1' && (it.rating === 'hard' || outcome(it) === 'fail'))).length;
    if (tough >= 3) push(-6, 'Main lifts felt hard the last two times');
    if (days >= 4 && days <= 10) push(3, days + ' days of rest');
  }

  score = Math.max(5, Math.min(100, Math.round(score)));
  const level = score >= 80 ? 'great' : score >= 65 ? 'good' : score >= 50 ? 'ok' : 'low';
  const advice = {
    great: 'Good day to push. If the last set feels easy, say so — the weight jumps more.',
    good: 'Train as planned.',
    ok: 'Train as planned, but rate the last set honestly. If the first sets feel heavy, a lighter day is fine.',
    low: 'Consider a lighter day (90 %, half the sets) or the short home session. Missing one heavy day costs nothing.',
  }[level];
  return { score, level, reasons: reasons.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect)), advice, checkedIn: !!c, sources };
}

/* ---------- Insights ---------- */
/**
 * Insights from health data and the log. Each: { id, area, level, title, text, value? }
 * level: 'alert' (see a doctor) | 'warn' | 'info' | 'good'
 */
export function insights(state, health, { today = iso() } = {}) {
  const out = [];
  const say = (id, area, level, title, text, value) => out.push({ id, area, level, title, text, value });
  const d = health?.days || {};
  const f = freshness(health, today);
  const end = f.last || today;
  const win = (k, n, back = 0) => series(d, k, add(end, -(n + back) + 1), add(end, -back));
  const age = state.profile?.birthYear ? new Date(today).getFullYear() - state.profile.birthYear
    : health?.profile?.birthDate ? new Date(today).getFullYear() - Number(health.profile.birthDate.slice(0, 4)) : null;
  const sex = state.profile?.sex || health?.profile?.sex || null;

  if (health && f.last) {
    // Sleep
    const sleep = win('sleepH', 14);
    if (sleep.length >= 5) {
      const a = avg(sleep);
      const sd = Math.sqrt(avg(sleep.map((x) => (x - a) ** 2)));
      if (a < 6.5) say('sleep', 'sleep', 'warn', 'Short on sleep: ' + r1(a) + ' h a night', 'Strength and muscle gain suffer under 7 hours. Aim for a fixed bedtime 30 minutes earlier for two weeks.', r1(a) + ' h');
      else if (a < 7) say('sleep', 'sleep', 'info', 'A little short on sleep: ' + r1(a) + ' h', 'Most adults need 7–9 hours. Even 30 more minutes helps recovery.', r1(a) + ' h');
      else say('sleep', 'sleep', 'good', 'Sleep is good: ' + r1(a) + ' h a night', 'Keep it up — it is the cheapest recovery there is.', r1(a) + ' h');
      if (sd > 1.2) say('sleep-var', 'sleep', 'info', 'Uneven sleep', 'Your nights vary by about ' + r1(sd) + ' h. A steady wake-up time, also on weekends, makes sleep deeper.');
    }
    // Resting pulse
    const rhr7 = avg(win('restingHr', 7)), rhr30 = avg(win('restingHr', 30, 7));
    if (rhr7 != null) {
      if (rhr7 > 100) say('rhr-high', 'heart', 'alert', 'Resting pulse over 100', 'A resting pulse this high should be checked by a doctor.', Math.round(rhr7) + ' bpm');
      else if (rhr30 != null && rhr7 - rhr30 >= 5) say('rhr-up', 'heart', 'warn', 'Resting pulse up ' + Math.round(rhr7 - rhr30) + ' bpm', 'Above your normal this week. Common with poor sleep, stress, alcohol or a cold coming. Go lighter until it settles; see a doctor if it stays high or you feel unwell.', Math.round(rhr7) + ' bpm');
      else if (rhr30 != null && rhr30 - rhr7 >= 3) say('rhr-down', 'heart', 'good', 'Resting pulse going down', 'Down ' + Math.round(rhr30 - rhr7) + ' bpm — a sign your fitness is improving.', Math.round(rhr7) + ' bpm');
    }
    // HRV
    const hrv7 = avg(win('hrvMs', 7)), hrv30 = avg(win('hrvMs', 30, 7));
    if (hrv7 != null && hrv30) {
      const rel = (hrv7 - hrv30) / hrv30;
      if (rel <= -0.15) say('hrv-down', 'recovery', 'warn', 'HRV ' + Math.round(-rel * 100) + ' % below normal', 'Your body is under more strain than usual. Prioritise sleep and keep training at planned weights, not more.', Math.round(hrv7) + ' ms');
      else if (rel >= 0.1) say('hrv-up', 'recovery', 'good', 'HRV above normal', 'You are recovering well.', Math.round(hrv7) + ' ms');
    }
    // Blood oxygen and breathing
    const spo2 = avg(win('spo2', 14));
    if (spo2 != null && spo2 < 93) say('spo2', 'heart', 'alert', 'Low blood oxygen: ' + Math.round(spo2) + ' %', 'Readings this low (on average) are worth checking with a doctor, especially with shortness of breath. Watch readings can be off — but don\'t ignore it.', Math.round(spo2) + ' %');
    const rr7 = avg(win('respiratoryRate', 7)), rr30 = avg(win('respiratoryRate', 30, 7));
    if (rr7 != null && rr30 != null && rr7 - rr30 >= 2) say('rr', 'recovery', 'warn', 'Breathing rate up at night', 'Often the first sign of getting ill. Take it easy for a couple of days.', r1(rr7) + '/min');
    // Steps
    const steps = avg(win('steps', 14));
    if (steps != null) {
      const s = Math.round(steps / 100) * 100;
      if (steps < 5000) say('steps', 'activity', 'warn', s + ' steps a day', 'Low. Your health benefits most from going up to 7,000–8,000. A 20-minute walk is about 2,500 steps.', s);
      else if (steps < 7500) say('steps', 'activity', 'info', s + ' steps a day', 'Decent. 7,000–10,000 is where the health benefit levels off.', s);
      else say('steps', 'activity', 'good', s + ' steps a day', 'Plenty of daily movement — your painting job helps.', s);
    }
    // VO2 max
    const vo2 = avg(win('vo2max', 60));
    if (vo2 != null && age) {
      const band = vo2Band(vo2, age, sex);
      say('vo2', 'activity', band === 'low' ? 'warn' : band === 'fair' ? 'info' : 'good', 'Fitness (VO₂ max) ' + r1(vo2) + ': ' + { low: 'below average', fair: 'average', good: 'good', high: 'excellent' }[band] + ' for your age',
        band === 'low' || band === 'fair' ? 'VO₂ max is one of the strongest predictors of a long life. Two 30-minute cardio sessions a week, one of them with intervals (4 × 4 min hard), raises it in 6–8 weeks.' : 'Keep some cardio in the week to hold it.', r1(vo2));
    }
  }

  // Cardio minutes this week: app log + Apple Health workouts that are not strength training
  const from7 = add(today, -6);
  const appMin = (state.cardio || []).filter((c) => c.date >= from7).reduce((s, c) => s + (c.min || 0), 0);
  const hkMin = (health?.workouts || []).filter((w) => w.date >= from7 && !/strength|functional|core/i.test(w.type || '')).reduce((s, w) => s + (w.durationMin || 0), 0);
  const cardio = Math.round(Math.max(appMin, hkMin));
  if (cardio < 75) say('cardio', 'activity', 'info', cardio + ' min cardio this week', 'WHO recommends 150 minutes of moderate cardio a week. Brisk walks count. It helps recovery between lifting days too.', cardio + ' min');
  else if (cardio >= 150) say('cardio', 'activity', 'good', cardio + ' min cardio this week', 'Meets the 150-minute guideline.', cardio + ' min');

  // Bodyweight trend and protein
  const weights = [...(state.body?.weight || []).map((e) => [e.date, e.value]), ...Object.entries(d).filter(([, v]) => v.weightKg != null).map(([k, v]) => [k, v.weightKg])]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const recentW = weights.filter(([k]) => daysBetween(k, today) <= 35);
  if (recentW.length >= 3) {
    const first = recentW[0], last = recentW[recentW.length - 1];
    const weeks = Math.max(1, daysBetween(first[0], last[0]) / 7);
    const rate = (last[1] - first[1]) / weeks;
    if (rate < -0.5) say('weight-down', 'body', 'warn', 'Losing ' + r1(-rate) + ' kg a week', 'Fast for someone building strength. If you don\'t mean to lose weight, eat more — about 300–500 kcal a day.', r1(last[1]) + ' kg');
    else if (rate > 0.5) say('weight-up', 'body', 'info', 'Gaining ' + r1(rate) + ' kg a week', 'Faster than muscle can grow (about 0.25 kg a week early on). Fine if you are bulking; otherwise trim portions a little.', r1(last[1]) + ' kg');
  }
  const bw = weights.length ? weights[weights.length - 1][1] : null;
  if (bw) say('protein', 'body', 'info', 'Protein: about ' + Math.round(bw * 1.6) + ' g a day', 'For ' + r1(bw) + ' kg that is 1.6 g per kg — spread over 3–4 meals, ~' + Math.round(bw * 0.4) + ' g each. Above this gives little extra for strength.', Math.round(bw * 1.6) + ' g');

  // Training consistency
  const gym4 = (state.sessions || []).filter((s) => daysBetween(s.date, today) < 28);
  if (state.prog && daysBetween(state.prog.started, today) >= 14) {
    const perWeek = gym4.length / 4;
    if (perWeek < 1.5) say('consistency', 'training', 'info', r1(perWeek) + ' workouts a week lately', 'Two a week is enough to keep getting stronger. When the week is packed, a short home session still counts.');
    else if (perWeek >= 2.5) say('consistency', 'training', 'good', r1(perWeek) + ' workouts a week', 'Great consistency — that is what moves the numbers.');
  }

  if (health && f.age != null && f.age > 14) say('stale', 'data', 'info', 'Health data is ' + f.age + ' days old', 'Export again from the Health app for up-to-date advice.');

  const order = { alert: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Rough VO₂ max bands (ml/kg/min) by age and sex. */
export function vo2Band(v, age, sex) {
  const male = sex !== 'female';
  // Lower edges of "fair", "good", "high" for each decade
  const t = male
    ? [[30, [38, 44, 50]], [40, [36, 42, 47]], [50, [33, 39, 44]], [60, [30, 35, 40]], [200, [26, 31, 36]]]
    : [[30, [32, 37, 42]], [40, [30, 35, 40]], [50, [28, 33, 37]], [60, [25, 30, 34]], [200, [22, 27, 31]]];
  const [, [fair, good, high]] = t.find(([maxAge]) => age < maxAge);
  return v >= high ? 'high' : v >= good ? 'good' : v >= fair ? 'fair' : 'low';
}
