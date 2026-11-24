# FORMDAY v0.7.0

Release date: 2026-11-24 (Asia/Seoul)

## Purpose

Consolidate routines and workout records under the workout menu, repair silent workout entry failures, and add the requested exercise picker and weight/calorie trends to the existing FORMDAY site.

## User-visible changes

- Mobile navigation is Home / Workout / Calendar / Graphs / Exercise Library. Workout contains Workout / Routines / Programs / Records.
- Workout entry buttons and nested icon clicks consistently route to the workout hub or current session. Missing runtime, unreadable storage, and failed exercise-start saves show a recoverable error without overwriting the original records.
- Routine add/replace, free-workout start, and in-session add use one native-dialog exercise picker. It supports name/Korean-initial search, muscle/equipment filters, multiple selection, and independent favorite toggles. Cancel preserves the underlying draft; failed save keeps the selection open.
- Mobile uses a bottom sheet with safe-area and visualViewport keyboard handling. Desktop uses a centered dialog. Focus restoration and reduced-motion preferences are supported.
- The picker and exercise library use local exercise-specific SVG artwork. 64 catalog names map to 63 unchanged images. Bicep curl and dumbbell curl share their matching image. Clean and snatch intentionally show an unavailable-image label because this source has no exact matching illustration; both remain selectable.
- Weight and calorie graphs provide 7/30/90-day and all-history ranges, current target lines, record selection, keyboard controls, and a paginated original daily-value table.
- Optional target weight is set alongside existing macro goals. Blank clears it. Valid range matches the existing measurement maximum (0.1–500 kg).

## Data and calculation behavior

- Existing calendar and IRON storage keys and versions are retained. No Firebase rules, authentication settings, deployment settings, or production records are changed by this release process.
- `favoriteExercises` is an optional IRON field, defaulting to `[]`. Existing routines, programs, custom exercise names, and sessions retain their format. Backups and sync normalization preserve favorites. Favorite-only data is treated as user data during first pairing.
- `settings.targetWeight` is optional and defaults to `null`; old calendar backups still import.
- Graphs read completed, real, nonfuture calendar records. They do not write to either store. A day with multiple weight measurements uses the latest time and a deterministic ID tie-break.
- Calorie totals use the existing nutrition calculator. Unknown calories remain unknown; partial totals are labeled. Missing days are not zero-filled, and averages divide by days with known calorie values.
- Long ranges include every date in consecutive bins, with at most 120 plotted bins. Bin size and recorded-day averages are explicitly labeled; original daily values remain available in the table.
- Current goals are displayed across the selected range and are labeled as current goals, not historical goal changes.

## Artwork provenance

Source: [Workout Guide by Bryl Lim](https://github.com/bryllim/workout-guide), pinned commit `aac599224bb9780305239607ef98540b7e0ce389`.

Artwork: CC BY-SA 4.0; some works derive from [Everkinetic by Greg Priday](https://github.com/everkinetic/data). Assets are copied unchanged. See `fitplan/exercise-credits.html`, `fitplan/assets/exercises/attribution.json`, and `LICENSE-ASSETS` for per-file sources, upstream changes, authors, and license text. The SVGs contain no scripts, foreign objects, embedded images, or external resource references.

## Verification before deployment

- Node.js v24.22.3: `node --test fitplan-dev/*.test.cjs` — **181 passed, 0 failed**.
- Syntax checks passed for every top-level `fitplan/*.js` file.
- `git diff --check` passed.
- All 64 mapped exercise names resolve to existing local SVGs. Contact-sheet inspection was used to check movements, image/background contrast, and equipment labels.
- Focused behavior tests cover top-level and hero routing, corrupted and denied storage, save failures, atomic multiselect saves, draft preservation, favorites, backup compatibility, unknown/zero calories, repeat snapshots, date boundaries, long-range aggregation, and accessible graph interaction.

## Deployment and live acceptance

Target remains the existing Render static site `formday-fitplan-ccucle`, repository `ccucle/frame7-nav`, branch `fitplan-site-20261123`, publish path `fitplan`. Auto-deploy is disabled, so deployment is triggered once after the reviewed PR merge.

After deployment, verify the served version and source bytes; then exercise the menu, routine builder, picker search/selection/cancel, favorite persistence, graph ranges, target dialog, and library in the public browser. The pre-deployment tests use fixtures and mock DOM, not a real iPhone. Actual iPhone Safari/ChatGPT in-app browsing, the user's Google sign-in session, and cross-device Firebase synchronization need their own device-level confirmation; they must not be reported as tested by the automated suite.
