/* FORMDAY exercise picker. Catalog selection only; callers own all writes. */
(function (root, factory) {
  'use strict';
  const library = factory();
  if (typeof module === 'object' && module.exports) module.exports = library;
  if (root && root.document) root.FormdayExercisePicker = library.createPicker(root);
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const MAX_SELECTION = 30;
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeText = value => String(value == null ? '' : value).normalize('NFC').toLocaleLowerCase('ko-KR');

  function initials(value) {
    return Array.from(normalizeText(value), char => {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) return INITIALS[Math.floor((code - 0xac00) / 588)];
      if (code >= 0x1100 && code <= 0x1112) return INITIALS[code - 0x1100];
      return char;
    }).join('').replace(/\s+/g, '');
  }

  function matchesName(name, query) {
    const text = normalizeText(name).replace(/\s+/g, '');
    const short = initials(name);
    return normalizeText(query).trim().split(/\s+/).filter(Boolean).every(token => {
      const initialToken = initials(token);
      return /^[ㄱ-ㅎ]+$/.test(token) || /^[\u1100-\u1112]+$/.test(token)
        ? short.includes(initialToken) : text.includes(token);
    });
  }

  function catalogRows(catalog, metadata) {
    const details = new Map((Array.isArray(metadata) ? metadata : []).filter(row => row && typeof row.name === 'string').map(row => [row.name, row]));
    const seen = new Set();
    return (Array.isArray(catalog) ? catalog : []).filter(row => {
      if (!row || typeof row.name !== 'string' || !row.name.trim() || seen.has(row.name)) return false;
      seen.add(row.name); return true;
    }).map(row => ({name: row.name, group: typeof row.group === 'string' && row.group ? row.group : '기타',
      equipment: (details.get(row.name) || {}).equipment || row.equipment || '기타'}));
  }

  function createModel(catalog, options) {
    const opts = options || {};
    const rows = catalogRows(catalog);
    const byName = new Map(rows.map(row => [row.name, row]));
    const multiple = opts.multiple === true;
    const max = multiple ? MAX_SELECTION : 1;
    const limit = Number.isInteger(opts.limit) ? Math.max(0, Math.min(max, opts.limit)) : max;
    const selected = new Set();
    let favorites = new Set();
    const filters = {query: '', group: '', equipment: '', favoritesOnly: false};
    const model = {
      rows, multiple, limit,
      selection: () => Array.from(selected),
      isSelected: name => selected.has(name),
      isFavorite: name => favorites.has(name),
      setFavorites(names) { favorites = new Set((Array.isArray(names) ? names : []).filter(name => byName.has(name))); },
      setFavorite(name, next) { if (byName.has(name)) next ? favorites.add(name) : favorites.delete(name); },
      toggle(name) {
        if (!byName.has(name)) return 'unknown';
        if (selected.has(name)) { selected.delete(name); return 'removed'; }
        if (!limit || (multiple && selected.size >= limit)) return 'limit';
        if (!multiple) selected.clear();
        selected.add(name); return 'selected';
      },
      remove(name) { return selected.delete(name); },
      clear() { selected.clear(); },
      setFilter(key, value) {
        if (!Object.prototype.hasOwnProperty.call(filters, key)) return;
        filters[key] = key === 'favoritesOnly' ? value === true : String(value || '').slice(0, 160);
      },
      filters: () => ({...filters}),
      resetFilters() { Object.assign(filters, {query: '', group: '', equipment: '', favoritesOnly: false}); },
      visible() {
        return rows.filter(row => (!filters.group || row.group === filters.group) &&
          (!filters.equipment || row.equipment === filters.equipment) &&
          (!filters.favoritesOnly || favorites.has(row.name)) && matchesName(row.name, filters.query));
      }
    };
    model.setFavorites(opts.favorites);
    return model;
  }

  // Images may be local assets or HTTPS. Credits always point to HTTPS pages.
  function safeURL(value, sourceOnly) {
    if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u0020\\]/.test(value) || value.startsWith('//')) return '';
    if (/^https:\/\//i.test(value)) {
      try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : ''; } catch (_) { return ''; }
    }
    if (sourceOnly || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('#') || value.startsWith('?')) return '';
    return /^(?:\.?\.?\/|[a-z\d_-])/i.test(value) ? value : '';
  }

  function mediaFor(root, name) {
    const entry = root.FormdayExerciseMedia && root.FormdayExerciseMedia.byName && root.FormdayExerciseMedia.byName[name];
    if (!entry || !safeURL(entry.src)) return null;
    return {src: safeURL(entry.src), alt: typeof entry.alt === 'string' && entry.alt.trim() ? entry.alt : name + ' 동작 이미지', sourceUrl: safeURL(entry.sourceUrl, true)};
  }

  function createPicker(root) {
    const document = root.document;
    let active = null;
    let sequence = 0;

    function focusElement(element) {
      if (!element || typeof element.focus !== 'function' || element.isConnected === false) return false;
      if (typeof element.closest === 'function' && element.closest('[hidden]')) return false;
      try { element.focus({preventScroll: true}); return true; } catch (_) { return false; }
    }

    function finish(session, reason) {
      if (!session || session.finished) return;
      session.finished = true;
      if (active === session) active = null;
      const {dialog, viewport, updateViewport, onClick, onInput, onCancel, onClose, onError} = session;
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('input', onInput);
      dialog.removeEventListener('change', onInput);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('error', onError, true);
      if (viewport) {
        viewport.removeEventListener('resize', updateViewport);
        viewport.removeEventListener('scroll', updateViewport);
      }
      if (root.removeEventListener) root.removeEventListener('resize', updateViewport);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (!session.hadBodyLock) document.body.classList.remove('fd-picker-open');
      if (typeof session.options.onClose === 'function') {
        try { session.options.onClose({reason}); } catch (_) { /* Caller failure cannot leave a modal locked open. */ }
      }
      if (active) return; // The caller may open another picker from onClose.
      if (!focusElement(session.opener)) {
        const fallback = document.querySelector('main') || document.body;
        const tabindex = fallback.getAttribute('tabindex');
        fallback.setAttribute('tabindex', '-1'); focusElement(fallback);
        if (tabindex === null) fallback.removeAttribute('tabindex'); else fallback.setAttribute('tabindex', tabindex);
      }
    }

    function open(options) {
      if (active) return false;
      const opts = options || {};
      const catalog = root.FormdayWorkouts && root.FormdayWorkouts.catalog;
      let metadata = [];
      try { if (root.FormdayIronData && typeof root.FormdayIronData.all === 'function') metadata = root.FormdayIronData.all(catalog || []); } catch (_) { /* Catalog remains usable without optional metadata. */ }
      const enrichedCatalog = catalogRows(catalog, metadata).map(row => {
        const media = root.FormdayExerciseMedia && root.FormdayExerciseMedia.byName && root.FormdayExerciseMedia.byName[row.name];
        return media && typeof media.equipment === 'string' && media.equipment.trim() ? {...row, equipment: media.equipment.trim()} : row;
      });
      const model = createModel(enrichedCatalog, opts);
      let favoritesUnavailable = false;
      if (typeof opts.getFavorites === 'function') {
        try { model.setFavorites(opts.getFavorites()); } catch (_) { favoritesUnavailable = true; }
      }
      const dialog = document.createElement('dialog');
      if (typeof dialog.showModal !== 'function') return false;
      const id = 'fd-picker-' + (++sequence);
      dialog.className = 'fd-exercise-picker';
      dialog.setAttribute('aria-labelledby', id + '-title');
      dialog.setAttribute('aria-describedby', id + '-hint');
      const groupOptions = Array.from(new Set(model.rows.map(row => row.group)));
      const equipmentOrder = ['바벨', '덤벨', '머신', '케이블', '맨몸', '기타'];
      const equipmentOptions = Array.from(new Set(model.rows.map(row => row.equipment))).sort((a, b) => {
        const ai = equipmentOrder.indexOf(a), bi = equipmentOrder.indexOf(b);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      const optionMarkup = values => values.map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(value) + '</option>').join('');
      dialog.innerHTML = '<div class="fd-picker-shell">' +
        '<header class="fd-picker-header"><div><p class="fd-picker-eyebrow">FORMDAY · 운동 라이브러리</p>' +
        '<h2 id="' + id + '-title" tabindex="-1">' + escapeHTML(opts.title || '종목 선택') + '</h2>' +
        '<p id="' + id + '-hint" class="fd-picker-hint">' + (model.multiple ? '운동을 선택한 뒤 선택 완료를 눌러 주세요.' : '운동 한 종목을 선택해 주세요.') + '</p></div>' +
        '<button type="button" class="fd-picker-close" data-picker-action="cancel" aria-label="종목 선택 닫기"><span aria-hidden="true">×</span></button></header>' +
        '<div class="fd-picker-tools"><label class="fd-picker-search"><span class="fd-picker-sr-only">운동 이름 또는 초성 검색</span>' +
        '<input type="search" data-picker-query placeholder="운동 이름 또는 초성 검색 (ㅂㅊ)" maxlength="160" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-controls="' + id + '-results"></label>' +
        '<div class="fd-picker-filters"><label><span class="fd-picker-sr-only">운동 부위</span><select data-picker-group aria-label="운동 부위"><option value="">전체 부위</option>' + optionMarkup(groupOptions) + '</select></label>' +
        '<label><span class="fd-picker-sr-only">운동 장비</span><select data-picker-equipment aria-label="운동 장비"><option value="">전체 장비</option>' + optionMarkup(equipmentOptions) + '</select></label>' +
        '<button type="button" class="fd-picker-favorites" data-picker-action="favorites-only" aria-pressed="false"><span aria-hidden="true">☆</span> 즐겨찾기</button></div>' +
        '<div class="fd-picker-selected" data-picker-selected hidden><div class="fd-picker-selected-heading"><span>선택한 운동</span>' +
        '<button type="button" data-picker-action="clear" class="fd-picker-clear">선택 해제</button></div><ul class="fd-picker-chips" data-picker-chips aria-label="선택한 운동"></ul></div></div>' +
        '<div class="fd-picker-results-heading"><span data-picker-results-count role="status" aria-live="polite" aria-atomic="true"></span>' +
        '<button type="button" class="fd-picker-reset" data-picker-action="reset-filters">필터 초기화</button></div>' +
        '<div class="fd-picker-scroll"><ul class="fd-picker-results" id="' + id + '-results" data-picker-results aria-label="운동 목록"></ul>' +
        '<p class="fd-picker-empty" data-picker-empty hidden>조건에 맞는 운동이 없습니다.<br>검색어나 필터를 바꿔 보세요.</p></div>' +
        '<p class="fd-picker-message" data-picker-message role="alert" hidden></p>' +
        '<footer class="fd-picker-footer"><div class="fd-picker-footer-info"><div class="fd-picker-count" data-picker-count role="status" aria-live="polite" aria-atomic="true"></div>' +
        '<a class="fd-picker-attribution" href="exercise-credits.html" target="_blank" rel="noopener noreferrer">운동 이미지 출처 ↗</a></div>' +
        '<button type="button" class="fd-picker-confirm" data-picker-action="confirm" disabled>선택 완료</button></footer></div>';
      const find = selector => dialog.querySelector(selector);
      const nodes = {
        title: find('h2'), query: find('[data-picker-query]'), group: find('[data-picker-group]'), equipment: find('[data-picker-equipment]'),
        favorites: find('[data-picker-action="favorites-only"]'), selected: find('[data-picker-selected]'), chips: find('[data-picker-chips]'),
        results: find('[data-picker-results]'), resultsCount: find('[data-picker-results-count]'), empty: find('[data-picker-empty]'),
        count: find('[data-picker-count]'), confirm: find('[data-picker-action="confirm"]'), message: find('[data-picker-message]')
      };
      const rowIndex = new Map(model.rows.map((row, index) => [row.name, index]));
      const session = {dialog, options: opts, model, nodes, opener: document.activeElement, hadBodyLock: document.body.classList.contains('fd-picker-open'), finished: false};
      const message = text => { nodes.message.textContent = text || ''; nodes.message.hidden = !text; };

      function render(focusTarget) {
        const visible = model.visible();
        const names = model.selection();
        nodes.results.innerHTML = visible.map(row => {
          const index = rowIndex.get(row.name), checked = model.isSelected(row.name), favorite = model.isFavorite(row.name);
          const media = mediaFor(root, row.name);
          const picture = media ? '<img src="' + escapeHTML(media.src) + '" alt="' + escapeHTML(media.alt) + '" loading="lazy" decoding="async" width="112" height="96">' : '<span class="fd-picker-missing">이미지<br>준비 중</span>';
          return '<li class="fd-picker-item" data-selected="' + checked + '"><button type="button" class="fd-picker-choice" data-picker-action="select" data-picker-index="' + index + '" aria-pressed="' + checked + '" aria-label="' + escapeHTML(row.name + (checked ? ' 선택 해제' : ' 선택')) + '">' +
            '<span class="fd-picker-media">' + picture + '</span><span class="fd-picker-copy"><strong>' + escapeHTML(row.name) + '</strong><small>' + escapeHTML(row.group + ' · ' + row.equipment) + '</small></span>' +
            '<span class="fd-picker-indicator" aria-hidden="true">' + (checked ? '✓' : '+') + '</span></button><div class="fd-picker-side">' +
            '<button type="button" class="fd-picker-star" data-picker-action="favorite" data-picker-index="' + index + '" aria-pressed="' + favorite + '" aria-label="' + escapeHTML(row.name + (favorite ? ' 즐겨찾기 해제' : ' 즐겨찾기 추가')) + '"' + (typeof opts.onFavoriteChange !== 'function' || favoritesUnavailable ? ' disabled' : '') + '><span aria-hidden="true">' + (favorite ? '★' : '☆') + '</span></button>' +
            (media && media.sourceUrl ? '<a class="fd-picker-credit" href="' + escapeHTML(media.sourceUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHTML(row.name + ' 이미지 출처') + '">출처 ↗</a>' : '') + '</div></li>';
        }).join('');
        nodes.resultsCount.textContent = visible.length + '개 운동';
        nodes.empty.hidden = visible.length > 0;
        nodes.selected.hidden = !names.length;
        nodes.chips.innerHTML = names.map(name => '<li><button type="button" class="fd-picker-chip" data-picker-action="remove" data-picker-index="' + rowIndex.get(name) + '" aria-label="' + escapeHTML(name + ' 선택 해제') + '">' + escapeHTML(name) + '<span aria-hidden="true">×</span></button></li>').join('');
        nodes.count.textContent = names.length + '개 선택 · 최대 ' + model.limit + '개';
        nodes.confirm.disabled = !names.length || !model.limit;
        nodes.confirm.textContent = names.length ? names.length + '개 선택 완료' : '선택 완료';
        nodes.favorites.setAttribute('aria-pressed', String(model.filters().favoritesOnly));
        if (focusTarget) {
          const action = focusTarget.action, index = focusTarget.index;
          const target = dialog.querySelector('[data-picker-action="' + action + '"]' + (index === undefined ? '' : '[data-picker-index="' + index + '"]'));
          if (!focusElement(target)) focusElement(nodes.title);
        }
      }

      session.onClick = event => {
        if (session.finished) return;
        if (event.target === dialog) { finish(session, 'cancel'); return; }
        const button = event.target && event.target.closest ? event.target.closest('[data-picker-action]') : null;
        if (!button || !dialog.contains(button) || button.disabled) return;
        const action = button.dataset.pickerAction;
        const index = button.dataset.pickerIndex === undefined ? undefined : Number(button.dataset.pickerIndex);
        const row = Number.isInteger(index) ? model.rows[index] : null;
        if (action === 'cancel') { finish(session, 'cancel'); return; }
        message('');
        if (action === 'confirm') {
          const names = model.selection();
          if (!names.length || !model.limit) return;
          try {
            if (typeof opts.onConfirm === 'function' && opts.onConfirm(names.slice()) === true) { finish(session, 'confirmed'); return; }
            message('선택을 적용하지 못했습니다. 현재 선택은 유지됩니다.');
          } catch (_) { message('선택을 적용하지 못했습니다. 현재 선택을 확인한 뒤 다시 시도해 주세요.'); }
          return;
        }
        if (action === 'select' && row) {
          if (model.toggle(row.name) === 'limit') message(model.limit ? '최대 ' + model.limit + '개까지 선택할 수 있습니다. 선택한 운동을 해제한 뒤 다시 골라 주세요.' : '추가할 수 있는 종목 수를 모두 사용했습니다.');
        } else if (action === 'favorite' && row && typeof opts.onFavoriteChange === 'function' && !favoritesUnavailable) {
          // Re-read before a toggle so another tab's changes are not inverted.
          try {
            if (typeof opts.getFavorites === 'function') model.setFavorites(opts.getFavorites());
            const next = !model.isFavorite(row.name);
            if (opts.onFavoriteChange(row.name, next) === true) model.setFavorite(row.name, next);
            else message('즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.');
          } catch (_) { message('즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.'); }
        } else if (action === 'remove' && row) model.remove(row.name);
        else if (action === 'clear') model.clear();
        else if (action === 'favorites-only') model.setFilter('favoritesOnly', !model.filters().favoritesOnly);
        else if (action === 'reset-filters') {
          model.resetFilters(); nodes.query.value = ''; nodes.group.value = ''; nodes.equipment.value = '';
        } else return;
        render({action, index});
      };
      session.onInput = event => {
        if (event.target === nodes.query) model.setFilter('query', nodes.query.value);
        else if (event.target === nodes.group) model.setFilter('group', nodes.group.value);
        else if (event.target === nodes.equipment) model.setFilter('equipment', nodes.equipment.value);
        else return;
        message(''); render();
      };
      session.onCancel = event => { event.preventDefault(); finish(session, 'cancel'); };
      session.onClose = () => finish(session, 'cancel');
      session.onError = event => {
        const image = event.target;
        if (!image || image.tagName !== 'IMG' || !image.parentElement || !image.parentElement.classList.contains('fd-picker-media')) return;
        image.parentElement.innerHTML = '<span class="fd-picker-missing">이미지<br>불러오기 실패</span>';
      };
      session.viewport = root.visualViewport || null;
      session.updateViewport = () => {
        const viewport = session.viewport;
        const height = viewport && viewport.height || root.innerHeight;
        if (Number.isFinite(height) && height > 0) dialog.style.setProperty('--fd-picker-vh', height + 'px');
        dialog.style.setProperty('--fd-picker-vtop', ((viewport && viewport.offsetTop) || 0) + 'px');
        // iOS can resize only visualViewport when a keyboard opens, without
        // changing CSS height media queries. Keep its compact layout in sync.
        dialog.setAttribute('data-picker-compact', String(height <= 560));
        dialog.setAttribute('data-picker-short', String(height <= 420));
      };
      dialog.addEventListener('click', session.onClick);
      dialog.addEventListener('input', session.onInput);
      dialog.addEventListener('change', session.onInput);
      dialog.addEventListener('cancel', session.onCancel);
      dialog.addEventListener('close', session.onClose);
      dialog.addEventListener('error', session.onError, true);
      if (session.viewport) {
        session.viewport.addEventListener('resize', session.updateViewport);
        session.viewport.addEventListener('scroll', session.updateViewport);
      }
      if (root.addEventListener) root.addEventListener('resize', session.updateViewport);
      active = session;
      document.body.appendChild(dialog);
      document.body.classList.add('fd-picker-open');
      session.updateViewport(); render();
      if (!model.limit) message('추가할 수 있는 종목 수를 모두 사용했습니다.');
      else if (favoritesUnavailable) message('즐겨찾기를 불러오지 못했습니다. 운동 선택은 계속할 수 있습니다.');
      try { dialog.showModal(); focusElement(nodes.title); }
      catch (_) { finish(session, 'cancel'); return false; }
      return true;
    }

    return Object.freeze({open, isOpen: () => !!active, close: () => { if (active) finish(active, 'cancel'); }});
  }

  return {createPicker, createModel, catalogRows, matchesName, initials, safeURL};
});
