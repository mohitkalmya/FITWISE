/* FITWISE app UI. All persistent logic lives in core.js; this file wires it to the DOM. */
(function () {
  'use strict';
  const C = window.FitwiseCore, F = window.FitwiseFoods, V = window.FitwiseVault;
  const $ = id => document.getElementById(id);
  const KEY = 'fitwise-v01-data';          // unchanged so existing data and backups keep working
  const DRAFT_KEY = 'fitwise-session-draft';
  const PREF_KEY = 'fitwise-prefs';
  const TABS = ['home', 'food', 'workout', 'progress', 'settings'];
  const MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner', other: 'Other' };
  const today = () => C.dateKey();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round1 = n => Math.round(n * 10) / 10;
  const fmt = n => Math.round(n).toLocaleString('en-IN');
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(v);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const localDay = iso => C.dateKey(new Date(iso));      // backups are stored as UTC ISO; show/compare in the user's local day
  const dayLabel = k => new Date(k + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  /* ================= state & storage ================= */
  let data, loadNote = null, draft = null;
  let prefs = { planLevel: null, planEquipment: null, restSecs: 90, theme: 'auto', calMode: 'left', chartDays: 30 };
  const ui = { today: today(), homeDate: null, diaryDate: today(), group: 'All', histDays: 10, resultLimit: 10, restEnd: 0, restTimer: null };

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function load() {
    const raw = safeGet(KEY);
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (e) { safeSet(KEY + '-corrupt', raw); loadNote = 'Your saved data could not be read. A copy was kept and FITWISE started fresh.'; }
    }
    data = C.sanitize(C.normalize(parsed));
    try { const p = JSON.parse(safeGet(PREF_KEY) || '{}'); if (p && typeof p === 'object') prefs = Object.assign(prefs, p); } catch (e) { /* ignore */ }
    $('themeSel').value = prefs.theme || 'auto'; applyTheme();
    try { const dr = JSON.parse(safeGet(DRAFT_KEY) || 'null'); if (dr && Array.isArray(dr.exercises) && dr.title) draft = dr; } catch (e) { draft = null; }
  }
  let askedPersist = false;
  function persist() {
    const ok = safeSet(KEY, JSON.stringify(data));
    if (!ok) { toast('Could not save — browser storage may be full or blocked. Export a backup now.'); return false; }
    if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().then(refreshStorageNote).catch(() => {}); }
    return true;
  }
  function applyTheme() {
    const t = prefs.theme === 'dark' || prefs.theme === 'light' ? prefs.theme : 'auto', root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#0f1713' : '#174f3b');
  }
  function savePrefs() { safeSet(PREF_KEY, JSON.stringify(prefs)); }
  function saveDraft() { if (draft) safeSet(DRAFT_KEY, JSON.stringify(draft)); else { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } } }

  /* ================= toast & undo ================= */
  function hideToast() { $('toast').classList.remove('show'); }
  function toast(msg, action) {
    const b = $('toastAction');
    $('toastMsg').textContent = msg;
    if (action) { b.textContent = action.label; b.classList.remove('hidden'); b.onclick = () => { hideToast(); action.fn(); }; }
    else { b.classList.add('hidden'); b.onclick = null; }
    $('toast').classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(hideToast, action ? 7000 : 2800);
  }
  function mutate(keys, message, fn) {
    const snap = JSON.stringify(keys.map(k => data[k]));
    fn(); persist(); renderAll();
    toast(message, { label: 'Undo', fn: () => { const v = JSON.parse(snap); keys.forEach((k, i) => { data[k] = v[i]; }); persist(); renderAll(); } });
  }

  /* ================= navigation ================= */
  function show(tab) {
    if (!TABS.includes(tab)) tab = 'home';
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === tab));
    document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('[data-go]').forEach(b => { b.classList.toggle('active', b.dataset.go === tab && b.closest('.mobilebar') !== null); if (b.closest('.mobilebar')) { if (b.dataset.go === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); } });
    window.scrollTo(0, 0);
    $('quickbar').classList.toggle('hidden', tab !== 'home'); document.body.classList.toggle('qb-on', tab === 'home');
    renderAll();
  }
  function go(tab) { if (location.hash === '#' + tab) show(tab); else location.hash = tab; }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); show(TABS.includes(t) ? t : 'home'); });   // empty hash = Home, so Back works
  $('skipLink').addEventListener('click', e => { e.preventDefault(); $('mainContent').focus(); });

  /* ================= food helpers ================= */
  const customToFood = cf => Object.assign({ unit: cf.recipe ? '1 serving' : '1 serving', emoji: '🍽️', hi: '', group: 'My foods', tags: '' }, cf);
  const allFoods = () => F.list.concat(data.customFoods.map(customToFood));
  const foodById = id => F.byId[id] || (data.customFoods.find(f => f.id === id) ? customToFood(data.customFoods.find(f => f.id === id)) : null);
  const per100 = f => ({ p: f.p100 != null ? f.p100 : f.p * 100 / f.serving, c: f.c100 != null ? f.c100 : f.c * 100 / f.serving, f: f.f100 != null ? f.f100 : f.f * 100 / f.serving });
  const shortName = f => f.name.split(/[,(]/)[0].trim();
  function suggestedMeal() { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner'; }
  function foodsOn(d) { return data.foods.filter(x => x.date === d); }
  function lastEntryFor(foodId) { for (let i = data.foods.length - 1; i >= 0; i--) if (data.foods[i].foodId === foodId) return data.foods[i]; return null; }
  function quickFoods() {
    const since = C.addDays(today(), -45), counts = {}, last = {};
    data.foods.forEach((x, i) => { if (x.foodId && x.date >= since) { counts[x.foodId] = (counts[x.foodId] || 0) + 1; last[x.foodId] = i; } });
    const ids = Object.keys(counts).filter(id => foodById(id)).sort((a, b) => counts[b] - counts[a] || last[b] - last[a]);
    ['egg', 'roti', 'rice', 'dal', 'chicken', 'curd', 'banana', 'paneer'].forEach(id => { if (!ids.includes(id)) ids.push(id); });
    return ids.slice(0, 8).map(foodById).filter(Boolean);
  }

  /* ---- add / edit dialog ---- */
  const fd = { food: null, entry: null, date: today() };
  function defaultMode(f) { return (/^\d+\s?g\b/.test(f.unit) || f.serving >= 100) ? 'g' : 's'; }
  function srcNote(f) { return f.src === 'usda' ? ' · ✓ checked against USDA data' : f.src === 'estimate' ? ' · approximate estimate' : ''; }
  function openFoodDialog(food, opts) {
    opts = opts || {};
    fd.food = food; fd.entry = opts.entry || null; fd.date = opts.date || today();
    $('fdTitle').textContent = (fd.entry ? 'Edit: ' : '') + food.emoji + ' ' + food.name;
    $('fdMeta').textContent = fd.entry
      ? dayLabel(fd.entry.date) + ' · ' + food.serving + ' g per serving'
      : (fd.date === today() ? 'Adding to today' : 'Adding to ' + dayLabel(fd.date)) + ' · 1 serving = ' + food.unit + ' (' + food.serving + ' g)' + srcNote(food);
    const unitSel = $('fdUnit');
    unitSel.innerHTML = '<option value="g">grams (g)</option><option value="s">servings (1 = ' + esc(food.unit) + ')</option>';
    const prev = fd.entry || lastEntryFor(food.id);
    const mode = defaultMode(food);
    unitSel.value = mode;
    const grams = prev ? C.grams(prev) : food.serving;
    $('fdAmount').value = mode === 'g' ? round1(grams) : round1(grams / food.serving);
    $('fdMeal').value = (fd.entry && fd.entry.meal) || suggestedMeal();
    $('fdSave').textContent = fd.entry ? 'Save changes' : 'Add to diary';
    $('fdError').classList.add('hidden');
    updateFoodPreview();
    openDialog($('foodDialog'));
    setTimeout(() => { $('fdAmount').focus(); $('fdAmount').select(); }, 30);
  }
  function fdGrams() { const a = num($('fdAmount').value); return $('fdUnit').value === 'g' ? a : a * fd.food.serving; }
  function updateFoodPreview() {
    const g = fdGrams(), f = fd.food, k = (Number.isFinite(g) && g > 0) ? g / f.serving : 0;
    $('fdPreview').innerHTML = [[Math.round(f.kcal * k), 'kcal'], [round1(f.p * k), 'protein g'], [round1(f.c * k), 'carbs g'], [round1(f.f * k), 'fat g']]
      .map(([v, l]) => '<div><strong>' + v + '</strong><small>' + l + '</small></div>').join('');
  }
  $('fdUnit').addEventListener('change', () => {
    // convert the amount so switching units keeps the same quantity
    const f = fd.food, a = num($('fdAmount').value); if (!Number.isFinite(a)) { updateFoodPreview(); return; }
    $('fdAmount').value = $('fdUnit').value === 'g' ? round1(a * f.serving) : round1(a / f.serving);
    updateFoodPreview();
  });
  $('fdAmount').addEventListener('input', updateFoodPreview);
  $('foodForm').addEventListener('submit', e => {
    e.preventDefault();
    const g = fdGrams(), f = fd.food, err = $('fdError');
    if (!Number.isFinite(g) || g < 1 || g > 5000) { err.textContent = 'Enter an amount between 1 g and 5,000 g (about ' + round1(1 / f.serving) + ' to ' + round1(5000 / f.serving) + ' servings).'; err.classList.remove('hidden'); return; }
    const qty = Math.round(g / f.serving * 10000) / 10000;
    if (qty < 0.01 || qty > 1000) { err.textContent = 'That amount is outside the supported range.'; err.classList.remove('hidden'); return; }
    const meal = $('fdMeal').value;
    if (fd.entry) {
      const entry = data.foods.find(x => x.id === fd.entry.id);
      if (entry) { entry.qty = qty; entry.meal = meal; }
      persist(); renderAll(); toast('Entry updated.');
    } else {
      const entry = { id: uid(), date: fd.date, meal, foodId: f.id, name: f.name, emoji: f.emoji, qty, serving: f.serving, kcal: f.kcal, p: f.p, c: f.c, f: f.f };
      data.foods.push(entry); persist(); renderAll();
      toast('Added ' + round1(g) + ' g ' + shortName(f) + ' · ' + Math.round(f.kcal * qty) + ' kcal', { label: 'Undo', fn: () => { data.foods = data.foods.filter(x => x.id !== entry.id); persist(); renderAll(); } });
    }
    closeDialog($('foodDialog'));
  });
  $('fdCancel').addEventListener('click', () => closeDialog($('foodDialog')));

  function openDialog(d) { if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) closeDialog(d); }));

  /* ---- diary ---- */
  function foodRow(x, compact) {
    const g = round1(C.grams(x));
    return '<div class="fooditem"><div class="foodicon" aria-hidden="true">' + esc(x.emoji || '🍽️') + '</div><div class="itemmain"><strong>' + esc(x.name) + '</strong><small>' + g + ' g · P ' + round1(x.p * x.qty) + ' · C ' + round1(x.c * x.qty) + ' · F ' + round1(x.f * x.qty) + '</small></div><div class="kcal">' + fmt(x.kcal * x.qty) + ' kcal</div>' +
      (compact ? '' : '<button class="iconbtn" data-action="edit-food" data-id="' + esc(x.id) + '" aria-label="Edit ' + esc(x.name) + '">✎</button><button class="iconbtn" data-action="del-food" data-id="' + esc(x.id) + '" aria-label="Delete ' + esc(x.name) + '">×</button>') + '</div>';
  }
  function renderFood() {
    $('diaryDate').max = today(); $('diaryDate').value = ui.diaryDate;
    $('dateNext').disabled = ui.diaryDate >= today();
    // search
    const q = $('foodSearch').value;
    let pool = allFoods();
    if (ui.group === 'My foods') pool = pool.filter(f => f.group === 'My foods');
    else if (ui.group !== 'All') pool = pool.filter(f => f.group === ui.group);
    const matches = F.search(q, pool), found = matches.slice(0, ui.resultLimit);
    $('foodCount').textContent = matches.length + ' food' + (matches.length === 1 ? '' : 's');
    $('foodResults').innerHTML = found.length ? found.map(f =>
      '<div class="fooditem"><div class="foodicon" aria-hidden="true">' + esc(f.emoji) + '</div><div class="itemmain"><strong>' + esc(f.name) + '</strong><small>' + esc(f.hi ? f.hi + ' · ' : '') + esc(f.unit) + ' = ' + f.serving + ' g · ' + f.kcal + ' kcal · P ' + f.p + ' g' + (f.src === 'usda' ? ' · ✓ USDA' : f.src === 'estimate' ? ' · est.' : '') + '</small></div><button class="btn small" data-action="add-food" data-scope="food" data-id="' + esc(f.id) + '" aria-label="Add ' + esc(f.name) + '">Add</button></div>').join('') + (matches.length > found.length ? '<button class="btn secondary" data-action="more-results">Show ' + Math.min(20, matches.length - found.length) + ' more (' + (matches.length - found.length) + ' left)</button>' : '')
      : '<div class="empty">No match. Try another spelling, or save it as a custom food below.</div>';
    const groups = ['All'].concat(Array.from(new Set(F.list.map(f => f.group)))).concat(data.customFoods.length ? ['My foods'] : []);
    $('groupChips').innerHTML = groups.map(g => '<button type="button" class="chip' + (g === ui.group ? ' active' : '') + '" data-action="group" data-group="' + esc(g) + '" aria-pressed="' + (g === ui.group) + '">' + esc(g) + '</button>').join('');
    $('quickChips').innerHTML = quickFoods().map(f => '<button type="button" class="chip" data-action="add-food" data-scope="food" data-id="' + esc(f.id) + '">' + esc(f.emoji + ' ' + shortName(f)) + '</button>').join('');
    // saved meals
    const sm = data.savedMeals;
    $('mealsBlock').classList.toggle('hidden', !sm.length);
    $('mealChips').innerHTML = sm.map(m => '<button type="button" class="chip" data-action="log-meal" data-id="' + esc(m.id) + '">🍽️ ' + esc(m.name) + ' · ' + fmt(C.totals(m.items).kcal) + ' kcal</button>').join('');
    $('mealManage').innerHTML = sm.map(m => '<div class="fooditem"><div class="itemmain"><strong>' + esc(m.name) + '</strong><small>' + m.items.length + ' item' + (m.items.length === 1 ? '' : 's') + ': ' + esc(m.items.map(i => shortName(i)).join(', ')) + '</small></div><button type="button" class="iconbtn" data-action="del-meal" data-id="' + esc(m.id) + '" aria-label="Delete saved meal ' + esc(m.name) + '">✕</button></div>').join('');
    // diary
    const entries = foodsOn(ui.diaryDate), t = C.totals(entries), p = data.profile;
    $('diaryTotals').innerHTML = [['Calories', fmt(t.kcal), 'of ' + fmt(p.calories)], ['Protein', round1(t.p) + ' g', 'of ' + p.protein + ' g'], ['Carbs', round1(t.c) + ' g', 'of ' + p.carbs + ' g'], ['Fat', round1(t.f) + ' g', 'of ' + p.fat + ' g']]
      .map(([l, v, s]) => '<div class="stat"><label>' + l + '</label><strong>' + v + '</strong><small>' + s + '</small></div>').join('');
    const order = ['breakfast', 'lunch', 'snack', 'dinner', 'other'];
    const html = order.map(m => {
      const list = entries.filter(x => (x.meal || 'other') === m);
      if (!list.length) return '';
      const mt = C.totals(list);
      return '<div class="mealhead">' + MEAL_NAMES[m] + '<span>' + fmt(mt.kcal) + ' kcal · ' + round1(mt.p) + ' g protein <button type="button" class="iconbtn" style="min-height:32px;margin-left:6px" data-action="save-meal" data-meal="' + m + '" aria-label="Save ' + MEAL_NAMES[m] + ' as a meal">Save as meal</button></span></div><div class="list">' + list.map(x => foodRow(x)).join('') + '</div>';
    }).join('');
    $('foodDiary').innerHTML = html || '<div class="empty">Nothing logged for ' + (ui.diaryDate === today() ? 'today' : esc(dayLabel(ui.diaryDate))) + ' yet. Tap a food on the left to add it.</div>';
    $('copyPrev').disabled = false;
    $('myFoods').innerHTML = data.customFoods.length ? data.customFoods.map(f => '<div class="fooditem"><div class="foodicon" aria-hidden="true">' + esc(f.emoji || '🍽️') + '</div><div class="itemmain"><strong>' + esc(f.name) + '</strong><small>' + f.serving + ' g · ' + f.kcal + ' kcal · P ' + f.p + ' · C ' + f.c + ' · F ' + f.f + (f.recipe ? ' · recipe' : '') + '</small></div><button class="iconbtn" data-action="del-custom" data-id="' + esc(f.id) + '" aria-label="Remove ' + esc(f.name) + ' from my foods">×</button></div>').join('') : '<div class="empty">Foods and recipes you save appear here.</div>';
  }
  $('foodSearch').addEventListener('input', () => { ui.resultLimit = 10; renderFood(); });
  $('diaryDate').addEventListener('change', e => { if (C.validDate(e.target.value) && e.target.value <= today()) { ui.diaryDate = e.target.value; renderFood(); } });
  $('datePrev').addEventListener('click', () => { ui.diaryDate = C.addDays(ui.diaryDate, -1); renderFood(); });
  $('dateNext').addEventListener('click', () => { if (ui.diaryDate < today()) { ui.diaryDate = C.addDays(ui.diaryDate, 1); renderFood(); } });
  $('copyPrev').addEventListener('click', () => {
    const src = foodsOn(C.addDays(ui.diaryDate, -1));
    if (!src.length) { toast('Nothing was logged on the previous day.'); return; }
    mutate(['foods'], 'Copied ' + src.length + ' entries from the previous day.', () => { src.forEach(x => data.foods.push(Object.assign({}, x, { id: uid(), date: ui.diaryDate }))); });
  });

  /* ---- saved meals ---- */
  let pendingMeal = null;
  $('mealCancel').addEventListener('click', () => $('mealDialog').close());
  $('mealForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('mealName').value.trim().slice(0, 60);
    if (!pendingMeal || !name) return;
    const items = pendingMeal.items.map(x => { const c = Object.assign({}, x); delete c.id; delete c.date; delete c.meal; return c; });
    pendingMeal = null; $('mealDialog').close();
    const dupe = data.savedMeals.find(m => m.name.toLowerCase() === name.toLowerCase());
    mutate(['savedMeals'], (dupe ? 'Replaced the saved meal ' : 'Saved meal ') + name + '.', () => { data.savedMeals = data.savedMeals.filter(m => m !== dupe); data.savedMeals.push({ id: uid(), name, items }); });
  });

  /* ---- custom food form ---- */
  function updateMacroEnergyHint() {
    const p = num($('customProtein').value) || 0, c = num($('customCarbs').value) || 0, f = num($('customFat').value) || 0, k = num($('customCalories').value) || 0;
    const est = Math.round(C.atwater(p, c, f)), diff = Math.abs(k - est);
    $('macroEnergyHint').textContent = 'Macros add up to about ' + est + ' kcal (protein ×4 + carbs ×4 + fat ×9). ' + (k && diff > Math.max(40, k * 0.2) ? 'That differs from the calories you entered — check the serving size on the label.' : 'Fibre and rounding can explain small differences.');
  }
  ['customCalories', 'customProtein', 'customCarbs', 'customFat'].forEach(id => $(id).addEventListener('input', updateMacroEnergyHint));
  $('customFoodForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = { id: 'custom-' + uid(), name: $('customName').value.trim(), emoji: '🍽️', serving: num($('customServing').value), kcal: num($('customCalories').value), p: num($('customProtein').value), c: num($('customCarbs').value), f: num($('customFat').value) };
    if (!C.validCustomFood(f)) { toast('Check the values: name required, serving 1–5000 g, calories 0–5000, macros 0–500 g.'); return; }
    if (data.customFoods.some(x => x.name.trim().toLowerCase() === f.name.toLowerCase())) { toast('You already have a food called "' + f.name + '". Delete the old one in My foods first, or use a different name.'); return; }
    if (data.customFoods.some(x => x.name.trim().toLowerCase() === f.name.toLowerCase())) { toast('You already have a food called "' + f.name + '". Delete the old one in My foods first, or use a different name.'); return; }
    data.customFoods.push(f); persist(); e.target.reset();
    $('customServing').value = 100; $('customProtein').value = 0; $('customCarbs').value = 0; $('customFat').value = 0; updateMacroEnergyHint(); renderAll();
    openFoodDialog(customToFood(f), { date: ui.diaryDate });
  });

  /* ---- recipe builder ---- */
  function addIngredientRow(name, grams) {
    const row = document.createElement('div'); row.className = 'ingrow';
    row.innerHTML = '<input list="foodNames" class="ri-name" placeholder="Ingredient (type to search)" aria-label="Ingredient name" autocomplete="off"><input type="number" class="ri-g" inputmode="decimal" min="1" max="20000" placeholder="grams" aria-label="Grams"><button type="button" class="iconbtn ri-x" aria-label="Remove ingredient">×</button>';
    if (name) row.querySelector('.ri-name').value = name;
    if (grams) row.querySelector('.ri-g').value = grams;
    $('rIngs').appendChild(row);
  }
  function recipeState() {
    const byName = {}; allFoods().forEach(f => { byName[f.name.toLowerCase()] = f; });
    const rows = Array.from($('rIngs').querySelectorAll('.ingrow')).map(r => ({ name: r.querySelector('.ri-name').value.trim(), grams: num(r.querySelector('.ri-g').value) })).filter(r => r.name || Number.isFinite(r.grams));
    const bad = [], ing = [];
    rows.forEach(r => {
      const f = byName[r.name.toLowerCase()];
      if (!f) bad.push(r.name || '(blank)'); else if (!(r.grams > 0)) bad.push(r.name + ' (grams)'); else { const p = per100(f); ing.push({ grams: r.grams, p100: p.p, c100: p.c, f100: p.f, name: f.name }); }
    });
    const servings = num($('rServings').value), yieldG = num($('rYield').value);
    const res = ing.length && servings > 0 ? C.recipe(ing, servings, Number.isFinite(yieldG) ? yieldG : 0) : null;
    return { rows, bad, ing, servings, yieldG, res };
  }
  function updateRecipePreview() {
    const s = recipeState(), r = s.res;
    $('rPreview').innerHTML = r ? [[r.kcal, 'kcal / serving'], [r.p, 'protein g'], [r.c, 'carbs g'], [r.f, 'fat g']].map(([v, l]) => '<div><strong>' + v + '</strong><small>' + l + '</small></div>').join('') : '<div style="grid-column:1/-1">Add ingredients to see nutrition per serving.</div>';
  }
  $('openRecipe').addEventListener('click', () => {
    $('recipeForm').reset(); $('rIngs').innerHTML = ''; $('rError').classList.add('hidden');
    $('foodNames').innerHTML = allFoods().map(f => '<option value="' + esc(f.name) + '"></option>').join('');
    addIngredientRow(); addIngredientRow(); updateRecipePreview(); openDialog($('recipeDialog'));
  });
  $('rAdd').addEventListener('click', () => { addIngredientRow(); const rows = $('rIngs').querySelectorAll('.ri-name'); rows[rows.length - 1].focus(); });
  $('rIngs').addEventListener('click', e => { const x = e.target.closest('.ri-x'); if (x) { x.parentElement.remove(); updateRecipePreview(); } });
  $('rIngs').addEventListener('input', updateRecipePreview);
  ['rServings', 'rYield'].forEach(id => $(id).addEventListener('input', updateRecipePreview));
  $('rCancel').addEventListener('click', () => closeDialog($('recipeDialog')));
  $('recipeForm').addEventListener('submit', e => {
    e.preventDefault();
    const s = recipeState(), err = $('rError'), name = $('rName').value.trim();
    const fail = m => { err.textContent = m; err.classList.remove('hidden'); };
    if (!name) return fail('Give the recipe a name.');
    if (s.bad.length) return fail('Fix these ingredients (pick from the list and enter grams): ' + s.bad.join(', '));
    if (!s.res) return fail('Add at least one ingredient with its weight and the number of servings.');
    const r = s.res;
    const f = { id: 'custom-' + uid(), name, emoji: '🍲', serving: r.serving, kcal: r.kcal, p: r.p, c: r.c, f: r.f, recipe: true, servings: s.servings, ingredients: s.ing.map(i => ({ name: i.name, grams: i.grams })) };
    if (!C.validCustomFood(f)) return fail('Those numbers are outside the supported range (serving 1–5000 g, under 5000 kcal per serving).');
    data.customFoods.push(f); persist(); closeDialog($('recipeDialog')); renderAll();
    openFoodDialog(customToFood(f), { date: ui.diaryDate });
  });

  /* ================= weight ================= */
  function drawWeightChart(svg, series, days, w, h) {
    const since = C.addDays(today(), -days);
    const pts = series.filter(p => p.date >= since);
    const text = m => { svg.innerHTML = '<text x="' + w / 2 + '" y="' + h / 2 + '" text-anchor="middle" class="ch-txt" font-size="13">' + m + '</text>'; };
    if (!pts.length) { text('Log your first weigh-in to see a chart'); svg.setAttribute('aria-label', 'Weight chart: no data yet'); return; }
    if (pts.length === 1) { text(pts[0].weight.toFixed(1) + ' kg — add another weigh-in to see a trend'); svg.setAttribute('aria-label', 'Weight chart: one weigh-in'); return; }
    const vals = pts.map(p => p.weight).concat(pts.map(p => p.trend));
    let min = Math.min.apply(null, vals) - 0.3, max = Math.max.apply(null, vals) + 0.3;
    if (max - min < 1) { const m = (max + min) / 2; min = m - 0.5; max = m + 0.5; }
    const L = 38, R = 12, T = 10, B = 22, span = Math.max(1, C.daysBetween(pts[0].date, pts[pts.length - 1].date));
    const X = d => L + C.daysBetween(pts[0].date, d) / span * (w - L - R), Y = v => T + (1 - (v - min) / (max - min)) * (h - T - B);
    let out = '';
    [min, (min + max) / 2, max].forEach(v => { out += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="ch-grid"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" class="ch-txt" font-size="11">' + v.toFixed(1) + '</text>'; });
    out += '<path d="' + pts.map((p, i) => (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p.trend).toFixed(1)).join(' ') + '" fill="none" class="ch-line" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    pts.forEach(p => { out += '<circle cx="' + X(p.date).toFixed(1) + '" cy="' + Y(p.weight).toFixed(1) + '" r="11" fill="transparent" data-d="' + p.date + '" data-w="' + p.weight + '" data-t="' + p.trend.toFixed(1) + '"/><circle cx="' + X(p.date).toFixed(1) + '" cy="' + Y(p.weight).toFixed(1) + '" r="3.5" class="ch-dot" opacity=".85" pointer-events="none"><title>' + p.date + ': ' + p.weight + ' kg</title></circle>'; });
    out += '<text x="' + L + '" y="' + (h - 5) + '" class="ch-txt" font-size="11">' + pts[0].date.slice(5) + '</text><text x="' + (w - R) + '" y="' + (h - 5) + '" text-anchor="end" class="ch-txt" font-size="11">' + pts[pts.length - 1].date.slice(5) + '</text>';
    svg.innerHTML = out;
    const last = pts[pts.length - 1];
    svg.setAttribute('aria-label', 'Weight chart over ' + days + ' days: latest ' + last.weight + ' kg, smoothed trend ' + last.trend.toFixed(1) + ' kg');
  }
  const rateText = r => (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(round1(r)).toFixed(1);
  function rateWhy(ws) {
    if (ws.seedOnly || ws.count < 4) return 'Needs at least 4 weigh-ins spread over a week or more (you have ' + ws.count + ').';
    if (ws.rate === null) return 'Needs a weigh-in from the last 5 days and 7+ days between the first and last of the recent ones.';
    return '';
  }
  function rangeStats(ws, days) {
    const since = C.addDays(today(), -days), real = ws.seedOnly ? [] : data.weights.filter(w => w.source !== 'profile' && w.date >= since).sort((a, b) => a.date.localeCompare(b.date));
    let t = '';
    if (real.length >= 2) {
      const avg = real.reduce((s, w) => s + w.weight, 0) / real.length, ch = real[real.length - 1].weight - real[0].weight;
      t = 'Last ' + days + ' days: average ' + avg.toFixed(1) + ' kg · ' + real.length + ' weigh-ins · first to last ' + (ch > 0 ? '+' : ch < 0 ? '−' : '') + Math.abs(ch).toFixed(1) + ' kg (daily noise of 0.5–1 kg is normal).';
    } else t = real.length ? 'Only one weigh-in in the last ' + days + ' days.' : 'No weigh-ins in the last ' + days + ' days.';
    $('rangeStatsHome').textContent = t; $('rangeStatsProg').textContent = t;
  }
  function renderWeight() {
    const ws = C.weightSummary(data.weights, today());
    $('weightCount').textContent = ws.count + ' weigh-in' + (ws.count === 1 ? '' : 's');
    $('latestWeight').innerHTML = ws.latest !== null ? ws.latest.toFixed(1) + ' <span class="unit">kg</span>' : '— <span class="unit">kg</span>';
    let cap;
    if (ws.seedOnly) cap = 'Starting weight from your profile. Log a weigh-in to start your trend.';
    else if (ws.rate !== null) cap = 'Trend ' + ws.trend.toFixed(1) + ' kg · ' + rateText(ws.rate) + ' kg/week over the last 2 weeks. Not a body-fat measurement.';
    else if (ws.count) cap = 'Trend ' + ws.trend.toFixed(1) + ' kg. ' + rateWhy(ws);
    else cap = 'Log a few weigh-ins (same time of day works best) to see a smoothed trend.';
    $('trendCaption').textContent = cap;
    const rd = [7, 14, 30, 90].includes(prefs.chartDays) ? prefs.chartDays : 30;
    document.querySelectorAll('[data-range]').forEach(b => { const on = Number(b.dataset.range) === rd; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    drawWeightChart($('weightChart'), ws.seedOnly ? [] : ws.series, rd, 400, 160);
    rangeStats(ws, rd);
    // progress tab
    $('pLatest').textContent = ws.latest !== null ? ws.latest.toFixed(1) : '—';
    $('pTrend').textContent = ws.trend !== null && !ws.seedOnly ? ws.trend.toFixed(1) : '—';
    $('pRate').textContent = ws.rate !== null ? rateText(ws.rate) : '—';
    $('pWaist').textContent = ws.waist ? ws.waist.waist.toFixed(1) : '—';
    $('rateExplain').textContent = ws.rate !== null ? 'Rate is a best-fit line through your last 2 weeks of weigh-ins; daily swings of 0.5–1 kg are normal water and digestion.' : rateWhy(ws);
    drawWeightChart($('progressChart'), ws.seedOnly ? [] : ws.series, rd, 400, 190);
    const rows = data.weights.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    $('weightHistory').innerHTML = rows.length ? rows.map(x => '<div class="dayrow"><span>' + esc(dayLabel(x.date)) + (x.waist != null ? ' · waist ' + x.waist + ' cm' : '') + (x.source === 'profile' ? ' · <em>starting weight</em>' : '') + '</span><strong>' + x.weight.toFixed(1) + ' kg <button class="iconbtn" data-action="del-weight" data-id="' + esc(x.id) + '" aria-label="Delete measurement from ' + esc(x.date) + '">×</button></strong></div>').join('') : '<div class="empty">Your measurements will appear here.</div>';
  }
  $('weightForm').addEventListener('submit', e => {
    e.preventDefault();
    const w = num($('weightInput').value), waist = $('waistInput').value === '' ? null : num($('waistInput').value), date = $('measureDate').value;
    const entry = { id: uid(), date, weight: w, waist };
    if (!C.validDate(date) || date > today() || !C.validWeight(entry)) { toast('Check the values: weight 20–400 kg, waist 30–250 cm, date not in the future.'); return; }
    data.weights = data.weights.filter(x => x.date !== date && x.source !== 'profile');   // one entry per day; the profile seed is replaced by real data
    data.weights.push(entry); data.weights.sort((a, b) => a.date.localeCompare(b.date));
    persist(); $('weightInput').value = ''; $('waistInput').value = ''; renderAll(); toast('Measurement saved.');
  });

  /* ================= training ================= */
  const PLANS = {
    beginner: { title: 'Beginner · full body A/B', days: [
      { title: 'Session A', items: [
        { gym: 'Goblet squat', home: 'Bodyweight squat', sets: 3, range: '8–12' },
        { gym: 'Dumbbell bench press', home: 'Incline push-up', sets: 3, range: '8–12' },
        { gym: 'Lat pulldown', home: 'Band pull-down (or towel row)', sets: 3, range: '8–12' },
        { gym: 'Romanian deadlift', home: 'Hip hinge / glute bridge', sets: 2, range: '8–12' },
        { gym: 'Plank', home: 'Dead bug', sets: 2, range: '20–40 sec' }] },
      { title: 'Session B', items: [
        { gym: 'Leg press', home: 'Reverse lunge to support', sets: 3, range: '8–12' },
        { gym: 'Seated cable row', home: 'Backpack row', sets: 3, range: '8–12' },
        { gym: 'Dumbbell overhead press', home: 'Pike push-up (incline)', sets: 2, range: '8–12' },
        { gym: 'Hip thrust', home: 'Glute bridge', sets: 3, range: '10–15' },
        { gym: 'Farmer carry', home: 'Bird dog', sets: 2, range: '20–40 sec' }] },
      { title: 'Weekly guide', guide: ['Alternate A and B on non-consecutive days (A/B/A one week, B/A/B the next).', 'Warm up 5–8 minutes of easy movement first.', 'Leave about 2–3 reps in reserve while you learn technique.', 'Progress reps first within the range, then load. Never force a personal record.'] }] },
    intermediate: { title: 'Intermediate · upper / lower', days: [
      { title: 'Upper A', items: [
        { gym: 'Bench press', home: 'Push-up variation', sets: 3, range: '6–10' },
        { gym: 'Chest-supported row', home: 'One-arm backpack row', sets: 3, range: '8–12' },
        { gym: 'Overhead press', home: 'Pike push-up', sets: 3, range: '6–10' },
        { gym: 'Lat pulldown', home: 'Band / backpack row', sets: 3, range: '8–12' }] },
      { title: 'Lower A', items: [
        { gym: 'Squat', home: 'Tempo squat', sets: 3, range: '6–10' },
        { gym: 'Romanian deadlift', home: 'Single-leg hip hinge', sets: 3, range: '8–12' },
        { gym: 'Split squat', home: 'Split squat', sets: 3, range: '8–12' },
        { gym: 'Calf raise', home: 'Calf raise', sets: 3, range: '10–15' }] },
      { title: 'Upper / lower B', items: [
        { gym: 'Incline dumbbell press', home: 'Feet-elevated push-up', sets: 3, range: '8–12' },
        { gym: 'Cable row', home: 'Backpack row', sets: 3, range: '8–12' },
        { gym: 'Leg press', home: 'Reverse lunge', sets: 3, range: '8–12' },
        { gym: 'Hip thrust', home: 'Single-leg glute bridge', sets: 3, range: '8–12' }] },
      { title: 'Weekly guide', guide: ['Rotate the three sessions across 3–4 training days.', 'Keep 1–2 reps in reserve on most sets.', 'Use double progression: reach the top of the rep range on every set, then add the smallest load step.'] }] },
    advanced: { title: 'Advanced · volume-managed', days: [
      { title: 'Upper strength', items: [
        { gym: 'Bench press', home: 'Weighted push-up', sets: 4, range: '4–8' },
        { gym: 'Weighted pull-up', home: 'Difficult row variation', sets: 4, range: '4–8' },
        { gym: 'Overhead press', home: 'Pike push-up', sets: 3, range: '5–8' }] },
      { title: 'Lower strength', items: [
        { gym: 'Squat', home: 'Tempo split squat', sets: 4, range: '4–8' },
        { gym: 'Deadlift', home: 'Single-leg hinge', sets: 3, range: '4–8' },
        { gym: 'Split squat', home: 'Split squat', sets: 3, range: '8–12' }] },
      { title: 'Upper / lower volume', items: [
        { gym: 'Incline press', home: 'Push-up variation', sets: 3, range: '8–12' },
        { gym: 'Cable / machine row', home: 'Backpack row', sets: 3, range: '8–12' },
        { gym: 'Leg press', home: 'Lunge variation', sets: 3, range: '10–15' },
        { gym: 'Hamstring curl', home: 'Sliding hamstring curl', sets: 3, range: '8–15' }] },
      { title: 'Weekly guide', guide: ['Watch weekly volume; add sets only when recovery is good.', 'Deload (cut volume ~40%) every 4–8 weeks or when performance drops.'] }] }
  };
  const planLevel = () => PLANS[prefs.planLevel] ? prefs.planLevel : (PLANS[data.profile.experience] ? data.profile.experience : 'beginner');
  const planEquip = () => prefs.planEquipment === 'gym' || prefs.planEquipment === 'home' ? prefs.planEquipment : (data.profile.equipment === 'gym' ? 'gym' : 'home');
  const exName = ex => ex.mode === 'gym' ? ex.gym : ex.home;
  const historyOf = name => data.workouts.filter(w => w.name.toLowerCase() === name.toLowerCase()).sort((a, b) => a.date.localeCompare(b.date));
  const loadStr = w => (w > 0 ? w + ' kg' : 'bodyweight');
  const setSummary = x => { const s = C.setsOf(x); const unit = x.timed ? ' s' : ''; return s.map(t => t.reps + unit + (t.weight > 0 ? ' × ' + t.weight : '')).join(' · '); };

  function renderTraining() {
    const level = planLevel(), equip = planEquip(), plan = PLANS[level];
    $('planLevel').value = level; $('planEquipment').value = equip; $('restSecs').value = String(prefs.restSecs || 90);
    $('planLevelLabel').textContent = plan.title;
    const titles = C.sessionTitles(plan), next = C.nextSession(titles, data.workouts);
    const planned = C.plannedDays(data.profile.sessionsPerWeek).includes(new Date().getDay());
    const trainedToday = data.workouts.some(w => w.date === today());
    $('planInfo').innerHTML = '<strong>Next up: ' + esc(next) + '</strong> · ' + (trainedToday ? 'you already trained today' : planned ? 'a planned training day' : 'not a planned day — optional') + '. You aim for ' + data.profile.sessionsPerWeek + ' sessions a week.';
    $('sessionPicker').innerHTML = titles.map(t => '<button type="button" class="chip' + (t === next ? ' active' : '') + '" data-action="start-session" data-title="' + esc(t) + '">Start ' + esc(t) + (t === next ? ' · next up' : '') + '</button>').join('');
    const guide = plan.days.find(d => d.guide);
    $('planGuide').textContent = guide ? guide.guide.join(' ') : '';
    // history
    const byDate = {};
    data.workouts.forEach(x => { (byDate[x.date] = byDate[x.date] || []).push(x); });
    const dates = Object.keys(byDate).sort().reverse();
    $('exerciseCount').textContent = data.workouts.length + ' exercise log' + (data.workouts.length === 1 ? '' : 's');
    $('exerciseDiary').innerHTML = dates.length ? dates.slice(0, ui.histDays).map(d => {
      const items = byDate[d]; const sess = items.find(i => i.session);
      return '<div class="histday"><h4>' + esc(dayLabel(d)) + (sess ? ' · ' + esc(sess.session) : '') + '</h4><div class="list">' + items.map(x =>
        '<div class="exerciseitem"><div class="itemmain"><strong>' + esc(x.name) + '</strong><small>' + x.sets + ' sets · ' + (x.rpe ? 'RPE ' + x.rpe : '') + (x.notes ? ' · ' + esc(x.notes) : '') + '</small><div class="setchips">' + (x.setLog ? x.setLog.map(s => '<span>' + s.reps + (x.timed ? ' s' : '') + (s.weight > 0 ? ' × ' + s.weight + ' kg' : '') + '</span>').join('') : '<span>' + x.reps + ' reps' + (x.weight > 0 ? ' × ' + x.weight + ' kg' : '') + '</span>') + '</div></div><button class="iconbtn" data-action="del-workout" data-id="' + esc(x.id) + '" aria-label="Delete ' + esc(x.name) + ' from ' + esc(d) + '">×</button></div>').join('') + '</div></div>';
    }).join('') + (dates.length > ui.histDays ? '<div style="margin-top:12px"><button class="btn secondary small" data-action="more-history">Show older</button></div>' : '') : '<div class="empty">No workouts yet. Start a session above or use quick log.</div>';
    // personal bests
    const best = {};
    data.workouts.forEach(x => {
      const b = best[x.name.toLowerCase()] = best[x.name.toLowerCase()] || { name: x.name, load: 0, e1rm: 0, reps: 0, date: x.date, timed: !!x.timed };
      C.setsOf(x).forEach(s => { b.load = Math.max(b.load, s.weight); b.e1rm = Math.max(b.e1rm, C.epley1RM(s.weight, s.reps)); b.reps = Math.max(b.reps, s.reps); });
      if (x.date > b.date) b.date = x.date;
    });
    const pbs = Object.values(best).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    $('personalRecords').innerHTML = pbs.length ? pbs.map(b => '<div class="dayrow"><span>' + esc(b.name) + '</span><strong>' + (b.load > 0 ? b.load + ' kg' + (b.e1rm ? ' · est. 1RM ' + round1(b.e1rm) : '') : b.reps + (b.timed ? ' s' : ' reps') + ' best set') + '</strong></div>').join('') : '<div class="empty">Personal bests appear as you log.</div>';
    // cardio
    const cardio = data.cardio.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    $('cardioList').innerHTML = cardio.length ? cardio.map(c => '<div class="dayrow"><span>' + esc(dayLabel(c.date)) + ' · ' + esc(c.kind) + ' · ' + c.minutes + ' min · effort ' + c.rpe + '</span><button class="iconbtn" data-action="del-cardio" data-id="' + esc(c.id) + '" aria-label="Delete cardio entry">×</button></div>').join('') : '';
    renderSession();
  }

  /* ---- guided session ---- */
  function startSession(title) {
    if (draft && !confirm('A session is already in progress. Replace it with a new one?')) { go('workout'); return; }
    const plan = PLANS[planLevel()], day = plan.days.find(d => d.title === title && d.items);
    if (!day) return;
    const mode = planEquip();
    draft = { id: uid(), date: today(), title, level: planLevel(), startedAt: Date.now(), exercises: day.items.map(it => buildExercise(it, mode)) };
    saveDraft(); go('workout'); renderSession();
    setTimeout(() => { const c = $('sessionCard'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); }, 50);
  }
  function buildExercise(it, mode) {
    const ex = { gym: it.gym, home: it.home, mode, setsPlanned: it.sets, range: it.range, rpe: 7, rows: [] };
    fillRows(ex); return ex;
  }
  function fillRows(ex) {
    const range = C.parseRange(ex.range), sug = C.suggestNext(historyOf(exName(ex)), ex.range);
    ex.rows = Array.from({ length: ex.setsPlanned }, () => ({ reps: range.time ? (range.lo || 30) : (sug.reps || range.lo), load: sug.load || 0, done: false }));
  }
  function renderSession() {
    const card = $('sessionCard');
    if (!draft) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    $('sessionTitle').textContent = draft.title + ' · ' + draft.level + ' · started ' + new Date(draft.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('sessionBody').innerHTML = draft.exercises.map((ex, i) => {
      const range = C.parseRange(ex.range), name = exName(ex), hist = historyOf(name), last = hist[hist.length - 1], sug = C.suggestNext(hist, ex.range);
      const lastTxt = last ? 'Last (' + esc(dayLabel(last.date)) + '): ' + esc(setSummary(last)) + (last.rpe ? ' · RPE ' + last.rpe : '') : 'No history yet for this exercise.';
      return '<div class="excard" data-exi="' + i + '"><h4>' + esc(name) + '</h4><div class="hint">Plan: ' + ex.setsPlanned + ' × ' + esc(ex.range) + (ex.gym !== ex.home ? ' · <button type="button" class="chip" style="min-height:36px;font-size:13px" data-action="swap-ex" data-ex="' + i + '">Swap to ' + esc(ex.mode === 'gym' ? ex.home : ex.gym) + '</button>' : '') + '</div>' +
        '<div class="target"><strong>' + esc(sug.text) + '</strong><br><span class="muted">' + lastTxt + '</span></div>' +
        '<div class="sethead"><span>Set</span><span>' + (range.time ? 'Seconds' : 'Reps') + '</span><span>Load (kg)</span><span>Done</span></div>' +
        ex.rows.map((r, j) => '<div class="setrow' + (r.done ? ' isdone' : '') + '"><span class="setno">' + (j + 1) + '</span><input type="number" inputmode="numeric" min="0" max="1000" value="' + esc(r.reps) + '" data-f="reps" data-ex="' + i + '" data-set="' + j + '" aria-label="' + esc(name) + ' set ' + (j + 1) + ' ' + (range.time ? 'seconds' : 'reps') + '"><input type="number" inputmode="decimal" min="0" max="2000" step="0.25" value="' + esc(r.load) + '" data-f="load" data-ex="' + i + '" data-set="' + j + '" aria-label="' + esc(name) + ' set ' + (j + 1) + ' load in kilograms"><button type="button" class="done" data-action="toggle-set" data-ex="' + i + '" data-set="' + j + '" aria-pressed="' + r.done + '" aria-label="Mark set ' + (j + 1) + ' of ' + esc(name) + ' ' + (r.done ? 'not done' : 'done') + '">' + (r.done ? '✓' : '○') + '</button></div>').join('') +
        '<div class="exfoot"><button type="button" class="btn secondary small" data-action="add-set" data-ex="' + i + '">＋ Set</button><button type="button" class="btn secondary small" data-action="del-set" data-ex="' + i + '" aria-label="Remove last set of ' + esc(name) + '">− Set</button><label for="rpe' + i + '">Effort (RPE)</label><select id="rpe' + i + '" data-rpe="' + i + '">' + [5, 6, 7, 8, 9, 10].map(v => '<option' + (+ex.rpe === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div></div>';
    }).join('');
    updateRestDisplay();
  }
  $('sessionBody').addEventListener('input', e => {
    const t = e.target; if (!draft || !t.dataset || !t.dataset.f) return;
    const r = draft.exercises[+t.dataset.ex].rows[+t.dataset.set]; r[t.dataset.f] = t.value === '' ? '' : Number(t.value); saveDraft();
  });
  $('sessionBody').addEventListener('change', e => { const t = e.target; if (draft && t.dataset && t.dataset.rpe !== undefined) { draft.exercises[+t.dataset.rpe].rpe = Number(t.value); saveDraft(); } });

  function startRest(secs) {
    ui.restEnd = Date.now() + secs * 1000; clearInterval(ui.restTimer); ui.restTimer = setInterval(updateRestDisplay, 250); updateRestDisplay();
  }
  function updateRestDisplay() {
    const el = $('restDisplay'); if (!el) return;
    if (!ui.restEnd) { el.textContent = 'Ready'; return; }
    const left = Math.ceil((ui.restEnd - Date.now()) / 1000);
    if (left > 0) { el.textContent = 'Rest ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); return; }
    clearInterval(ui.restTimer); ui.restEnd = 0; el.textContent = 'Rest over — go';
    $('srLive').textContent = 'Rest over. Start your next set.';
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
    setTimeout(() => { if (!ui.restEnd) { el.textContent = 'Ready'; $('srLive').textContent = ''; } }, 8000);
  }
  $('restSkip').addEventListener('click', () => { clearInterval(ui.restTimer); ui.restEnd = 0; updateRestDisplay(); });
  $('restAdd').addEventListener('click', () => { if (ui.restEnd) { ui.restEnd += 30000; } else startRest(30); });
  document.addEventListener('click', e => {
    const m = e.target.closest && e.target.closest('[data-calmode]'); if (m) { prefs.calMode = m.dataset.calmode; savePrefs(); renderHome(); return; }
    const r = e.target.closest && e.target.closest('[data-range]'); if (r) { prefs.chartDays = Number(r.dataset.range); savePrefs(); renderWeight(); return; }
    const c = e.target.closest && e.target.closest('svg.chart circle[data-d]');
    if (c) { const id = c.ownerSVGElement.id === 'progressChart' ? 'readoutProg' : 'readoutHome'; $(id).textContent = dayLabel(c.dataset.d) + ': ' + c.dataset.w + ' kg · smoothed trend ' + c.dataset.t + ' kg'; }
  });
  $('quickWater').addEventListener('click', () => { data.waterMl[today()] = (Number(data.waterMl[today()]) || 0) + 250; persist(); renderAll(); toast('250 ml water logged.'); });
  $('themeSel').addEventListener('change', e => { prefs.theme = e.target.value; savePrefs(); applyTheme(); });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('restSecs').addEventListener('change', e => { prefs.restSecs = Number(e.target.value) || 90; savePrefs(); });
  $('planLevel').addEventListener('change', e => { prefs.planLevel = e.target.value; savePrefs(); renderTraining(); });
  $('planEquipment').addEventListener('change', e => { prefs.planEquipment = e.target.value; savePrefs(); renderTraining(); });

  $('finishSession').addEventListener('click', () => {
    if (!draft) return;
    const recs = [];
    for (const ex of draft.exercises) {
      const done = ex.rows.filter(r => r.done);
      if (!done.length) continue;
      const timed = C.parseRange(ex.range).time;
      const log = done.map(r => ({ reps: Math.max(0, Math.round(Number(r.reps) || 0)), weight: Math.max(0, Number(r.load) || 0) }));
      const rec = { id: uid(), date: draft.date, name: exName(ex), sets: log.length, reps: Math.round(log.reduce((s, t) => s + t.reps, 0) / log.length), weight: Math.max.apply(null, log.map(t => t.weight)), rpe: Number(ex.rpe) || 7, notes: '', session: draft.title, setLog: log };
      if (timed) rec.timed = true;
      if (!C.validWorkout(rec)) { toast('One of the sets has an invalid number. Check reps and loads.'); return; }
      recs.push(rec);
    }
    if (!recs.length) { toast('Tick at least one completed set (○) before finishing.'); return; }
    data.workouts.push.apply(data.workouts, recs);
    draft = null; saveDraft(); clearInterval(ui.restTimer); ui.restEnd = 0;
    persist(); renderAll(); toast('Session saved — ' + recs.length + ' exercise' + (recs.length === 1 ? '' : 's') + '. Nice work.');
  });
  $('discardSession').addEventListener('click', () => {
    if (!draft) return;
    if (!confirm('Discard this session? Sets you ticked will not be saved.')) return;
    draft = null; saveDraft(); clearInterval(ui.restTimer); ui.restEnd = 0; renderAll();
  });

  $('exerciseForm').addEventListener('submit', e => {
    e.preventDefault();
    const x = { id: uid(), date: today(), name: $('workoutName').value.trim(), sets: num($('exerciseSets').value), reps: num($('exerciseReps').value), weight: num($('exerciseWeight').value), rpe: num($('exerciseRpe').value), notes: $('workoutNotes').value.trim() };
    if (!C.validWorkout(x)) { toast('Check the exercise details.'); return; }
    data.workouts.push(x); persist(); e.target.reset();
    $('exerciseSets').value = 3; $('exerciseReps').value = 10; $('exerciseWeight').value = 0; $('exerciseRpe').value = 7; renderAll(); toast('Exercise saved.');
  });
  $('cardioForm').addEventListener('submit', e => {
    e.preventDefault();
    const c = { id: uid(), date: today(), kind: $('cardioKind').value, minutes: num($('cardioMin').value), rpe: num($('cardioRpe').value) };
    if (!C.validCardio(c)) { toast('Check minutes (1–600) and effort (1–10).'); return; }
    data.cardio.push(c); persist(); renderAll(); toast('Cardio saved.');
  });

  /* ================= progress insights ================= */
  function renderInsights() {
    const t = today(), d7 = C.addDays(t, -6), d28 = C.addDays(t, -27);
    const w7 = data.workouts.filter(x => x.date >= d7 && x.date <= t);
    $('weeklySessions').textContent = new Set(w7.map(x => x.date)).size;
    $('weeklySessionsCaption').textContent = w7.length + ' exercise logs';
    $('weeklyReps').textContent = fmt(w7.reduce((s, x) => s + C.totalReps(x), 0));
    $('weeklyVolume').textContent = fmt(w7.reduce((s, x) => s + C.volume(x), 0));
    $('weeklyFoodDays').textContent = new Set(data.foods.filter(x => x.date >= d7 && x.date <= t).map(x => x.date)).size;
    const weeks = [];
    for (let i = 5; i >= 0; i--) {
      const end = C.addDays(t, -i * 7), begin = C.addDays(end, -6);
      const rows = data.workouts.filter(x => x.date >= begin && x.date <= end);
      weeks.push({ label: i === 0 ? 'This wk' : begin.slice(5), value: Math.round(rows.reduce((s, x) => s + C.volume(x), 0)) });
    }
    const max = Math.max(1, Math.max.apply(null, weeks.map(w => w.value))), base = 142;
    $('trainingVolumeChart').innerHTML = weeks.map((x, i) => { const bh = x.value / max * 105, xx = 18 + i * 61; return '<rect x="' + xx + '" y="' + (base - bh) + '" width="36" height="' + bh + '" rx="5" class="ch-bar" opacity="' + (i === 5 ? 1 : 0.65) + '"><title>' + esc(x.label) + ': ' + fmt(x.value) + ' kg·reps</title></rect><text x="' + (xx + 18) + '" y="' + (base - bh - 5) + '" text-anchor="middle" class="ch-txt" font-size="10">' + (x.value ? fmt(x.value) : '') + '</text><text x="' + (xx + 18) + '" y="' + (base + 15) + '" text-anchor="middle" class="ch-txt" font-size="10">' + esc(x.label) + '</text>'; }).join('') + '<line x1="12" y1="' + base + '" x2="390" y2="' + base + '" class="ch-grid"/>';
    $('trainingVolumeChart').setAttribute('aria-label', 'Weekly load volume for the last 6 weeks: ' + weeks.map(w => w.label + ' ' + w.value).join(', '));
    const groups = {};
    data.workouts.forEach(x => { (groups[x.name.toLowerCase()] = groups[x.name.toLowerCase()] || []).push(x); });
    const trends = Object.values(groups).filter(a => a.length >= 2).map(a => { a.sort((p, q) => p.date.localeCompare(q.date)); return { name: a[a.length - 1].name, first: a[0], last: a[a.length - 1], n: a.length }; }).sort((p, q) => q.last.date.localeCompare(p.last.date)).slice(0, 6);
    $('exerciseTrends').innerHTML = trends.length ? trends.map(x => {
      const bl = Math.max.apply(null, C.setsOf(x.last).map(s => s.weight)), fl = Math.max.apply(null, C.setsOf(x.first).map(s => s.weight));
      const br = Math.max.apply(null, C.setsOf(x.last).map(s => s.reps)), fr = Math.max.apply(null, C.setsOf(x.first).map(s => s.reps));
      const change = bl > 0 ? (bl - fl >= 0 ? '+' : '') + round1(bl - fl) + ' kg' : (br - fr >= 0 ? '+' : '') + (br - fr) + (x.last.timed ? ' s' : ' reps');
      return '<div class="dayrow"><span><strong>' + esc(x.name) + '</strong> <span class="muted">· ' + x.n + ' logs since ' + esc(x.first.date) + '</span></span><strong>' + change + '</strong></div>';
    }).join('') : '<div class="empty">Log the same exercise twice or more to see how it changes.</div>';
    const trainDays = new Set(data.workouts.filter(x => x.date >= d28 && x.date <= t).map(x => x.date)).size;
    const foodDays = new Set(data.foods.filter(x => x.date >= d28 && x.date <= t).map(x => x.date)).size;
    const cardio = data.cardio.filter(x => x.date >= d28 && x.date <= t).reduce((s, x) => s + x.minutes, 0);
    $('consistencySummary').textContent = 'In the last 28 days you logged training on ' + trainDays + ' days, food on ' + foodDays + ' days, and ' + cardio + ' minutes of cardio. This records what you entered; it can\'t confirm complete food intake or completed workouts.';
  }

  function dietIdea(remaining) {
    remaining = Math.max(remaining, 30);
    const d = data.profile.diet;
    if (d === 'nonvegetarian') return 'for example ' + Math.min(250, Math.max(100, Math.round(remaining / 31 * 100 / 50) * 50)) + ' g cooked chicken breast (' + Math.round(Math.min(250, Math.max(100, Math.round(remaining / 31 * 100 / 50) * 50)) * 0.31) + ' g protein) or 3 eggs (about 19 g)';
    if (d === 'eggetarian' || d === 'flexible') return 'for example eggs (6 g each), curd, paneer (18 g per 100 g) or dal';
    if (d === 'vegan') return 'for example soya chunks (about 16 g per 30 g dry), dal, or chickpeas';
    return 'for example paneer (18 g per 100 g), curd, dal or soya chunks';
  }
  function renderReview() {
    const r = C.weeklyReview(data, today()), p = data.profile, rows = [];
    rows.push(['Food logged', r.loggedDays + ' of 7 days', r.loggedDays >= 5 ? 'ok' : 'warn']);
    rows.push(['Average intake (logged days)', r.avgKcal === null ? '—' : fmt(r.avgKcal) + ' kcal vs ' + fmt(p.calories) + ' target', '']);
    rows.push(['Protein', r.avgProtein === null ? '—' : fmt(r.avgProtein) + ' g avg · target reached on ' + r.proteinDays + ' of ' + r.loggedDays + ' logged days', '']);
    rows.push(['Training', r.sessions + ' day' + (r.sessions === 1 ? '' : 's') + ' (aim ' + r.planned + ')' + (r.cardioMin ? ' + ' + r.cardioMin + ' min cardio' : ''), '']);
    rows.push(['Weight trend', r.rate === null ? 'not enough weigh-ins yet' : rateText(r.rate) + ' kg/week', '']);
    if (r.waistChange !== null) rows.push(['Waist', (r.waistChange > 0 ? '+' : '') + r.waistChange + ' cm vs a week or more ago', '']);
    const notes = [];
    if (r.loggedDays < 5) notes.push('Only ' + r.loggedDays + ' days were logged, so intake numbers may under-report. Log most days before drawing conclusions.');
    if (r.loggedDays >= 3 && r.proteinDays < Math.ceil(r.loggedDays / 2)) notes.push('Protein reached target on fewer than half your logged days. A protein anchor at each meal helps — ' + dietIdea(p.protein - (r.avgProtein || 0)) + '.');
    if (r.sessions < r.planned) notes.push('You trained ' + r.sessions + ' of ' + r.planned + ' planned days. A short session still counts — consistency beats perfection.');
    if (r.rate !== null) {
      if ((p.goal === 'lose' || p.goal === 'recomp') && r.rate < -0.9) notes.push('Weight is falling faster than the 0.25–0.75 kg/week review band. If energy, sleep or lifts are slipping, consider eating a little more.');
      else if ((p.goal === 'lose' || p.goal === 'recomp') && r.rate > -0.1) notes.push('Weight is flat or rising. For a recomposition that can be fine — check waist and strength too. See the target check below.');
      else if (p.goal === 'lose' || p.goal === 'recomp') notes.push('Your rate is close to the review band. Keep going.');
    }
    if (!notes.length) notes.push('Nothing to flag this week. Keep logging and training consistently.');
    $('weeklyReview').innerHTML = '<div class="daylist">' + rows.map(([l, v, c]) => '<div class="dayrow"><span>' + l + '</span><strong' + (c === 'warn' ? ' style="color:var(--orange)"' : '') + '>' + esc(v) + '</strong></div>').join('') + '</div><h4>Things to consider</h4><div class="list">' + notes.map(n => '<div class="note">' + esc(n) + '</div>').join('') + '</div>';
    // mini on Home
    $('weekMini').innerHTML = [['Food logged', r.loggedDays + '/7 days'], ['Training days', r.sessions + ' of ' + r.planned], ['Weight rate', r.rate === null ? 'building…' : rateText(r.rate) + ' kg/wk']].map(([l, v]) => '<div class="dayrow"><span>' + l + '</span><strong>' + v + '</strong></div>').join('');
  }
  function renderExpenditure() {
    const e = C.expenditure(data, today()), pill = $('expPill');
    pill.textContent = e.eligible ? (e.confidence === 'good' ? 'Estimate · good data' : 'Estimate · rough') : 'Building…';
    let h;
    if (!e.eligible) {
      const pc = (a, b) => Math.min(100, Math.round(a / b * 100));
      h = '<div class="note">' + esc(e.reason) + '</div>' +
        '<div class="macroline" style="margin-top:10px"><span>Food days</span><div class="bar"><span style="width:' + pc(e.completeDays, e.needDays) + '%"></span></div><strong>' + e.completeDays + ' / ' + e.needDays + '</strong></div>' +
        '<div class="macroline" style="margin-top:8px"><span>Weigh-ins</span><div class="bar carbs"><span style="width:' + pc(e.weighIns, e.needWeighIns) + '%"></span></div><strong>' + e.weighIns + ' / ' + e.needWeighIns + '</strong></div>';
      if (e.formula) h += '<p class="sub" style="margin-top:10px">For comparison, a standard formula suggests about ' + fmt(e.formula) + ' kcal/day for your profile. That is a population average, not you.</p>';
    } else {
      h = '<div class="big">~' + fmt(e.kcal) + ' <span class="unit">kcal/day</span></div><p class="sub">±' + fmt(e.uncertainty) + ' kcal statistical uncertainty from weigh-in noise, before any logging error.</p>' +
        '<div class="note" style="margin-top:10px">' + esc(e.reason) + '</div>' +
        (e.formula ? '<p class="sub" style="margin-top:10px">A standard formula suggests ~' + fmt(e.formula) + ' kcal/day. Your own logs are usually a better guide if you log most food and weigh regularly.</p>' : '') +
        '<p class="sub">This is information only. It never changes your targets.</p>';
    }
    $('expBody').innerHTML = h;
  }
  function renderTargetCheck() {
    const s = C.targetSuggestion(data, today()), hist = data.targetHistory, last = hist[hist.length - 1];
    let html = '<div class="note warn">An experimental heuristic, not a validated model. It only suggests, never changes your targets by itself, caps changes at ±150 kcal, and stays quiet when your data is thin or noisy.</div><div style="height:10px"></div>';
    html += '<div class="note ' + (s.eligible && s.delta ? '' : '') + '">' + esc(s.reason) + '</div>';
    if (s.eligible && s.delta) {
      const np = C.applyDelta(data.profile, s.delta);
      html += '<p><strong>Suggestion:</strong> ' + fmt(data.profile.calories) + ' → ' + fmt(np.calories) + ' kcal (' + (s.delta > 0 ? '+' : '') + s.delta + '), carbs ' + data.profile.carbs + ' → ' + np.carbs + ' g; protein and fat unchanged.</p><div class="actions"><button class="btn" data-action="apply-target" data-delta="' + s.delta + '">Apply this change</button></div>';
    }
    if (last) html += '<p class="sub" style="margin-top:10px">Last change: ' + fmt(last.from) + ' → ' + fmt(last.to) + ' kcal on ' + esc(last.date) + '. <button class="btn secondary small" data-action="revert-target">Undo that change</button></p>';
    $('targetCheck').innerHTML = html;
  }

  /* ================= home ================= */
  function nextStep() {
    const t = today(), p = data.profile, tot = C.totals(foodsOn(t)), hour = new Date().getHours(), ws = C.weightSummary(data.weights, t);
    if (draft) return 'You have a session in progress (' + draft.title + '). Finish it when you\'re done — your sets are saved as you go.';
    if (!p.onboardingComplete) return 'Confirm your profile in Growth (about a minute) so training and trends match you.';
    if (!foodsOn(t).length) return 'Log what you\'ve eaten so far today — start with your most recent meal.';
    if (ws.seedOnly || ws.count === 0) return 'Log a weigh-in to start your trend. Same time of day (e.g. mornings) works best.';
    const remaining = p.protein - tot.p;
    if (hour >= 15 && remaining >= 30) return Math.round(remaining) + ' g protein to go today — ' + dietIdea(remaining) + '.';
    const titles = C.sessionTitles(PLANS[planLevel()]);
    if (C.plannedDays(p.sessionsPerWeek).includes(new Date().getDay()) && !data.workouts.some(w => w.date === t)) return 'Today is a planned training day: ' + C.nextSession(titles, data.workouts) + '. A short session still counts.';
    const lastW = ws.series[ws.series.length - 1];
    if (lastW && C.daysBetween(lastW.date, t) >= 3) return 'It\'s been ' + C.daysBetween(lastW.date, t) + ' days since your last weigh-in. Weigh in tomorrow morning if you can.';
    return 'You\'re on track for today. Sleep and rest are part of the plan.';
  }
  const homeDay = () => (ui.homeDate && ui.homeDate <= today() ? ui.homeDate : today());
  function renderWeekStrip(sel) {
    const t = today(), tg = data.profile.calories || 1;
    let out = '';
    for (let i = 6; i >= 0; i--) {
      const d = C.addDays(t, -i), k = C.totals(foodsOn(d)).kcal, pct = Math.min(100, Math.round(k / tg * 100)), dt = new Date(d + 'T12:00:00');
      out += '<button type="button" class="wday' + (d === sel ? ' sel' : '') + '" data-action="pick-day" data-date="' + d + '" aria-pressed="' + (d === sel) + '" aria-label="' + esc(dayLabel(d)) + ', ' + fmt(k) + ' kcal logged"><small>' + dt.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) + '</small><span class="wring" style="--p:' + pct + '%"><b>' + dt.getDate() + '</b></span></button>';
    }
    $('weekStrip').innerHTML = out;
  }
  function renderHome() {
    const t = today(), hdd = homeDay(), p = data.profile, tot = C.totals(foodsOn(hdd));
    const h = new Date().getHours();
    renderWeekStrip(hdd);
    $('homeDayTitle').textContent = hdd === t ? "Today's nutrition" : dayLabel(hdd) + ' nutrition';
    $('homeFoodTitle').textContent = hdd === t ? "Today's food" : 'Food on ' + dayLabel(hdd);
    document.querySelectorAll('[data-calmode]').forEach(b => { const on = b.dataset.calmode === (prefs.calMode === 'eaten' ? 'eaten' : 'left'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('greeting').textContent = ((h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (p.name ? ', ' + p.name : '')).toUpperCase();
    $('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    $('profileSummary').textContent = p.onboardingComplete ? p.age + ' y · ' + p.heightCm + ' cm · ' + p.experience + ' · ' + p.sessionsPerWeek + ' training days/week' : 'Starter plan loaded — confirm your profile in Growth.';
    $('onboardBanner').classList.toggle('hidden', !!p.onboardingComplete);
    $('goalLabel').textContent = 'Goal: ' + ({ maintain: 'maintain', lose: 'fat loss', gain: 'gain', recomp: 'recomposition' }[p.goal]);
    const pct = (n, d) => Math.max(0, Math.min(100, d ? n / d * 100 : 0));
    const left = p.calories - tot.kcal, ring = $('calRing');
    ring.style.setProperty('--progress', pct(tot.kcal, p.calories) + '%'); ring.classList.toggle('over', left < 0);
    if (prefs.calMode === 'eaten') { $('calRemain').textContent = fmt(tot.kcal); $('calUnit').textContent = 'of ' + fmt(p.calories) + ' kcal'; }
    else { $('calRemain').textContent = fmt(Math.abs(left)); $('calUnit').textContent = left < 0 ? 'kcal over' : 'kcal left'; }
    ring.setAttribute('aria-label', fmt(tot.kcal) + ' of ' + fmt(p.calories) + ' calories eaten; ' + fmt(Math.abs(left)) + (left < 0 ? ' over' : ' remaining'));
    [['protein', tot.p, p.protein], ['carbs', tot.c, p.carbs], ['fat', tot.f, p.fat]].forEach(([k, n, d]) => { $(k + 'Bar').style.width = pct(n, d) + '%'; $(k + 'Text').textContent = round1(n) + ' / ' + d + ' g'; });
    $('quickChipsHome').innerHTML = quickFoods().slice(0, 6).map(f => '<button type="button" class="chip" data-action="add-food" data-scope="home" data-id="' + esc(f.id) + '">' + esc(f.emoji + ' ' + shortName(f)) + '</button>').join('');
    $('quickbarChips').innerHTML = quickFoods().slice(0, 3).map(f => '<button type="button" class="qb" data-action="add-food" data-scope="home" data-id="' + esc(f.id) + '" aria-label="Add ' + esc(shortName(f)) + '">' + esc(f.emoji) + '</button>').join('');
    $('waterText').textContent = ((data.waterMl[t] || 0) / 1000).toFixed(2) + ' L today';
    // training card
    const plan = PLANS[planLevel()], titles = C.sessionTitles(plan), next = C.nextSession(titles, data.workouts);
    const planned = C.plannedDays(p.sessionsPerWeek).includes(new Date().getDay()), todays = data.workouts.filter(w => w.date === t);
    $('trainPill').textContent = todays.length ? 'Trained today' : planned ? 'Planned day' : 'Rest / optional';
    const day = plan.days.find(d => d.title === next && d.items);
    let ht;
    if (draft) ht = '<div class="note"><strong>Session in progress:</strong> ' + esc(draft.title) + '</div><div class="actions" style="margin-top:10px"><button class="btn" data-go="workout">Continue session</button></div>';
    else if (todays.length) ht = '<div class="list">' + todays.slice(0, 4).map(x => '<div class="dayrow"><span>' + esc(x.name) + '</span><strong>' + x.sets + ' sets</strong></div>').join('') + '</div><div class="actions" style="margin-top:10px"><button class="btn secondary small" data-go="workout">Open training</button></div>';
    else ht = '<p style="margin:0 0 8px"><strong>' + esc(next) + '</strong> is next up.</p>' + (day ? '<div class="list">' + day.items.slice(0, 4).map(it => '<div class="dayrow"><span>' + esc(planEquip() === 'gym' ? it.gym : it.home) + '</span><span class="muted">' + it.sets + ' × ' + esc(it.range) + '</span></div>').join('') + '</div>' : '') + '<div class="actions" style="margin-top:12px"><button class="btn" data-action="start-session" data-title="' + esc(next) + '">Start ' + esc(next) + '</button></div>';
    $('homeTraining').innerHTML = ht;
    renderWeight();
    $('nextStep').textContent = nextStep();
    renderReview();
    const todayFood = foodsOn(hdd);
    $('recentFoods').innerHTML = todayFood.length ? todayFood.slice().reverse().slice(0, 6).map(x => foodRow(x, true)).join('') : '<div class="empty">' + (hdd === t ? 'Nothing logged yet today. Tap a quick-add chip above to start.' : 'Nothing logged on this day.') + '</div>';
    // backup nudge
    const hasData = data.foods.length + data.workouts.length + data.weights.filter(w => w.source !== 'profile').length > 0;
    const lb = data.meta.lastBackupAt, stale = !lb || C.daysBetween(localDay(lb), t) > 14;
    const bn = $('backupNote');
    bn.classList.toggle('hidden', !(hasData && stale));
    bn.innerHTML = 'Your data lives only in this browser. ' + (lb ? 'Last backup: ' + esc(localDay(lb)) + '.' : 'You haven\'t made a backup yet.') + ' <button class="btn secondary small" data-action="export-backup" style="margin-left:6px">Back up now</button>';
  }

  /* ================= settings ================= */
  function fillSettings() {
    const p = data.profile;
    $('profileAge').value = p.age == null ? '' : p.age; $('profileHeight').value = p.heightCm == null ? '' : p.heightCm; $('profileCurrentWeight').value = p.currentWeight == null ? '' : p.currentWeight;
    $('profileActivity').value = p.activity; $('profileExperience').value = p.experience; $('profileEquipment').value = p.equipment; $('profileDiet').value = p.diet; $('profileSessions').value = String(p.sessionsPerWeek);
    $('profileStatus').textContent = p.onboardingComplete ? 'Profile saved' : 'Starter values — please confirm'; $('profileStatus').className = 'pill ' + (p.onboardingComplete ? 'ok' : 'warn');
    $('profileName').value = p.name || ''; $('profileGoal').value = p.goal; $('targetCalories').value = p.calories; $('targetProtein').value = p.protein; $('targetCarbs').value = p.carbs; $('targetFat').value = p.fat;
    updateMacroCheck();
    $('versionPill').textContent = 'v' + C.VERSION;
    const lb = data.meta.lastBackupAt; $('lastBackup').textContent = lb ? 'Last backup: ' + localDay(lb) : 'No backup yet — a full copy you can restore later.';
    refreshStorageNote();
  }
  function updateMacroCheck() {
    const m = C.macroCheck(num($('targetCalories').value), num($('targetProtein').value) || 0, num($('targetCarbs').value) || 0, num($('targetFat').value) || 0), el = $('macroCheckNote');
    el.className = 'note' + (m.level === 'block' ? ' bad' : m.level === 'warn' ? ' warn' : '');
    el.textContent = 'Macros add up to about ' + m.estimate + ' kcal. ' + (m.level === 'ok' ? 'That matches your calorie target.' : m.level === 'warn' ? 'That differs by ' + m.diffPct + '% from your calories — fine if intentional.' : 'That differs by ' + m.diffPct + '% from your calories. Fix this before saving.');
  }
  ['targetCalories', 'targetProtein', 'targetCarbs', 'targetFat'].forEach(id => $(id).addEventListener('input', updateMacroCheck));
  function refreshStorageNote() {
    const base = 'Your entries stay in this browser and are not encrypted. Anyone with access to this browser profile could read them. Clearing site data erases them — export a backup regularly.';
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(ok => { $('storageNote').textContent = base + ' Storage protection from automatic clean-up: ' + (ok ? 'granted.' : 'not granted (the browser may clear it if space runs low).'); }).catch(() => { $('storageNote').textContent = base; });
    else $('storageNote').textContent = base;
    // storage meter: size of our own data vs a conservative ~5 MB browser limit
    let bytes = 0; try { bytes = (safeGet(KEY) || '').length * 2; } catch (e) { /* ignore */ }
    const pct = Math.min(100, bytes / (5 * 1024 * 1024) * 100), kb = bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
    $('storageMeter').classList.remove('hidden');
    $('storageMeterText').textContent = 'Data stored: ' + kb + ' of roughly 5 MB available' + (pct > 70 ? ' — getting full. Export a backup and consider clearing old entries.' : '.');
    $('storageMeterBar').style.width = Math.max(1, pct) + '%'; $('storageMeterBar').parentNode.classList.toggle('warn', pct > 70);
  }
  $('personalProfileForm').addEventListener('submit', e => {
    e.preventDefault();
    const next = { age: num($('profileAge').value), heightCm: num($('profileHeight').value), currentWeight: num($('profileCurrentWeight').value), activity: $('profileActivity').value, experience: $('profileExperience').value, equipment: $('profileEquipment').value, diet: $('profileDiet').value, sessionsPerWeek: Number($('profileSessions').value) };
    const ok = Number.isInteger(next.age) && next.age >= 13 && next.age <= 100 && next.heightCm >= 100 && next.heightCm <= 250 && next.currentWeight >= 25 && next.currentWeight <= 350 &&
      ['sedentary', 'light', 'moderate', 'high'].includes(next.activity) && ['beginner', 'intermediate', 'advanced'].includes(next.experience) && ['home', 'gym', 'both'].includes(next.equipment) &&
      ['flexible', 'vegetarian', 'vegan', 'eggetarian', 'nonvegetarian'].includes(next.diet) && [2, 3, 4, 5, 6].includes(next.sessionsPerWeek);
    if (!ok) { toast('Check your profile values and try again.'); return; }
    data.profile = Object.assign({}, data.profile, next, { onboardingComplete: true });
    const seeds = data.weights.filter(w => w.source === 'profile'), real = data.weights.filter(w => w.source !== 'profile');
    if (!real.length) { data.weights = [{ id: uid(), date: today(), weight: next.currentWeight, waist: null, source: 'profile' }]; }
    prefs.planLevel = next.experience; prefs.planEquipment = next.equipment === 'gym' ? 'gym' : 'home'; savePrefs();
    persist(); renderAll(); toast('Profile saved.');
  });
  $('settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    const p = { name: $('profileName').value.trim(), goal: $('profileGoal').value, calories: num($('targetCalories').value), protein: num($('targetProtein').value), carbs: num($('targetCarbs').value), fat: num($('targetFat').value) };
    const inR = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
    if (!inR(p.calories, 800, 7000) || !inR(p.protein, 0, 500) || !inR(p.carbs, 0, 1000) || !inR(p.fat, 0, 500) || !C.GOALS.includes(p.goal)) { toast('Targets are outside the allowed ranges.'); return; }
    const m = C.macroCheck(p.calories, p.protein, p.carbs, p.fat);
    if (m.level === 'block') { toast('Your macros add up to ' + m.estimate + ' kcal, which contradicts ' + p.calories + ' kcal. Adjust them first.'); return; }
    data.profile = Object.assign({}, data.profile, p);          // merge — never replace — so profile details survive
    persist(); renderAll(); toast('Goal and targets saved.');
  });
  $('resetPlan').addEventListener('click', () => {
    mutate(['profile'], 'Targets reset to your starter plan.', () => { const d = C.defaultProfile(); Object.assign(data.profile, { goal: d.goal, calories: d.calories, protein: d.protein, carbs: d.carbs, fat: d.fat }); });
    fillSettings();
  });

  /* ---- export / import ---- */
  function download(name, mime, text) {
    const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([text], { type: mime }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportBackup() {
    data.meta.lastBackupAt = new Date().toISOString(); data.meta.appVersion = C.VERSION; persist();
    download('fitwise-backup-' + today() + '.json', 'application/json', JSON.stringify(Object.assign({}, data, { exportedAt: new Date().toISOString() }), null, 2));
    renderAll(); toast('Backup downloaded.');
  }
  $('exportBtn').addEventListener('click', exportBackup);
  $('csvFood').addEventListener('click', () => {
    const rows = data.foods.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => ({ date: x.date, meal: x.meal || '', food: x.name, grams: round1(C.grams(x)), servings: x.qty, kcal: round1(x.kcal * x.qty), protein_g: round1(x.p * x.qty), carbs_g: round1(x.c * x.qty), fat_g: round1(x.f * x.qty) }));
    download('fitwise-food-' + today() + '.csv', 'text/csv', '﻿' + C.toCSV(['date', 'meal', 'food', 'grams', 'servings', 'kcal', 'protein_g', 'carbs_g', 'fat_g'], rows)); toast('Food CSV downloaded.');
  });
  $('csvWeight').addEventListener('click', () => {
    const rows = data.weights.filter(w => w.source !== 'profile').map(x => ({ date: x.date, weight_kg: x.weight, waist_cm: x.waist == null ? '' : x.waist }));
    download('fitwise-weight-' + today() + '.csv', 'text/csv', '﻿' + C.toCSV(['date', 'weight_kg', 'waist_cm'], rows)); toast('Weight CSV downloaded.');
  });
  $('csvWorkout').addEventListener('click', () => {
    const rows = []; data.workouts.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(x => C.setsOf(x).forEach((s, i) => rows.push({ date: x.date, session: x.session || '', exercise: x.name, set: i + 1, reps_or_seconds: s.reps, load_kg: s.weight, rpe: x.rpe })));
    download('fitwise-workouts-' + today() + '.csv', 'text/csv', '﻿' + C.toCSV(['date', 'session', 'exercise', 'set', 'reps_or_seconds', 'load_kg', 'rpe'], rows)); toast('Workout CSV downloaded.');
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  /* passphrase prompt: resolves with the passphrase, or null if cancelled */
  function askPass(title, info, confirm2) {
    return new Promise(resolve => {
      $('passTitle').textContent = title; $('passInfo').textContent = info; $('passInput').value = ''; $('passInput2').value = '';
      $('passConfirmRow').classList.toggle('hidden', !confirm2); $('passInput2').required = !!confirm2; $('passError').classList.add('hidden');
      const dlg = $('passDialog'), form = $('passForm'); let done = false;
      const finish = v => { if (done) return; done = true; form.removeEventListener('submit', onSubmit); $('passCancel').removeEventListener('click', onCancel); dlg.removeEventListener('close', onCancel); if (dlg.open) dlg.close(); resolve(v); };
      const onSubmit = e => {
        e.preventDefault(); const v = $('passInput').value;
        if (v.length < 8) { $('passError').textContent = 'Use at least 8 characters.'; $('passError').classList.remove('hidden'); return; }
        if (confirm2 && v !== $('passInput2').value) { $('passError').textContent = 'The two passphrases do not match.'; $('passError').classList.remove('hidden'); return; }
        finish(v);
      };
      const onCancel = () => finish(null);
      form.addEventListener('submit', onSubmit); $('passCancel').addEventListener('click', onCancel); dlg.addEventListener('close', onCancel);
      dlg.showModal(); $('passInput').focus();
    });
  }
  $('exportEncBtn').addEventListener('click', async () => {
    if (!V.available()) { toast('Encryption is not available in this browser (it needs a secure https:// or localhost page).'); return; }
    const pass = await askPass('Encrypt backup', 'Choose a passphrase of 8+ characters. Write it down somewhere safe: without it the backup cannot be opened.', true);
    if (!pass) return;
    try {
      data.meta.lastBackupAt = new Date().toISOString(); data.meta.appVersion = C.VERSION; persist();
      const enc = await V.encrypt(JSON.stringify(Object.assign({}, data, { exportedAt: new Date().toISOString() })), pass);
      download('fitwise-backup-' + today() + '.encrypted.json', 'application/json', JSON.stringify(enc));
      renderAll(); toast('Encrypted backup downloaded.');
    } catch (err) { toast('Could not encrypt the backup.'); }
  });
  $('importFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('too large');
      let incoming = JSON.parse(await file.text());
      if (V.isEncrypted(incoming)) {
        if (!V.available()) throw new Error('nocrypto');
        const pass = await askPass('Encrypted backup', 'Enter the passphrase used when this backup was created.', false);
        if (!pass) return;
        try { incoming = JSON.parse(await V.decrypt(incoming, pass)); }
        catch (err) { toast('Wrong passphrase, or the file was changed. Your data was not changed.'); return; }
      }
      if (!C.validateBackup(incoming)) throw new Error('invalid');
      if (!confirm('Replace the data on this device with this backup? A safety copy of your current data is kept in this browser.')) return;
      const before = safeGet(KEY); if (before) safeSet(KEY + '-before-import', before);
      const candidate = C.sanitize(C.normalize(incoming));
      if (!safeSet(KEY, JSON.stringify(candidate))) throw new Error('storage');
      data = candidate; renderAll(); fillSettings(); toast('Backup imported.');
    } catch (err) { toast('Import failed: that is not a valid FITWISE backup, or storage is unavailable. Your data was not changed.'); }
    finally { e.target.value = ''; }
  });
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('Delete ALL FITWISE data in this browser? This cannot be undone.')) return;
    data = C.normalize(null); draft = null; saveDraft(); persist(); renderAll(); fillSettings(); toast('All local data deleted.');
  });
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  $('installBtn').addEventListener('click', async () => {
    if (installPrompt) { installPrompt.prompt(); try { await installPrompt.userChoice; } catch (e) { /* ignore */ } installPrompt = null; }
    else toast('Use your browser menu → Install app / Add to Home screen. It needs HTTPS.');
  });
  $('waterBtn').addEventListener('click', () => { data.waterMl[today()] = (Number(data.waterMl[today()]) || 0) + 250; persist(); renderAll(); toast('250 ml water logged.'); });

  /* ================= delegated actions ================= */
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-tab],[data-go]');
    if (nav && !nav.dataset.action) { go(nav.dataset.tab || nav.dataset.go); return; }
    const el = e.target.closest('[data-action]'); if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    if (a === 'save-meal') {
      const items = foodsOn(ui.diaryDate).filter(x => (x.meal || 'other') === el.dataset.meal);
      if (!items.length) return;
      pendingMeal = { items, meal: el.dataset.meal };
      $('mealDlgInfo').textContent = items.length + ' item' + (items.length === 1 ? '' : 's') + ' · ' + fmt(C.totals(items).kcal) + ' kcal. Saved on this device; one tap logs it again.';
      $('mealName').value = MEAL_NAMES[el.dataset.meal] === 'Other' ? '' : 'My ' + MEAL_NAMES[el.dataset.meal].toLowerCase();
      $('mealDialog').showModal(); $('mealName').focus(); $('mealName').select(); return;
    }
    if (a === 'log-meal') {
      const m = data.savedMeals.find(v => v.id === id); if (!m) return;
      const meal = el.dataset.meal || suggestedMeal();
      mutate(['foods'], 'Logged ' + m.name + ' (' + fmt(C.totals(m.items).kcal) + ' kcal).', () => { m.items.forEach(i => data.foods.push(Object.assign({}, i, { id: uid(), date: ui.diaryDate, meal }))); });
      return;
    }
    if (a === 'del-meal') { const m = data.savedMeals.find(v => v.id === id); if (m) mutate(['savedMeals'], 'Deleted saved meal ' + m.name + '.', () => { data.savedMeals = data.savedMeals.filter(v => v.id !== id); }); return; }
    if (a === 'pick-day') { ui.homeDate = el.dataset.date === today() ? null : el.dataset.date; renderHome(); return; }
    if (a === 'quick-search') { ui.diaryDate = homeDay(); go('food'); setTimeout(() => { const s = $('foodSearch'); if (s) s.focus(); }, 60); return; }
    if (a === 'add-food') { const f = foodById(id); if (f) openFoodDialog(f, { date: el.dataset.scope === 'home' ? homeDay() : ui.diaryDate }); }
    else if (a === 'edit-food') { const x = data.foods.find(v => v.id === id); if (x) openFoodDialog({ id: x.foodId || x.id, name: x.name, emoji: x.emoji || '🍽️', serving: x.serving, unit: (foodById(x.foodId) || {}).unit || x.serving + ' g serving', kcal: x.kcal, p: x.p, c: x.c, f: x.f }, { entry: x }); }
    else if (a === 'del-food') { const x = data.foods.find(v => v.id === id); if (x) mutate(['foods'], 'Removed ' + shortName(x) + '.', () => { data.foods = data.foods.filter(v => v.id !== id); }); }
    else if (a === 'del-custom') { const x = data.customFoods.find(v => v.id === id); if (x) mutate(['customFoods'], 'Removed ' + shortName(x) + ' from my foods (diary entries kept).', () => { data.customFoods = data.customFoods.filter(v => v.id !== id); }); }
    else if (a === 'group') { ui.group = el.dataset.group; ui.resultLimit = 10; renderFood(); }
    else if (a === 'more-results') { ui.resultLimit += 20; renderFood(); }
    else if (a === 'start-session') startSession(el.dataset.title);
    else if (a === 'toggle-set') {
      const r = draft.exercises[+el.dataset.ex].rows[+el.dataset.set]; r.done = !r.done; saveDraft(); renderSession();
      if (r.done) startRest(prefs.restSecs || 90);
      const again = document.querySelector('[data-action="toggle-set"][data-ex="' + el.dataset.ex + '"][data-set="' + el.dataset.set + '"]'); if (again) again.focus();
    }
    else if (a === 'add-set') { const ex = draft.exercises[+el.dataset.ex], last = ex.rows[ex.rows.length - 1]; if (ex.rows.length < 12) ex.rows.push({ reps: last ? last.reps : 10, load: last ? last.load : 0, done: false }); saveDraft(); renderSession(); }
    else if (a === 'del-set') { const ex = draft.exercises[+el.dataset.ex]; if (ex.rows.length > 1) ex.rows.pop(); saveDraft(); renderSession(); }
    else if (a === 'swap-ex') { const ex = draft.exercises[+el.dataset.ex]; if (ex.rows.some(r => r.done)) { toast('Finish or un-tick this exercise\'s sets before swapping.'); return; } ex.mode = ex.mode === 'gym' ? 'home' : 'gym'; fillRows(ex); saveDraft(); renderSession(); }
    else if (a === 'del-workout') { mutate(['workouts'], 'Exercise removed.', () => { data.workouts = data.workouts.filter(v => v.id !== id); }); }
    else if (a === 'del-weight') { mutate(['weights'], 'Measurement removed.', () => { data.weights = data.weights.filter(v => v.id !== id); }); }
    else if (a === 'del-cardio') { mutate(['cardio'], 'Cardio entry removed.', () => { data.cardio = data.cardio.filter(v => v.id !== id); }); }
    else if (a === 'more-history') { ui.histDays += 10; renderTraining(); }
    else if (a === 'export-backup') exportBackup();
    else if (a === 'apply-target') {
      const delta = Number(el.dataset.delta), s = C.targetSuggestion(data, today());
      if (!s.eligible || s.delta !== delta) { toast('That suggestion is no longer current.'); renderAll(); return; }
      const from = data.profile.calories, np = C.applyDelta(data.profile, delta);
      data.profile = np; data.targetHistory.push({ date: today(), from, to: np.calories, carbsBefore: np.carbs - Math.round(delta / 4), reason: s.reason });
      persist(); renderAll(); toast('Calories now ' + fmt(np.calories) + ' kcal.', { label: 'Undo', fn: revertTarget });
    }
    else if (a === 'revert-target') revertTarget();
  });
  function revertTarget() {
    const last = data.targetHistory.pop(); if (!last) return;
    data.profile = Object.assign({}, data.profile, { calories: last.from, carbs: last.carbsBefore }); persist(); renderAll(); toast('Target change undone.');
  }

  /* ================= render all ================= */
  function renderAll() {
    renderHome(); renderFood(); renderTraining(); renderInsights(); renderTargetCheck(); renderExpenditure(); fillSettingsIfVisible();
    $('measureDate').max = today(); if (!$('measureDate').value) $('measureDate').value = today();
    $('footLine').textContent = 'FITWISE v' + C.VERSION + ' · Free · Not a medical device · Food values are approximate · Data stays on this device';
  }
  function fillSettingsIfVisible() { if ($('settings').classList.contains('active') && !document.activeElement.closest('#settings form')) fillSettings(); else if (!$('settings').classList.contains('active')) fillSettings(); }

  /* ================= day rollover ================= */
  function checkRollover() {
    const t = today(); if (t === ui.today) return;
    if (ui.diaryDate === ui.today) ui.diaryDate = t;
    ui.today = t; $('measureDate').value = t; renderAll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkRollover(); updateRestDisplay(); } });
  setInterval(checkRollover, 60000);

  /* ================= service worker ================= */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      const had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('FITWISE was updated.', { label: 'Reload', fn: () => location.reload() }); });
    });
  }

  /* ================= init ================= */
  load();
  $('measureDate').value = today();
  updateMacroEnergyHint();
  registerSW();
  const startTab = location.hash.slice(1);
  show(TABS.includes(startTab) ? startTab : 'home');
  if (loadNote) toast(loadNote);
})();
