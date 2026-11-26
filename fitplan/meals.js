/* FORMDAY meal editor. Food descriptors are copied into each meal as snapshots. */
(function (root, factory) {
  'use strict';
  const nutrition = root.FormdayNutrition || (typeof module === 'object' && module.exports ? require('./nutrition.js') : null);
  const api = factory(root, nutrition);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormdayMeals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, N) {
  'use strict';

  const MAX_ITEMS = 50, PAGE_SIZE = 50;
  const KEYS = ['kcal', 'protein', 'carbs', 'fat', 'unsat'];
  const LABELS = { kcal: '열량', protein: '단백질', carbs: '탄수화물', fat: '총 지방', unsat: '불포화지방' };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const copy = value => Array.isArray(value) ? value.map(copy) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;
  const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  const unitName = unit => unit === 'serving' ? '회분' : unit;
  const searchText = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  function uid(prefix) {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return prefix + '-' + root.crypto.randomUUID();
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const bytes = new Uint32Array(4); root.crypto.getRandomValues(bytes);
      return prefix + '-' + Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
    }
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function numeric(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    return Number(value);
  }
  function safeLink(value) {
    if (!value || typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return '';
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
  }
  function basisText(food) { return fmt(food.basisAmount) + ' ' + unitName(food.basisUnit); }
  function sourceBadge(food) {
    if (food.source.kind === 'usda') return 'USDA SR Legacy · ' + (food.source.datasetDate || '2018-04') + ' · ' + basisText(food) + ' 기준';
    if (food.source.kind === 'user') return '제품 표시 직접 입력 · ' + basisText(food) + ' 기준';
    if (food.source.kind === 'legacy') return '기존 샘플 · 검증 전 · ' + basisText(food) + ' 기준';
    return '영양정보 미확인 · ' + basisText(food) + ' 기준';
  }
  function sourceHTML(food) {
    const source = food.source, href = safeLink(source.url);
    const nutrients = KEYS.map(key => `<div><dt>${LABELS[key]}</dt><dd>${food.nutrients[key] === null ? '정보 없음' : fmt(food.nutrients[key]) + (key === 'kcal' ? ' kcal' : ' g')}</dd></div>`).join('');
    return `<details class="fm-source"><summary>영양성분·출처 보기</summary><div class="fm-source-content"><p class="fm-source-basis">${esc(basisText(food))}당 영양성분</p><dl class="fm-nutrient-list">${nutrients}</dl><p>${esc(source.label)}</p>${food.nameEn ? `<p><span>원문 이름</span> ${esc(food.nameEn)}</p>` : ''}${source.code ? `<p><span>${source.kind === 'usda' ? 'FDC ID' : '출처 코드'}</span> ${esc(source.code)}</p>` : ''}${source.datasetDate ? `<p><span>데이터 기준</span> ${esc(source.datasetDate)}</p>` : ''}${source.checkedAt ? `<p><span>출처 확인</span> ${esc(source.checkedAt)}</p>` : ''}${food.source.kind === 'legacy' ? '<p class="fm-source-caution">이전 버전의 샘플 값을 보존했습니다. 공식 검색이나 제품 표시사항으로 확인해 주세요.</p>' : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${source.kind === 'usda' ? 'USDA 원본 데이터 안내' : '입력한 출처 열기'} ↗</a>` : ''}</div></details>`;
  }
  function baseSummary() {
    return { kcal: 0, protein: 0, carbs: 0, fat: 0, unsat: 0, missing: { kcal: 0, protein: 0, carbs: 0, fat: 0, unsat: 0 }, itemCount: 0, legacyCount: 0 };
  }

  function mount(container, detail, options) {
    if (!N || !N.validateFood || !N.normalizeMeal || !N.calculateMeal) throw new Error('영양 계산 기능을 불러오지 못했습니다. 새로고침해 주세요.');
    if (!container || typeof container.querySelector !== 'function') throw new Error('식단 편집 영역을 찾을 수 없습니다.');
    options = options || {};
    const source = detail == null ? {} : detail;
    if (!plain(source)) throw new Error('식단 상세 기록이 올바르지 않습니다.');
    let initial;
    if (Object.prototype.hasOwnProperty.call(source, 'items')) {
      if (!Array.isArray(source.items)) throw new Error('식사에 포함된 음식 목록이 올바르지 않습니다.');
      initial = { items: source.items.map(item => {
        if (!plain(item)) throw new Error('식사에 포함된 음식 정보가 올바르지 않습니다.');
        return { id: item.id === undefined ? uid('meal') : item.id, food: N.validateFood(item.food), amount: item.amount };
      }), notes: source.notes === undefined ? '' : source.notes };
    } else if (Object.prototype.hasOwnProperty.call(source, 'food')) initial = N.normalizeMeal(source);
    else initial = { items: [], notes: source.notes === undefined ? '' : source.notes };
    if (typeof initial.notes !== 'string') throw new Error('식단 메모가 올바르지 않습니다.');
    const items = initial.items;
    const mealMetadata = N.mealMetadata(source);
    let notes = initial.notes, disposed = false, loading = false, catalogLoaded = false, catalogError = '', meta = {}, catalog = [];
    let library = (options.customFoods || []).map(food => N.validateFood(food));
    let favorites = new Set(options.favoriteFoodIds || []);
    let query = '', tab = 'all', page = 0, customForm = null, lastSaved = null, searchTimer = null;
    const foodCache = new Map(), prefix = uid('fm');
    if (source._mealEditor && source._mealEditor.customDraft) customForm = copy(source._mealEditor.customDraft);
    const restoredForm = customForm;

    container.innerHTML = `<section class="fm-editor" aria-label="식사 기록"><div class="fm-intro"><div><h3>한 끼의 음식을 모아 기록하세요</h3><p>섭취량에 맞춰 열량과 영양성분을 함께 계산합니다.</p></div><span class="fm-badge">MEAL LOG</span></div><div data-fm-summary></div><div class="fm-section-title"><h4>이번 식사</h4><span data-fm-count></span></div><div class="fm-items" data-fm-items></div><div class="fm-meal-actions"><button type="button" class="fm-button fm-button-primary" data-fm-action="show-search">＋ 음식 검색·추가</button><button type="button" class="fm-button fm-button-quiet" data-fm-action="new-custom">제품 직접 입력</button></div><div data-fm-custom></div><div class="fm-search-panel" data-fm-search-panel><div class="fm-search-heading"><div><h4>식품 찾기</h4><p>일반 식품은 공식 데이터로, 브랜드 제품은 표시사항으로.</p></div></div><div data-meal-ui-only><label class="fm-search-label" for="${prefix}-search"><span>음식·브랜드 검색</span><input id="${prefix}-search" type="search" data-fm-field="search" placeholder="닭가슴살, 계란, chicken…" autocomplete="off"></label><div class="fm-tabs" role="tablist" aria-label="식품 목록"><button type="button" role="tab" data-fm-action="tab" data-tab="all" aria-selected="true">전체</button><button type="button" role="tab" data-fm-action="tab" data-tab="favorites" aria-selected="false">즐겨찾기</button><button type="button" role="tab" data-fm-action="tab" data-tab="custom" aria-selected="false">내 식품</button></div></div><div data-fm-results></div></div><p class="fm-error" data-fm-error role="alert" hidden></p><label class="fm-notes" for="${prefix}-notes"><span>코멘트 · 식사 메모 <small>선택</small></span><textarea id="${prefix}-notes" rows="5" maxlength="2000" data-fm-field="notes" placeholder="음식별 코멘트, 식사별 평가, 개인 메모를 직접 작성하세요.">${esc(notes)}</textarea></label><div class="fd-meal-note-actions"><button type="button" class="fm-button fm-button-quiet" data-fm-action="comment-template">코멘트 작성 양식</button><p class="fm-unit-note">ChatGPT에서 가져온 코멘트는 여기서 확인하거나 수정할 수 있어요. 직접 등록할 때도 메모를 작성할 수 있습니다.</p></div><p class="fm-unit-note">같은 단위에서 기준량에 비례해 계산합니다. ml와 g는 서로 변환하지 않습니다. 불포화지방은 총 지방의 일부이며 열량에 중복해서 더하지 않습니다.</p></section>`;
    const nodes = {
      summary: container.querySelector('[data-fm-summary]'), items: container.querySelector('[data-fm-items]'), count: container.querySelector('[data-fm-count]'),
      custom: container.querySelector('[data-fm-custom]'), results: container.querySelector('[data-fm-results]'), search: container.querySelector('[data-fm-field="search"]'),
      notes: container.querySelector('[data-fm-field="notes"]'), error: container.querySelector('[data-fm-error]'), panel: container.querySelector('[data-fm-search-panel]')
    };
    function error(message) {
      if (disposed) return;
      nodes.error.textContent = message || '';
      nodes.error.hidden = !message;
    }
    function capture() {
      for (const input of container.querySelectorAll('[data-fm-amount]')) {
        const item = items.find(value => value.id === input.dataset.fmAmount);
        if (item) item.amount = input.value;
      }
      if (nodes.notes) notes = nodes.notes.value;
      if (customForm) for (const input of container.querySelectorAll('[data-fm-custom-field]')) customForm.raw[input.dataset.fmCustomField] = input.value;
    }
    function draft() {
      capture();
      const meal = { items: copy(items), notes, ...mealMetadata };
      if (customForm) meal._mealEditor = { customDraft: copy(customForm) };
      return meal;
    }
    function preview() {
      const valid = [], invalid = [];
      for (const item of items) {
        const amount = numeric(item.amount);
        if (Number.isFinite(amount) && amount > 0 && amount <= 20000) valid.push({ id: item.id, food: item.food, amount });
        else invalid.push(item.id);
      }
      let totals = baseSummary(), calculationError = '';
      try { if (valid.length) totals = N.calculateMeal({ items: valid, notes: '' }); } catch (failure) { calculationError = failure.message; }
      return { ...totals, draftItemCount: items.length, invalidItemCount: invalid.length, calculationError };
    }
    function metricValue(sum, key) {
      if (sum.calculationError) return '<strong class="fm-missing">계산 확인</strong>';
      if (sum.itemCount && sum.missing[key] === sum.itemCount) return '<strong class="fm-missing">정보 없음</strong>';
      return `<strong>${fmt(sum[key])}<small>${key === 'kcal' ? 'kcal' : 'g'}</small></strong>${sum.missing[key] ? '<em>일부 정보 없음</em>' : ''}`;
    }
    function renderSummary() {
      const sum = preview();
      nodes.summary.innerHTML = `<div class="fm-summary">${KEYS.map(key => `<div class="fm-metric fm-metric-${key}"><span>${LABELS[key]}</span>${metricValue(sum, key)}</div>`).join('')}</div><div class="fm-summary-notes" aria-live="polite">${sum.invalidItemCount ? `<p class="fm-caution">섭취량 확인이 필요한 음식 ${sum.invalidItemCount}개가 합계에서 빠져 있습니다. 올바르게 입력한 ${sum.itemCount}개 기준입니다.</p>` : !items.length ? '<p>음식을 추가하면 이번 식사의 합계가 표시됩니다.</p>' : '<p>입력한 섭취량 기준 합계 · 실제 섭취 여부는 아래 완료 항목에서 체크하세요.</p>'}${sum.missing.unsat ? `<p>불포화지방 정보가 없는 음식 ${sum.missing.unsat}개는 0g으로 간주하지 않습니다.${sum.missing.unsat < sum.itemCount ? ' 표시된 값은 확인 가능한 음식의 합계입니다.' : ''}</p>` : ''}${KEYS.slice(0, 4).some(key => sum.missing[key]) ? '<p>정보가 없는 영양성분은 합계에 포함되지 않습니다. 각 음식의 영양성분·출처를 확인하세요.</p>' : ''}${sum.legacyCount ? `<p class="fm-caution">기존 샘플 ${sum.legacyCount}개가 포함되어 있습니다. 당시 값은 보존되며 공식 데이터로 검증된 값이 아닙니다.</p>` : ''}${sum.calculationError ? `<p class="fm-caution">${esc(sum.calculationError)}</p>` : ''}</div>`;
      nodes.count.textContent = items.length + ' / ' + MAX_ITEMS + '개';
      return sum;
    }
    function itemTotalHTML(item) {
      const amount = numeric(item.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 20000) return '<span class="fm-caution">섭취량을 확인해 주세요</span>';
      try {
        const sum = N.calculateMeal({ items: [{ id: item.id, food: item.food, amount }], notes: '' });
        return `<strong>${sum.missing.kcal ? '열량 정보 없음' : fmt(sum.kcal) + ' kcal'}</strong><span>${['protein', 'carbs', 'fat'].map(key => LABELS[key] + ' ' + (sum.missing[key] ? '정보 없음' : fmt(sum[key]) + 'g')).join(' · ')}</span>`;
      } catch (failure) { return `<span class="fm-caution">${esc(failure.message)}</span>`; }
    }
    function renderItems() {
      nodes.items.innerHTML = !items.length ? '<div class="fm-empty-meal"><span>＋</span><strong>아직 추가한 음식이 없어요</strong><p>아래에서 음식을 찾아 한 끼를 구성하세요.</p></div>' : items.map((item, index) => `<article class="fm-item" data-fm-item="${esc(item.id)}"><div class="fm-item-head"><span class="fm-item-index">${String(index + 1).padStart(2, '0')}</span><div class="fm-food-name"><h5>${esc(item.food.name)}</h5>${item.food.brand ? `<p class="fm-brand">${esc(item.food.brand)}</p>` : ''}${item.food.nameEn && item.food.nameEn !== item.food.name ? `<p lang="en">${esc(item.food.nameEn)}</p>` : ''}<span class="fm-provenance ${item.food.source.kind === 'legacy' || item.food.source.kind === 'unknown' ? 'is-unverified' : ''}">${esc(sourceBadge(item.food))}</span></div><button type="button" class="fm-icon-button fm-delete" data-fm-action="remove-item" data-id="${esc(item.id)}" aria-label="${esc(item.food.name)} 식사에서 삭제">×</button></div><div class="fm-item-entry"><label for="${prefix}-${esc(item.id)}"><span>섭취량</span><span class="fm-amount-control"><input id="${prefix}-${esc(item.id)}" type="number" min="0.001" max="20000" step="any" inputmode="decimal" data-fm-amount="${esc(item.id)}" value="${esc(item.amount)}" aria-label="${esc(item.food.name)} 섭취량" placeholder="양 입력"><b>${esc(unitName(item.food.basisUnit))}</b></span></label><div class="fm-item-total" data-fm-item-total="${esc(item.id)}">${itemTotalHTML(item)}</div></div>${sourceHTML(item.food)}</article>`).join('');
      renderSummary();
    }
    function notify() {
      const sum = renderSummary();
      if (typeof options.onChange === 'function') options.onChange(draft(), sum);
    }
    function descriptor(id) {
      const custom = library.find(food => food.id === id);
      if (custom) return custom;
      if (foodCache.has(id)) return foodCache.get(id);
      const row = catalog.find(item => item.id === id);
      if (!row) return null;
      const food = N.fromCatalog(row, meta); foodCache.set(id, food); return food;
    }
    function searchEntries() {
      const tokens = String(query || '').normalize('NFKC').split(/[\s\p{P}\p{S}]+/u).map(searchText).filter(Boolean);
      const entries = library.map(food => ({ id: food.id, haystack: searchText([food.name, food.nameEn, food.brand, food.category].join(' ')), custom: true }));
      if (tab !== 'custom') entries.push(...catalog.map(row => ({ id: row.id, haystack: row._fmSearch, custom: false })));
      return entries.filter(entry => (tab !== 'favorites' || favorites.has(entry.id)) && tokens.every(token => entry.haystack.includes(token)));
    }
    function foodResult(food) {
      const active = favorites.has(food.id), isCustom = food.source.kind === 'user', kcal = food.nutrients.kcal;
      return `<article class="fm-result"><div class="fm-result-main"><div class="fm-food-name"><h5>${esc(food.name)}</h5>${food.brand ? `<p class="fm-brand">${esc(food.brand)}</p>` : ''}${food.nameEn && food.nameEn !== food.name ? `<p lang="en">${esc(food.nameEn)}</p>` : ''}<span class="fm-provenance">${esc(sourceBadge(food))}</span></div><button type="button" class="fm-icon-button fm-star ${active ? 'is-favorite' : ''}" data-fm-action="favorite" data-id="${esc(food.id)}" aria-label="${esc(food.name)} 즐겨찾기 ${active ? '해제' : '추가'}" aria-pressed="${active}">${active ? '★' : '☆'}</button></div><div class="fm-result-bottom"><span class="fm-result-energy">${kcal === null ? '열량 정보 없음' : fmt(kcal) + ' kcal'} <small>/ ${esc(basisText(food))}</small></span><button type="button" class="fm-button fm-add-food" data-fm-action="add-food" data-id="${esc(food.id)}" ${items.length >= MAX_ITEMS ? 'disabled' : ''}>＋ 식사에 추가</button></div>${sourceHTML(food)}${isCustom ? `<div class="fm-library-actions"><button type="button" data-fm-action="edit-custom" data-id="${esc(food.id)}">제품 정보 수정</button><button type="button" data-fm-action="delete-custom" data-id="${esc(food.id)}">내 식품에서 삭제</button></div>` : ''}</article>`;
    }
    function renderResults() {
      if (disposed) return;
      for (const button of container.querySelectorAll('[data-fm-action="tab"]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
      const entries = searchEntries(), pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
      page = Math.min(Math.max(0, page), pages - 1);
      let failureCount = 0;
      const rows = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => {
        try { const food = descriptor(entry.id); return food ? foodResult(food) : ''; } catch (_) { failureCount++; return ''; }
      }).join('');
      const stateNote = loading && tab !== 'custom' ? '<p class="fm-search-state" role="status">공식 식품 목록을 불러오는 중입니다…</p>' : catalogError && tab !== 'custom' ? `<div class="fm-search-state fm-caution" role="status"><p>${esc(catalogError)}</p><button type="button" class="fm-button fm-button-quiet" data-fm-action="retry-catalog">다시 불러오기</button></div>` : '';
      nodes.results.innerHTML = `${stateNote}<div class="fm-results-count" role="status"><span>${tab === 'favorites' ? '즐겨찾기' : tab === 'custom' ? '내 식품' : '검색 결과'} <strong>${entries.length.toLocaleString('ko-KR')}</strong>개</span>${entries.length ? `<span>${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, entries.length)} 표시</span>` : ''}</div>${rows || `<div class="fm-search-empty"><strong>${query ? '검색 결과가 없습니다' : tab === 'favorites' ? '즐겨찾는 식품을 모아 두세요' : tab === 'custom' ? '등록한 제품이 없습니다' : loading ? '조금만 기다려 주세요' : '표시할 식품이 없습니다'}</strong><p>${tab === 'favorites' ? '식품 옆 별을 누르면 이곳에서 다시 찾을 수 있어요.' : '브랜드 제품은 포장의 영양성분으로 직접 등록할 수 있어요.'}</p>${tab !== 'favorites' ? '<button type="button" class="fm-button fm-button-quiet" data-fm-action="new-custom">제품 직접 입력</button>' : ''}</div>`}${failureCount ? `<p class="fm-caution">영양정보 검증이 필요한 식품 ${failureCount}개는 선택할 수 없습니다.</p>` : ''}${pages > 1 ? `<nav class="fm-pagination" aria-label="식품 검색 페이지" data-meal-ui-only><button type="button" class="fm-button fm-button-quiet" data-fm-action="previous-page" ${page === 0 ? 'disabled' : ''}>이전 ${PAGE_SIZE}개</button><span>${page + 1} / ${pages}</span><button type="button" class="fm-button fm-button-quiet" data-fm-action="next-page" ${page === pages - 1 ? 'disabled' : ''}>다음 ${PAGE_SIZE}개</button></nav>` : ''}<p class="fm-catalog-note">공식 검색: USDA FoodData Central, SR Legacy${meta.datasetDate ? ' (' + esc(meta.datasetDate) + ')' : ''}. 일반 식품 데이터이며 실제 제품 표시사항과 다를 수 있습니다. 영문 원문과 출처를 함께 확인하세요.</p>`;
    }
    function customField(key, label, type, extra) {
      const raw = customForm.raw, id = prefix + '-custom-' + key;
      return `<label class="fm-custom-field" for="${id}"><span>${label}</span><input id="${id}" type="${type || 'text'}" data-fm-custom-field="${key}" value="${esc(raw[key])}" ${extra || ''}></label>`;
    }
    function renderCustom() {
      if (!customForm) {
        nodes.custom.innerHTML = lastSaved ? `<div class="fm-saved-food" role="status"><div><strong>내 식품에 저장했어요</strong><p>${esc(lastSaved.name)}${lastSaved.brand ? ' · ' + esc(lastSaved.brand) : ''}</p><small>이미 식사에 넣은 음식의 영양정보는 그대로 유지됩니다.</small></div><button type="button" class="fm-button fm-button-primary" data-fm-action="add-food" data-id="${esc(lastSaved.id)}" ${items.length >= MAX_ITEMS ? 'disabled' : ''}>이 식사에 추가</button></div>` : '';
        return;
      }
      const raw = customForm.raw;
      nodes.custom.innerHTML = `<section class="fm-custom-panel" aria-label="제품 영양성분 직접 입력"><div class="fm-custom-title"><div><h4>${customForm.existingId ? '내 식품 수정' : '제품 영양성분 직접 입력'}</h4><p>포장에 적힌 기준량과 영양성분을 그대로 입력하세요.</p></div><span>내 식품</span></div><div class="fm-custom-grid">${customField('name', '제품·음식 이름', 'text', 'maxlength="400" placeholder="예: 오리지널 단백질 바"')}${customField('brand', '브랜드 <small>선택</small>', 'text', 'maxlength="200" placeholder="제품 브랜드"')}${customField('basisAmount', '영양성분 입력 기준량', 'number', 'min="0.001" max="20000" step="any" inputmode="decimal"')}<label class="fm-custom-field" for="${prefix}-custom-basisUnit"><span>기준 단위</span><select id="${prefix}-custom-basisUnit" data-fm-custom-field="basisUnit"><option value="g" ${raw.basisUnit === 'g' ? 'selected' : ''}>g · 중량</option><option value="ml" ${raw.basisUnit === 'ml' ? 'selected' : ''}>ml · 용량</option><option value="serving" ${raw.basisUnit === 'serving' ? 'selected' : ''}>회분 · 1팩/1개 등</option></select></label></div><p class="fm-custom-help">예: 한 팩 45g의 영양성분이면 기준량을 <b>45g</b>으로 입력하세요. 식사에서 90g을 기록하면 두 팩의 영양성분으로 계산합니다. ml와 g는 서로 바꾸지 않습니다.</p><div class="fm-custom-grid fm-custom-nutrients">${customField('kcal', '열량 (kcal)', 'number', 'min="0" max="20000" step="any" inputmode="decimal" placeholder="표시값"')}${customField('protein', '단백질 (g)', 'number', 'min="0" max="2000" step="any" inputmode="decimal" placeholder="표시값"')}${customField('carbs', '탄수화물 (g)', 'number', 'min="0" max="2000" step="any" inputmode="decimal" placeholder="표시값"')}${customField('fat', '총 지방 (g)', 'number', 'min="0" max="2000" step="any" inputmode="decimal" placeholder="표시값"')}${customField('unsat', '불포화지방 (g) <small>선택</small>', 'number', 'min="0" max="2000" step="any" inputmode="decimal" placeholder="정보가 없으면 비워두기"')}</div><p class="fm-custom-help">위 영양성분은 모두 입력 기준량 1회분의 값입니다. 불포화지방이 표시되지 않으면 비워 두세요. 총 지방에서 포화지방을 빼서 추정하지 않습니다.</p><div class="fm-custom-grid fm-custom-link">${customField('url', '제품 정보 주소 <small>선택 · HTTPS</small>', 'url', 'maxlength="2000" placeholder="https://…"')}</div><p class="fm-custom-error" data-fm-custom-error role="alert" hidden></p><div class="fm-custom-buttons"><button type="button" class="fm-button fm-button-quiet" data-fm-action="cancel-custom">입력 취소</button><button type="button" class="fm-button fm-button-primary" data-fm-action="save-custom">내 식품에 저장</button></div><p class="fm-custom-footnote">저장한 식품은 이 브라우저의 보관함에서 다시 사용할 수 있습니다. 등록·수정은 기존 식사 기록의 영양정보를 바꾸지 않습니다.</p></section>`;
    }
    function canReplaceForm() {
      capture();
      return !customForm || !customForm.dirty || (typeof root.confirm === 'function' && root.confirm('아직 저장하지 않은 제품 입력이 있습니다. 이 입력을 버릴까요? 식사에 추가한 음식은 유지됩니다.'));
    }
    function showForm(food) {
      if (!canReplaceForm()) return;
      lastSaved = null;
      customForm = { existingId: food ? food.id : null, originalFood: food ? copy(food) : null, dirty: false, raw: food ? {
        name: food.name, brand: food.brand, basisAmount: String(food.basisAmount), basisUnit: food.basisUnit,
        ...Object.fromEntries(KEYS.map(key => [key, food.nutrients[key] === null ? '' : String(food.nutrients[key])])), url: food.source.url
      } : { name: '', brand: '', basisAmount: '100', basisUnit: 'g', kcal: '', protein: '', carbs: '', fat: '', unsat: '', url: '' } };
      renderCustom();
      const input = container.querySelector('[data-fm-custom-field="name"]');
      if (input) input.focus({ preventScroll: true });
      scrollTo(nodes.custom);
    }
    function scrollTo(node) {
      // Only scroll the modal body, never an ancestor overlay or the page.
      const body = container.closest && container.closest('.modal-body');
      if (!body || !node || typeof node.getBoundingClientRect !== 'function') return;
      const parentRect = body.getBoundingClientRect(), rect = node.getBoundingClientRect();
      body.scrollTop += rect.top - parentRect.top - 12;
    }
    function saveCustom() {
      capture();
      if (!customForm) return;
      const fieldError = container.querySelector('[data-fm-custom-error]');
      try {
        const raw = customForm.raw, nutrients = {};
        for (const key of KEYS) {
          if (key === 'unsat' && String(raw[key] == null ? '' : raw[key]).trim() === '') nutrients[key] = null;
          else {
            nutrients[key] = numeric(raw[key]);
            if (!Number.isFinite(nutrients[key]) || nutrients[key] < 0) throw new Error(LABELS[key] + '을(를) 0 이상의 숫자로 입력해 주세요.');
          }
        }
        const original = customForm.originalFood || library.find(item => item.id === customForm.existingId) || {};
        const food = N.validateFood({ id: customForm.existingId || uid('user'), name: raw.name.trim(), nameEn: original.nameEn || '', brand: raw.brand.trim(), category: original.category || '', basisAmount: numeric(raw.basisAmount), basisUnit: raw.basisUnit, nutrients, source: { ...(original.source || {}), kind: 'user', url: raw.url.trim() } });
        if (typeof options.onSaveFood !== 'function') throw new Error('내 식품 저장 기능을 사용할 수 없습니다.');
        const saved = options.onSaveFood(copy(food));
        if (!saved || typeof saved.then === 'function') throw new Error('내 식품에 저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.');
        const canonical = N.validateFood(saved);
        if (canonical.id !== food.id || canonical.source.kind !== 'user') throw new Error('저장한 제품 정보를 확인할 수 없습니다. 입력 내용은 유지됩니다.');
        const index = library.findIndex(item => item.id === canonical.id);
        if (index === -1) library.push(canonical); else library[index] = canonical;
        lastSaved = copy(canonical); customForm = null;
        renderCustom(); renderResults(); error('');
      } catch (failure) {
        if (fieldError) { fieldError.textContent = failure.message; fieldError.hidden = false; }
        else error(failure.message);
      }
    }
    function addFood(id) {
      capture();
      if (items.length >= MAX_ITEMS) throw new Error('한 식사에는 음식을 최대 50개까지 추가할 수 있습니다.');
      const food = descriptor(id);
      if (!food) throw new Error('선택한 식품을 찾을 수 없습니다. 목록을 다시 확인해 주세요.');
      const item = { id: uid('meal'), food: N.validateFood(food), amount: food.basisAmount };
      items.push(item); renderItems(); renderResults(); renderCustom(); notify();
      error('');
    }
    async function loadCatalog() {
      if (loading || disposed || catalogLoaded) return;
      loading = true; catalogError = ''; renderResults();
      try {
        if (typeof options.loadCatalog !== 'function') throw new Error('공식 식품 목록을 불러올 수 없습니다.');
        const data = await options.loadCatalog();
        if (disposed) return;
        if (!data || !Array.isArray(data.foods)) throw new Error('식품 목록 형식을 확인할 수 없습니다.');
        meta = plain(data.meta) ? copy(data.meta) : {};
        const ids = new Set();
        catalog = data.foods.map(row => {
          if (!row || typeof row.id !== 'string' || ids.has(row.id)) throw new Error('식품 목록의 식별자를 확인할 수 없습니다.');
          ids.add(row.id);
          return { ...row, _fmSearch: searchText([row.nameKo, row.nameEn, row.category, ...(Array.isArray(row.aliases) ? row.aliases : [])].join(' ')) };
        }).filter(row => !row.id.startsWith('legacy-') && !row.id.startsWith('unknown-'));
        // Curated Korean names first; the complete source catalog remains searchable.
        catalog.sort((a, b) => Number(!!b.nameKo) - Number(!!a.nameKo));
        catalogLoaded = true;
      } catch (failure) {
        if (!disposed) catalogError = '공식 식품 목록을 불러오지 못했습니다. 내 식품과 이미 추가한 음식은 계속 사용할 수 있습니다.';
      } finally {
        if (!disposed) { loading = false; renderResults(); }
      }
    }
    function onInput(event) {
      const target = event.target;
      if (!target || !target.dataset) return;
      if (target.dataset.fmAmount !== undefined) {
        const item = items.find(value => value.id === target.dataset.fmAmount);
        if (!item) return;
        item.amount = target.value;
        const row = target.closest && target.closest('[data-fm-item]');
        const output = row && row.querySelector('[data-fm-item-total]');
        if (output) output.innerHTML = itemTotalHTML(item);
        notify();
      } else if (target.dataset.fmField === 'notes') { notes = target.value; notify(); }
      else if (target.dataset.fmField === 'search') {
        query = target.value; page = 0;
        if (searchTimer !== null) root.clearTimeout(searchTimer);
        searchTimer = root.setTimeout(() => { searchTimer = null; renderResults(); }, 100);
      } else if (target.dataset.fmCustomField && customForm) {
        customForm.raw[target.dataset.fmCustomField] = target.value; customForm.dirty = true;
      }
    }
    function onChange(event) {
      // Text/number controls already dispatch input; selects need change support.
      const target = event.target;
      if (target && target.dataset && target.dataset.fmCustomField === 'basisUnit' && customForm) {
        customForm.raw.basisUnit = target.value; customForm.dirty = true;
      }
    }
    function onClick(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-fm-action]') : null;
      if (!button || button.disabled || !container.contains(button)) return;
      const action = button.dataset.fmAction, id = button.dataset.id;
      event.preventDefault();
      try {
        if (action === 'show-search') { scrollTo(nodes.panel); nodes.search.focus({ preventScroll: true }); }
        else if (action === 'tab') { tab = button.dataset.tab; page = 0; renderResults(); }
        else if (action === 'previous-page' || action === 'next-page') { page += action === 'next-page' ? 1 : -1; renderResults(); scrollTo(nodes.panel); }
        else if (action === 'retry-catalog') loadCatalog();
        else if (action === 'comment-template') {
          capture();
          if (!items.length) throw new Error('먼저 이번 식사의 음식을 추가해 주세요.');
          const sections=[];
          if (!/(^|\n)음식별 코멘트:/.test(notes)) sections.push('음식별 코멘트:\n'+items.map(item=>'- '+item.food.name.replace(/[\r\n]+/g,' ')+': ').join('\n'));
          if (!/(^|\n)식사별 코멘트:/.test(notes)) sections.push('식사별 코멘트: ');
          if (!/(^|\n)사용자 메모:/.test(notes)) sections.push('사용자 메모: ');
          if (sections.length) {
            const next=notes+(notes?'\n\n':'')+sections.join('\n');
            if(next.length>2000)throw new Error('메모가 2,000자를 넘습니다. 기존 내용은 유지됩니다.');
            notes=next;nodes.notes.value=notes;notify();
          }
          error('');nodes.notes.focus?.({preventScroll:true});
        }
        else if (action === 'new-custom') showForm(null);
        else if (action === 'edit-custom') { const food = library.find(item => item.id === id); if (food) showForm(food); }
        else if (action === 'cancel-custom') { if (canReplaceForm()) { customForm = null; renderCustom(); } }
        else if (action === 'save-custom') saveCustom();
        else if (action === 'add-food') addFood(id);
        else if (action === 'remove-item') {
          capture(); const index = items.findIndex(item => item.id === id);
          if (index !== -1) { items.splice(index, 1); renderItems(); renderResults(); renderCustom(); notify(); }
        } else if (action === 'favorite') {
          if (typeof options.onToggleFavorite !== 'function' || options.onToggleFavorite(id) !== true) throw new Error('즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.');
          if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
          renderResults();
        } else if (action === 'delete-custom') {
          const food = library.find(item => item.id === id);
          if (!food || typeof root.confirm !== 'function' || !root.confirm('“' + food.name + '”을(를) 내 식품에서 삭제할까요? 이미 기록했거나 이번 식사에 추가한 음식의 영양정보는 그대로 유지됩니다.')) return;
          if (typeof options.onDeleteFood !== 'function' || options.onDeleteFood(id) !== true) throw new Error('내 식품에서 삭제하지 못했습니다. 다시 시도해 주세요.');
          library = library.filter(item => item.id !== id); favorites.delete(id);
          if (lastSaved && lastSaved.id === id) lastSaved = null;
          // Preserve a currently edited product draft; it can be saved again explicitly.
          renderResults(); if (!customForm) renderCustom();
        }
      } catch (failure) { error(failure.message); }
    }
    function read() {
      capture();
      if (customForm && customForm.dirty) throw new Error('아직 저장하지 않은 제품 입력이 있습니다. 먼저 “내 식품에 저장”을 누르거나 “입력 취소”를 선택해 주세요.');
      if (!items.length) throw new Error('이번 식사에 음식을 1개 이상 추가해 주세요.');
      const canonical = { items: items.map(item => {
        const amount = numeric(item.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 20000) throw new Error('“' + item.food.name + '”의 섭취량을 0보다 크고 20,000 이하인 숫자로 입력해 주세요.');
        return { id: item.id, food: copy(item.food), amount };
      }), notes, ...mealMetadata };
      return N.normalizeMeal(canonical);
    }
    container.addEventListener('input', onInput);
    container.addEventListener('change', onChange);
    container.addEventListener('click', onClick);
    renderItems(); renderCustom(); renderResults(); loadCatalog();
    // Restoring a product draft is a round trip, not a new edit notification.
    if (restoredForm) customForm = restoredForm;
    return { read, draft, destroy() {
      if (disposed) return; disposed = true;
      if (searchTimer !== null) root.clearTimeout(searchTimer);
      container.removeEventListener('input', onInput); container.removeEventListener('change', onChange); container.removeEventListener('click', onClick);
    } };
  }
  return Object.freeze({ mount });
});
