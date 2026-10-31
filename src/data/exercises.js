/* Exercise catalog. Main lifts drive the program; accessories are suggestions
   (between sets, or as T3 work). Body-part groups match the Body tab. */

export const MAIN = {
  sq: { id: 'sq', name: 'Back squat', short: 'Squat', lower: true, inc: 2.5, colour: 'sq' },
  bp: { id: 'bp', name: 'Bench press', short: 'Bench', lower: false, inc: 2.5, colour: 'bp' },
  dl: { id: 'dl', name: 'Deadlift', short: 'Deadlift', lower: true, inc: 5, colour: 'dl' },
  op: { id: 'op', name: 'Overhead press', short: 'Press', lower: false, inc: 1.25, colour: 'op' },
};
export const MAIN_IDS = ['sq', 'bp', 'dl', 'op'];
export const PULLUP = { id: 'pu', name: 'Pull-ups', short: 'Pull-ups', colour: 'pu' };

/* Two workouts in rotation. Squat and bench appear in both, deadlift and press
   in every second one, so 2–4 sessions a week still trains each lift 1–4 times. */
export const WORKOUTS = {
  A: { id: 'A', name: 'Workout A', t1: ['sq', 'op'], t2: ['bp'] },
  B: { id: 'B', name: 'Workout B', t1: ['bp', 'dl'], t2: ['sq'] },
};

/* Accessories. kind: 'weight' adds load (double progression), 'reps' adds reps, 'time' adds seconds.
   step: the smallest weight jump for that exercise. */
export const ACCESSORIES = [
  { id: 'row-db', name: 'One-arm dumbbell row', group: 'back', kind: 'weight', step: 2, range: [8, 12], start: 16 },
  { id: 'facepull', name: 'Face pulls', group: 'back', kind: 'weight', step: 2.5, range: [12, 15], start: 15 },
  { id: 'pullapart', name: 'Band pull-aparts', group: 'back', kind: 'reps', range: [15, 25] },
  { id: 'inc-db', name: 'Incline dumbbell press', group: 'chest', kind: 'weight', step: 2, range: [8, 12], start: 14 },
  { id: 'pushup', name: 'Push-ups', group: 'chest', kind: 'reps', range: [10, 25] },
  { id: 'dips', name: 'Dips', group: 'chest', kind: 'reps', range: [6, 15] },
  { id: 'lateral', name: 'Lateral raises', group: 'shoulders', kind: 'weight', step: 1, range: [12, 15], start: 6 },
  { id: 'curl', name: 'Dumbbell curls', group: 'arms', kind: 'weight', step: 1, range: [8, 12], start: 10 },
  { id: 'hammer', name: 'Hammer curls', group: 'arms', kind: 'weight', step: 1, range: [8, 12], start: 10 },
  { id: 'tri-ext', name: 'Overhead triceps extension', group: 'arms', kind: 'weight', step: 2, range: [10, 15], start: 12 },
  { id: 'rdl', name: 'Romanian deadlift', group: 'legs', kind: 'weight', step: 5, range: [8, 12], start: 40 },
  { id: 'split', name: 'Bulgarian split squat', group: 'legs', kind: 'weight', step: 2, range: [8, 12], start: 0 },
  { id: 'lunge', name: 'Walking lunges', group: 'legs', kind: 'weight', step: 2, range: [10, 14], start: 0 },
  { id: 'calf', name: 'Standing calf raises', group: 'legs', kind: 'weight', step: 2.5, range: [12, 20], start: 0 },
  { id: 'plank', name: 'Plank', group: 'core', kind: 'time', range: [30, 60] },
  { id: 'hlr', name: 'Hanging knee raises', group: 'core', kind: 'reps', range: [8, 15] },
  { id: 'pallof', name: 'Pallof press', group: 'core', kind: 'weight', step: 2.5, range: [10, 15], start: 10 },
  { id: 'farmer', name: 'Farmer carry (20 m)', group: 'grip', kind: 'weight', step: 2, range: [2, 3], start: 24 },
  { id: 'hang', name: 'Dead hang', group: 'grip', kind: 'time', range: [20, 60] },
  { id: 'neck', name: 'Neck curls', group: 'neck', kind: 'reps', range: [12, 20] },
  { id: 'reverse-fly', name: 'Reverse dumbbell fly', group: 'shoulders', kind: 'weight', step: 1, range: [12, 15], start: 5 },
  { id: 'db-fly', name: 'Dumbbell fly', group: 'chest', kind: 'weight', step: 2, range: [10, 15], start: 8 },
  { id: 'close-push', name: 'Close-grip push-ups', group: 'arms', kind: 'reps', range: [8, 20] },
  { id: 'leg-curl', name: 'Leg curl (machine)', group: 'legs', kind: 'weight', step: 5, range: [10, 15], start: 25 },
  { id: 'nordic', name: 'Nordic curl (slow lowering)', group: 'legs', kind: 'reps', range: [3, 8] },
  { id: 'hip-thrust', name: 'Hip thrust', group: 'legs', kind: 'weight', step: 5, range: [8, 12], start: 40 },
  { id: 'copenhagen', name: 'Copenhagen plank', group: 'legs', kind: 'time', range: [15, 40] },
  { id: 'side-plank', name: 'Side plank (each side)', group: 'core', kind: 'time', range: [20, 45] },
  { id: 'back-ext', name: 'Back extension', group: 'core', kind: 'reps', range: [10, 20] },
  { id: 'wrist-curl', name: 'Wrist curls', group: 'grip', kind: 'weight', step: 1, range: [15, 20], start: 8 },
];

export const GROUPS = { back: 'Back', chest: 'Chest', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', core: 'Core', grip: 'Grip', neck: 'Neck' };

/* Default T3 work per workout: what the main lifts leave out (checked with the muscle
   balance model). A has no deadlift, so it gets the hamstring hinge; B gets side delts,
   extra chest/triceps and calves. */
export const DEFAULT_T3 = { A: ['rdl', 'facepull', 'hlr'], B: ['lateral', 'dips', 'calf'] };

/* Short fillers for rest periods: easy, non-fatiguing, matched to the lift you rest from. */
export const REST_TIPS = {
  sq: ['Dead hang 20 s', 'Plank 30 s', 'Calf raises × 15'],
  bp: ['Band pull-aparts × 15', 'Face pulls × 15', 'Dead hang 20 s'],
  dl: ['Plank 30 s', 'Pallof press × 10 each side', 'Neck curls × 15'],
  op: ['Band pull-aparts × 15', 'Neck curls × 15', 'Hanging knee raises × 8'],
  pu: ['Push-ups × 10', 'Lateral raises × 12', 'Calf raises × 15'],
};

export const CARDIO_TYPES = [
  { id: 'run', name: 'Run', pace: 'min/km' },
  { id: 'walk', name: 'Walk / hike', pace: 'min/km' },
  { id: 'bike', name: 'Bike', pace: 'km/h' },
  { id: 'row', name: 'Row', pace: 'min/500 m' },
  { id: 'swim', name: 'Swim', pace: 'min/100 m' },
  { id: 'other', name: 'Other', pace: null },
];

export const MEASURES = [
  { id: 'weight', name: 'Bodyweight', unit: 'kg', often: true },
  { id: 'waist', name: 'Waist', unit: 'cm', often: true },
  { id: 'chest', name: 'Chest', unit: 'cm' },
  { id: 'arm', name: 'Upper arm', unit: 'cm' },
  { id: 'thigh', name: 'Thigh', unit: 'cm' },
  { id: 'neck', name: 'Neck', unit: 'cm' },
  { id: 'hips', name: 'Hips', unit: 'cm' },
  { id: 'bodyfat', name: 'Body fat', unit: '%' },
  { id: 'rhr', name: 'Resting pulse', unit: 'bpm', often: true },
];

export function accessory(id, custom = []) {
  return custom.find((c) => c.id === id) || ACCESSORIES.find((a) => a.id === id) || null;
}
