/* Apple Health export reader.

   The owner exports everything from the Health app (profile → "Export All
   Health Data"), saves export.zip to Files and picks it here. A web app can't
   read HealthKit, so this is the only way in.

   Exports are big: the zip is often 50–500 MB and export.xml inside it can be
   1–5 GB. So everything is streamed: the zip entry is inflated with
   DecompressionStream, decoded with TextDecoderStream, and the text is scanned
   chunk by chunk for the few tags we care about. Nothing keeps the whole XML,
   and no raw records are stored: each record is folded straight into a small
   per-day state.

   Works on iPhone Safari 16.4+ (DecompressionStream('deflate-raw'),
   TextDecoderStream, Blob.stream/slice) and in Node 22+ for the tests.
   No DOM, no DOMParser: Safari would need the whole document in memory. */

// ---------------------------------------------------------------- errors

export class HealthExportError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HealthExportError';
    this.code = code; // 'not-health' | 'damaged'
  }
}
const notHealth = (cause) => new HealthExportError('not-health', "This doesn't look like an Apple Health export", cause);
const damaged = (cause) => new HealthExportError('damaged', 'The file seems damaged', cause);

function abortError(signal) {
  if (signal.reason instanceof Error || (typeof DOMException !== 'undefined' && signal.reason instanceof DOMException)) return signal.reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

// ---------------------------------------------------------------- units

const KM = { km: 1, m: 0.001, cm: 1e-5, mm: 1e-6, mi: 1.609344, ft: 0.0003048, yd: 0.0009144, in: 0.0000254 };
const KCAL = { kcal: 1, Cal: 1, cal: 0.001, kJ: 1 / 4.184, J: 1 / 4184 };
const KG = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 };
const MIN = { min: 1, s: 1 / 60, ms: 1 / 60000, hr: 60, h: 60, d: 1440 };
const MS = { ms: 1, s: 1000 };
const CM = { cm: 1, m: 100, mm: 0.1, in: 2.54, ft: 30.48 };

// An unknown unit is taken as already being in the unit we want.
const via = (table) => (v, unit) => v * (table[unit] ?? 1);
const toKm = via(KM), toKcal = via(KCAL), toKg = via(KG), toMin = via(MIN), toMs = via(MS), toCm = via(CM);
// HealthKit writes percentages as a fraction (0.97 with unit "%"). The guard
// keeps a value that some app already wrote as 97 from becoming 9700.
const toPct = (v) => (v <= 1 ? v * 100 : v);
const same = (v) => v;

// ---------------------------------------------------------------- types

const SUM = 1, AVG = 2, LAST = 3;
const Q = 'HKQuantityTypeIdentifier';
const QUANTITY = {
  [Q + 'StepCount']: ['steps', SUM, same],
  [Q + 'DistanceWalkingRunning']: ['distanceKm', SUM, toKm],
  [Q + 'ActiveEnergyBurned']: ['activeKcal', SUM, toKcal],
  [Q + 'AppleExerciseTime']: ['exerciseMin', SUM, toMin],
  [Q + 'FlightsClimbed']: ['flights', SUM, same],
  [Q + 'RestingHeartRate']: ['restingHr', AVG, same],
  [Q + 'HeartRateVariabilitySDNN']: ['hrvMs', AVG, toMs],
  [Q + 'WalkingHeartRateAverage']: ['walkingHr', AVG, same],
  [Q + 'RespiratoryRate']: ['respiratoryRate', AVG, same],
  [Q + 'OxygenSaturation']: ['spo2', AVG, toPct],
  [Q + 'BodyMass']: ['weightKg', LAST, toKg],
  [Q + 'BodyFatPercentage']: ['bodyFatPct', LAST, toPct],
  [Q + 'LeanBodyMass']: ['leanKg', LAST, toKg],
  [Q + 'VO2Max']: ['vo2max', LAST, same],
};
const HEIGHT = Q + 'Height';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const SLEEP_VALUE = 'HKCategoryValueSleepAnalysis';

// Output key order, and which keys are whole numbers. Everything else gets 1 decimal.
const DAY_KEYS = ['steps', 'distanceKm', 'activeKcal', 'exerciseMin', 'flights',
  'restingHr', 'hrvMs', 'walkingHr', 'respiratoryRate', 'spo2',
  'weightKg', 'bodyFatPct', 'leanKg', 'vo2max',
  'sleepH', 'deepH', 'remH', 'inBedH'];
const WHOLE = new Set(['steps', 'flights', 'activeKcal', 'exerciseMin']);
const round = (key, v) => (WHOLE.has(key) ? Math.round(v) : Math.round(v * 10) / 10);
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- dates

// Apple writes "2026-10-30 07:12:44 +0100": the local wall time plus the
// offset. Day keys use the local date exactly as written.
const DATE_RE = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)\s*(?:([+-])(\d\d):?(\d\d)|Z)?/;
function toEpoch(s) {
  const m = DATE_RE.exec(s || '');
  if (!m) return NaN;
  const local = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const off = m[7] ? (m[7] === '-' ? -1 : 1) * (m[8] * 60 + +m[9]) : 0;
  return local - off * 60000;
}
function addDays(day, n) {
  const t = Date.UTC(+day.slice(0, 4), day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- XML bits

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? all;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
  });
}

const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function parseAttrs(s) {
  const o = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) o[m[1]] = decodeEntities(m[2] ?? m[3]);
  return o;
}

// The only tags we look at. Everything else (MetadataEntry, HeartRate
// beat lists, routes, ActivitySummary, the DOCTYPE...) is skipped by the
// regex engine without any JS work. The attribute part is quote-aware, so a
// raw '>' inside a quoted value does not end the tag early. WorkoutStatistics
// comes before Workout so the longer name wins; the lookahead stops Workout
// from matching WorkoutEvent/WorkoutRoute and Me from matching MetadataEntry.
const TAG_RE = /<(\/?HealthData|\/Workout|Record|WorkoutStatistics|Workout|Me|ExportDate)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const TYPE_RE = /\stype\s*=\s*"([^"]*)"/;

// ---------------------------------------------------------------- parser

/* The streaming parser. push() takes text in any chunk size; finish() returns
   the result. Exported so tests can feed it tiny chunks. */
export function createHealthParser({ since = null } = {}) {
  // days[day] = { sum: { key: { source: total } }, avg: { key: [total, n] }, last: { key: [time, value] } }
  const days = Object.create(null);
  // nights[day] = { asleep: [s, e, s, e, ...], deep, rem, inBed } (epoch ms pairs)
  const nights = Object.create(null);
  const workouts = [];
  const profile = { birthDate: null, sex: null, heightCm: null };
  let heightAt = '';
  let exportDate = null;
  let started = false, ended = false;
  let records = 0;
  let workout = null; // the <Workout> we are inside, if it is being kept
  let tail = '';      // start of a tag that the last chunk cut in half

  const tooOld = (day) => since != null && day < since;

  function day(key) {
    return days[key] ??= { sum: null, avg: null, last: null };
  }

  function onRecord(attrs) {
    const tm = TYPE_RE.exec(attrs);
    if (!tm) return;
    const type = tm[1];
    if (type === SLEEP) return onSleep(parseAttrs(attrs));
    const spec = QUANTITY[type];
    if (!spec && type !== HEIGHT) return; // most records (HeartRate, BasalEnergy...) stop here
    const a = parseAttrs(attrs);
    const start = a.startDate;
    const v = parseFloat(a.value);
    if (!start || !Number.isFinite(v)) return;

    // Height is a profile value: keep the newest one, even from before `since`.
    if (!spec) {
      if (start >= heightAt) { heightAt = start; profile.heightCm = r1(toCm(v, a.unit)); }
      records++;
      return;
    }

    // Sums are filed by start date. A record that starts the day before
    // `since` is also dropped, so the first day is not a partial one.
    const key = start.slice(0, 10);
    if (tooOld(key) || tooOld((a.endDate || start).slice(0, 10))) return;
    const [name, kind, convert] = spec;
    const value = convert(v, a.unit);
    const d = day(key);
    if (kind === SUM) {
      // iPhone and Apple Watch both count steps, distance and energy, so the
      // raw records overlap. Health merges them by priority, minute by minute;
      // we approximate that by summing per source and then taking the biggest
      // source for the day (see finish()).
      const bySource = (d.sum ??= Object.create(null))[name] ??= Object.create(null);
      const src = a.sourceName || '?';
      bySource[src] = (bySource[src] || 0) + value;
    } else if (kind === AVG) {
      const acc = (d.avg ??= Object.create(null))[name] ??= [0, 0];
      acc[0] += value; acc[1]++;
    } else {
      // "Last value that day": the latest start time wins. The strings sort
      // by local time, which is what the owner saw on the day.
      const last = (d.last ??= Object.create(null));
      if (!last[name] || start >= last[name][0]) last[name] = [start, value];
    }
    records++;
  }

  function onSleep(a) {
    const v = a.value || '';
    let kinds;
    if (v === SLEEP_VALUE + 'InBed') kinds = ['inBed'];
    else if (v.startsWith(SLEEP_VALUE + 'Asleep')) { // Asleep, AsleepUnspecified, AsleepCore, AsleepDeep, AsleepREM
      kinds = ['asleep'];
      if (v === SLEEP_VALUE + 'AsleepDeep') kinds.push('deep');
      else if (v === SLEEP_VALUE + 'AsleepREM') kinds.push('rem');
    } else return; // Awake
    const s = toEpoch(a.startDate), e = toEpoch(a.endDate);
    if (!(e > s)) return;
    // A night belongs to the morning it ends on. Sleep that ends after 18:00
    // (an evening nap, or the first part of the night before midnight)
    // belongs to the next day's night.
    const endDay = a.endDate.slice(0, 10);
    const night = a.endDate.slice(11, 19) > '18:00:00' ? addDays(endDay, 1) : endDay;
    // `since` is checked against the night, not the record, so the first
    // night is kept whole (its first part ends the evening before).
    if (tooOld(night)) return;
    const n = nights[night] ??= { asleep: [], deep: [], rem: [], inBed: [] };
    for (const k of kinds) n[k].push(s, e);
    records++;
  }

  function onWorkout(attrs, selfClosing) {
    workout = null;
    const a = parseAttrs(attrs);
    if (!a.startDate || tooOld(a.startDate.slice(0, 10))) return;
    const num = (x) => (x == null || x === '' ? NaN : parseFloat(x));
    const w = {
      start: a.startDate, end: a.endDate,
      type: activityName(a.workoutActivityType),
      durationMin: toMin(num(a.duration), a.durationUnit || 'min'),
      kcal: toKcal(num(a.totalEnergyBurned), a.totalEnergyBurnedUnit),
      distanceKm: toKm(num(a.totalDistance), a.totalDistanceUnit),
      avgHr: NaN, statKcal: NaN, statKm: NaN,
    };
    if (selfClosing) closeWorkout(w); else workout = w;
  }

  // Newer exports (iOS 16+) drop totalEnergyBurned/totalDistance from
  // <Workout> and put them in <WorkoutStatistics> children instead.
  function onWorkoutStat(attrs) {
    if (!workout) return;
    const a = parseAttrs(attrs);
    const t = a.type || '';
    if (t === Q + 'ActiveEnergyBurned') workout.statKcal = toKcal(parseFloat(a.sum), a.unit);
    else if (t === Q + 'HeartRate') workout.avgHr = parseFloat(a.average);
    else if (t.startsWith(Q + 'Distance')) {
      const km = toKm(parseFloat(a.sum), a.unit);
      if (Number.isFinite(km)) workout.statKm = (Number.isFinite(workout.statKm) ? workout.statKm : 0) + km;
    }
  }

  function closeWorkout(w) {
    const pick = (a, b) => (a > 0 ? a : b > 0 ? b : null);
    let dur = w.durationMin;
    if (!(dur > 0)) dur = (toEpoch(w.end) - toEpoch(w.start)) / 60000;
    const kcal = pick(w.kcal, w.statKcal), km = pick(w.distanceKm, w.statKm);
    workouts.push({
      start: w.start,
      date: w.start.slice(0, 10),
      type: w.type,
      durationMin: dur > 0 ? r1(dur) : null,
      kcal: kcal == null ? null : Math.round(kcal),
      distanceKm: km == null ? null : r1(km),
      avgHr: w.avgHr > 0 ? Math.round(w.avgHr) : null,
    });
  }

  function onMe(attrs) {
    const a = parseAttrs(attrs);
    const dob = a.HKCharacteristicTypeIdentifierDateOfBirth || '';
    if (/^\d{4}-\d\d-\d\d/.test(dob)) profile.birthDate = dob.slice(0, 10);
    const sex = a.HKCharacteristicTypeIdentifierBiologicalSex || '';
    profile.sex = sex.endsWith('Female') ? 'female' : sex.endsWith('Male') ? 'male' : sex.endsWith('Other') ? 'other' : null;
  }

  function onTag(name, attrs) {
    switch (name) {
      case 'Record': return onRecord(attrs);
      case 'WorkoutStatistics': return onWorkoutStat(attrs);
      case 'Workout': return onWorkout(attrs, /\/\s*$/.test(attrs));
      case '/Workout': if (workout) closeWorkout(workout); workout = null; return;
      case 'Me': return onMe(attrs);
      case 'ExportDate': {
        const v = parseAttrs(attrs).value || '';
        if (/^\d{4}-\d\d-\d\d/.test(v)) exportDate = v.slice(0, 10);
        return;
      }
      case 'HealthData': started = true; return;
      case '/HealthData': ended = true; return;
    }
  }

  function push(text) {
    const buf = tail + text;
    TAG_RE.lastIndex = 0;
    let m, end = 0;
    while ((m = TAG_RE.exec(buf))) {
      onTag(m[1], m[2]);
      end = TAG_RE.lastIndex;
    }
    // '<' can't appear raw inside an attribute value, so the last '<' after
    // the last finished tag is where an unfinished tag (if any) starts.
    const lt = buf.lastIndexOf('<');
    tail = lt >= end ? buf.slice(lt) : '';
  }

  function finish() {
    if (!started) throw notHealth();
    if (!ended) throw damaged(); // the XML stops in the middle

    const out = {};
    const keys = [...new Set([...Object.keys(days), ...Object.keys(nights)])].sort();
    for (const key of keys) {
      if (tooOld(key)) continue;
      const raw = {};
      const d = days[key];
      if (d?.sum) for (const k in d.sum) {
        let max = 0;
        for (const src in d.sum[k]) if (d.sum[k][src] > max) max = d.sum[k][src];
        raw[k] = max;
      }
      if (d?.avg) for (const k in d.avg) raw[k] = d.avg[k][0] / d.avg[k][1];
      if (d?.last) for (const k in d.last) raw[k] = d.last[k][1];
      const n = nights[key];
      if (n) {
        // Merge overlapping intervals across sources first, so Watch and
        // iPhone recording the same night don't add up to 14 hours.
        const asleep = mergedHours(n.asleep), deep = mergedHours(n.deep), rem = mergedHours(n.rem), inBed = mergedHours(n.inBed);
        if (asleep > 0) raw.sleepH = asleep;
        if (deep > 0) raw.deepH = deep;
        if (rem > 0) raw.remH = rem;
        if (inBed > 0) raw.inBedH = inBed;
      }
      const o = {};
      for (const k of DAY_KEYS) if (raw[k] != null && Number.isFinite(raw[k])) o[k] = round(k, raw[k]);
      if (Object.keys(o).length) out[key] = o;
    }

    workouts.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const ws = workouts.map(({ start, ...w }) => w);

    const dayKeys = Object.keys(out);
    let from = dayKeys[0] ?? null, to = dayKeys[dayKeys.length - 1] ?? null;
    for (const w of ws) {
      if (!from || w.date < from) from = w.date;
      if (!to || w.date > to) to = w.date;
    }

    return {
      profile: { ...profile },
      days: out,
      workouts: ws,
      range: { from, to },
      counts: { records, workouts: ws.length },
      exportDate,
    };
  }

  return { push, finish };
}

function mergedHours(flat) {
  if (!flat.length) return 0;
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  pairs.sort((a, b) => a[0] - b[0]);
  let total = 0, [s, e] = pairs[0];
  for (let i = 1; i < pairs.length; i++) {
    const [ps, pe] = pairs[i];
    if (ps <= e) { if (pe > e) e = pe; } else { total += e - s; s = ps; e = pe; }
  }
  total += e - s;
  return total / 3600000;
}

// "HKWorkoutActivityTypeTraditionalStrengthTraining" → "Traditional Strength Training"
function activityName(raw) {
  if (!raw) return 'Other';
  return raw.replace(/^HKWorkoutActivityType/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') || 'Other';
}

// ---------------------------------------------------------------- zip

const MAX32 = 0xffffffff;

async function view(blob, start, length) {
  return new DataView(await blob.slice(start, start + length).arrayBuffer());
}
function big(dv, at) {
  const n = Number(dv.getBigUint64(at, true));
  if (!Number.isSafeInteger(n)) throw damaged();
  return n;
}

/* Finds export.xml inside the zip and returns its compressed bytes (as a Blob
   slice) and method. Only the end of the file, the central directory and one
   local header are read; the entry itself is streamed later. */
async function findExportEntry(file) {
  const size = file.size;

  // End of Central Directory: 22 bytes plus a comment of up to 64 KB, at the end.
  const tailLen = Math.min(size, 0xffff + 22);
  const tailStart = size - tailLen;
  const tail = await view(file, tailStart, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw damaged();
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // Zip64: a 20-byte locator sits right before the EOCD and points at the
  // EOCD64 record, which holds the real 64-bit count, size and offset.
  const locAt = tailStart + eocd - 20;
  const loc = locAt >= 0 ? await view(file, locAt, 20) : null;
  if (loc && loc.byteLength === 20 && loc.getUint32(0, true) === 0x07064b50) {
    const at = big(loc, 8);
    const r = await view(file, at, 56);
    if (r.byteLength < 56 || r.getUint32(0, true) !== 0x06064b50) throw damaged();
    count = big(r, 32);
    cdSize = big(r, 40);
    cdOffset = big(r, 48);
  } else if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    throw damaged(); // says zip64 but the locator is missing
  }
  if (count === 0) throw notHealth();
  if (cdOffset + cdSize > size || cdSize > 256 * 1024 * 1024) throw damaged();

  // Central directory. A Health export has one entry per file (export.xml,
  // export_cda.xml, workout routes, ECGs...), so this is small.
  const cd = await view(file, cdOffset, cdSize);
  const names = new TextDecoder();
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50) {
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true);
    let uncomp = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cd.byteLength) throw damaged();
    const name = names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // Zip64 extra field (0x0001): holds, in this order, only those of
    // uncompressed size, compressed size and offset that are 0xFFFFFFFF above.
    for (let x = p + 46 + nameLen, xEnd = x + extraLen; x + 4 <= xEnd;) {
      const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        const qEnd = Math.min(q + len, xEnd);
        if (uncomp === MAX32 && q + 8 <= qEnd) { uncomp = big(cd, q); q += 8; }
        if (comp === MAX32 && q + 8 <= qEnd) { comp = big(cd, q); q += 8; }
        if (offset === MAX32 && q + 8 <= qEnd) { offset = big(cd, q); q += 8; }
      }
      x += 4 + len;
    }
    if (comp === MAX32 || offset === MAX32) throw damaged();
    entries.push({ name, method, comp, uncomp, offset });
    p = next;
  }
  if (!entries.length) throw damaged();

  const entry = pickExportXml(entries);
  if (!entry) throw notHealth();

  // The local header's extra field can differ from the central one (zip64
  // writers often put sizes there), so read its own lengths.
  const lh = await view(file, entry.offset, 30);
  if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw damaged();
  const dataStart = entry.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  if (dataStart + entry.comp > size) throw damaged();
  if (entry.method !== 0 && entry.method !== 8) throw damaged();
  return { blob: file.slice(dataStart, dataStart + entry.comp), method: entry.method };
}

function pickExportXml(entries) {
  const usable = entries.filter((e) => !/(^|\/)__MACOSX\//.test(e.name) && !e.name.endsWith('/'));
  const biggest = (list) => list.sort((a, b) => b.uncomp - a.uncomp)[0] || null;
  const exact = usable.filter((e) => /export\.xml$/i.test(e.name) && !/export_cda\.xml$/i.test(e.name));
  if (exact.length) return biggest(exact);
  // Fallback: some iOS languages name the file differently. Take the biggest
  // .xml in the top folder that isn't the clinical-records file. The parser
  // still checks for <HealthData>, so a wrong pick ends in a clear error.
  return biggest(usable.filter((e) => /\.xml$/i.test(e.name) && !/_cda\.xml$/i.test(e.name) && e.name.split('/').length <= 2));
}

// ---------------------------------------------------------------- reading

const isZip = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const nextTask = () => new Promise((r) => setTimeout(r, 0));

/* Reads an Apple Health export (export.zip or a bare export.xml) and returns
   daily summaries. See the top of the file for why it streams. */
export async function readHealthExport(file, { since = null, onProgress = null, signal = null } = {}) {
  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
    throw new TypeError('readHealthExport needs a File or Blob');
  }
  if (since != null && !/^\d{4}-\d\d-\d\d$/.test(since)) throw new TypeError("since must be 'YYYY-MM-DD' or null");
  if (signal?.aborted) throw abortError(signal);

  // Pick the source by the first bytes, not the file name.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  let source;
  if (isZip(head)) {
    source = await findExportEntry(file);
  } else {
    const probe = await file.slice(0, 65536).text();
    if (!/^﻿?\s*</.test(probe) || probe.indexOf('HealthData') < 0) throw notHealth();
    source = { blob: file, method: 0 };
  }
  if (signal?.aborted) throw abortError(signal);

  // Count the compressed bytes as they go in: that's what progress is based on.
  const total = source.blob.size || 1;
  let done = 0;
  let bytes = source.blob.stream().pipeThrough(new TransformStream({
    transform(chunk, ctl) { done += chunk.byteLength; ctl.enqueue(chunk); },
  }));
  if (source.method === 8) bytes = bytes.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();

  // Cancelling the reader also cancels everything upstream (file read, inflate).
  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });

  const parser = createHealthParser({ since });
  let lastProgress = 0, lastYield = Date.now();
  try {
    for (;;) {
      let step;
      try {
        step = await reader.read();
      } catch (err) {
        if (signal?.aborted) throw abortError(signal);
        throw damaged(err); // bad deflate data, truncated entry, unreadable file
      }
      if (signal?.aborted) throw abortError(signal);
      if (step.done) break;
      parser.push(step.value);

      const now = Date.now();
      if (onProgress && now - lastProgress >= 100) { lastProgress = now; onProgress(Math.min(1, done / total)); }
      // Let the page repaint (progress bar, cancel button) now and then.
      if (now - lastYield >= 50) { await nextTask(); lastYield = Date.now(); if (signal?.aborted) throw abortError(signal); }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const result = parser.finish();
  onProgress?.(1);
  return result;
}

// ---------------------------------------------------------------- summary

const SUMMARY_LIMIT = 4000; // bytes of JSON
// How big a change must be (relative) before we call it a trend.
const TREND_EDGE = { weightKg: 0.01, leanKg: 0.01, bodyFatPct: 0.02 };

/* A compact view for the AI coach: per metric the average over the last
   `days` days and the `days` before that, the trend, the latest value and how
   many days had data; plus the last 14 days as rows. Kept under ~4 KB. */
export function summarizeHealth(result, { days = 30 } = {}) {
  const n = Math.max(1, Math.min(365, Math.floor(days) || 30));
  const all = result?.days || {};
  const keys = Object.keys(all).sort();
  const lastData = result?.range?.to ?? keys[keys.length - 1] ?? null;
  // Measure up to the export date, so "no data lately" shows as such.
  let asOf = result?.exportDate || lastData;
  if (lastData && asOf && lastData > asOf) asOf = lastData;

  const out = { asOf, windowDays: n, profile: profileSummary(result?.profile, asOf), metrics: {}, workouts: null, last14: null };
  if (!asOf) { out.workouts = { count: 0 }; out.last14 = { cols: ['date'], rows: [] }; return out; }

  const recentFrom = addDays(asOf, -(n - 1));
  const prevFrom = addDays(asOf, -(2 * n - 1));

  for (const m of DAY_KEYS) {
    let rs = 0, rn = 0, ps = 0, pn = 0, latest = null, latestDate = null;
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k > asOf) continue;
      const v = all[k][m];
      if (v == null) continue;
      if (latest == null) { latest = v; latestDate = k; }
      if (k >= recentFrom) { rs += v; rn++; } else if (k >= prevFrom) { ps += v; pn++; } else break;
    }
    if (latest == null) continue;
    const s = {};
    if (rn) s.avg = round(m, rs / rn);
    if (pn) s.prevAvg = round(m, ps / pn);
    if (rn && pn) {
      const diff = s.avg - s.prevAvg;
      const rel = s.prevAvg ? diff / Math.abs(s.prevAvg) : diff ? 1 : 0;
      s.trend = Math.abs(rel) < (TREND_EDGE[m] ?? 0.03) ? 'flat' : diff > 0 ? 'up' : 'down';
    }
    s.latest = latest;
    s.latestDate = latestDate;
    s.days = rn;
    out.metrics[m] = s;
  }

  // Workouts in the window, by type, plus the last few.
  const ws = (result?.workouts || []).filter((w) => w.date <= asOf);
  const recent = ws.filter((w) => w.date >= recentFrom);
  const byType = {};
  let minutes = 0;
  for (const w of recent) { byType[w.type] = (byType[w.type] || 0) + 1; minutes += w.durationMin || 0; }
  out.workouts = {
    count: recent.length,
    prevCount: ws.filter((w) => w.date >= prevFrom && w.date < recentFrom).length,
    totalMin: Math.round(minutes),
    byType,
    recent: ws.slice(-5).map((w) => {
      const o = {};
      for (const k in w) if (w[k] != null) o[k] = w[k];
      return o;
    }),
  };

  // The last 14 calendar days as rows: only columns with any data.
  const dates = [];
  for (let i = 13; i >= 0; i--) dates.push(addDays(asOf, -i));
  const cols = DAY_KEYS.filter((k) => dates.some((d) => all[d]?.[k] != null));
  out.last14 = { cols: ['date', ...cols], rows: dates.map((d) => [d, ...cols.map((k) => all[d]?.[k] ?? null)]) };

  // Stay under the size limit, dropping the least useful detail first.
  const size = () => new TextEncoder().encode(JSON.stringify(out)).length;
  const cuts = [
    () => { out.workouts.recent = out.workouts.recent.slice(-3); },
    () => { for (const s of Object.values(out.metrics)) if (s.latestDate === asOf) delete s.latestDate; },
    () => { delete out.workouts.recent; },
    () => { for (const s of Object.values(out.metrics)) delete s.latestDate; },
  ];
  for (const cut of cuts) { if (size() <= SUMMARY_LIMIT) break; cut(); }
  while (size() > SUMMARY_LIMIT && out.last14.rows.length > 1) out.last14.rows.shift();
  return out;
}

function profileSummary(p, asOf) {
  const o = { age: null, sex: p?.sex ?? null, heightCm: p?.heightCm ?? null };
  if (p?.birthDate && asOf) {
    let age = +asOf.slice(0, 4) - +p.birthDate.slice(0, 4);
    if (asOf.slice(5) < p.birthDate.slice(5)) age--;
    o.age = age;
  }
  return o;
}
