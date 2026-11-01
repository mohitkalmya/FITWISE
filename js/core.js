/* FITWISE core — pure logic (no DOM). Loaded by the app and by Node unit tests.
 * Everything here is deterministic and takes "today" as an argument where time matters. */
(function (root) {
  'use strict';
  const Core = { VERSION: '1.3.2' };
  const pad = n => String(n).padStart(2, '0');
  const num = v => (typeof v === 'number' && Number.isFinite(v));
  const round1 = n => Math.round(n * 10) / 10;

  /* ---------- dates (all dates are local calendar days, 'YYYY-MM-DD') ---------- */
  Core.dateKey = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  Core.daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  Core.addDays = (k, n) => {
    const t = new Date(parse(k) + n * 864e5);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  Core.validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Core.addDays(v, 0) === v;

  /* ---------- defaults & normalisation ---------- */
  Core.GOALS = ['maintain', 'lose', 'gain', 'recomp'];
  Core.MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];
  Core.defaultProfile = () => ({
    name: '', goal: 'recomp',
    calories: 2200, protein: 160, carbs: 245, fat: 64,
    age: 20, heightCm: 175, currentWeight: 95,
    activity: 'light', experience: 'beginner', equipment: 'both', diet: 'nonvegetarian',
    sessionsPerWeek: 3, onboardingComplete: false
  });
  Core.emptyData = () => ({
    version: 1, profile: Core.defaultProfile(),
    foods: [], customFoods: [], workouts: [], cardio: [], weights: [], savedMeals: [],
    waterMl: {}, targetHistory: [],
    meta: { appVersion: Core.VERSION, lastBackupAt: null },
    createdAt: new Date().toISOString()
  });

  /* Merge stored/imported data over defaults. NEVER drops unknown profile keys. */
  Core.normalize = function (raw) {
    const base = Core.emptyData();
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const d = Object.assign({}, base, r);
    d.profile = Object.assign({}, base.profile, (r.profile && typeof r.profile === 'object') ? r.profile : {});
    ['foods', 'customFoods', 'workouts', 'cardio', 'weights', 'targetHistory', 'savedMeals'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
    if (!r.waterMl || typeof r.waterMl !== 'object' || Array.isArray(r.waterMl)) {
      const legacy = (r.water && typeof r.water === 'object') ? r.water : {};
      // v0.1 stored glasses; approximate 250 ml per glass.
      d.waterMl = Object.fromEntries(Object.entries(legacy).map(([day, n]) => [day, Math.max(0, Number(n) || 0) * 250]));
    }
    delete d.water;
    d.meta = Object.assign({}, base.meta, (r.meta && typeof r.meta === 'object') ? r.meta : {});
    d.version = 1;
    return d;
  };

  /* ---------- record validators ---------- */
  const inRange = (o, k, lo, hi) => num(o[k]) && o[k] >= lo && o[k] <= hi;
  Core.validFood = x => !!x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim().length > 0 && x.name.length <= 120 &&
    Core.validDate(x.date) && inRange(x, 'qty', 0.01, 1000) && inRange(x, 'serving', 1, 5000) &&
    inRange(x, 'kcal', 0, 5000) && inRange(x, 'p', 0, 500) && inRange(x, 'c', 0, 500) && inRange(x, 'f', 0, 500) &&
    (x.meal === undefined || Core.MEALS.includes(x.meal));
  Core.validCustomFood = x => !!x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim().length > 0 && x.name.length <= 80 &&
    inRange(x, 'serving', 1, 5000) && inRange(x, 'kcal', 0, 5000) && inRange(x, 'p', 0, 500) && inRange(x, 'c', 0, 500) && inRange(x, 'f', 0, 500);
  Core.validMeal = x => !!x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim().length > 0 && x.name.length <= 60 &&
    Array.isArray(x.items) && x.items.length >= 1 && x.items.length <= 30 &&
    x.items.every(i => !!i && typeof i === 'object' && Core.validFood(Object.assign({}, i, { date: '2000-01-01', meal: undefined })));
  Core.validWorkout = x => {
    if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 120 || !Core.validDate(x.date)) return false;
    if (!(inRange(x, 'sets', 1, 100) && inRange(x, 'reps', 0, 1000) && inRange(x, 'weight', 0, 2000) && inRange(x, 'rpe', 0, 10))) return false;
    if (x.setLog !== undefined) {
      if (!Array.isArray(x.setLog) || x.setLog.length > 100) return false;
      if (!x.setLog.every(s => s && inRange(s, 'reps', 0, 1000) && inRange(s, 'weight', 0, 2000))) return false;
    }
    return true;
  };
  Core.validWeight = x => !!x && typeof x === 'object' && Core.validDate(x.date) && inRange(x, 'weight', 20, 400) &&
    (x.waist === null || x.waist === undefined || inRange(x, 'waist', 30, 250));
  Core.validCardio = x => !!x && typeof x === 'object' && Core.validDate(x.date) && inRange(x, 'minutes', 1, 1000) &&
    typeof x.kind === 'string' && x.kind.length <= 40 && inRange(x, 'rpe', 0, 10);

  Core.validateBackup = function (b) {
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.version !== 1 || !b.profile || typeof b.profile !== 'object') return false;
    if (!Core.GOALS.includes(b.profile.goal)) return false;
    const ranges = { calories: [800, 7000], protein: [0, 500], carbs: [0, 1000], fat: [0, 500] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) { if (!inRange(b.profile, k, lo, hi)) return false; }
    const lists = { foods: 20000, customFoods: 5000, workouts: 20000, weights: 8000 };
    for (const [k, max] of Object.entries(lists)) { if (!Array.isArray(b[k]) || b[k].length > max) return false; }
    if (b.cardio !== undefined && (!Array.isArray(b.cardio) || b.cardio.length > 8000)) return false;
    if (!b.foods.every(Core.validFood) || !b.customFoods.every(Core.validCustomFood) ||
        !b.workouts.every(Core.validWorkout) || !b.weights.every(Core.validWeight)) return false;
    if (b.cardio && !b.cardio.every(Core.validCardio)) return false;
    if (b.savedMeals !== undefined && (!Array.isArray(b.savedMeals) || b.savedMeals.length > 500 || !b.savedMeals.every(Core.validMeal))) return false;
    if (b.waterMl !== undefined && (!b.waterMl || typeof b.waterMl !== 'object' || Array.isArray(b.waterMl) ||
        Object.entries(b.waterMl).some(([d, n]) => !Core.validDate(d) || !num(n) || n < 0 || n > 20000))) return false;
    return true;
  };

  /* Drop individually-corrupt records from locally stored data so one bad row can't break rendering. */
  Core.sanitize = function (d) {
    d.foods = d.foods.filter(Core.validFood);
    d.customFoods = d.customFoods.filter(Core.validCustomFood);
    d.workouts = d.workouts.filter(Core.validWorkout);
    d.weights = d.weights.filter(Core.validWeight);
    d.cardio = d.cardio.filter(Core.validCardio);
    d.savedMeals = d.savedMeals.filter(Core.validMeal);
    const p = d.profile;
    if (!Core.GOALS.includes(p.goal)) p.goal = 'recomp';
    for (const [k, lo, hi, def] of [['calories', 800, 7000, 2200], ['protein', 0, 500, 160], ['carbs', 0, 1000, 245], ['fat', 0, 500, 64]]) {
      if (!num(p[k]) || p[k] < lo || p[k] > hi) p[k] = def;
    }
    return d;
  };

  /* ---------- nutrition ---------- */
  Core.atwater = (p, c, f) => 4 * p + 4 * c + 9 * f;
  Core.totals = entries => entries.reduce((a, x) => {
    a.kcal += x.kcal * x.qty; a.p += x.p * x.qty; a.c += x.c * x.qty; a.f += x.f * x.qty; return a;
  }, { kcal: 0, p: 0, c: 0, f: 0 });
  Core.grams = x => x.serving * x.qty;

  /* Compare calories with macro-implied energy. Returns { estimate, diffPct, level:'ok'|'warn'|'block' }. */
  Core.macroCheck = function (calories, protein, carbs, fat) {
    const estimate = Core.atwater(protein, carbs, fat);
    const diffPct = calories > 0 ? Math.abs(estimate - calories) / calories * 100 : 100;
    return { estimate: Math.round(estimate), diffPct: round1(diffPct), level: diffPct > 15 ? 'block' : diffPct > 5 ? 'warn' : 'ok' };
  };

  /* Combine ingredients into per-serving values. ingredients: [{grams, p100, c100, f100}] (macros per 100 g). */
  Core.recipe = function (ingredients, servings, cookedYieldG) {
    let p = 0, c = 0, f = 0, g = 0;
    for (const i of ingredients) { const k = i.grams / 100; p += i.p100 * k; c += i.c100 * k; f += i.f100 * k; g += i.grams; }
    const s = Math.max(servings, 0.01);
    const servingG = (cookedYieldG && cookedYieldG > 0 ? cookedYieldG : g) / s;
    const per = { p: round1(p / s), c: round1(c / s), f: round1(f / s) };
    return { serving: Math.max(1, Math.round(servingG)), p: per.p, c: per.c, f: per.f, kcal: Math.round(Core.atwater(p / s, c / s, f / s)), totalGrams: g };
  };

  /* ---------- weight trend ---------- */
  /* Real weigh-ins only. A profile-seeded starting weight is used only when nothing else exists. */
  Core.weightPoints = function (weights) {
    const sorted = weights.slice().sort((a, b) => a.date.localeCompare(b.date));
    const real = sorted.filter(w => w.source !== 'profile');
    return { points: real.length ? real : sorted, seedOnly: real.length === 0 && sorted.length > 0 };
  };
  /* Time-aware exponential moving average (tau in days). */
  Core.trendSeries = function (points, tau) {
    tau = tau || 7;
    const out = []; let prev = null, prevDate = null;
    for (const p of points) {
      if (prev === null) prev = p.weight;
      else { const dt = Math.max(1, Core.daysBetween(prevDate, p.date)); const a = 1 - Math.exp(-dt / tau); prev = prev + a * (p.weight - prev); }
      prevDate = p.date; out.push({ date: p.date, weight: p.weight, trend: prev });
    }
    return out;
  };
  /* kg/week from a least-squares line through the RAW weigh-ins over the last windowDays (unbiased; the smoothed
   * trend lags real change). Needs >=4 weigh-ins spanning >=7 days, latest within 5 days of today. */
  Core.weeklyRate = function (series, today, windowDays) {
    windowDays = windowDays || 14;
    if (!series.length) return null;
    const end = series[series.length - 1].date;
    if (Core.daysBetween(end, today) > 5) return null;
    const start = Core.addDays(end, -windowDays);
    const w = series.filter(p => p.date >= start);
    if (w.length < 4 || Core.daysBetween(w[0].date, end) < 7) return null;
    const x = w.map(p => Core.daysBetween(w[0].date, p.date)), y = w.map(p => p.weight);
    const n = w.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    return sxx ? (sxy / sxx) * 7 : null;
  };
  /* What the UI needs about weight, in one place. */
  Core.weightSummary = function (weights, today) {
    const { points, seedOnly } = Core.weightPoints(weights);
    const series = Core.trendSeries(points);
    const last = series[series.length - 1] || null;
    const waists = weights.filter(w => w.waist !== null && w.waist !== undefined).sort((a, b) => a.date.localeCompare(b.date));
    return {
      series, seedOnly, count: seedOnly ? 0 : points.length,
      latest: last ? last.weight : null, trend: last ? last.trend : null,
      rate: seedOnly ? null : Core.weeklyRate(series, today),
      waist: waists.length ? waists[waists.length - 1] : null
    };
  };

  /* ---------- training ---------- */
  Core.parseRange = function (s) {
    s = String(s || '');
    const time = /sec|min/i.test(s);
    const m = s.match(/(\d+)(?:\s*[–-]\s*(\d+))?/);
    if (!m) return { time, lo: time ? 30 : 8, hi: time ? 30 : 12 };
    return { time, lo: +m[1], hi: +(m[2] || m[1]) };
  };
  Core.setsOf = x => (Array.isArray(x.setLog) && x.setLog.length) ? x.setLog : Array.from({ length: x.sets }, () => ({ reps: x.reps, weight: x.weight }));
  /* Timed holds (planks, carries) store seconds in `reps`; they don't count as reps or load volume. */
  Core.volume = x => x.timed ? 0 : Core.setsOf(x).reduce((s, t) => s + Math.max(0, t.reps) * Math.max(0, t.weight), 0);
  Core.totalReps = x => x.timed ? 0 : Core.setsOf(x).reduce((s, t) => s + Math.max(0, t.reps), 0);
  Core.epley1RM = (w, r) => (w > 0 && r >= 1 && r <= 12) ? w * (1 + r / 30) : 0;

  /* Conservative double progression. Never auto-applies; returns a suggestion only. */
  Core.suggestNext = function (history, rangeStr) {
    const range = Core.parseRange(rangeStr);
    if (!history.length) return { load: 0, reps: range.lo, text: 'First time — start light and leave 2–3 reps in reserve.', first: true };
    const last = history[history.length - 1];
    const sets = Core.setsOf(last), load = Math.max(...sets.map(s => s.weight)), minReps = Math.min(...sets.map(s => s.reps));
    const rpe = last.rpe || 7;
    if (range.time) return { load, reps: 0, text: 'Hold the same duration; add a few seconds only if form stays solid.' };
    if (rpe >= 9) return { load, reps: Math.max(range.lo, minReps), text: 'Last time was very hard — repeat ' + load + ' kg and aim for RPE 8 or lower.' };
    if (minReps >= range.hi && rpe <= 8) {
      if (load > 0) return { load: round1(load + 2.5), reps: range.lo, text: 'You hit ' + range.hi + ' reps on every set — try ' + round1(load + 2.5) + ' kg for ' + range.lo + '+ reps (or the smallest step available).' };
      return { load: 0, reps: range.hi, text: 'You hit ' + range.hi + ' reps on every set — add a tempo/pause or move to a harder variation.' };
    }
    const target = Math.min(range.hi, minReps + 1);
    return { load, reps: target, text: 'Same load (' + load + ' kg); aim for ' + target + ' reps on each set.' };
  };

  Core.sessionTitles = plan => plan.days.filter(d => !d.guide).map(d => d.title);
  /* Next session in rotation, based on the most recently logged session title (workouts are in logged order). */
  Core.nextSession = function (titles, workouts) {
    for (let i = workouts.length - 1; i >= 0; i--) {
      const idx = titles.indexOf(workouts[i].session);
      if (idx >= 0) return titles[(idx + 1) % titles.length];
    }
    return titles[0];
  };
  /* Suggested training weekdays (0=Sun..6=Sat) by sessions per week. A suggestion, not a rule. */
  Core.plannedDays = n => ({ 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] }[n] || [1, 3, 5]);

  /* ---------- weekly review & target suggestion ---------- */
  Core.weeklyReview = function (d, today) {
    const from = Core.addDays(today, -6);
    const inWeek = x => x.date >= from && x.date <= today;
    const foods = d.foods.filter(inWeek);
    const days = {};
    foods.forEach(x => { (days[x.date] = days[x.date] || { kcal: 0, p: 0 }); days[x.date].kcal += x.kcal * x.qty; days[x.date].p += x.p * x.qty; });
    const dayKeys = Object.keys(days);
    const loggedDays = dayKeys.length;
    const avgKcal = loggedDays ? dayKeys.reduce((s, k) => s + days[k].kcal, 0) / loggedDays : null;
    const avgProtein = loggedDays ? dayKeys.reduce((s, k) => s + days[k].p, 0) / loggedDays : null;
    const proteinDays = dayKeys.filter(k => days[k].p >= 0.9 * d.profile.protein).length;
    const sessions = new Set(d.workouts.filter(inWeek).map(x => x.date)).size;
    const cardioMin = d.cardio.filter(inWeek).reduce((s, x) => s + x.minutes, 0);
    const ws = Core.weightSummary(d.weights, today);
    const waists = d.weights.filter(w => w.waist != null && w.source !== 'profile').sort((a, b) => a.date.localeCompare(b.date));
    let waistChange = null;
    if (waists.length >= 2) {
      const latest = waists[waists.length - 1];
      const prior = waists.filter(w => Core.daysBetween(w.date, latest.date) >= 7).pop();
      if (prior) waistChange = round1(latest.waist - prior.waist);
    }
    return { loggedDays, avgKcal, avgProtein, proteinDays, sessions, planned: d.profile.sessionsPerWeek, cardioMin, rate: ws.rate, weighIns: ws.count, waistChange };
  };

  Core.TARGET_FLOOR = 1500;
  /* Experimental, explainable, capped (±150 kcal), and gated on data quality. Suggests only; the user applies. */
  /* Estimated energy use (TDEE) from the person's own logs: average intake minus the energy implied by weight change.
   * Needs >=12 "complete" food days (>=800 kcal logged) and >=6 weigh-ins over >=14 days inside the last 21 days (today excluded
   * from intake because it is incomplete). 7,700 kcal per kg is a rule of thumb. Reported as an estimate with a confidence level. */
  Core.expenditure = function (d, today) {
    const from = Core.addDays(today, -21), yest = Core.addDays(today, -1);
    const perDay = {};
    d.foods.forEach(x => { if (x.date >= from && x.date <= yest) perDay[x.date] = (perDay[x.date] || 0) + x.kcal * x.qty; });
    const complete = Object.keys(perDay).filter(k => perDay[k] >= 800);
    const wp = Core.weightPoints(d.weights), pts = wp.seedOnly ? [] : wp.points.filter(w => w.date >= from && w.date <= today);
    const span = pts.length > 1 ? Core.daysBetween(pts[0].date, pts[pts.length - 1].date) : 0;
    const out = { eligible: false, completeDays: complete.length, needDays: 12, weighIns: pts.length, needWeighIns: 6, span, kcal: null, intake: null, rate: null, confidence: null, reason: '', formula: null };
    const p = d.profile;
    if (p && p.age && p.heightCm && p.currentWeight) {
      const bmr = 10 * p.currentWeight + 6.25 * p.heightCm - 5 * p.age + 5, f = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[p.activity] || 1.375;
      out.formula = Math.round(bmr * f / 10) * 10;   // population formula, shown only for comparison (male constant; owner profile)
    }
    if (complete.length < out.needDays || pts.length < out.needWeighIns || span < 14) {
      out.reason = 'Not enough data yet. This estimate needs ' + out.needDays + ' well-logged days and ' + out.needWeighIns + ' weigh-ins over 14+ days within the last 3 weeks (you have ' + complete.length + ' days and ' + pts.length + ' weigh-ins' + (span ? ' over ' + span + ' days' : '') + ').';
      return out;
    }
    const xs = pts.map(w => Core.daysBetween(pts[0].date, w.date)), ys = pts.map(w => w.weight), n = pts.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); }
    const slope = sxx ? sxy / sxx : 0;    // kg per day
    let sse = 0; for (let i = 0; i < n; i++) { const e = ys[i] - (my + slope * (xs[i] - mx)); sse += e * e; }
    const se = n > 2 && sxx ? Math.sqrt(sse / (n - 2) / sxx) : 1;   // kg/day
    const intake = complete.reduce((a, k) => a + perDay[k], 0) / complete.length;
    const tdee = intake - slope * 7700;
    if (!(tdee >= 1200 && tdee <= 5500)) { out.reason = 'The numbers do not combine into a believable estimate (usually incomplete logging or a water-weight swing). Keep logging for another week.'; return out; }
    out.eligible = true; out.intake = Math.round(intake); out.rate = Math.round(slope * 7 * 100) / 100; out.kcal = Math.round(tdee / 10) * 10;
    out.uncertainty = Math.round(se * 7700 / 10) * 10;
    out.confidence = se * 7 < 0.2 && complete.length >= 16 ? 'good' : 'low';
    out.reason = 'Average intake on logged days was ' + out.intake + ' kcal and your weight trend moved ' + (out.rate > 0 ? '+' : '') + out.rate + ' kg/week, which implies you use roughly ' + out.kcal + ' kcal/day. ' +
      (out.confidence === 'good' ? 'Your data is consistent enough for a reasonable estimate.' : 'Treat this as rough: weigh-ins are noisy or fewer than 16 days were logged.');
    return out;
  };
  Core.targetSuggestion = function (d, today) {
    const from = Core.addDays(today, -13);
    const foodDays = new Set(d.foods.filter(x => x.date >= from && x.date <= today).map(x => x.date)).size;
    const ws = Core.weightSummary(d.weights, today);
    const recentW = ws.series.filter(p => p.date >= from);
    const span = recentW.length > 1 ? Core.daysBetween(recentW[0].date, recentW[recentW.length - 1].date) : 0;
    const out = { eligible: false, foodDays, weighIns: recentW.length, rate: ws.rate, delta: 0, calories: d.profile.calories, reason: '' };
    const lastChange = (d.targetHistory || []).slice(-1)[0];
    if (lastChange && Core.validDate(lastChange.date) && Core.daysBetween(lastChange.date, today) < 14) {
      out.reason = 'You changed your target ' + Core.daysBetween(lastChange.date, today) + ' day(s) ago. Give it at least 14 days of data before checking again.';
      return out;
    }
    if (ws.seedOnly || foodDays < 10 || recentW.length < 6 || span < 10) {
      out.reason = 'Not enough data yet. This check needs food logged on at least 10 of the last 14 days and 6 weigh-ins spread over 10+ days (you have ' +
        foodDays + ' food days and ' + recentW.length + ' weigh-ins).';
      return out;
    }
    if (ws.rate === null) { out.reason = 'Your latest weigh-in is too old to judge a trend. Log a recent weight.'; return out; }
    out.eligible = true;
    const goal = d.profile.goal, r = ws.rate;
    let delta = 0, why = '';
    if (goal === 'lose' || goal === 'recomp') {
      if (r > -0.1) { delta = -150; why = 'Weight is flat or rising (' + round1(r) + ' kg/week) while your goal is fat loss.'; }
      else if (r < -0.9) { delta = 150; why = 'Weight is dropping faster (' + round1(r) + ' kg/week) than the 0.25–0.75 kg/week review band — a slower rate usually protects training and recovery.'; }
      else why = 'Rate (' + round1(r) + ' kg/week) is within or close to the review band. No change suggested.';
    } else if (goal === 'gain') {
      if (r < 0.05) { delta = 150; why = 'Weight is not rising (' + round1(r) + ' kg/week) while your goal is gaining.'; }
      else if (r > 0.6) { delta = -100; why = 'Weight is rising quickly (' + round1(r) + ' kg/week); a slower gain adds less fat.'; }
      else why = 'Rate (' + round1(r) + ' kg/week) suits a gaining goal. No change suggested.';
    } else {
      if (Math.abs(r) > 0.3) { delta = r > 0 ? -100 : 100; why = 'Weight is moving ' + round1(r) + ' kg/week while your goal is maintenance.'; }
      else why = 'Weight is stable (' + round1(r) + ' kg/week). No change suggested.';
    }
    if (delta && d.profile.calories + delta < Core.TARGET_FLOOR) { delta = 0; why += ' (Not suggested: would fall below ' + Core.TARGET_FLOOR + ' kcal.)'; }
    out.delta = delta; out.calories = d.profile.calories + delta; out.reason = why;
    return out;
  };
  /* Apply a calorie change by shifting carbohydrate (keeps protein/fat stable). */
  Core.applyDelta = function (profile, delta) {
    const carbs = Math.max(0, Math.round(profile.carbs + delta / 4));
    return Object.assign({}, profile, { calories: profile.calories + delta, carbs });
  };

  /* ---------- CSV ---------- */
  Core.csvCell = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  Core.toCSV = (columns, rows) => [columns.join(',')].concat(rows.map(r => columns.map(c => Core.csvCell(r[c])).join(','))).join('\r\n') + '\r\n';

  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.FitwiseCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);
