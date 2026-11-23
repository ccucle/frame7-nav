/* FORMDAY nutrition: explicit units, food snapshots and missing-value aware totals. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports && !root.FormdayData) require('./data.js');
  const api = factory(root.FormdayData || null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormdayNutrition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (legacyData) {
  'use strict';

  const KEYS = Object.freeze(['kcal', 'protein', 'carbs', 'fat', 'unsat']);
  const REQUIRED = ['kcal', 'protein', 'carbs', 'fat'];
  const LABELS = { kcal: '열량', protein: '단백질', carbs: '탄수화물', fat: '총 지방', unsat: '불포화지방' };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
  const fail = message => { const error = new Error(message); error.code = 'INVALID_DATA'; throw error; };
  const EPSILON = 1e-9;

  function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }

  function text(value, label, max, optional) {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail(label + '을(를) 확인해 주세요.');
    return value;
  }

  function identifier(value, label, generate) {
    if (value === undefined && generate) return uid();
    if (!idOK(value)) fail(label + ' 식별자가 올바르지 않습니다.');
    return value;
  }

  function positive(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 20000) fail(label + '은(는) 0보다 크고 20,000 이하인 숫자로 입력해 주세요.');
    return value;
  }

  function safeURL(value) {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value)) fail('식품 출처 주소가 올바르지 않습니다.');
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('식품 출처 주소는 HTTPS 주소만 사용할 수 있습니다.');
      return url.href;
    } catch (error) {
      fail('식품 출처 주소는 올바른 HTTPS 주소로 입력해 주세요.');
    }
  }

  function normalizeSource(source) {
    if (!plain(source) || !['usda', 'user', 'legacy', 'unknown'].includes(source.kind)) fail('식품 출처 종류가 올바르지 않습니다.');
    const suppliedLabel = text(source.label, '식품 출처', 250, true);
    const defaultLabel = { usda: 'USDA FoodData Central · SR Legacy', user: '사용자 직접 입력 · 제품 표시사항', legacy: '기존 샘플 영양정보 · 검증되지 않음', unknown: '영양정보 없음' }[source.kind];
    return {
      kind: source.kind,
      // User-entered products must never inherit a public-database verification label.
      label: source.kind === 'user' ? defaultLabel : suppliedLabel || defaultLabel,
      url: safeURL(source.url),
      code: text(source.code, '출처 코드', 100, true),
      datasetDate: text(source.datasetDate, '데이터 기준일', 40, true),
      checkedAt: text(source.checkedAt, '출처 확인일', 40, true)
    };
  }

  function validateFood(raw) {
    if (!plain(raw)) fail('식품 정보가 올바르지 않습니다.');
    const source = normalizeSource(raw.source);
    const basisAmount = positive(raw.basisAmount, '영양성분 기준량');
    if (!['g', 'ml', 'serving'].includes(raw.basisUnit)) fail('영양성분 기준 단위를 확인해 주세요.');
    if (!plain(raw.nutrients)) fail('식품 영양성분이 올바르지 않습니다.');
    const nutrients = {};
    for (const key of KEYS) {
      const value = raw.nutrients[key];
      if (value === null || value === undefined) {
        if (source.kind === 'user' && REQUIRED.includes(key)) fail('직접 등록한 식품은 ' + LABELS[key] + '을(를) 입력해야 합니다.');
        nutrients[key] = null;
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'kcal' ? 20000 : 2000)) fail(LABELS[key] + ' 값이 올바르지 않습니다.');
      if (raw.basisUnit === 'g' && key !== 'kcal' && value > basisAmount + Math.max(0.1, basisAmount * 0.001) + EPSILON) fail(LABELS[key] + '은(는) 기준 중량보다 클 수 없습니다.');
      nutrients[key] = value;
    }
    const unsatTolerance = source.kind === 'usda' && raw.basisUnit === 'g' ? basisAmount * 0.001 : 0;
    if (nutrients.unsat !== null && nutrients.fat !== null && nutrients.unsat > nutrients.fat + unsatTolerance + EPSILON) fail('불포화지방은 총 지방보다 클 수 없습니다. 출처의 영양성분을 확인해 주세요.');
    return {
      id: identifier(raw.id, '식품', false),
      name: text(raw.name, '식품 이름', 400, false),
      nameEn: text(raw.nameEn, '영문 식품 이름', 600, true),
      brand: text(raw.brand, '제품 브랜드', 200, true),
      category: text(raw.category, '식품 분류', 160, true),
      basisAmount,
      basisUnit: raw.basisUnit,
      nutrients,
      source
    };
  }

  function fromCatalog(row, meta) {
    if (!plain(row) || !plain(row.per100g)) fail('공개 식품 데이터가 올바르지 않습니다.');
    const metadata = plain(meta) ? meta : {};
    const n = row.per100g;
    for (const key of ['mono', 'poly']) {
      const value = n[key];
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100.1 + EPSILON)) fail('공개 식품 데이터의 불포화지방 원본 값이 올바르지 않습니다.');
    }
    let unsat;
    // An explicit null can represent inconsistent source data; never recreate it.
    if (own(n, 'unsat')) unsat = n.unsat;
    else if (typeof n.mono === 'number' && Number.isFinite(n.mono) && n.mono >= 0 && typeof n.poly === 'number' && Number.isFinite(n.poly) && n.poly >= 0) unsat = n.mono + n.poly;
    else unsat = null;
    const nameEn = text(row.nameEn, '영문 식품 이름', 600, false);
    if (row.nameKo !== undefined && row.nameKo !== null && typeof row.nameKo !== 'string') fail('한글 식품 이름이 올바르지 않습니다.');
    return validateFood({
      id: row.id,
      name: row.nameKo && row.nameKo.trim() ? row.nameKo : nameEn,
      nameEn,
      brand: '',
      category: row.category === undefined ? '' : row.category,
      basisAmount: 100,
      basisUnit: 'g',
      nutrients: { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, unsat },
      source: {
        kind: 'usda',
        label: typeof metadata.source === 'string' ? metadata.source : 'USDA FoodData Central · SR Legacy',
        url: row.sourceUrl,
        code: row.fdcId === undefined ? '' : String(row.fdcId),
        datasetDate: metadata.datasetDate,
        checkedAt: metadata.checkedAt
      }
    });
  }

  function nameHash(value) {
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  function legacyFood(name) {
    if (!legacyData || !legacyData.FOOD_MAP || typeof legacyData.FOOD_MAP.get !== 'function') fail('기존 식품 데이터를 불러오지 못했습니다. 원본 기록은 유지됩니다.');
    const old = legacyData.FOOD_MAP.get(name);
    const known = !!old;
    return validateFood({
      id: (known ? 'legacy-' : 'unknown-') + nameHash(name),
      name,
      category: known ? old.group : '',
      basisAmount: 100,
      basisUnit: 'g',
      nutrients: Object.fromEntries(KEYS.map(key => [key, known ? old[key] : null])),
      source: { kind: known ? 'legacy' : 'unknown' }
    });
  }

  function sumItems(items) {
    const totals = Object.fromEntries(KEYS.map(key => [key, 0]));
    totals.missing = Object.fromEntries(KEYS.map(key => [key, 0]));
    totals.itemCount = items.length;
    totals.legacyCount = 0;
    for (const item of items) {
      const ratio = item.amount / item.food.basisAmount;
      if (!Number.isFinite(ratio)) fail('섭취량과 기준량의 비율이 계산 범위를 벗어났습니다.');
      if (item.food.source.kind === 'legacy') totals.legacyCount++;
      for (const key of KEYS) {
        const value = item.food.nutrients[key];
        if (value === null) totals.missing[key]++;
        else {
          const next = totals[key] + value * ratio;
          if (!Number.isFinite(next)) fail('영양성분 합계가 계산 범위를 벗어났습니다.');
          totals[key] = next;
        }
      }
    }
    return totals;
  }

  function normalizeMeal(raw) {
    if (!plain(raw)) fail('식단 상세 기록이 올바르지 않습니다.');
    const notes = text(raw.notes, '식단 메모', 2000, true);
    let items;
    if (own(raw, 'items')) {
      if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 50) fail('한 식사에는 음식을 1~50개까지 넣을 수 있습니다.');
      const seen = new Set();
      items = raw.items.map(item => {
        if (!plain(item)) fail('식사에 포함된 음식 정보가 올바르지 않습니다.');
        const id = identifier(item.id, '식사 항목', true);
        if (seen.has(id)) fail('중복된 식사 항목 식별자가 있습니다.');
        seen.add(id);
        return { id, food: validateFood(item.food), amount: positive(item.amount, '섭취량') };
      });
    } else {
      const name = text(raw.food, '기존 식품 이름', 200, false);
      items = [{ id: uid(), food: legacyFood(name), amount: positive(raw.grams, '기존 섭취 중량') }];
    }
    // Reject arithmetic overflow before a malformed meal reaches persisted state.
    sumItems(items);
    return { items, notes };
  }

  function calculateMeal(detail) {
    return sumItems(normalizeMeal(detail).items);
  }

  function describeMeal(detail) {
    const meal = normalizeMeal(detail), total = sumItems(meal.items);
    const fmt = value => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
    const first = meal.items[0];
    const unit = first.food.basisUnit === 'serving' ? '회분' : first.food.basisUnit;
    const names = first.food.name + (meal.items.length > 1 ? ' 외 ' + (meal.items.length - 1) + '가지' : ' · ' + fmt(first.amount) + unit);
    const energy = total.missing.kcal === total.itemCount ? '열량 정보 없음' : (total.missing.kcal ? '확인 가능한 열량 ' : '') + fmt(total.kcal) + ' kcal';
    return names + ' · ' + energy;
  }

  function normalizeCollections(state) {
    if (!plain(state)) fail('식품 보관함 형식이 올바르지 않습니다.');
    const foods = state.customFoods === undefined ? [] : state.customFoods;
    if (!Array.isArray(foods) || foods.length > 500) fail('직접 등록한 식품은 최대 500개까지 보관할 수 있습니다.');
    const ids = new Set();
    const customFoods = foods.map(raw => {
      const food = validateFood(raw);
      if (food.source.kind !== 'user') fail('직접 등록한 식품의 출처 종류가 올바르지 않습니다.');
      if (ids.has(food.id)) fail('중복된 직접 등록 식품 식별자가 있습니다.');
      ids.add(food.id);
      return food;
    });
    const favorites = state.favoriteFoodIds === undefined ? [] : state.favoriteFoodIds;
    if (!Array.isArray(favorites) || favorites.length > 1000) fail('즐겨찾기는 최대 1,000개까지 등록할 수 있습니다.');
    const favoriteIds = new Set();
    const favoriteFoodIds = favorites.map(raw => {
      const id = identifier(raw, '즐겨찾기 식품', false);
      if (favoriteIds.has(id)) fail('중복된 즐겨찾기 식별자가 있습니다.');
      favoriteIds.add(id);
      return id;
    });
    return { customFoods, favoriteFoodIds };
  }

  function upsertCustomFood(state, raw) {
    const food = validateFood(raw);
    if (food.source.kind !== 'user') fail('직접 등록한 식품만 수정할 수 있습니다.');
    const collections = normalizeCollections(state);
    const index = collections.customFoods.findIndex(item => item.id === food.id);
    if (index < 0) {
      if (collections.customFoods.length >= 500) fail('직접 등록한 식품은 최대 500개까지 보관할 수 있습니다.');
      collections.customFoods.push(food);
    } else collections.customFoods[index] = food;
    return { ...clone(state), ...collections };
  }

  function removeCustomFood(state, id) {
    identifier(id, '직접 등록 식품', false);
    const collections = normalizeCollections(state);
    collections.customFoods = collections.customFoods.filter(food => food.id !== id);
    collections.favoriteFoodIds = collections.favoriteFoodIds.filter(value => value !== id);
    return { ...clone(state), ...collections };
  }

  function toggleFavorite(state, id) {
    identifier(id, '즐겨찾기 식품', false);
    const collections = normalizeCollections(state);
    const index = collections.favoriteFoodIds.indexOf(id);
    if (index >= 0) collections.favoriteFoodIds.splice(index, 1);
    else {
      if (collections.favoriteFoodIds.length >= 1000) fail('즐겨찾기는 최대 1,000개까지 등록할 수 있습니다.');
      collections.favoriteFoodIds.push(id);
    }
    return { ...clone(state), ...collections };
  }

  return { KEYS, normalizeMeal, validateFood, fromCatalog, calculateMeal, describeMeal, normalizeCollections, upsertCustomFood, removeCustomFood, toggleFavorite };
});
