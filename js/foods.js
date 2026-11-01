/* FITWISE starter food catalogue — APPROXIMATE values, not a verified national database.
 * Each row: id, name, Hindi, emoji, serving grams, household unit, protein/carb/fat per 100 g, search tags, group.
 * Calories are derived from the macros (4/4/9) so every entry reconciles exactly; fibre is ignored, so energy can
 * read a few percent high for high-fibre foods. Home-cooked dishes vary a lot with oil and portion — weigh when it matters. */
(function (root) {
  'use strict';
  const ROWS = [
    // id, name, hindi, emoji, servingG, unit, p100, c100, f100, tags, group
    ['roti', 'Roti / chapati (plain, no oil)', 'रोटी / चपाती', '🫓', 40, '1 roti', 8.5, 51, 1.5, 'phulka chapati wheat', 'Breads & grains'],
    ['paratha', 'Paratha, plain (pan-fried)', 'पराठा', '🫓', 80, '1 paratha', 7, 45, 15, 'parantha', 'Breads & grains'],
    ['bread', 'Bread, brown (slice)', 'ब्रेड', '🍞', 30, '1 slice', 9, 45, 3.5, 'toast', 'Breads & grains'],
    ['rice', 'Rice, white, cooked', 'पका चावल', '🍚', 150, '1 katori', 2.7, 28.2, 0.3, 'chawal', 'Breads & grains'],
    ['brownrice', 'Rice, brown, cooked', 'ब्राउन राइस', '🍚', 150, '1 katori', 2.6, 23, 0.9, 'chawal', 'Breads & grains'],
    ['poha', 'Poha (prepared)', 'पोहा', '🍲', 150, '1 plate', 3.3, 28, 4.7, 'flattened rice breakfast', 'Breakfast'],
    ['upma', 'Upma (prepared)', 'उपमा', '🍲', 200, '1 bowl', 3.5, 22, 5, 'suji rava breakfast', 'Breakfast'],
    ['idli', 'Idli, steamed', 'इडली', '🍘', 40, '1 idli', 4.5, 30, 0.5, 'south indian breakfast', 'Breakfast'],
    ['dosa', 'Plain dosa (oil varies)', 'डोसा', '🥞', 100, '1 dosa', 4, 28, 4, 'south indian breakfast', 'Breakfast'],
    ['masaladosa', 'Masala dosa (potato filling)', 'मसाला डोसा', '🥞', 180, '1 dosa', 4.5, 27, 7, 'south indian breakfast', 'Breakfast'],
    ['oats', 'Oats, dry (rolled)', 'ओट्स', '🥣', 40, '½ cup dry', 13.2, 67.7, 6.5, 'oatmeal porridge', 'Breakfast'],
    ['khichdi', 'Moong dal khichdi', 'खिचड़ी', '🥘', 200, '1 bowl', 4, 17, 3, 'rice lentil', 'Meals'],
    ['biryani', 'Chicken biryani (restaurant style)', 'चिकन बिरयानी', '🍛', 300, '1 plate', 8, 25, 6, 'rice chicken', 'Meals'],

    ['dal', 'Dal, cooked (plain)', 'दाल', '🥣', 150, '1 katori', 7, 17.3, 2.1, 'lentil toor moong masoor', 'Pulses'],
    ['dal_tadka', 'Dal tadka (oil varies)', 'दाल तड़का', '🥘', 150, '1 katori', 6, 16.7, 6, 'lentil', 'Pulses'],
    ['rajma', 'Rajma curry', 'राजमा', '🥘', 150, '1 katori', 6.5, 14, 3, 'kidney beans', 'Pulses'],
    ['chole', 'Chole (chickpea curry)', 'छोले', '🥘', 150, '1 katori', 6.5, 16, 5, 'chana masala chickpea', 'Pulses'],
    ['chana', 'Chickpeas, boiled (plain)', 'उबले चने', '🫘', 100, '½ cup', 9, 27, 2.6, 'kala chana', 'Pulses'],
    ['sprouts', 'Moong sprouts', 'अंकुरित मूंग', '🌱', 100, '1 bowl', 7, 12, 0.5, 'sprouted', 'Pulses'],
    ['soya', 'Soya chunks, dry', 'सोया चंक्स', '🫘', 30, '1 handful dry', 51, 33, 3.3, 'nutrela meal maker protein', 'Pulses'],
    ['sambar', 'Sambar', 'सांबर', '🥣', 150, '1 katori', 3, 8, 2.5, 'south indian', 'Pulses'],

    ['milk', 'Milk, whole', 'दूध', '🥛', 200, '1 glass', 3.2, 4.8, 3.3, 'doodh', 'Dairy & eggs'],
    ['milk_toned', 'Milk, toned', 'टोन्ड दूध', '🥛', 200, '1 glass', 3, 4.7, 1.5, 'doodh', 'Dairy & eggs'],
    ['curd', 'Curd / plain yogurt', 'दही', '🥛', 100, '1 katori', 3.5, 4.7, 3.3, 'dahi', 'Dairy & eggs'],
    ['buttermilk', 'Buttermilk (chaas)', 'छाछ', '🥛', 200, '1 glass', 1.5, 2.5, 1, 'chaas lassi', 'Dairy & eggs'],
    ['paneer', 'Paneer', 'पनीर', '🧀', 100, '100 g', 18.3, 1.2, 20.8, 'cottage cheese brand varies — check pack', 'Dairy & eggs'],
    ['whey', 'Whey protein powder (typical scoop)', 'व्हे प्रोटीन', '🥤', 30, '1 scoop', 80, 7, 6, 'supplement shake — check your label', 'Dairy & eggs'],
    ['egg', 'Egg, whole, boiled', 'अंडा', '🥚', 50, '1 egg', 12.6, 1.1, 10.6, 'anda', 'Dairy & eggs'],
    ['eggwhite', 'Egg white, boiled', 'अंडे का सफेद भाग', '🥚', 33, '1 white', 10.9, 0.7, 0.2, 'anda', 'Dairy & eggs'],

    ['chicken', 'Chicken breast, cooked (no oil)', 'चिकन ब्रेस्ट', '🍗', 100, '100 g cooked', 31, 0, 3.6, 'grilled boiled', 'Meat & fish'],
    ['chicken_raw', 'Chicken breast, raw', 'कच्चा चिकन ब्रेस्ट', '🍗', 100, '100 g raw', 21.2, 0, 2.6, 'uncooked', 'Meat & fish'],
    ['chicken_thigh', 'Chicken thigh, cooked, skinless', 'चिकन जांघ', '🍗', 100, '100 g cooked', 26, 0, 8, 'leg', 'Meat & fish'],
    ['chicken_curry', 'Chicken curry (home style)', 'चिकन करी', '🍛', 150, '1 katori', 14, 4, 8, 'gravy oil varies', 'Meat & fish'],
    ['mutton_curry', 'Mutton curry (home style)', 'मटन करी', '🍛', 150, '1 katori', 15, 3, 12, 'goat lamb', 'Meat & fish'],
    ['fish_rohu', 'Rohu / freshwater fish, cooked (no oil)', 'रोहू मछली', '🐟', 100, '100 g cooked', 20, 0, 2.5, 'machli fried is higher', 'Meat & fish'],
    ['fish_salmon', 'Salmon, cooked', 'सैल्मन', '🐟', 100, '100 g cooked', 22, 0, 12, 'machli', 'Meat & fish'],
    ['tuna', 'Tuna, canned in water', 'टूना', '🐟', 100, '100 g drained', 24, 0, 1, 'machli', 'Meat & fish'],
    ['fish_curry', 'Fish curry (home style)', 'फिश करी', '🍛', 150, '1 katori', 12, 3, 7, 'machli gravy oil varies', 'Meat & fish'],
    ['prawns', 'Prawns / shrimp, cooked', 'झींगा', '🦐', 100, '100 g cooked', 24, 0.2, 1, 'jhinga', 'Meat & fish'],

    ['sabzi', 'Mixed vegetable sabzi (light oil)', 'सब्जी', '🥦', 150, '1 katori', 2, 7, 4, 'subzi vegetables', 'Vegetables & fruit'],
    ['aloo_sabzi', 'Aloo sabzi', 'आलू की सब्जी', '🥔', 150, '1 katori', 2, 15, 5, 'potato', 'Vegetables & fruit'],
    ['palak_paneer', 'Palak paneer', 'पालक पनीर', '🥬', 150, '1 katori', 7, 4, 10, 'spinach', 'Vegetables & fruit'],
    ['salad', 'Salad (cucumber, tomato, onion)', 'सलाद', '🥗', 100, '1 plate', 1, 4, 0.2, 'raw vegetables', 'Vegetables & fruit'],
    ['potato', 'Potato, boiled', 'उबला आलू', '🥔', 100, '1 medium', 2, 20, 0.1, 'aloo', 'Vegetables & fruit'],
    ['sweetpotato', 'Sweet potato, boiled', 'शकरकंद', '🍠', 100, '1 small', 1.6, 20, 0.1, 'shakarkand', 'Vegetables & fruit'],
    ['banana', 'Banana', 'केला', '🍌', 118, '1 medium', 1.1, 22.8, 0.3, 'kela fruit', 'Vegetables & fruit'],
    ['apple', 'Apple', 'सेब', '🍎', 180, '1 medium', 0.3, 13.8, 0.2, 'seb fruit', 'Vegetables & fruit'],
    ['orange', 'Orange', 'संतरा', '🍊', 130, '1 medium', 0.9, 11.8, 0.1, 'santra fruit', 'Vegetables & fruit'],
    ['mango', 'Mango', 'आम', '🥭', 150, '1 bowl sliced', 0.8, 15, 0.4, 'aam fruit', 'Vegetables & fruit'],
    ['papaya', 'Papaya', 'पपीता', '🍈', 150, '1 bowl', 0.5, 10, 0.3, 'papita fruit', 'Vegetables & fruit'],
    ['watermelon', 'Watermelon', 'तरबूज', '🍉', 150, '1 bowl', 0.6, 7.6, 0.2, 'tarbooz fruit', 'Vegetables & fruit'],
    ['guava', 'Guava', 'अमरूद', '🍐', 100, '1 small', 2.6, 14, 1, 'amrood fruit', 'Vegetables & fruit'],

    ['oil', 'Cooking oil', 'तेल', '🫒', 5, '1 tsp', 0, 0, 100, 'tel mustard sunflower groundnut', 'Fats, nuts & snacks'],
    ['ghee', 'Ghee', 'घी', '🧈', 5, '1 tsp', 0, 0, 100, 'clarified butter', 'Fats, nuts & snacks'],
    ['butter', 'Butter', 'मक्खन', '🧈', 10, '1 tsp (10 g)', 0.9, 0.1, 81, 'makhan', 'Fats, nuts & snacks'],
    ['almonds', 'Almonds', 'बादाम', '🥜', 15, '~10 almonds', 21, 10, 50, 'badam nuts (carbs shown excl. fibre)', 'Fats, nuts & snacks'],
    ['peanuts', 'Peanuts, roasted', 'मूंगफली', '🥜', 30, '1 handful', 25.8, 8, 49, 'moongfali nuts', 'Fats, nuts & snacks'],
    ['peanutbutter', 'Peanut butter', 'पीनट बटर', '🥜', 16, '1 tbsp', 25, 12, 50, 'spread', 'Fats, nuts & snacks'],
    ['makhana', 'Makhana, roasted', 'मखाना', '🍿', 30, '1 cup', 9.7, 77, 0.1, 'fox nuts lotus seeds', 'Fats, nuts & snacks'],
    ['roastedchana', 'Roasted chana', 'भुना चना', '🫘', 30, '1 handful', 19, 58, 5, 'snack', 'Fats, nuts & snacks'],
    ['samosa', 'Samosa', 'समोसा', '🥟', 80, '1 samosa', 4, 28, 15, 'fried snack', 'Fats, nuts & snacks'],
    ['tea', 'Tea with milk & sugar', 'चाय', '🍵', 150, '1 cup', 1.2, 7, 1.5, 'chai', 'Fats, nuts & snacks'],
    ['sugar', 'Sugar', 'चीनी', '🍬', 4, '1 tsp', 0, 100, 0, 'cheeni', 'Fats, nuts & snacks']
  ];
  /* Provenance. 'usda' = macros checked against USDA FoodData Central (SR Legacy) for a like-for-like plain food.
   * Everything else is an approximate estimate: home-style dishes (dal, curries, idli, dosa, poha…) vary with recipe and oil,
   * and no credible per-dish Indian source could be confirmed. Update this list only after checking a source. */
  const VERIFIED = new Set(['rice', 'chana', 'curd', 'milk', 'egg', 'chicken', 'chicken_raw', 'banana', 'oats', 'almonds', 'ghee']);
  const r1 = n => Math.round(n * 10) / 10;
  const list = ROWS.map(([id, name, hi, emoji, serving, unit, p, c, f, tags, group]) => {
    const k = serving / 100;
    const sp = r1(p * k), sc = r1(c * k), sf = r1(f * k);
    return {
      id, name, hi, emoji, serving, unit, tags, group, src: VERIFIED.has(id) ? 'usda' : 'estimate',
      p100: p, c100: c, f100: f,
      p: sp, c: sc, f: sf, kcal: Math.round(4 * p * k + 4 * c * k + 9 * f * k)
    };
  });
  const byId = Object.fromEntries(list.map(f => [f.id, f]));
  /* Token search over name, Hindi name and synonyms. Every token must match; name matches rank first
   * (a name starting with the query beats a name containing it, which beats a synonym/Hindi match). */
  function search(query, pool) {
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = pool || list;
    if (!tokens.length) return all;
    const scored = [];
    all.forEach((f, i) => {
      const name = f.name.toLowerCase(), other = ((f.hi || '') + ' ' + (f.tags || '')).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (name.startsWith(t) || name.includes(' ' + t) || name.includes('(' + t)) score += 0;
        else if (name.includes(t)) score += 1;
        else if (other.includes(t)) score += 2;
        else return;
      }
      scored.push([score, i, f]);
    });
    return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  }
  root.FitwiseFoods = { list, byId, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FitwiseFoods;
})(typeof window !== 'undefined' ? window : globalThis);
