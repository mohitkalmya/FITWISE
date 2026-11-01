# FITWISE v1.3.2

A free, private, offline nutrition and training tracker for the phone and the desktop browser. It is a Progressive Web App (PWA): no account, no ads, no analytics, no network calls for your data. Everything is stored in your own browser.

## Run it

```bash
cd fitwise
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

Opening `index.html` directly also works for basic use, but install and offline mode need `localhost` or HTTPS.

### Put it on your phone (free)

1. Host the folder on any free HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages — drag the folder in).
2. Open the URL in Chrome on Android, wait a few seconds, then **⋮ → Install app**.
3. Run through `ANDROID_RELEASE_CHECKLIST.md` once on the device.

Updates: the service worker is network-first, so when you redeploy, the next online visit gets the new version (you'll see a "FITWISE was updated — Reload" toast). Bump `VERSION` in `sw.js` and `Core.VERSION` in `js/core.js` on each release.

## What it does

| Area | Features |
|---|---|
| **Nutrition** | 63-food starter catalogue of common Indian foods (each marked as USDA-checked or an estimate; Hindi names and synonyms searchable), grams *or* servings entry in a dialog, meals (breakfast/lunch/snack/dinner), live macro preview, edit/delete with Undo, “your usual” quick-add, copy previous day, log past days, custom foods from labels (duplicate names refused), **saved meals** (one-tap re-log, undoable), a day strip on Home to view or log any of the last 7 days, a quick-log bar, **recipe builder** (ingredients + cooked weight + servings → per-serving nutrition), water. |
| **Training** | Beginner A/B, intermediate upper/lower and advanced plans with home and gym alternatives; guided sessions with per-set reps/load, rest timer, suggested load/reps from your last session (conservative double progression), session rotation, drafts that survive reloads, quick log for off-plan exercises, cardio log, history, personal bests (est. 1RM). |
| **Progress** | Raw weigh-ins + smoothed trend line, weekly rate (needs ≥4 weigh-ins over ≥7 days), waist, **Estimated energy use** (your logged intake vs weight trend; needs 12 well-logged days and 6 weigh-ins over 14+ days; shown as an estimate with uncertainty; never changes targets), 7/14/30/90-day chart ranges, weekly review (food-log days, protein adherence, training days, trend), training volume and exercise trends, **Target check** (experimental, ±150 kcal cap, needs ≥10 food days and ≥6 weigh-ins in 14 days, you apply it, one-tap revert, 14-day cool-down). |
| **Data** | Light/dark/auto appearance, storage meter, JSON backup/restore (optionally passphrase-encrypted) with strict validation and automatic safety copy, CSV export (food, weight, workouts), corrupt-storage recovery, backup reminder, persistent-storage request. |
| **Starter plan** | New installs start with the personal plan from `docs/PERSONAL_FITWISE_SPEC.md`: 2,200 kcal · 160 g protein · 245 g carbs · 64 g fat, goal recomposition. Existing saved data is never overwritten. |

## What it deliberately does not do

- No validated energy-expenditure model: the energy estimate and the Target check are labelled heuristics that only inform or suggest.
- Food values are approximate (calories are derived from macros; fibre is ignored). Weigh and read labels when precision matters. No dietitian review.
- No barcode/photo/voice logging, accounts, cloud sync, wearables, reminders or progress photos.
- Data stored in the browser is not encrypted: anyone with access to your browser profile can read it. Backups *can* be encrypted (Settings → Encrypted backup: AES-256-GCM, PBKDF2 310,000 iterations, built-in WebCrypto, nothing leaves the device). A forgotten passphrase cannot be recovered. The app ships a strict Content-Security-Policy and makes no network requests other than loading its own files.
- Not a medical device. Check with a clinician before changing diet or training if you have a medical condition.

## Layout

```
index.html          markup (5 tabs + 2 dialogs)
css/app.css         styles
js/core.js          pure logic: validation, trend/rate, targets, progression, CSV (unit-tested in Node)
js/foods.js         food catalogue + search
js/vault.js         passphrase-encrypted backups (WebCrypto)
js/theme.js         applies the saved theme before first paint
js/app.js           UI wiring
sw.js               network-first service worker (offline fallback)
manifest.webmanifest, icons/
tests/core.test.js  30 unit tests          -> node --test tests/core.test.js
tests/e2e.py        112 real-browser checks -> python3 tests/e2e.py   (pip install playwright; playwright install chromium)
tests/e2e_stress.py 104 stress/robustness checks -> python3 tests/e2e_stress.py
docs/               spec and phase history
```

Data schema is unchanged since v0.1 (`localStorage` key `fitwise-v01-data`, `version: 1`), so old backups still import. v1.x adds optional fields (`meal`, `setLog`, `cardio`, `targetHistory`, `meta`).

## Tests

`npm test` (or run the two commands above). The end-to-end suite starts its own server and uses a real origin with real `localStorage` — no mocks. It covers the profile regression, food/recipe/workout flows, weight trend, target check, backup round-trip, legacy-data migration, corruption recovery, offline use, update delivery, layout at 390 px and 1280 px, keyboard/skip-link, accessible names and colour-contrast ratios.

Not covered (needs a person and a phone): installing on real Android, screen-reader testing, other browsers (Safari/Firefox), storage-quota behaviour, long-term use.

See `CHANGELOG.md` for what changed from the Phase 9 prototype.
