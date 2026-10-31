/* Muscle groups, and how much each exercise trains them.

   A set counts as 1 for a muscle the exercise mainly trains, and 0.5 for one
   that helps (a synergist), like triceps on the bench press. That is how the
   big volume meta-regressions count indirect sets (Pelland et al. 2024).

   target: weekly hard sets [low, high] for this lifter (novice to early intermediate,
   set a bit below the RP volume landmarks). Below low the muscle is under-trained;
   past high there is little extra to gain. quiet: never warn (forearms, neck).
   See docs/research.md, section "Muscle volume". */

export const MUSCLES = [
  // Upper body
  { id: 'chest', name: 'Chest', region: 'Push', size: 'large', target: [8, 16] },
  { id: 'frontDelts', name: 'Front delts', region: 'Push', size: 'small', target: [4, 10] },
  { id: 'sideDelts', name: 'Side delts', region: 'Shoulders', size: 'small', target: [6, 14] },
  { id: 'rearDelts', name: 'Rear delts', region: 'Shoulders', size: 'small', target: [4, 12] },
  { id: 'triceps', name: 'Triceps', region: 'Arms', size: 'small', target: [6, 14] },
  { id: 'biceps', name: 'Biceps', region: 'Arms', size: 'small', target: [6, 14] },
  { id: 'forearms', name: 'Forearms & grip', region: 'Arms', size: 'small', target: [0, 6], optional: true, quiet: true },
  { id: 'lats', name: 'Lats', region: 'Pull', size: 'large', target: [8, 16] },
  { id: 'upperBack', name: 'Upper back & traps', region: 'Pull', size: 'large', target: [8, 16] },
  { id: 'neck', name: 'Neck', region: 'Pull', size: 'small', target: [0, 4], optional: true, quiet: true },
  // Trunk
  { id: 'abs', name: 'Abs', region: 'Core', size: 'small', target: [4, 10] },
  { id: 'obliques', name: 'Obliques', region: 'Core', size: 'small', target: [2, 8], optional: true },
  { id: 'lowerBack', name: 'Lower back', region: 'Core', size: 'large', target: [2, 8] },
  // Legs
  { id: 'quads', name: 'Quads', region: 'Legs', size: 'large', target: [8, 16] },
  { id: 'glutes', name: 'Glutes', region: 'Legs', size: 'large', target: [6, 14] },
  { id: 'hamstrings', name: 'Hamstrings', region: 'Legs', size: 'large', target: [6, 12] },
  { id: 'adductors', name: 'Adductors', region: 'Legs', size: 'large', target: [3, 8], optional: true },
  { id: 'calves', name: 'Calves', region: 'Legs', size: 'small', target: [4, 12] },
];
export const MUSCLE = Object.fromEntries(MUSCLES.map((m) => [m.id, m]));
export const REGIONS = ['Push', 'Pull', 'Shoulders', 'Arms', 'Core', 'Legs'];

/* Exercise → { muscle: 1 | 0.5 }. Main lifts and pull-ups by id. */
export const WORKS = {
  sq: { quads: 1, glutes: 0.5, adductors: 0.5, lowerBack: 0.5 }, // Kubo 2019: deep squats grow glutes/adductors some, hamstrings not
  bp: { chest: 1, triceps: 0.5, frontDelts: 0.5 },
  dl: { glutes: 0.5, lowerBack: 0.5, hamstrings: 0.5, quads: 0.5, upperBack: 0.5, forearms: 0.5 }, // little direct growth evidence
  op: { frontDelts: 1, sideDelts: 0.5, triceps: 0.5, upperBack: 0.5, abs: 0.5 },
  pu: { lats: 1, upperBack: 0.5, biceps: 0.5, rearDelts: 0.25, forearms: 0.5 },
  'row-db': { upperBack: 1, lats: 1, rearDelts: 0.5, biceps: 0.5 },
  facepull: { rearDelts: 1, upperBack: 1, sideDelts: 0.5 },
  pullapart: { rearDelts: 1, upperBack: 0.5 },
  'reverse-fly': { rearDelts: 1, upperBack: 0.5 },
  'inc-db': { chest: 1, frontDelts: 0.5, triceps: 0.5 },
  'db-fly': { chest: 1, frontDelts: 0.5 },
  pushup: { chest: 1, triceps: 0.5, frontDelts: 0.5, abs: 0.5 },
  dips: { chest: 1, triceps: 1, frontDelts: 0.5 },
  lateral: { sideDelts: 1 },
  curl: { biceps: 1, forearms: 0.5 },
  hammer: { biceps: 1, forearms: 1 },
  'tri-ext': { triceps: 1 },
  'close-push': { triceps: 1, chest: 0.5 },
  rdl: { hamstrings: 1, glutes: 1, lowerBack: 0.5 },
  'leg-curl': { hamstrings: 1 },
  nordic: { hamstrings: 1 },
  split: { quads: 1, glutes: 1, adductors: 0.5 },
  lunge: { quads: 1, glutes: 1, adductors: 0.5 },
  'hip-thrust': { glutes: 1, hamstrings: 0.5 },
  copenhagen: { adductors: 1, obliques: 0.5 },
  calf: { calves: 1 },
  plank: { abs: 1, obliques: 0.5 },
  'side-plank': { obliques: 1, abs: 0.5 },
  hlr: { abs: 1, forearms: 0.5 },
  pallof: { obliques: 1, abs: 0.5 },
  'back-ext': { lowerBack: 1, glutes: 0.5, hamstrings: 0.5 },
  farmer: { forearms: 1, upperBack: 0.5, abs: 0.5 },
  hang: { forearms: 1, lats: 0.5 },
  'wrist-curl': { forearms: 1 },
  neck: { neck: 1 },
  goblet: { quads: 1, glutes: 0.5, adductors: 0.5, abs: 0.5 },
  'db-rdl': { hamstrings: 1, glutes: 1, lowerBack: 0.5, forearms: 0.5 },
  'floor-press': { chest: 1, triceps: 0.5, frontDelts: 0.5 },
  'db-press': { frontDelts: 1, sideDelts: 0.5, triceps: 0.5 },
  'kb-swing': { glutes: 1, hamstrings: 0.5, lowerBack: 0.5, forearms: 0.5 },
  superman: { lowerBack: 1, glutes: 0.5 },
};

/* Own exercises are tagged with a body-part group; this is the guess for them. */
export const GROUP_WORKS = {
  back: { upperBack: 1, lats: 1, rearDelts: 0.5, biceps: 0.5 },
  chest: { chest: 1, triceps: 0.5, frontDelts: 0.5 },
  shoulders: { sideDelts: 1, frontDelts: 0.5, rearDelts: 0.5 },
  arms: { biceps: 1, triceps: 1 },
  legs: { quads: 1, glutes: 1, hamstrings: 0.5 },
  core: { abs: 1, obliques: 0.5 },
  grip: { forearms: 1 },
  neck: { neck: 1 },
};

/* Cardio tires the legs a little but is not counted as lifting volume.
   Fatigue in set-equivalents per 30 minutes. */
export const CARDIO_FATIGUE = {
  run: { quads: 1, calves: 1.5, hamstrings: 0.5, glutes: 0.5 },
  walk: { calves: 0.5, quads: 0.25 },
  bike: { quads: 1.5, glutes: 0.5, calves: 0.5 },
  row: { lats: 0.5, upperBack: 0.5, quads: 0.5, glutes: 0.5, lowerBack: 0.5 },
  swim: { lats: 0.75, frontDelts: 0.5, sideDelts: 0.25 },
  other: {},
};

/** What an exercise trains. custom: own exercises (they may carry their own `works`). */
export function worksFor(exId, custom = []) {
  if (WORKS[exId]) return WORKS[exId];
  const c = custom.find((x) => x.id === exId);
  if (c?.works && Object.keys(c.works).length) return c.works;
  if (c?.group && GROUP_WORKS[c.group]) return GROUP_WORKS[c.group];
  return {};
}
