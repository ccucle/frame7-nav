'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../fitplan/nutrition.js');
const C = require('../fitplan/core.js');

const clone = value => JSON.parse(JSON.stringify(value));
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const empty = () => C.normalizeState({ events: [], settings: { ...C.defaults } });
const product = (patch = {}) => N.validateFood({
  id: 'user-product', name: '직접 등록한 제품', nameEn: '', brand: '테스트', category: '',
  basisAmount: 100, basisUnit: 'g',
  nutrients: { kcal: 200, protein: 10, carbs: 25, fat: 7, unsat: null },
  source: { kind: 'user', label: '직접 입력' }, ...patch
});
const meal = (food, amount, id = 'item1') => ({ items: [{ id, food, amount }], notes: '' });
const event = (detail, patch = {}) => ({ id: 'meal1', date: '2026-11-23', start: '12:00', end: '12:30', type: 'meal', title: '점심', repeat: 'none', completed: true, detail, ...patch });
const catalogRow = (patch = {}) => ({
  id: 'usda-sr-123456', fdcId: 123456, ndbNumber: '01234', nameEn: 'Example, edible food', nameKo: '예시 식품', category: 'Test category',
  per100g: { kcal: 100, protein: 8, carbs: 12, fat: 3, mono: 1, poly: 0.5, unsat: 1.5 },
  sourceUrl: 'https://fdc.nal.usda.gov/food-details/123456/nutrients', ...patch
});
const meta = { source: 'USDA FoodData Central · SR Legacy', datasetDate: '2018-04', checkedAt: '2026-11-23' };

test('all 41 legacy foods retain every original per-100g value and quantity when migrated', () => {
  assert.equal(globalThis.FormdayData.FOOD.length, 41);
  for (const row of globalThis.FormdayData.FOOD) {
    const amount = 137.5;
    const migrated = N.normalizeMeal({ food: row[1], grams: amount });
    assert.equal(migrated.items[0].amount, amount);
    assert.equal(migrated.items[0].food.basisAmount, 100);
    assert.equal(migrated.items[0].food.basisUnit, 'g');
    assert.equal(migrated.items[0].food.source.kind, 'legacy');
    const totals = N.calculateMeal(migrated);
    N.KEYS.forEach((key, index) => {
      assert.equal(migrated.items[0].food.nutrients[key], row[index + 2]);
      approx(totals[key], row[index + 2] * amount / 100);
      assert.equal(totals.missing[key], 0);
    });
    assert.equal(totals.legacyCount, 1);
  }
});

test('unknown legacy food remains a named snapshot with unknown nutrients, not fabricated zeroes', () => {
  const detail = N.normalizeMeal({ food: '기존 기록의 미등록 음식', grams: 225 });
  assert.equal(detail.items[0].food.name, '기존 기록의 미등록 음식');
  assert.equal(detail.items[0].food.source.kind, 'unknown');
  assert.equal(detail.items[0].amount, 225);
  const totals = N.calculateMeal(detail);
  for (const key of N.KEYS) {
    assert.equal(detail.items[0].food.nutrients[key], null);
    assert.equal(totals.missing[key], 1);
  }
  assert.match(N.describeMeal(detail), /열량 정보 없음/);
  assert.doesNotMatch(N.describeMeal(detail), /0 kcal/);
});

test('per-100g, label-per-45g, 100ml and fractional-serving quantities use their own basis', () => {
  const cases = [
    [product(), 150, 300, 15, 37.5, 10.5],
    [product({ basisAmount: 45 }), 22.5, 100, 5, 12.5, 3.5],
    [product({ basisAmount: 100, basisUnit: 'ml', nutrients: { kcal: 42, protein: 3.4, carbs: 5, fat: 1, unsat: 0.3 } }), 250, 105, 8.5, 12.5, 2.5],
    [product({ basisAmount: 1, basisUnit: 'serving', nutrients: { kcal: 120, protein: 20, carbs: 5, fat: 2, unsat: null } }), 0.5, 60, 10, 2.5, 1]
  ];
  for (const [food, amount, kcal, protein, carbs, fat] of cases) {
    const totals = N.calculateMeal(meal(food, amount));
    for (const [key, expected] of Object.entries({ kcal, protein, carbs, fat })) approx(totals[key], expected);
  }
  // Millilitres and servings do not imply a gram mass or a density of 1g/ml.
  assert.doesNotThrow(() => product({ basisUnit: 'ml', basisAmount: 1, nutrients: { kcal: 50, protein: 2, carbs: 3, fat: 2, unsat: 1 } }));
});

test('a two-food meal scales each food separately and never adds unsaturated fat to total fat or energy', () => {
  const chicken = N.normalizeMeal({ food: '닭가슴살(조리)', grams: 150 });
  const rice = N.normalizeMeal({ food: '현미밥', grams: 180 });
  const combined = { items: [...chicken.items, ...rice.items], notes: '점심 식사' };
  const totals = N.calculateMeal(combined);
  approx(totals.kcal, 468.9);
  approx(totals.protein, 51.36);
  approx(totals.carbs, 46.08);
  approx(totals.fat, 7.2);
  approx(totals.unsat, 3.15);
  assert.equal(totals.itemCount, 2);
  assert.equal(totals.legacyCount, 2);
  assert.match(N.describeMeal(combined), /외 1가지/);
});

test('missing unsaturated fat remains distinct from zero while known values form a partial sum', () => {
  const known = product({ id: 'known', nutrients: { kcal: 100, protein: 5, carbs: 10, fat: 4, unsat: 2 } });
  const unknown = product({ id: 'unknown' });
  const totals = N.calculateMeal({ items: [{ id: 'a', food: known, amount: 150 }, { id: 'b', food: unknown, amount: 50 }], notes: '' });
  assert.equal(totals.unsat, 3);
  assert.equal(totals.missing.unsat, 1);
  assert.equal(totals.kcal, 250);
  assert.equal(totals.missing.kcal, 0);
  const zero = product({ nutrients: { kcal: 0, protein: 0, carbs: 0, fat: 0, unsat: 0 } });
  assert.equal(N.calculateMeal(meal(zero, 100)).missing.unsat, 0);
});

test('catalog conversion preserves provenance, source nulls and permitted source rounding', () => {
  const food = N.fromCatalog(catalogRow(), meta);
  assert.equal(food.name, '예시 식품');
  assert.equal(food.source.kind, 'usda');
  assert.equal(food.source.code, '123456');
  assert.equal(food.source.datasetDate, '2018-04');
  assert.equal(food.source.checkedAt, '2026-11-23');
  const inconsistent = catalogRow({ per100g: { kcal: 100, protein: 8, carbs: 12, fat: 3, mono: 3, poly: 4, unsat: null } });
  assert.equal(N.fromCatalog(inconsistent, meta).nutrients.unsat, null);
  assert.equal(N.calculateMeal(meal(N.fromCatalog(inconsistent, meta), 100)).missing.unsat, 1);
  const rounding = catalogRow({ per100g: { kcal: 100, protein: 8, carbs: 12, fat: 3, mono: 2, poly: 1.09, unsat: 3.09 } });
  assert.equal(N.fromCatalog(rounding, meta).nutrients.unsat, 3.09);
  const excessive = clone(rounding); excessive.per100g.unsat = 3.11;
  assert.throws(() => N.fromCatalog(excessive, meta), /총 지방보다/);
  const noDerivedValue = catalogRow({ per100g: { kcal: 100, protein: 8, carbs: 12, fat: 3, mono: 1, poly: null } });
  assert.equal(N.fromCatalog(noDerivedValue, meta).nutrients.unsat, null);
  const derive = catalogRow({ per100g: { kcal: 100, protein: 8, carbs: 12, fat: 3, mono: 1, poly: 0.5 } });
  assert.equal(N.fromCatalog(derive, meta).nutrients.unsat, 1.5);
});

test('direct products require numeric label values and reject physically impossible amounts and unsafe source URLs', () => {
  const original = product();
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
    for (const invalid of [null, undefined, '', '10', -1, NaN, Infinity]) {
      assert.throws(() => N.validateFood({ ...original, nutrients: { ...original.nutrients, [key]: invalid } }));
    }
  }
  assert.throws(() => product({ nutrients: { kcal: 10, protein: 101, carbs: 0, fat: 0, unsat: null } }), /기준 중량/);
  assert.throws(() => product({ nutrients: { kcal: 100, protein: 1, carbs: 1, fat: 3, unsat: 3.001 } }), /총 지방보다/);
  assert.throws(() => product({ basisUnit: 'oz' }), /단위/);
  assert.throws(() => product({ basisAmount: 0 }), /기준량/);
  assert.throws(() => product({ id: 'x" onclick="bad' }), /식별자/);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', 'https://example.com\n/path', '//example.com']) {
    assert.throws(() => product({ source: { kind: 'user', url } }), /주소/);
  }
  const user = product({ source: { kind: 'user', label: 'USDA 검증 완료', url: 'https://example.com/label' } });
  assert.equal(user.source.kind, 'user');
  assert.match(user.source.label, /사용자 직접 입력/);
  assert.doesNotMatch(user.source.label, /USDA|검증 완료/);
});

test('invalid meal quantities, duplicate item IDs and oversize details reject without truncation or mutation', () => {
  const food = product(), valid = meal(food, 100), before = JSON.stringify(valid);
  for (const amount of ['', '100', 0, -1, 20001, Infinity, NaN, null]) assert.throws(() => N.normalizeMeal(meal(food, amount)));
  assert.throws(() => N.normalizeMeal({ items: [valid.items[0], valid.items[0]], notes: '' }), /중복/);
  assert.throws(() => N.normalizeMeal({ items: [], notes: '' }), /1~50/);
  assert.throws(() => N.normalizeMeal({ items: Array.from({ length: 51 }, (_, i) => ({ id: 'i' + i, food, amount: 1 })) }), /1~50/);
  assert.throws(() => N.normalizeMeal({ ...valid, notes: 'x'.repeat(2001) }), /메모/);
  assert.throws(() => N.normalizeMeal(meal(product({ basisUnit: 'serving', basisAmount: 1e-320 }), 20000)), /계산 범위/);
  assert.equal(JSON.stringify(valid), before);
  const normalized = N.normalizeMeal(valid);
  food.nutrients.kcal = 999;
  assert.equal(normalized.items[0].food.nutrients.kcal, 200);
});

test('editing or removing a saved product never changes existing meal snapshots', () => {
  const originalFood = product();
  let state = N.upsertCustomFood(empty(), originalFood);
  state = N.toggleFavorite(state, originalFood.id);
  state = C.upsert(state, event(meal(state.customFoods[0], 50)));
  const before = JSON.stringify(state);
  const changed = N.upsertCustomFood(state, { ...originalFood, name: '제품 새 표시사항', nutrients: { ...originalFood.nutrients, kcal: 250 } });
  assert.equal(changed.customFoods[0].name, '제품 새 표시사항');
  assert.equal(N.calculateMeal(changed.events[0].detail).kcal, 100);
  assert.equal(changed.events[0].detail.items[0].food.name, '직접 등록한 제품');
  assert.equal(JSON.stringify(state), before);
  const removed = N.removeCustomFood(changed, originalFood.id);
  assert.equal(removed.customFoods.length, 0);
  assert.equal(removed.favoriteFoodIds.length, 0);
  assert.equal(N.calculateMeal(removed.events[0].detail).kcal, 100);
  assert.equal(C.normalizeState(removed).events.length, 1);
});

test('custom food and favorite collections enforce duplicate IDs, source kind and limits', () => {
  const food = product(), state = empty();
  assert.throws(() => C.normalizeState({ ...state, customFoods: [food, food] }), /중복/);
  assert.throws(() => C.normalizeState({ ...state, favoriteFoodIds: ['same', 'same'] }), /중복/);
  assert.throws(() => C.normalizeState({ ...state, customFoods: [N.fromCatalog(catalogRow(), meta)] }), /출처 종류/);
  assert.throws(() => C.normalizeState({ ...state, customFoods: Array.from({ length: 501 }, (_, i) => ({ ...food, id: 'u' + i })) }), /500/);
  assert.throws(() => C.normalizeState({ ...state, favoriteFoodIds: Array.from({ length: 1001 }, (_, i) => 'f' + i) }), /1,000/);
  const favorite = N.toggleFavorite(state, 'usda-sr-123456');
  assert.deepEqual(favorite.favoriteFoodIds, ['usda-sr-123456']);
  assert.deepEqual(N.toggleFavorite(favorite, 'usda-sr-123456').favoriteFoodIds, []);
  assert.deepEqual(state.favoriteFoodIds, []);
});

test('v1, v2 and v3 backups migrate to v3 while preserving quantities, collections and previous raw storage', () => {
  for (const version of [1, 2]) {
    const old = { app: 'formday', version, schemaVersion: version, events: [event({ food: '현미밥', grams: 180 })], settings: { ...C.defaults } };
    const raw = JSON.stringify(old), map = new Map([[C.STORE, raw]]);
    const store = C.makeStore({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
    const loaded = store.load();
    assert.equal(loaded.error, null);
    assert.equal(loaded.data.schemaVersion, 3);
    assert.deepEqual(loaded.data.customFoods, []);
    assert.deepEqual(loaded.data.favoriteFoodIds, []);
    approx(N.calculateMeal(loaded.data.events[0].detail).kcal, 221.4);
    store.save(loaded.data, '');
    assert.equal(map.get(store.backupKey), raw);
  }
  let v3 = N.upsertCustomFood(empty(), product());
  v3 = N.toggleFavorite(v3, 'user-product');
  v3 = C.upsert(v3, event(meal(v3.customFoods[0], 22.5)));
  const imported = C.normalizeState(JSON.parse(JSON.stringify({ app: 'formday', version: 3, ...v3 })));
  assert.deepEqual(imported, v3);
  assert.throws(() => C.normalizeState({ ...v3, version: 4 }), /버전/);
});

test('recurring meal migration and day edits keep independent food and amount snapshots', () => {
  let state = C.normalizeState({ events: [event({ food: '닭가슴살(조리)', grams: 100 }, { repeat: 'daily', doneDates: ['2026-11-23', '2026-11-24'] })], settings: { ...C.defaults } });
  const day = C.occurrence(state.events[0], '2026-11-24');
  day.detail.items[0].amount = 200;
  state = C.upsert(state, day, { scope: 'occurrence', occurrenceDate: day.date });
  assert.equal(N.calculateMeal(C.occurrence(state.events[0], '2026-11-23').detail).kcal, 165);
  assert.equal(N.calculateMeal(C.occurrence(state.events[0], '2026-11-24').detail).kcal, 330);
  const template = { ...state.events[0], detail: N.normalizeMeal({ food: '현미밥', grams: 180 }) };
  state = C.upsert(state, template, { scope: 'series' });
  assert.equal(N.calculateMeal(C.occurrence(state.events[0], '2026-11-23').detail).kcal, 165);
  assert.equal(N.calculateMeal(C.occurrence(state.events[0], '2026-11-24').detail).kcal, 330);
  approx(N.calculateMeal(C.occurrence(state.events[0], '2026-11-25').detail).kcal, 221.4);
  assert.equal(C.occurrence(state.events[0], '2026-11-25').completed, false);
});
