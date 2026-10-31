// Tests for src/health.js. Run: node --test test/health.test.js
// The exports are built here: a small export.xml string, zipped by hand
// (local headers, central directory, EOCD) with deflate-raw from node:zlib.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readHealthExport, summarizeHealth, createHealthParser, decodeEntities } from '../src/health.js';

// ------------------------------------------------------------ XML helpers

const Q = 'HKQuantityTypeIdentifier';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Attribute order is shuffled on purpose: real exports don't promise one.
function rec(type, start, end, value, unit, source = 'iPhone', children = '') {
  const t = type.startsWith('HK') ? type : Q + type;
  const attrs = [
    `endDate="${end}"`, `value="${esc(value)}"`, `type="${t}"`,
    `sourceName="${esc(source)}"`, unit ? `unit="${unit}"` : '', `startDate="${start}"`,
    `creationDate="${end}"`, `device="&lt;&lt;HKDevice: 0x28&gt;, name:${esc(source)}&gt;"`,
  ].filter(Boolean);
  if (t.length % 2) attrs.reverse();
  const open = `<Record ${attrs.join(' ')}`;
  return children ? `${open}>\n${children}\n</Record>` : `${open}/>`;
}
const sleep = (value, start, end, source) =>
  rec('HKCategoryTypeIdentifierSleepAnalysis', start, end, 'HKCategoryValueSleepAnalysis' + value, '', source);

function healthXml(body, { exportDate = '2026-10-31 08:00:00 +0100', me = true } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>
<!ATTLIST Record type CDATA #REQUIRED value CDATA #IMPLIED>
<!ELEMENT Workout ((MetadataEntry|WorkoutEvent|WorkoutRoute|WorkoutStatistics)*)>
]>
<HealthData locale="nb_NO">
 <ExportDate value="${exportDate}"/>
${me ? ' <Me HKCharacteristicTypeIdentifierBloodType="HKBloodTypeNotSet" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale" HKCharacteristicTypeIdentifierDateOfBirth="1994-05-17" HKCharacteristicTypeIdentifierFitzpatrickSkinType="HKFitzpatrickSkinTypeNotSet"/>' : ''}
${body}
 <ActivitySummary dateComponents="2026-10-30" activeEnergyBurned="500" activeEnergyBurnedGoal="600"/>
</HealthData>
`;
}

// ------------------------------------------------------------ zip helpers

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
const crc = (buf) => (zlib.crc32 ? zlib.crc32(buf) : 0);

/* files: [{ name, data, method: 0|8 }]
   zip64: write every size/offset as 0xFFFFFFFF with the real value in the
   0x0001 extra field, plus an EOCD64 record and locator.
   localPad: extra junk in the local extra field only, so the local and
   central extra lengths differ. comment: a zip comment after the EOCD. */
function makeZip(files, { zip64 = false, localPad = 0, comment = '' } = {}) {
  const out = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const raw = Buffer.from(f.data);
    const method = f.method ?? 8;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    let localExtra = Buffer.alloc(0);
    if (zip64) localExtra = Buffer.concat([u16(1), u16(16), u64(raw.length), u64(data.length)]);
    if (localPad) localExtra = Buffer.concat([localExtra, u16(0xcafe), u16(localPad), Buffer.alloc(localPad, 7)]);
    const S = (n) => u32(zip64 ? 0xffffffff : n);
    const local = Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(0), u16(method), u16(0), u16(0),
      u32(crc(raw)), S(data.length), S(raw.length), u16(name.length), u16(localExtra.length),
    ]);
    const centralExtra = zip64 ? Buffer.concat([u16(1), u16(24), u64(raw.length), u64(data.length), u64(offset)]) : Buffer.alloc(0);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(45), u16(zip64 ? 45 : 20), u16(0), u16(method), u16(0), u16(0),
      u32(crc(raw)), S(data.length), S(raw.length), u16(name.length), u16(centralExtra.length), u16(0),
      u16(0), u16(0), u32(0), S(offset),
    ]), name, centralExtra);
    out.push(local, name, localExtra, data);
    offset += local.length + name.length + localExtra.length + data.length;
  }
  const cd = Buffer.concat(central);
  const cdOffset = offset;
  if (zip64) {
    const eocd64At = cdOffset + cd.length;
    out.push(cd, Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(files.length), u64(files.length), u64(cd.length), u64(cdOffset),
    ]), Buffer.concat([u32(0x07064b50), u32(0), u64(eocd64At), u32(1)]));
  } else out.push(cd);
  const c = Buffer.from(comment);
  out.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(zip64 ? 0xffff : files.length), u16(zip64 ? 0xffff : files.length),
    u32(zip64 ? 0xffffffff : cd.length), u32(zip64 ? 0xffffffff : cdOffset), u16(c.length),
  ]), c);
  return Buffer.concat(out);
}

const zipOf = (xml, opts = {}) => new Blob([makeZip([
  { name: 'apple_health_export/export_cda.xml', data: '<?xml version="1.0"?><ClinicalDocument/>' },
  { name: 'apple_health_export/workout-routes/route_2026-10-30.gpx', data: '<gpx/>' },
  { name: opts.name || 'apple_health_export/export.xml', data: xml, method: opts.method ?? 8 },
], opts)]);

// ------------------------------------------------------------ fixture

const D = (day, time) => `${day} ${time} +0100`;
const FIXTURE = healthXml([
  // Steps on 2026-10-30: iPhone 3000+2000 = 5000, Watch 4000+500 = 4500 → 5000.
  rec('StepCount', D('2026-10-30', '08:00:00'), D('2026-10-30', '09:00:00'), 3000, 'count', "Emil's iPhone"),
  rec('StepCount', D('2026-10-30', '12:00:00'), D('2026-10-30', '13:00:00'), 2000, 'count', "Emil's iPhone"),
  rec('StepCount', D('2026-10-30', '08:00:00'), D('2026-10-30', '09:00:00'), 4000, 'count', 'Apple Watch'),
  rec('StepCount', D('2026-10-30', '12:00:00'), D('2026-10-30', '13:00:00'), 500, 'count', 'Apple Watch'),
  // Day assigned by startDate: starts 23:50 on the 29th.
  rec('StepCount', D('2026-10-29', '23:50:00'), D('2026-10-30', '00:10:00'), 700, 'count', 'Apple Watch'),
  // Units.
  rec('DistanceWalkingRunning', D('2026-10-30', '08:00:00'), D('2026-10-30', '09:00:00'), 3.1, 'mi', 'Apple Watch'),
  rec('DistanceWalkingRunning', D('2026-10-29', '08:00:00'), D('2026-10-29', '09:00:00'), 2500, 'm', 'iPhone'),
  rec('ActiveEnergyBurned', D('2026-10-30', '08:00:00'), D('2026-10-30', '09:00:00'), 418.4, 'kJ', 'Apple Watch'),
  rec('ActiveEnergyBurned', D('2026-10-30', '10:00:00'), D('2026-10-30', '11:00:00'), 150, 'kcal', 'Apple Watch'),
  rec('AppleExerciseTime', D('2026-10-30', '08:00:00'), D('2026-10-30', '08:30:00'), 30, 'min', 'Apple Watch'),
  rec('FlightsClimbed', D('2026-10-30', '08:00:00'), D('2026-10-30', '08:30:00'), 4, 'count', 'iPhone'),
  rec('RestingHeartRate', D('2026-10-30', '07:00:00'), D('2026-10-30', '07:00:00'), 50, 'count/min', 'Apple Watch'),
  rec('RestingHeartRate', D('2026-10-30', '20:00:00'), D('2026-10-30', '20:00:00'), 53, 'count/min', 'Apple Watch'),
  rec('WalkingHeartRateAverage', D('2026-10-30', '20:00:00'), D('2026-10-30', '20:00:00'), 98.44, 'count/min', 'Apple Watch'),
  rec('RespiratoryRate', D('2026-10-30', '03:00:00'), D('2026-10-30', '03:00:00'), 14.5, 'count/min', 'Apple Watch'),
  rec('OxygenSaturation', D('2026-10-30', '03:00:00'), D('2026-10-30', '03:00:00'), 0.97, '%', 'Apple Watch'),
  rec('OxygenSaturation', D('2026-10-30', '04:00:00'), D('2026-10-30', '04:00:00'), 0.95, '%', 'Apple Watch'),
  rec('BodyMass', D('2026-10-30', '07:30:00'), D('2026-10-30', '07:30:00'), 176.37, 'lb', 'Scale'),
  rec('BodyMass', D('2026-10-30', '06:30:00'), D('2026-10-30', '06:30:00'), 190, 'lb', 'Scale'), // earlier that day: loses
  rec('BodyFatPercentage', D('2026-10-30', '07:30:00'), D('2026-10-30', '07:30:00'), 0.215, '%', 'Scale'),
  rec('LeanBodyMass', D('2026-10-30', '07:30:00'), D('2026-10-30', '07:30:00'), 138.89, 'lb', 'Scale'),
  rec('VO2Max', D('2026-10-30', '18:00:00'), D('2026-10-30', '18:00:00'), 48.2, 'mL/min·kg', 'Apple Watch'),
  rec('Height', D('2020-01-01', '12:00:00'), D('2020-01-01', '12:00:00'), 70.866, 'in', 'Health'),
  // A record with children (HRV beat list) and one with MetadataEntry.
  rec('HeartRateVariabilitySDNN', D('2026-10-30', '02:00:00'), D('2026-10-30', '02:01:00'), 45.2, 'ms', 'Apple Watch',
    '  <HeartRateVariabilityMetadataList>\n   <InstantaneousBeatsPerMinute bpm="60" time="02:00:01,00"/>\n  </HeartRateVariabilityMetadataList>'),
  rec('HeartRateVariabilitySDNN', D('2026-10-30', '04:00:00'), D('2026-10-30', '04:01:00'), 54.8, 'ms', 'Apple Watch',
    '  <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="1"/>'),
  // HeartRate is not one of ours: skipped.
  rec('HeartRate', D('2026-10-30', '08:00:00'), D('2026-10-30', '08:00:00'), 150, 'count/min', 'Apple Watch'),

  // Sleep, night ending 2026-10-30. Watch: 22:30–23:00 Core (ends after
  // 18:00 → still this night), 23:00–01:00 Core, 01:00–02:00 Deep,
  // 02:00–03:00 REM, 03:00–03:15 Awake, 03:15–06:30 Core.
  // iPhone: Asleep 23:30–06:00 (overlaps), InBed 22:15–06:45.
  sleep('AsleepCore', D('2026-10-29', '22:30:00'), D('2026-10-29', '23:00:00'), 'Apple Watch'),
  sleep('AsleepCore', D('2026-10-29', '23:00:00'), D('2026-10-30', '01:00:00'), 'Apple Watch'),
  sleep('AsleepDeep', D('2026-10-30', '01:00:00'), D('2026-10-30', '02:00:00'), 'Apple Watch'),
  sleep('AsleepREM', D('2026-10-30', '02:00:00'), D('2026-10-30', '03:00:00'), 'Apple Watch'),
  sleep('Awake', D('2026-10-30', '03:00:00'), D('2026-10-30', '03:15:00'), 'Apple Watch'),
  sleep('AsleepCore', D('2026-10-30', '03:15:00'), D('2026-10-30', '06:30:00'), 'Apple Watch'),
  sleep('Asleep', D('2026-10-29', '23:30:00'), D('2026-10-30', '06:00:00'), 'iPhone'),
  sleep('InBed', D('2026-10-29', '22:15:00'), D('2026-10-30', '06:45:00'), 'iPhone'),
  // Evening nap ending 19:00 on the 30th → the night of the 31st.
  sleep('AsleepUnspecified', D('2026-10-30', '18:00:00'), D('2026-10-30', '19:00:00'), 'Apple Watch'),

  // New-style workout: totals in WorkoutStatistics children.
  `<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45.5" durationUnit="min" sourceName="Apple Watch" startDate="${D('2026-10-30', '17:00:00')}" endDate="${D('2026-10-30', '17:45:30')}">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
  <WorkoutEvent type="HKWorkoutEventTypeSegment" date="${D('2026-10-30', '17:00:00')}"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="${D('2026-10-30', '17:00:00')}" endDate="${D('2026-10-30', '17:45:30')}" sum="250.4" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="${D('2026-10-30', '17:00:00')}" endDate="${D('2026-10-30', '17:45:30')}" average="128.4" minimum="80" maximum="165" unit="count/min"/>
 </Workout>`,
  // Old-style workout: totals as attributes, in mi and kJ.
  `<Workout totalEnergyBurnedUnit="kJ" totalDistanceUnit="mi" workoutActivityType="HKWorkoutActivityTypeRunning" duration="0.5" durationUnit="hr" totalDistance="3.10686" totalEnergyBurned="1255.2" sourceName="Apple Watch" startDate="${D('2026-10-29', '07:00:00')}" endDate="${D('2026-10-29', '07:30:00')}">
  <WorkoutRoute sourceName="Apple Watch"><FileReference path="/workout-routes/route.gpx"/></WorkoutRoute>
 </Workout>`,
  // Self-closing workout with no duration: computed from the dates.
  `<Workout workoutActivityType="HKWorkoutActivityTypeHighIntensityIntervalTraining" sourceName="Apple Watch" startDate="${D('2026-10-28', '18:00:00')}" endDate="${D('2026-10-28', '18:20:00')}"/>`,
].join('\n'));

// ------------------------------------------------------------ tests

test('reads a deflated zip: dedupe, units, averages, last values, profile', async () => {
  const r = await readHealthExport(zipOf(FIXTURE));
  const d = r.days['2026-10-30'];
  assert.equal(d.steps, 5000, 'max of per-source sums');
  assert.equal(r.days['2026-10-29'].steps, 700, 'filed by start date');
  assert.equal(d.distanceKm, 5.0); // 3.1 mi
  assert.equal(r.days['2026-10-29'].distanceKm, 2.5); // 2500 m
  assert.equal(d.activeKcal, 250); // 418.4 kJ = 100 kcal, + 150 kcal
  assert.equal(d.exerciseMin, 30);
  assert.equal(d.flights, 4);
  assert.equal(d.restingHr, 51.5);
  assert.equal(d.walkingHr, 98.4);
  assert.equal(d.respiratoryRate, 14.5);
  assert.equal(d.spo2, 96);
  assert.equal(d.hrvMs, 50);
  assert.equal(d.weightKg, 80, '176.37 lb, the later weighing');
  assert.equal(d.bodyFatPct, 21.5);
  assert.equal(d.leanKg, 63);
  assert.equal(d.vo2max, 48.2);
  assert.deepEqual(r.profile, { birthDate: '1994-05-17', sex: 'male', heightCm: 180 });
  assert.equal(r.exportDate, '2026-10-31');
  assert.deepEqual(r.range, { from: '2026-10-28', to: '2026-10-31' });
  assert.equal(r.counts.workouts, 3);
  assert.ok(!('heartRate' in d));
  for (const k of Object.keys(d)) assert.notEqual(d[k], null);
});

test('entities in source names are decoded before dedupe', () => {
  // The same source written two ways must be summed, not maxed.
  const xml = healthXml([
    rec('StepCount', D('2026-10-30', '08:00:00'), D('2026-10-30', '09:00:00'), 1000, 'count', 'x').replace('sourceName="x"', 'sourceName="Emil&apos;s iPhone"'),
    rec('StepCount', D('2026-10-30', '10:00:00'), D('2026-10-30', '11:00:00'), 1000, 'count', 'x').replace('sourceName="x"', 'sourceName="Emil&#39;s iPhone"'),
  ].join('\n'));
  const p = createHealthParser(); p.push(xml);
  assert.equal(p.finish().days['2026-10-30'].steps, 2000);
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#x41;&#66; &bogus;'), 'a & b <c> "d" AB &bogus;');
});

test('sleep: merged across sources, nights by end time, after 18:00 → next night', async () => {
  const r = await readHealthExport(zipOf(FIXTURE));
  const n = r.days['2026-10-30'];
  // Asleep union: 22:30–03:00 and 03:15–06:30 = 4.5 + 3.25 = 7.75 h
  // (the iPhone's 23:30–06:00 fills the 03:00–03:15 Awake gap) → 22:30–06:30 = 8 h.
  assert.equal(n.sleepH, 8);
  assert.equal(n.deepH, 1);
  assert.equal(n.remH, 1);
  assert.equal(n.inBedH, 8.5);
  assert.equal(r.days['2026-10-31'].sleepH, 1, 'evening nap goes to the next night');
  assert.equal(r.days['2026-10-29']?.sleepH, undefined, '22:30–23:00 on the 29th is not that night');
});

test('workouts: WorkoutStatistics, old attributes, computed duration, readable type', async () => {
  const { workouts } = await readHealthExport(zipOf(FIXTURE));
  assert.deepEqual(workouts, [
    { date: '2026-10-28', type: 'High Intensity Interval Training', durationMin: 20, kcal: null, distanceKm: null, avgHr: null },
    { date: '2026-10-29', type: 'Running', durationMin: 30, kcal: 300, distanceKm: 5, avgHr: null },
    { date: '2026-10-30', type: 'Traditional Strength Training', durationMin: 45.5, kcal: 250, distanceKm: null, avgHr: 128 },
  ]);
});

test('since skips older records and partial days, but keeps the profile height', async () => {
  const r = await readHealthExport(zipOf(FIXTURE), { since: '2026-10-30' });
  assert.deepEqual(Object.keys(r.days), ['2026-10-30', '2026-10-31']);
  assert.equal(r.days['2026-10-30'].steps, 5000);
  assert.equal(r.days['2026-10-30'].sleepH, 8, 'night ending on since is kept');
  assert.deepEqual(r.workouts.map((w) => w.date), ['2026-10-30']);
  assert.equal(r.profile.heightCm, 180);
  assert.equal(r.range.from, '2026-10-30');
});

test('zip64 entry (sizes and offset in the 0x0001 extra field)', async () => {
  const blob = zipOf(FIXTURE, { zip64: true });
  const plain = await readHealthExport(zipOf(FIXTURE));
  assert.deepEqual(await readHealthExport(blob), plain);
});

test('stored (method 0) entry, local extra field longer than central, zip comment', async () => {
  const blob = zipOf(FIXTURE, { method: 0, localPad: 37, comment: 'Exported from Health' });
  const plain = await readHealthExport(zipOf(FIXTURE));
  assert.deepEqual(await readHealthExport(blob), plain);
});

test('bare export.xml works too', async () => {
  const plain = await readHealthExport(zipOf(FIXTURE));
  assert.deepEqual(await readHealthExport(new Blob(['﻿' + FIXTURE])), plain);
});

test('localized file name falls back to the biggest top-level .xml', async () => {
  const plain = await readHealthExport(zipOf(FIXTURE));
  assert.deepEqual(await readHealthExport(zipOf(FIXTURE, { name: 'apple_health_export/eksport.xml' })), plain);
});

test('tags split across chunk boundaries give the same result', () => {
  const whole = createHealthParser(); whole.push(FIXTURE);
  const expected = whole.finish();
  for (const size of [1, 2, 3, 7, 13, 64]) {
    const p = createHealthParser();
    for (let i = 0; i < FIXTURE.length; i += size) p.push(FIXTURE.slice(i, i + size));
    assert.deepEqual(p.finish(), expected, `chunk size ${size}`);
  }
});

test('a raw ">" inside a quoted value does not end the tag', () => {
  const p = createHealthParser();
  p.push(healthXml(`<Record sourceName="A > B" type="${Q}StepCount" unit="count" startDate="${D('2026-10-30', '08:00:00')}" endDate="${D('2026-10-30', '09:00:00')}" value="123"/>`));
  assert.equal(p.finish().days['2026-10-30'].steps, 123);
});

const NOT_HEALTH = /This doesn't look like an Apple Health export/;
const DAMAGED = /The file seems damaged/;

test('non-health files are rejected with a readable error', async () => {
  await assert.rejects(readHealthExport(new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')])), NOT_HEALTH);
  await assert.rejects(readHealthExport(new Blob(['hello world'])), NOT_HEALTH);
  await assert.rejects(readHealthExport(new Blob(['<?xml version="1.0"?><svg/>'])), NOT_HEALTH);
  // A zip with only the clinical-records file.
  const cdaOnly = new Blob([makeZip([{ name: 'apple_health_export/export_cda.xml', data: '<ClinicalDocument/>' }])]);
  await assert.rejects(readHealthExport(cdaOnly), (err) => NOT_HEALTH.test(err.message) && err.code === 'not-health');
  // A zip with an export.xml that isn't Health data.
  await assert.rejects(readHealthExport(new Blob([makeZip([{ name: 'export.xml', data: '<?xml version="1.0"?><root/>' }])])), NOT_HEALTH);
});

test('damaged zips are rejected with a readable error', async () => {
  const good = makeZip([{ name: 'apple_health_export/export.xml', data: FIXTURE }]);
  // Cut off the end: no central directory.
  await assert.rejects(readHealthExport(new Blob([good.subarray(0, 400)])), DAMAGED);
  // Garbage in the deflate data.
  const bad = Buffer.from(good);
  // Keep the start (so <HealthData> is still found) and break the middle.
  const dataAt = 30 + 'apple_health_export/export.xml'.length;
  const mid = dataAt + Math.floor(good.readUInt32LE(18) / 2);
  for (let i = mid; i < mid + 64; i++) bad[i] ^= 0x5a;
  await assert.rejects(readHealthExport(new Blob([bad])), DAMAGED);
  // XML that stops halfway (stored, so the zip itself is fine).
  const half = FIXTURE.slice(0, FIXTURE.length / 2);
  await assert.rejects(readHealthExport(new Blob([makeZip([{ name: 'export.xml', data: half, method: 0 }])])), DAMAGED);
});

test('abort and progress', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(readHealthExport(zipOf(FIXTURE), { signal: ac.signal }), { name: 'AbortError' });

  const ac2 = new AbortController();
  const p = readHealthExport(zipOf(FIXTURE), { signal: ac2.signal });
  ac2.abort();
  await assert.rejects(p, { name: 'AbortError' });

  const seen = [];
  await readHealthExport(zipOf(FIXTURE), { onProgress: (f) => seen.push(f) });
  assert.equal(seen.at(-1), 1);
  assert.ok(seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1])));
});

test('summarizeHealth stays under 4 KB for 2 years of data', async () => {
  // Two years, every metric, two sources, sleep every night, workouts every other day.
  const parts = [];
  const start = Date.UTC(2024, 10, 1);
  const pad = (n) => String(n).padStart(2, '0');
  let last;
  for (let i = 0; i < 731; i++) {
    const t = new Date(start + i * 86400000);
    const day = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    const prev = new Date(start + (i - 1) * 86400000).toISOString().slice(0, 10);
    const w = (k) => 1 + 0.1 * Math.sin(i / 20 + k);
    const at = (h) => D(day, `${pad(h)}:00:00`);
    for (const src of ['iPhone', 'Apple Watch']) {
      parts.push(rec('StepCount', at(9), at(10), Math.round(8000 * w(src.length)), 'count', src));
      parts.push(rec('DistanceWalkingRunning', at(9), at(10), 6 * w(1), 'km', src));
      parts.push(rec('ActiveEnergyBurned', at(9), at(10), 500 * w(2), 'kcal', src));
      parts.push(rec('FlightsClimbed', at(9), at(10), 10, 'count', src));
    }
    parts.push(rec('AppleExerciseTime', at(9), at(10), 40 * w(3), 'min', 'Apple Watch'));
    parts.push(rec('RestingHeartRate', at(7), at(7), 52 * w(4), 'count/min', 'Apple Watch'));
    parts.push(rec('HeartRateVariabilitySDNN', at(3), at(3), 55 * w(5), 'ms', 'Apple Watch'));
    parts.push(rec('WalkingHeartRateAverage', at(20), at(20), 100 * w(6), 'count/min', 'Apple Watch'));
    parts.push(rec('RespiratoryRate', at(3), at(3), 14 * w(7), 'count/min', 'Apple Watch'));
    parts.push(rec('OxygenSaturation', at(3), at(3), 0.96, '%', 'Apple Watch'));
    parts.push(rec('BodyMass', at(7), at(7), 82 - i * 0.005, 'kg', 'Scale'));
    parts.push(rec('BodyFatPercentage', at(7), at(7), 0.2, '%', 'Scale'));
    parts.push(rec('LeanBodyMass', at(7), at(7), 65, 'kg', 'Scale'));
    parts.push(rec('VO2Max', at(18), at(18), 47.5, 'mL/min·kg', 'Apple Watch'));
    parts.push(sleep('InBed', D(prev, '22:30:00'), D(day, '06:45:00'), 'iPhone'));
    parts.push(sleep('AsleepCore', D(prev, '23:00:00'), D(day, '02:00:00'), 'Apple Watch'));
    parts.push(sleep('AsleepDeep', D(day, '02:00:00'), D(day, '03:00:00'), 'Apple Watch'));
    parts.push(sleep('AsleepREM', D(day, '03:00:00'), D(day, '04:30:00'), 'Apple Watch'));
    parts.push(sleep('AsleepCore', D(day, '04:30:00'), D(day, '06:30:00'), 'Apple Watch'));
    if (i % 2 === 0) parts.push(`<Workout workoutActivityType="HKWorkoutActivityType${i % 4 ? 'Running' : 'TraditionalStrengthTraining'}" duration="50" durationUnit="min" sourceName="Apple Watch" startDate="${at(17)}" endDate="${at(18)}"><WorkoutStatistics type="${Q}ActiveEnergyBurned" sum="400" unit="kcal"/><WorkoutStatistics type="${Q}HeartRate" average="135" unit="count/min"/>${i % 4 ? `<WorkoutStatistics type="${Q}DistanceWalkingRunning" sum="8.2" unit="km"/>` : ''}</Workout>`);
    last = day;
  }
  const xml = healthXml(parts.join('\n'), { exportDate: `${last} 08:00:00 +0100` });
  const result = await readHealthExport(zipOf(xml));
  assert.equal(Object.keys(result.days).length, 731);
  assert.equal(result.days[last].sleepH, 7.5);

  for (const days of [7, 30, 90]) {
    const s = summarizeHealth(result, { days });
    const bytes = Buffer.byteLength(JSON.stringify(s));
    assert.ok(bytes < 4096, `summary for ${days} days is ${bytes} bytes`);
    assert.equal(s.asOf, last);
    assert.equal(s.last14.rows.length, 14);
    assert.equal(s.metrics.steps.days, Math.min(days, 731));
    assert.ok(['up', 'down', 'flat'].includes(s.metrics.steps.trend));
    assert.equal(s.metrics.sleepH.avg, 7.5);
    assert.equal(s.metrics.weightKg.trend, 'flat');
    assert.ok(s.workouts.count > 0);
    assert.equal(s.profile.age, 32);
  }
  // Empty result doesn't throw.
  const empty = summarizeHealth({ profile: {}, days: {}, workouts: [], range: { from: null, to: null }, exportDate: null });
  assert.equal(empty.asOf, null);
});
