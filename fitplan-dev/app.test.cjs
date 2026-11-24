'use strict';

// Integration smoke tests for the real browser scripts. This intentionally
// small DOM adapter covers startup, settings and backup handlers. It is not a
// browser layout engine and does not replace the deployed UI checks.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../fitplan/core.js');
const N = require('../fitplan/nutrition.js');
const directory = path.join(__dirname, '../fitplan');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const scripts = ['data.js', 'workouts.js', 'nutrition.js', 'core.js', 'iron-data.js', 'meals.js', 'app.js'].map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
const decode = (s = '') => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
class ClassList {
  constructor(value = '') { this.items = new Set(value.split(/\s+/).filter(Boolean)); }
  add(...names) { names.forEach((name) => this.items.add(name)); }
  remove(...names) { names.forEach((name) => this.items.delete(name)); }
  contains(name) { return this.items.has(name); }
  toggle(name, enabled = !this.contains(name)) { if (enabled) this.add(name); else this.remove(name); return enabled; }
}
class Element {
  constructor(document, tagName = 'div', attrs = {}, parent = null) {
    this.document = document; this.ownerDocument = document; this.tagName = tagName.toUpperCase(); this.parent = parent;
    this.attrs = attrs; this.id = attrs.id || ''; this.classList = new ClassList(attrs.class);
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value]));
    this.value = attrs.value || ''; this.checked = Object.hasOwn(attrs, 'checked'); this.disabled = Object.hasOwn(attrs, 'disabled');
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.inert = false; this.isConnected = true;
    this.children = []; this.listeners = new Map(); this._html = ''; this.textContent = '';
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); this.document.parse(this, this._html); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener)); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) { const match = selector.match(/^\[([^=\]]+)(?:="([^\"]*)")?\]$/); return !!match && Object.hasOwn(this.attrs, match[1]) && (match[2] === undefined || this.attrs[match[1]] === match[2]); }
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  contains(node) { for (let current = node; current; current = current.parent) if (current === this) return true; return false; }
  querySelector(selector) { return this.document.querySelectorAll(selector).find((node) => node !== this && this.contains(node)) || null; }
  querySelectorAll(selector) { return this.document.querySelectorAll(selector).filter((node) => node !== this && this.contains(node)); }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
  getClientRects() { return this.hidden ? [] : [{}]; }
  appendChild(node) { node.parent = this; this.children.push(node); this.document.nodes.add(node); }
  remove() { this.document.remove(this); }
  insertAdjacentHTML(_, value) { this.innerHTML += value; }
  click() {
    if (this.disabled) return;
    const event = { target: this, preventDefault() {} };
    this.onclick?.(event);
    for (const listener of this.listeners.get('click') || []) listener(event);
    for (const listener of this.document.listeners.get('click') || []) listener(event);
  }
}
class DocumentStub {
  constructor() { this.nodes = new Set(); this.listeners = new Map(); this.body = new Element(this, 'body'); this.activeElement = this.body; this.hidden = false; }
  parse(owner, markup) {
    for (const child of owner.children.slice()) this.remove(child);
    owner.children = [];
    for (const match of markup.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
      const attrs = {};
      for (const attr of match[2].matchAll(/([\w:-]+)(?:="([^\"]*)"|'([^']*)')?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? '');
      const node = new Element(this, match[1], attrs, owner);
      owner.children.push(node); this.nodes.add(node);
    }
  }
  remove(node) { for (const child of node.children.slice()) this.remove(child); this.nodes.delete(node); node.isConnected = false; if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); }
  querySelectorAll(selector) { return [...this.nodes].filter((node) => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener)); }
  createElement(tagName) { return new Element(this, tagName); }
}
function boot(raw, options = {}) {
  const document = new DocumentStub(); document.body.innerHTML = html;
  const map = new Map(raw === undefined ? [] : [[C.STORE, raw]]), writes = [], confirmations = [], downloads = [], windowListeners = new Map();
  let failWrites = false, unique = 0;
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) { if (failWrites && key === C.STORE) throw new Error('QuotaExceededError'); writes.push([key, value]); map.set(key, value); }
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-23T12:00:00Z'])); } static now() { return Date.parse('2026-11-23T12:00:00Z'); } }
  class TestURL extends URL {
    static createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({ document, Date: FixedDate, console, localStorage: storage,
    crypto: { randomUUID: () => 'test-' + ++unique },
    setTimeout: () => ++unique, clearTimeout() {}, setInterval: () => ++unique, clearInterval() {}, requestAnimationFrame: (fn) => fn(),
    confirm(message) { confirmations.push(message); return options.confirm !== false; },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    dispatchEvent(event) { windowListeners.get(event.type)?.(event); return true; },
    CustomEvent: class { constructor(type) { this.type = type; } },
    Blob, URL: TestURL, AbortController,
    fetch: options.fetch || (async () => { throw new Error('Test fetch unavailable'); })
  });
  context.window = context;
  let ironSnapshot = options.iron;
  const setIronSnapshot = value => {
    ironSnapshot = value;
    context.FormdayIndependent = { getSnapshot: () => ironSnapshot, renderCalendar: options.renderIronCalendar || (() => {}) };
  };
  if (options.iron) setIronSnapshot(options.iron);
  if (options.storageDenied) Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  for (const [name, code] of scripts) {
    if (name === 'app.js' && options.mealMount) context.FormdayMeals = { mount: options.mealMount };
    vm.runInContext(code, context, { filename: name });
  }
  return { document, context, map, writes, storage, confirmations, downloads, windowListeners,
    setIronSnapshot(value) { setIronSnapshot(value); context.dispatchEvent(new context.CustomEvent('formday:iron-changed')); },
    get: (id) => document.querySelector('#' + id),
    failWrites(value = true) { failWrites = value; },
    async importText(text) {
      const node = document.querySelector('#import-file'); node.value = 'backup.json';
      node.onchange({ target: { files: [{ size: Buffer.byteLength(text), text: async () => text }] } });
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}
const legacyEvent = (overrides = {}) => ({ id: 'legacy-workout', date: '2026-11-23', start: '07:00', end: '08:00', type: 'strength', title: '기존 벤치 기록', repeat: 'none', completed: true, detail: { exercise: '벤치프레스', sets: 3, weight: 60, reps: 10, notes: '이전 메모' }, ...overrides });
const legacyState = () => ({ events: [legacyEvent()], settings: { protein: 150, carbs: 200, fat: 50 } });

test('empty storage starts the real scripts, renders the calendar and labels samples without auto-saving', () => {
  const app = boot();
  assert.equal(app.get('date-heading').textContent, '2026년 11월');
  assert.equal((app.get('calendar').innerHTML.match(/class="month-cell /g) || []).length, 42);
  assert.equal(app.get('stat-workout').textContent, '0 / 0');
  assert.match(app.get('stat-kcal').innerHTML, /^0 /);
  assert.equal(app.get('stat-weight').innerHTML, '—');
  assert.equal(app.get('demo-banner').classList.contains('hide'), false);
  assert.match(app.get('storage-status').innerHTML, /이 기기에 저장/);
  assert.equal(app.writes.length, 0); assert.equal(app.map.size, 0);
  assert.equal(typeof app.get('settings-btn').onclick, 'function');
  assert.equal(typeof app.get('import-file').onchange, 'function');
});

test('legacy valid storage renders migrated completed sets and preserves original raw bytes until save', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  assert.match(app.get('calendar').innerHTML, /기존 벤치 기록/);
  assert.equal(app.get('stat-workout').textContent, '1 / 1');
  assert.match(app.get('workout-progress').innerHTML, /1,800/);
  assert.match(app.get('agenda').innerHTML, /3\/3세트 완료/);
  assert.equal(app.get('demo-banner').classList.contains('hide'), true);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
});

test('calendar statistics refresh when independent completed or partial workouts change, without saving either store', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  const session = { id: 'independent', date: '2026-11-23', label: '새 웨이트', status: 'PARTIAL', exercises: [{
    id: 'ex', name: '스쿼트', sets: [
      { id: 'main', weight: 100, reps: 5, done: true, warmup: false },
      { id: 'warm', weight: 500, reps: 1, done: true, warmup: true },
      { id: 'planned', weight: 100, reps: 5, done: false, warmup: false }
    ]
  }] };
  app.setIronSnapshot({ sessions: [session], routines: [], programs: [] });
  assert.equal(app.get('stat-workout').textContent, '2 / 2');
  assert.match(app.get('workout-progress').innerHTML, /4<small> \/ 5/);
  assert.match(app.get('workout-progress').innerHTML, /2,300/);
  app.setIronSnapshot({ sessions: [{ ...session, status: 'PAUSED' }], routines: [], programs: [] });
  assert.equal(app.get('stat-workout').textContent, '1 / 1');
  assert.match(app.get('workout-progress').innerHTML, /1,800/);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('calendar period navigation always refreshes the independent selected-day cards', () => {
  let renders = 0;
  const app = boot(JSON.stringify(legacyState()), { iron: { sessions: [] }, renderIronCalendar() { renders++; } });
  const initial = renders;
  app.get('prev').click();
  assert.equal(app.context.FormdayBridge.getSelectedDay(), '2026-10-01');
  assert.ok(renders > initial);
  const previous = renders;
  app.get('today').click();
  assert.equal(app.context.FormdayBridge.getSelectedDay(), '2026-11-23');
  assert.ok(renders > previous);
  assert.equal(app.writes.length, 0);
});

test('corrupt saved JSON shows recovery banner and blocks new writes without overwriting the raw record', () => {
  const raw = '{broken previous data', app = boot(raw);
  assert.equal(app.get('storage-status').classList.contains('storage-error'), true);
  assert.match(app.get('storage-status').innerHTML, /원본을 보존/);
  assert.ok(app.get('export-raw'));
  assert.equal(app.get('stat-workout').textContent, '0 / 0');
  assert.equal(app.get('demo-banner').classList.contains('hide'), true);
  app.get('new-event').click();
  assert.equal(app.get('modal-root').children.length, 0);
  assert.match(app.get('toast-root').innerHTML, /백업을 복원/);
  app.get('settings-btn').click(); app.get('save-settings').click();
  assert.match(app.get('storage-status').innerHTML, /기존 기록을 읽지 못했습니다/);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
});

test('denied localStorage still renders a protected empty calendar', () => {
  const app = boot(undefined, { storageDenied: true });
  assert.match(app.get('calendar').innerHTML, /month-grid/);
  assert.equal(app.get('storage-status').classList.contains('storage-error'), true);
  assert.equal(app.get('stat-workout').textContent, '0 / 0');
  assert.equal(app.writes.length, 0);
});

test('invalid or zero-total nutrition goals keep the dialog and saved record intact', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  app.get('settings-btn').click();
  app.get('s-protein').value = ''; app.get('save-settings').click();
  assert.equal(app.get('form-error').classList.contains('hide'), false);
  assert.ok(app.get('form-error').textContent.length > 0);
  for (const key of ['protein', 'carbs', 'fat']) app.get('s-' + key).value = '0';
  app.get('save-settings').click();
  assert.match(app.get('form-error').textContent, /열량|목표/);
  assert.ok(app.get('save-settings'));
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
});

test('failed settings persistence keeps the dialog draft and prior rendered data; retry succeeds', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  app.get('settings-btn').click();
  app.get('s-protein').value = '170'; app.get('s-carbs').value = '220'; app.get('s-fat').value = '60';
  app.failWrites(); app.get('save-settings').click();
  assert.equal(app.get('s-protein').value, '170');
  assert.equal(app.get('storage-status').classList.contains('storage-error'), true);
  assert.equal(app.map.get(C.STORE), raw);
  assert.match(app.get('stat-kcal-note').textContent, /1,850/);
  app.failWrites(false); app.get('save-settings').click();
  assert.equal(app.get('modal-root').children.length, 0);
  assert.equal(JSON.parse(app.map.get(C.STORE)).settings.protein, 170);
  assert.match(app.get('stat-kcal-note').textContent, /2,100/);
  assert.equal(app.get('storage-status').classList.contains('storage-error'), false);
});

test('weight goal settings validate, persist, and clear without replacing existing records', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  app.get('settings-btn').click();
  assert.equal(app.get('s-target-weight').value, '');
  app.get('s-target-weight').value = '501'; app.get('save-settings').click();
  assert.match(app.get('form-error').textContent, /목표 체중/);
  assert.equal(app.map.get(C.STORE), raw);
  app.get('s-target-weight').value = '75.5'; app.get('save-settings').click();
  const saved = JSON.parse(app.map.get(C.STORE));
  assert.equal(saved.settings.targetWeight, 75.5);
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].id, legacyEvent().id);
  app.get('settings-btn').click();
  assert.equal(app.get('s-target-weight').value, '75.5');
  app.get('s-target-weight').value = ''; app.get('save-settings').click();
  assert.equal(JSON.parse(app.map.get(C.STORE)).settings.targetWeight, null);
});

test('invalid backup import does not ask to replace or write current records', async () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  await app.importText('{invalid json');
  assert.match(app.get('toast-root').innerHTML, /백업을 가져오지 않았습니다/);
  assert.equal(app.confirmations.length, 0); assert.equal(app.writes.length, 0);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.get('import-file').value, '');
  await app.importText(JSON.stringify({ ...legacyState(), settings: { protein: -1, carbs: 200, fat: 50 } }));
  assert.equal(app.confirmations.length, 0); assert.equal(app.writes.length, 0);
  assert.equal(app.map.get(C.STORE), raw);
});

test('valid backup recovers corrupt storage only after confirmation and retains the old raw backup', async () => {
  const raw = '{corrupt original', app = boot(raw);
  const restored = legacyState(); restored.events[0].title = '복구된 운동 기록';
  await app.importText(JSON.stringify(restored));
  assert.equal(app.confirmations.length, 1);
  assert.equal(app.get('storage-status').classList.contains('storage-error'), false);
  assert.match(app.get('calendar').innerHTML, /복구된 운동 기록/);
  assert.equal(JSON.parse(app.map.get(C.STORE)).events[0].title, '복구된 운동 기록');
  assert.ok([...app.map.entries()].some(([key, value]) => key !== C.STORE && value === raw));
  assert.equal(app.get('import-file').value, '');
});

test('declining a valid import keeps current data unchanged', async () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw, { confirm: false });
  await app.importText(JSON.stringify({ ...legacyState(), events: [] }));
  assert.equal(app.confirmations.length, 1); assert.equal(app.writes.length, 0);
  assert.equal(app.map.get(C.STORE), raw);
  assert.match(app.get('calendar').innerHTML, /기존 벤치 기록/);
});

const food = (changes = {}) => N.validateFood({
  id: 'user-food', name: '사용자 제품', nameEn: '', brand: '', category: '', basisAmount: 100, basisUnit: 'g',
  nutrients: { kcal: 100, protein: 10, carbs: 20, fat: 1, unsat: 0.5 },
  source: { kind: 'user', url: 'https://example.com/product-label' }, ...changes
});
const mealEvent = (detail, changes = {}) => legacyEvent({ id: 'meal1', type: 'meal', title: '식사', detail, start: '12:00', end: '12:30', ...changes });
const mealDetail = (source, amount = 100) => ({ items: [{ id: 'item1', food: source, amount }], notes: '' });
const stateWith = (...events) => C.normalizeState({ events, settings: { ...C.defaults } });
const dummyMealController = () => ({ read() { throw new Error('음식을 추가해 주세요.'); }, draft() { return { items: [], notes: '' }; }, destroy() {} });

test('v2 legacy meals preserve the 365.5 kcal total and visibly identify legacy nutrition values', () => {
  const old = { version: 2, schemaVersion: 2, events: [
    mealEvent({ food: '그릭요거트(무지방)', grams: 200 }, { id: 'yogurt', start: '08:00', end: '08:30' }),
    mealEvent({ food: '닭가슴살(조리)', grams: 150 }, { id: 'chicken' })
  ], settings: { ...C.defaults } };
  const raw = JSON.stringify(old), app = boot(raw);
  assert.match(app.get('stat-kcal').innerHTML, /^365\.5 /);
  assert.match(app.get('stat-protein').innerHTML, /^66\.9 /);
  assert.match(app.get('nutrition').innerHTML, /기존 샘플 영양정보 2개 포함/);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('v3 daily nutrition sums the foods in completed meals and excludes planned meals', () => {
  const a = food();
  const b = food({ id: 'label45', basisAmount: 45, nutrients: { kcal: 90, protein: 4, carbs: 12, fat: 2, unsat: 1 } });
  const multiple = { items: [{ id: 'a', food: a, amount: 150 }, { id: 'b', food: b, amount: 22.5 }], notes: '두 음식' };
  const state = stateWith(mealEvent(multiple), mealEvent(mealDetail(a, 1000), { id: 'planned', completed: false, start: '19:00', end: '19:30' }));
  const app = boot(JSON.stringify(state));
  assert.match(app.get('stat-kcal').innerHTML, /^195 /);
  assert.match(app.get('stat-protein').innerHTML, /^17 /);
  assert.match(app.get('agenda').innerHTML, /외 1가지/);
  assert.equal(app.get('agenda-count').textContent, '1/2 완료');
  assert.doesNotMatch(app.get('nutrition').innerHTML, /legacy-info|missing-info/);
  const plannedOnly = boot(JSON.stringify(stateWith(mealEvent(multiple, { completed: false }))));
  assert.match(plannedOnly.get('stat-kcal').innerHTML, /^0 /);
  assert.match(plannedOnly.get('stat-protein').innerHTML, /^0 /);
});

test('sample and future-completed food and weight records stay visible as entries but never inflate actual summaries', () => {
  const day = '2026-11-23';
  const state = stateWith(
    mealEvent(mealDetail(food(), 100)),
    mealEvent(mealDetail(food(), 1000), { id: 'demo-meal', isSample: true }),
    mealEvent(mealDetail(food(), 1000), { id: 'future-meal', date: '2026-11-24' }),
    { id: 'real-weight', date: day, start: '07:00', end: '07:05', type: 'weight', title: '실제 체중', repeat: 'none', completed: true, detail: { weight: 75 } },
    { id: 'demo-weight', date: day, start: '08:00', end: '08:05', type: 'weight', title: '체중 예시', repeat: 'none', completed: true, isSample: true, detail: { weight: 90 } },
    { id: 'future-weight', date: '2026-11-24', start: '08:00', end: '08:05', type: 'weight', title: '미래 측정', repeat: 'none', completed: true, detail: { weight: 100 } }
  );
  const raw = JSON.stringify(state), app = boot(raw);
  assert.match(app.get('stat-kcal').innerHTML, /^100 /);
  assert.match(app.get('stat-weight').innerHTML, /^75 /);
  assert.match(app.get('agenda').innerHTML, /체중 예시/);
  app.document.querySelector('[data-day="2026-11-24"]').click();
  assert.match(app.get('stat-kcal').innerHTML, /^0 /);
  assert.match(app.get('stat-weight').innerHTML, /^75 /);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('all missing unsaturated-fat values render as unknown rather than zero grams', () => {
  const unknown = food({ nutrients: { kcal: 100, protein: 10, carbs: 20, fat: 1, unsat: null } });
  const app = boot(JSON.stringify(stateWith(mealEvent(mealDetail(unknown)))));
  assert.match(app.get('stat-kcal').innerHTML, /^100 /);
  assert.match(app.get('nutrition').innerHTML, /class="unsat-total"[\s\S]*?<strong>미확인<\/strong>/);
  assert.match(app.get('nutrition').innerHTML, /불포화지방 1개 식품/);
  assert.doesNotMatch(app.get('nutrition').innerHTML, /class="unsat-total"[\s\S]*?<strong>0g<\/strong>/);
});

test('partially known meal totals display a partial-sum marker and the missing nutrient counts', () => {
  const unknown = N.normalizeMeal({ food: '아직 영양정보가 없는 기존 음식', grams: 150 }).items[0];
  const detail = { items: [{ id: 'known', food: food(), amount: 100 }, { ...unknown, id: 'missing' }], notes: '' };
  const app = boot(JSON.stringify(stateWith(mealEvent(detail))));
  assert.match(app.get('stat-kcal').innerHTML, /^100 \+ /);
  assert.match(app.get('stat-protein').innerHTML, /^10 \+ /);
  assert.match(app.get('nutrition').innerHTML, /칼로리 1개 식품/);
  assert.match(app.get('nutrition').innerHTML, /부분 합계/);
  assert.match(app.get('nutrition').innerHTML, /미확인 값을 0으로 간주하지 않습니다/);
  assert.match(app.get('stat-protein-note').textContent, /미확인 식품 1개/);
});

test('v3 import and export keep product snapshots, saved products and favorites together', async () => {
  const product = food();
  let imported = N.upsertCustomFood(stateWith(mealEvent(mealDetail(product, 175))), product);
  imported = N.toggleFavorite(imported, product.id);
  imported = N.toggleFavorite(imported, 'usda-sr-171477');
  const app = boot(JSON.stringify(legacyState()));
  await app.importText(JSON.stringify({ app: 'formday', version: 3, ...imported }));
  const saved = JSON.parse(app.map.get(C.STORE));
  assert.equal(saved.customFoods.length, 1);
  assert.equal(saved.customFoods[0].id, product.id);
  assert.deepEqual(saved.favoriteFoodIds, [product.id, 'usda-sr-171477']);
  assert.deepEqual(saved.events[0].detail, imported.events[0].detail);
  assert.match(app.confirmations[0], /내 식품 1개/);
  assert.match(app.get('stat-kcal').innerHTML, /^175 /);
  app.get('export-btn').click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.equal(exported.app, 'formday');
  assert.equal(exported.version, 3);
  assert.deepEqual(exported.customFoods, saved.customFoods);
  assert.deepEqual(exported.favoriteFoodIds, saved.favoriteFoodIds);
  assert.deepEqual(exported.events, saved.events);
});

test('failed product, delete and favorite callbacks leave both stored and in-memory records unchanged', async () => {
  const originalFood = food();
  let initial = N.upsertCustomFood(stateWith(mealEvent(mealDetail(originalFood))), originalFood);
  initial = N.toggleFavorite(initial, originalFood.id);
  const raw = JSON.stringify(initial);
  let callbacks;
  const app = boot(raw, { mealMount(container, detail, options) { callbacks = options; return dummyMealController(); } });
  app.get('new-meal').click();
  assert.ok(callbacks);
  const added = food({ id: 'new-product', name: '저장할 새 제품' });
  app.failWrites();
  assert.equal(callbacks.onSaveFood(added), null);
  assert.equal(callbacks.onDeleteFood(originalFood.id), false);
  assert.equal(callbacks.onToggleFavorite('usda-sr-171477'), false);
  assert.equal(app.map.get(C.STORE), raw);
  assert.match(app.get('stat-kcal').innerHTML, /^100 /);
  assert.equal(app.get('storage-status').classList.contains('storage-error'), true);
  assert.ok(app.get('save-event'));
  app.get('export-btn').click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.deepEqual(exported.customFoods, initial.customFoods);
  assert.deepEqual(exported.favoriteFoodIds, initial.favoriteFoodIds);
  assert.deepEqual(exported.events, initial.events);
  app.failWrites(false);
  const savedFood = callbacks.onSaveFood(added);
  assert.equal(savedFood.id, added.id);
  assert.equal(JSON.parse(app.map.get(C.STORE)).customFoods.length, 2);
  assert.match(app.get('stat-kcal').innerHTML, /^100 /);
});

test('catalog fetch errors are retryable and successful catalog responses are cached', async () => {
  let callbacks, requests = 0;
  const catalog = { meta: { source: 'USDA FoodData Central · SR Legacy' }, foods: [{ id: 'example' }] };
  const app = boot(JSON.stringify(stateWith()), {
    mealMount(container, detail, options) { callbacks = options; return dummyMealController(); },
    async fetch(url, options) {
      assert.match(url, /^food-catalog\.json/);
      assert.ok(options.signal instanceof AbortSignal);
      requests++;
      return requests === 1 ? { ok: false } : { ok: true, json: async () => catalog };
    }
  });
  app.get('new-meal').click();
  await assert.rejects(callbacks.loadCatalog(), /불러오지 못했습니다/);
  assert.equal(await callbacks.loadCatalog(), catalog);
  assert.equal(await callbacks.loadCatalog(), catalog);
  assert.equal(requests, 2);
  assert.equal(app.writes.length, 0);
});

test('switching away from an empty meal captures its draft without invoking save validation', () => {
  let draftCalls = 0, readCalls = 0;
  const app = boot(JSON.stringify(stateWith()), { mealMount() { return {
    draft() { draftCalls++; return { items: [], notes: '' }; },
    read() { readCalls++; throw new Error('식사에 음식을 추가해 주세요.'); },
    destroy() {}
  }; } });
  app.get('new-meal').click();
  const cardioButton = app.document.querySelectorAll('[data-pick]').find(button => button.dataset.pick === 'cardio');
  cardioButton.click();
  assert.equal(draftCalls, 1);
  assert.equal(readCalls, 0);
  assert.ok(app.get('f-cardio'));
  assert.equal(app.get('form-error').classList.contains('hide'), true);
});
