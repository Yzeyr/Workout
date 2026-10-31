# Workout — project notes

A personal strength-training PWA for the owner's iPhone home screen. Live at
https://yzeyr.github.io/Workout/ (GitHub Pages from `main`). The UI is in English
(the owner's choice); the owner talks to Claude in Norwegian.

Rebuilt from scratch on 2026-10-31. The old single-file app (Block 01) lives
untouched in `v1/` with its own service worker and its data under the
`workout-v1` key. Its notes are in `v1/CLAUDE.md`.

## Layout
- `index.html`, `app.css`, `manifest.webmanifest`, `sw.js`, `icons/`
- `src/main.js` start-up, tabs, routing (`#train`, `#history`, `#body`, `#coach`, `#settings`)
- `src/program.js` **the brain**: A/B rotation, progression, failure ladder, waves, break rules, deloads, pull-ups, accessories. Pure functions, tested.
- `src/data/exercises.js` main lifts, workouts, accessories, rest tips, cardio types, measurements
- `src/state.js` the saved state (`workout:state`), `src/store.js` localStorage with visible errors
- `src/health.js` streaming reader for the Apple Health export (`export.zip`/`export.xml`) → daily summaries
- `src/muscles.js` + `src/data/muscles.js` **muscle balance**: every exercise mapped to muscles (1 / ½), weekly sets vs target, skipped program exercises, muscles left out N workouts in a row, push:pull and ham:quad ratios, fatigue/recovery per muscle, best-fix exercise. Screen: `#muscles` (body map)
- `src/coach.js` Claude coach: tools that read the app's data, `propose_change` cards the owner applies
- `src/views/*.js` the screens; `src/dom.js` UI building blocks; `src/timer.js` rest timer
- `docs/research.md` the training research behind the rules (with sources)

## Release routine
1. `node --test`
2. `node tools/version.mjs` (writes FILES and VERSION in `sw.js`; `--check` to verify)
3. commit, push to `main`

Icons: `node tools/icons.mjs`. Local preview: serve the repo under `/Workout/`.

## Rules that must hold
- The origin `yzeyr.github.io` is shared with Malerguiden, Handleliste, Bitetid and `v1/`.
  Never `localStorage.clear()`; only `workout:` keys; the service worker only deletes caches starting with `workout-`.
- The API key (`workout:api-key`) stays on the device and is never in backups.
- The coach conversation is append-only: never edit earlier messages (thinking blocks are bound to the exact history).
- Health data: only daily summaries are stored; data is sent to Anthropic only when the owner asks the coach.
- A missed day is never a failure. Skipped exercises (no sets done) change nothing.

## Decisions
- **New program, not the old one.** The owner chose "start fresh" with both a ready-made main program and their own exercises, training "when I can". A/B full-body rotation, tiers T1/T2/T3, 4-level rating of the last set, failure ladder 3×5 → 5×3 → 6×2 → −10 %, waves after two resets in 8 weeks, break table by days since that lift. See `docs/research.md` for what is research and what is convention.
- **Press and bench > 60 kg add reps before weight** (3×5 → 3×6 → 3×7 → +2.5 kg) when the smallest jump is 2.5 kg.
- **No planned deloads.** Offered only when hard/failed lifts, resets or "beat up" call for it.
- **Goal pace is a curve** (fast early, slow late), not a straight line. Bench 130 is the biggest stretch.
- **Coach changes are proposals.** The model can only suggest weight/goal/accessory/deload changes; the owner taps Apply.
- **Muscle balance (asked for "over-engineered").** Projection = average sets per workout over the last 6 × actual workouts/week (min 2), so a busy week doesn't flag everything; before 3 workouts the planned A/B stand in. Warnings on Train only for severity ≥ 2; everything on `#muscles`. Fixes are one-off extras for the next workout (`prog.extra`, used up when a workout is saved) or permanent accessories. Optional muscles (obliques, adductors) only warn when in focus; forearms and neck never. Default accessories were chosen so the default program has no serious warnings at 2–3 workouts a week (tested).
- **Service worker:** network-first for the page with a 2 s limit, cache for the rest, installs a version completely or not at all. A new version never reloads the page during a workout.

## Not verified yet
- On the owner's iPhone (sound unlock, wake lock, file picker for export.zip, a real Health export size).
- A real coach conversation (needs the owner's API key).
