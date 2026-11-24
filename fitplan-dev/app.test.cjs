'use strict';

// Integration smoke tests for the real browser scripts. This intentionally
// small DOM adapter covers startup, settings, backups and date-detail handlers. It is not a
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
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.inert = false; this.isConnected = true; this.open = false;
    this.scrollCalls = []; this.scrollTop = 0;
    this.children = []; this.listeners = new Map(); this._html = ''; this.textContent = '';
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); this.document.parse(this, this._html); }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener)); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  get parentElement() { return this.parent; }
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
  scrollIntoView(options) { this.scrollCalls.push(options); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  appendChild(node) {
    if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
    node.parent = this; this.children.push(node); this.document.nodes.add(node); return node;
  }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
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
    const stack = [owner], voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    for (const match of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*)>/gi)) {
      const tag = match[2].toLowerCase();
      if (match[1]) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
        continue;
      }
      const attrs = {};
      for (const attr of match[3].matchAll(/([\w:-]+)(?:="([^\"]*)"|'([^']*)')?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? '');
      const parent = stack.at(-1), node = new Element(this, tag, attrs, parent);
      parent.children.push(node); this.nodes.add(node);
      if (!voids.has(tag) && !match[3].trimEnd().endsWith('/')) stack.push(node);
    }
    for (const select of this.querySelectorAll('select').filter(node => owner.contains(node))) {
      const options = select.querySelectorAll('option');
      select.value = (options.find(option => Object.hasOwn(option.attrs, 'selected')) || options[0])?.value || '';
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

test('date details reuse one panel: today scrolls inline and other days open the sheet without writing records', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw);
  const bridge = app.context.FormdayBridge, panel = app.get('fd-day-detail'), agenda = app.get('agenda');
  assert.ok(app.get('fd-day-inline').contains(panel));
  bridge.openDayDetail('2026-11-23');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.equal(bridge.getDetailDay(), '2026-11-23');
  assert.ok(panel.scrollCalls.length > 0);

  app.document.querySelector('[data-day="2026-11-24"]').click();
  assert.equal(bridge.getDetailDay(), '2026-11-24');
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.ok(app.get('fd-day-sheet').contains(panel));
  assert.equal(app.get('agenda'), agenda);
  assert.equal(app.document.querySelectorAll('#fd-day-detail').length, 1);
  assert.equal(app.document.querySelectorAll('#agenda').length, 1);
  assert.match(app.get('right-date').textContent, /11월 24일/);

  bridge.closeDayDetail();
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.ok(app.get('fd-day-inline').contains(panel));
  assert.equal(bridge.getDetailDay(), '2026-11-23');
  assert.match(app.get('agenda').innerHTML, /기존 벤치 기록/);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('mini-calendar dates, the Today control and view changes remain read-only', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw), bridge = app.context.FormdayBridge;
  app.document.querySelector('[data-mini="2026-11-22"]').click();
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.equal(bridge.getDetailDay(), '2026-11-22');
  bridge.closeDayDetail();
  app.document.querySelector('[data-view="week"]').click();
  assert.match(app.get('calendar').innerHTML, /time-view-wrap/);
  app.get('today').click();
  assert.equal(bridge.getDetailDay(), '2026-11-23');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.ok(app.get('fd-day-detail').scrollCalls.length > 0);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('each date-specific registration action carries the selected date and cancel returns to its details', () => {
  for (const type of ['strength', 'cardio', 'meal', 'weight']) {
    const raw = JSON.stringify(legacyState());
    const app = boot(raw, { mealMount: dummyMealController }), bridge = app.context.FormdayBridge;
    bridge.openDayDetail('2026-11-26');
    app.document.querySelector('[data-day-create="' + type + '"]').click();
    assert.equal(app.get('f-date').value, '2026-11-26', type + ' defaults to the selected detail date');
    assert.equal(app.get('fd-day-sheet').open, false, 'the existing form is not hidden under a native dialog');
    assert.ok(app.get('save-event'));
    app.get('cancel-event').click();
    assert.equal(app.get('modal-root').children.length, 0);
    assert.equal(app.get('fd-day-sheet').open, true, type + ' cancellation returns to the same detail sheet');
    assert.equal(bridge.getDetailDay(), '2026-11-26');
    assert.equal(app.map.get(C.STORE), raw);
    assert.equal(app.writes.length, 0);
  }
});

test('a cardio plan created from another day saves once in the existing calendar store and reappears on that day', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw), bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="cardio"]').click();
  app.get('f-title').value = '목요일 저녁 러닝';
  app.get('f-start').value = '19:00'; app.get('f-end').value = '19:40';
  app.get('f-minutes').value = '40'; app.get('f-distance').value = '5';
  app.get('save-event').click();
  const saved = JSON.parse(app.map.get(C.STORE)), created = saved.events.find(event => event.title === '목요일 저녁 러닝');
  assert.ok(created);
  assert.equal(created.date, '2026-11-26');
  assert.equal(created.type, 'cardio');
  assert.equal(created.completed, false);
  assert.equal(saved.events.length, 2);
  assert.equal(saved.events.find(event => event.id === 'legacy-workout').date, '2026-11-23');
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.deepEqual([...app.map.keys()].sort(), [C.STORE, C.STORE + '_previous'].sort());
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.equal(bridge.getDetailDay(), '2026-11-26');
  assert.match(app.get('agenda').innerHTML, /목요일 저녁 러닝/);
  bridge.closeDayDetail();
  assert.doesNotMatch(app.get('agenda').innerHTML, /목요일 저녁 러닝/);
});

test('a failed date-specific weight save keeps its draft, date and original records until retry succeeds', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw), bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-22');
  app.document.querySelector('[data-day-create="weight"]').click();
  app.get('f-bodyweight').value = '76.2';
  app.get('f-completed').checked = true;
  app.failWrites();
  app.get('save-event').click();
  assert.equal(app.get('f-date').value, '2026-11-22');
  assert.equal(app.get('f-bodyweight').value, '76.2');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 0);
  app.failWrites(false);
  app.get('save-event').click();
  const saved = JSON.parse(app.map.get(C.STORE)), weight = saved.events.find(event => event.type === 'weight');
  assert.equal(weight.date, '2026-11-22');
  assert.equal(weight.detail.weight, 76.2);
  assert.equal(weight.completed, true);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.equal(bridge.getDetailDay(), '2026-11-22');
  assert.match(app.get('agenda').innerHTML, /76\.2kg/);
});

test('editing a repeated event from a date sheet changes only that occurrence and keeps other dates intact', () => {
  const event = { id: 'daily-run', date: '2026-11-23', start: '07:00', end: '07:30', type: 'cardio', title: '매일 걷기', repeat: 'daily', completed: false,
    detail: { cardio: '걷기', minutes: 30, distance: 2, intensity: '가벼움' } };
  const raw = JSON.stringify(stateWith(event)), app = boot(raw), bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-24');
  app.get('agenda').querySelector('[data-edit="daily-run"]').click();
  assert.equal(app.get('f-date').value, '2026-11-24');
  assert.equal(app.get('f-scope').value, 'occurrence');
  app.get('f-title').value = '화요일 짧게 걷기';
  app.get('f-minutes').value = '15';
  app.get('f-completed').checked = true;
  app.get('save-event').click();
  const saved = C.normalizeState(JSON.parse(app.map.get(C.STORE)));
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].title, '매일 걷기');
  assert.equal(saved.events[0].detail.minutes, 30);
  assert.deepEqual(Object.keys(saved.events[0].occurrences), ['2026-11-24']);
  assert.equal(C.dayEvents(saved, '2026-11-24')[0].title, '화요일 짧게 걷기');
  assert.equal(C.dayEvents(saved, '2026-11-24')[0].detail.minutes, 15);
  assert.equal(C.dayEvents(saved, '2026-11-25')[0].title, '매일 걷기');
  assert.equal(C.dayEvents(saved, '2026-11-25')[0].detail.minutes, 30);
  assert.equal(C.dayEvents(saved, '2026-11-25')[0].completed, false);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.match(app.get('agenda').innerHTML, /화요일 짧게 걷기/);
});

test('moving an existing inline event to another day and back returns to the matching detail presentation', () => {
  const event = { id: 'movable-run', date: '2026-11-23', start: '07:00', end: '07:30', type: 'cardio', title: '시간 조정 러닝', repeat: 'none', completed: false,
    detail: { cardio: '러닝', minutes: 30, distance: 3, intensity: '보통' } };
  const app = boot(JSON.stringify(stateWith(event))), bridge = app.context.FormdayBridge;
  app.get('agenda').querySelector('[data-edit="movable-run"]').click();
  app.get('f-date').value = '2026-11-26';
  app.get('save-event').click();
  assert.equal(bridge.getDetailDay(), '2026-11-26');
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.match(app.get('agenda').innerHTML, /시간 조정 러닝/);
  app.get('agenda').querySelector('[data-edit="movable-run"]').click();
  app.get('f-date').value = '2026-11-23';
  app.get('save-event').click();
  assert.equal(bridge.getDetailDay(), '2026-11-23');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.ok(app.get('fd-day-inline').contains(app.get('fd-day-detail')));
  const saved = JSON.parse(app.map.get(C.STORE));
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].id, 'movable-run');
  assert.equal(saved.events[0].date, '2026-11-23');
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 2);
});

test('declining to discard a dirty date-specific form leaves the form active and the sheet suspended', () => {
  const raw = JSON.stringify(legacyState()), app = boot(raw, { confirm: false }), bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="cardio"]').click();
  app.get('f-title').value = '아직 작성 중';
  app.get('modal-root').oninput({ target: app.get('f-title') });
  app.get('cancel-event').click();
  assert.equal(app.confirmations.length, 1);
  assert.equal(app.get('f-title').value, '아직 작성 중');
  assert.equal(app.get('f-date').value, '2026-11-26');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.equal(app.document.querySelector('.app').inert, true);
  assert.equal(bridge.getDetailDay(), '2026-11-26');
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('a saved routine becomes a plan on the selected day without mutating the routine or copying completion state', () => {
  const iron = { routines: [{ id: 'chest-plan', name: '가슴 루틴', exercises: [{ id: 'bench-source', name: '벤치프레스', notes: '원본 루틴 메모', sets: [
    { id: 'warm-source', weight: 20, reps: 15, warmup: true, done: true, restSec: 60 },
    { id: 'work-source', weight: 60, reps: 10, warmup: false, done: true, restSec: 90 }
  ] }] }], programs: [], sessions: [] };
  const originalIron = JSON.stringify(iron), raw = JSON.stringify(stateWith()), app = boot(raw, { iron });
  app.context.FormdayBridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="strength"]').click();
  app.get('f-routine').value = 'chest-plan'; app.get('f-routine').onchange();
  assert.equal(app.get('f-title').value, '가슴 루틴');
  assert.equal(app.get('f-date').value, '2026-11-26');
  assert.equal(app.get('f-completed').checked, false);
  assert.equal(app.writes.length, 0);
  app.get('save-event').click();
  const saved = JSON.parse(app.map.get(C.STORE));
  assert.equal(saved.events.length, 1);
  const plan = saved.events[0], exercise = plan.detail.exercises[0];
  assert.equal(plan.date, '2026-11-26');
  assert.equal(plan.type, 'strength');
  assert.equal(plan.title, '가슴 루틴');
  assert.equal(plan.completed, false);
  assert.equal(exercise.name, '벤치프레스');
  assert.notEqual(exercise.id, 'bench-source');
  assert.deepEqual(exercise.sets.map(set => [set.weight, set.reps, set.warmup, set.done]), [[20, 15, true, false], [60, 10, false, false]]);
  assert.notEqual(exercise.sets[0].id, 'warm-source');
  assert.notEqual(exercise.sets[1].id, 'work-source');
  assert.equal(JSON.stringify(iron), originalIron);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.deepEqual([...app.map.keys()].sort(), [C.STORE, C.STORE + '_previous'].sort());
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.match(app.get('agenda').innerHTML, /가슴 루틴/);
});

test('a completion-save failure stays visible inside the open date sheet and preserves the original record', () => {
  const event = { id: 'failed-check', date: '2026-11-22', start: '07:00', end: '07:30', type: 'cardio', title: '일요일 러닝', repeat: 'none', completed: false,
    detail: { cardio: '러닝', minutes: 30, distance: 3, intensity: '보통' } };
  const raw = JSON.stringify(stateWith(event)), app = boot(raw);
  app.context.FormdayBridge.openDayDetail('2026-11-22');
  app.failWrites();
  app.get('agenda').querySelector('[data-toggle="failed-check"]').click();
  const status = app.get('fd-day-status');
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.ok(app.get('fd-day-sheet').contains(status));
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.error, 'true');
  assert.match(status.textContent, /저장하지 못했습니다/);
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.context.FormdayBridge.getState().events[0].completed, false);
  assert.equal(app.get('agenda').querySelector('[data-toggle="failed-check"]').classList.contains('checked'), false);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 0);
});
