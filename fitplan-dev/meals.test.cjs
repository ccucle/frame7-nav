'use strict';

// The adapter models only the editor's input/event contract. Layout and native
// number-input behavior are verified separately in the browser.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const M = require('../fitplan/meals.js');
const N = require('../fitplan/nutrition.js');
const decode = value => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (html, name) => decode((html.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')) || [])[1]);
const food = (overrides = {}) => N.validateFood({ id: 'user-one', name: '단백질 바', nameEn: '', brand: '테스트', basisAmount: 45, basisUnit: 'g', nutrients: { kcal: 180, protein: 15, carbs: 18, fat: 6, unsat: null }, source: { kind: 'user' }, ...overrides });
const meal = () => ({ items: [{ id: 'item-one', food: food(), amount: 45 }], notes: '' });
function node(value = '') {
  return { value, dataset: {}, textContent: '', hidden: false, disabled: false, attrs: {}, html: '',
    get innerHTML() { return this.html; }, set innerHTML(html) { this.html = html; if (this.onHTML) this.onHTML(html); },
    setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; }, querySelector() { return null; } };
}
function harness(detail = {}, options = {}) {
  const listeners = new Map(), nodes = new Map();
  let amounts = [], custom = [], tabs = ['all', 'favorites', 'custom'].map(tab => ({ ...node(), dataset: { tab } }));
  const selectors = ['summary', 'items', 'count', 'custom', 'results', 'error', 'search-panel'];
  for (const key of selectors) nodes.set('[data-fm-' + key + ']', node());
  nodes.set('[data-fm-field="notes"]', node()); nodes.set('[data-fm-field="search"]', node());
  nodes.get('[data-fm-items]').onHTML = html => {
    amounts = [...html.matchAll(/<input\b[^>]*data-fm-amount="[^"]*"[^>]*>/g)].map(match => {
      const input = node(attr(match[0], 'value'));
      input.dataset.fmAmount = attr(match[0], 'data-fm-amount');
      input.closest = () => ({ querySelector: () => node() });
      return input;
    });
  };
  nodes.get('[data-fm-custom]').onHTML = html => {
    custom = [...html.matchAll(/<(?:input|select)\b[^>]*data-fm-custom-field="[^"]*"[^>]*>/g)].map(match => {
      const input = node(attr(match[0], 'value'));
      input.dataset.fmCustomField = attr(match[0], 'data-fm-custom-field');
      if (input.dataset.fmCustomField === 'basisUnit') {
        const options = html.slice(match.index, html.indexOf('</select>', match.index));
        input.value = (options.match(/<option value="([^"]*)" selected/) || [])[1] || 'g';
      }
      return input;
    });
    nodes.set('[data-fm-custom-error]', node());
  };
  const container = {
    html: '', get innerHTML() { return this.html; }, set innerHTML(html) {
      this.html = html;
      nodes.get('[data-fm-field="notes"]').value = decode((html.match(/<textarea\b[^>]*data-fm-field="notes"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1]);
    },
    querySelector(selector) {
      const key = (selector.match(/\[data-fm-custom-field="([^"]+)"\]/) || [])[1];
      return key ? custom.find(input => input.dataset.fmCustomField === key) || null : nodes.get(selector) || null;
    },
    querySelectorAll(selector) { return selector === '[data-fm-amount]' ? amounts : selector === '[data-fm-custom-field]' ? custom : selector === '[data-fm-action="tab"]' ? tabs : []; },
    addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); },
    contains() { return true; }, closest() { return null; }
  };
  const controller = M.mount(container, detail, { loadCatalog: async () => ({ meta: {}, foods: [] }), ...options });
  return {
    controller, nodes, container, listeners,
    input(key, value) {
      let target;
      if (key === 'notes' || key === 'search') { target = nodes.get('[data-fm-field="' + key + '"]'); target.dataset.fmField = key; }
      else if (key.startsWith('custom:')) target = custom.find(input => input.dataset.fmCustomField === key.slice(7));
      else target = amounts.find(input => input.dataset.fmAmount === key);
      assert.ok(target, 'input exists: ' + key); target.value = String(value);
      listeners.get('input')({ target }); return target;
    },
    click(action, id, extra = {}) {
      const button = { disabled: false, dataset: { fmAction: action, id, ...extra }, closest() { return this; } };
      listeners.get('click')({ target: button, preventDefault() {} });
    },
    html(key) { return nodes.get('[data-fm-' + key + ']').innerHTML; },
    amounts() { return amounts; }
  };
}
function fillProduct(h, overrides = {}) {
  const values = { name: '직접 입력 제품', brand: '브랜드', basisAmount: '45', basisUnit: 'g', kcal: '180', protein: '15', carbs: '18', fat: '6', unsat: '', url: '', ...overrides };
  for (const [key, value] of Object.entries(values)) h.input('custom:' + key, value);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('empty meals stay empty until a food is added; save requires an item', () => {
  const h = harness();
  assert.deepEqual(h.controller.draft(), { items: [], notes: '' });
  assert.throws(() => h.controller.read(), /1개 이상/);
  h.controller.destroy();
});

test('blank and invalid amounts survive unrelated UI actions, never become zero', async () => {
  let changes = 0;
  const h = harness(meal(), { customFoods: [food()], onToggleFavorite: () => true, onChange: () => changes++ });
  h.input('item-one', ''); h.click('favorite', 'user-one'); h.click('tab', undefined, { tab: 'custom' });
  assert.equal(h.controller.draft().items[0].amount, '');
  assert.throws(() => h.controller.read(), /섭취량/);
  assert.match(h.html('summary'), /1개가 합계에서 빠져/);
  assert.equal(changes, 1);
  h.input('item-one', '-5'); assert.throws(() => h.controller.read(), /섭취량/);
  h.input('item-one', '90'); assert.equal(h.controller.read().items[0].amount, 90);
  assert.equal(N.calculateMeal(h.controller.read()).kcal, 360);
  await tick(); h.controller.destroy();
});

test('missing unsaturated fat is labeled missing, while a known zero stays zero', () => {
  const h = harness(meal());
  assert.match(h.html('summary'), /불포화지방[\s\S]*정보 없음/);
  assert.match(h.html('summary'), /0g으로 간주하지 않습니다/);
  h.controller.destroy();
  const known = meal(); known.items[0].food.nutrients.unsat = 0;
  const h2 = harness(known);
  assert.doesNotMatch(h2.html('summary'), /0g으로 간주하지 않습니다/);
  assert.equal(N.calculateMeal(h2.controller.read()).unsat, 0);
  h2.controller.destroy();
});

test('product edits are explicit saves and never alter meal snapshots', () => {
  let saved;
  const h = harness(meal(), { customFoods: [food({ nameEn: 'Original product label', category: 'Imported product group' })], onSaveFood: product => (saved = product) });
  h.click('edit-custom', 'user-one'); fillProduct(h, { kcal: '200', name: '수정된 제품' });
  assert.throws(() => h.controller.read(), /아직 저장하지 않은 제품 입력/);
  h.click('save-custom');
  assert.equal(saved.id, 'user-one'); assert.equal(saved.nutrients.kcal, 200);
  assert.equal(saved.nameEn, 'Original product label'); assert.equal(saved.category, 'Imported product group');
  assert.equal(saved.nutrients.unsat, null);
  assert.equal(h.controller.read().items[0].food.nutrients.kcal, 180);
  assert.equal(h.controller.read().items[0].food.name, '단백질 바');
  h.click('add-food', 'user-one');
  const result = h.controller.read();
  assert.equal(result.items[1].food.nutrients.kcal, 200);
  assert.equal(result.items[1].amount, 45);
  result.items[1].food.nutrients.kcal = 999;
  assert.equal(h.controller.read().items[1].food.nutrients.kcal, 200);
  h.controller.destroy();
});

test('failed product storage keeps the complete input and blocks schedule save', () => {
  const h = harness(meal(), { onSaveFood: () => null });
  h.click('new-custom'); fillProduct(h); h.click('save-custom');
  const current = h.controller.draft();
  assert.equal(current._mealEditor.customDraft.raw.name, '직접 입력 제품');
  assert.equal(current._mealEditor.customDraft.raw.unsat, '');
  assert.equal(current._mealEditor.customDraft.dirty, true);
  assert.throws(() => h.controller.read(), /먼저 “내 식품에 저장”/);
  assert.match(h.nodes.get('[data-fm-custom-error]').textContent, /저장하지 못했습니다/);
  h.controller.destroy();
});

test('a draft round trip preserves custom form input, invalid amounts, and memo', () => {
  const h = harness(meal());
  h.input('item-one', ''); h.input('notes', '남겨 둔 메모'); h.click('new-custom');
  fillProduct(h, { name: '아직 등록 전', kcal: '' });
  const raw = h.controller.draft(); h.controller.destroy();
  const restored = harness(raw);
  assert.equal(restored.controller.draft().items[0].amount, '');
  assert.equal(restored.controller.draft().notes, '남겨 둔 메모');
  assert.equal(restored.controller.draft()._mealEditor.customDraft.raw.kcal, '');
  assert.match(restored.html('custom'), /아직 등록 전/);
  assert.throws(() => restored.controller.read(), /아직 저장하지 않은 제품 입력/);
  restored.controller.destroy();
});

test('catalog search paginates at 50 results and has no side effect on meal drafts', async () => {
  let changes = 0;
  const foods = Array.from({ length: 123 }, (_, index) => ({ id: 'usda-sr-' + (10000 + index), fdcId: 10000 + index, nameEn: 'Chicken breast ' + index, nameKo: index === 0 ? '닭 가슴살' : null, aliases: index === 0 ? ['닭가슴살', 'chicken breast'] : [], category: 'Poultry', per100g: { kcal: 120, protein: 23, carbs: 0, fat: 2, unsat: null }, sourceUrl: 'https://fdc.nal.usda.gov/download-datasets/' }));
  const h = harness(meal(), { loadCatalog: async () => ({ meta: { datasetDate: '2018-04' }, foods }), onChange: () => changes++ });
  await tick();
  assert.equal((h.html('results').match(/class="fm-result"/g) || []).length, 50);
  assert.match(h.html('results'), /123/);
  h.click('next-page'); assert.equal((h.html('results').match(/class="fm-result"/g) || []).length, 50);
  h.click('next-page'); assert.equal((h.html('results').match(/class="fm-result"/g) || []).length, 23);
  h.input('search', '닭가슴살'); h.click('tab', undefined, { tab: 'all' });
  assert.equal((h.html('results').match(/class="fm-result"/g) || []).length, 1);
  assert.equal(changes, 0);
  assert.match(h.container.innerHTML, /data-meal-ui-only/);
  h.controller.destroy();
});

test('catalog search matches every token regardless of English word order or punctuation', async () => {
  const foods = [
    ['usda-sr-171077', 'Chicken, broilers or fryers, breast, meat only, raw', '닭 가슴살'],
    ['usda-sr-171477', 'Chicken, breast, skinless, boneless, meat only, cooked', null],
    ['usda-sr-bread', 'Bread, whole-wheat, commercially prepared', null],
    ['usda-sr-leg', 'Chicken, leg, meat only, raw', null],
    ['usda-sr-white', 'Bread, white, commercially prepared', null]
  ].map(([id, nameEn, nameKo]) => ({ id, nameEn, nameKo, aliases: [], category: '', per100g: { kcal: 120, protein: 10, carbs: 10, fat: 4, unsat: null }, sourceUrl: 'https://fdc.nal.usda.gov/download-datasets/' }));
  const h = harness({}, { loadCatalog: async () => ({ meta: {}, foods }) });
  await tick();
  const search = query => {
    h.input('search', query); h.click('tab', undefined, { tab: 'all' });
    return h.html('results');
  };
  const bread = search('whole wheat bread');
  assert.equal((bread.match(/class="fm-result"/g) || []).length, 1);
  assert.match(bread, /Bread, whole-wheat/); assert.doesNotMatch(bread, /Bread, white/);
  for (const query of ['chicken breast', 'breast chicken', 'CHICKEN, BREAST']) {
    const result = search(query);
    assert.equal((result.match(/class="fm-result"/g) || []).length, 2, query);
    assert.match(result, /data-id="usda-sr-171077"/); assert.match(result, /data-id="usda-sr-171477"/);
    assert.doesNotMatch(result, /data-id="usda-sr-leg"/);
  }
  assert.equal((search('닭가슴살').match(/class="fm-result"/g) || []).length, 1);
  assert.equal((search('닭 가슴살').match(/class="fm-result"/g) || []).length, 1);
  h.controller.destroy();
});

test('library callback failures do not change favorite or remove food', async () => {
  const previousConfirm = globalThis.confirm; globalThis.confirm = () => true;
  try {
    const h = harness(meal(), { customFoods: [food()], favoriteFoodIds: [], onToggleFavorite: () => false, onDeleteFood: () => false });
    await tick();
    h.click('favorite', 'user-one'); assert.match(h.html('results'), /aria-pressed="false"/);
    h.click('delete-custom', 'user-one');
    assert.match(h.html('results'), /단백질 바/); assert.equal(h.controller.read().items.length, 1);
    h.controller.destroy();
  } finally { globalThis.confirm = previousConfirm; }
});

test('user strings are escaped and source links reject unsafe schemes', () => {
  const input = meal(); input.items[0].food.name = '<img src=x onerror=alert(1)>';
  const h = harness(input);
  assert.match(h.html('items'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(h.html('items'), /<img/);
  h.controller.destroy();
  input.items[0].food.source.url = 'javascript:alert(1)';
  assert.throws(() => harness(input), /HTTPS/);
});

test('destroy removes listeners and ignores catalog responses after unmount', async () => {
  let finish;
  const h = harness(meal(), { loadCatalog: () => new Promise(resolve => { finish = resolve; }) });
  const previous = h.html('results'); h.controller.destroy();
  assert.equal(h.listeners.size, 0);
  finish({ meta: {}, foods: [] }); await tick();
  assert.equal(h.html('results'), previous);
});

test('manual comment template is optional, preserves old notes, and cannot duplicate headings',()=>{
 const h=harness({...meal(),notes:'기존 메모'});
 h.click('comment-template');
 const notes=h.controller.read().notes;
 assert.ok(notes.startsWith('기존 메모'));
 assert.match(notes,/음식별 코멘트:\n- 단백질 바:/);
 assert.match(notes,/식사별 코멘트:/);
 assert.match(notes,/사용자 메모:/);
 h.click('comment-template');
 assert.equal(h.controller.read().notes,notes);
 h.input('notes',notes+'직접 작성한 메모');
 assert.equal(h.controller.read().notes,notes+'직접 작성한 메모');
 h.controller.destroy();
});
test('manual comment template never truncates an existing memo',()=>{
 const notes='가'.repeat(1995),h=harness({...meal(),notes});
 h.click('comment-template');
 assert.equal(h.controller.read().notes,notes);
 h.controller.destroy();
});
