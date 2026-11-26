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
const I = require('../fitplan/iron-store.js');
const directory = path.join(__dirname, '../fitplan');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const scripts = ['data.js', 'workouts.js', 'nutrition.js', 'core.js', 'iron-store.js', 'calendar-workouts.js', 'iron-data.js', 'meals.js', 'ai-meal-import.js', 'app.js'].map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
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
  const map = new Map(raw === undefined ? [] : [[C.STORE, raw]]), writes = [], confirmations = [], downloads = [], windowListeners = new Map(), ironOpens = [];
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
    context.FormdayIndependent = { getSnapshot: () => ironSnapshot, getCalendarSnapshot: () => ironSnapshot, renderCalendar: options.renderIronCalendar || (() => {}),
      open(page, extra) { ironOpens.push({ page, extra }); return true; } };
  };
  if (options.iron) setIronSnapshot(options.iron);
  if (options.storageDenied) Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  for (const [name, code] of scripts) {
    if (name === 'app.js' && options.mealMount) context.FormdayMeals = { mount: options.mealMount };
    vm.runInContext(code, context, { filename: name });
  }
  return { document, context, map, writes, storage, confirmations, downloads, windowListeners, ironOpens,
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
  assert.equal(app.get('stat-workout').textContent, '1 / 2');
  assert.match(app.get('stat-workout-note').textContent,/부분 완료 1회/);
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
    if(type==='strength'){
      assert.ok(app.get('fd-weight-close'));
      app.document.querySelector('[data-weight-route="free"]').click();
      app.get('fd-free-direct').click();
    }
    assert.equal(app.get('f-date').value, '2026-11-26', type + ' defaults to the selected detail date');
    assert.equal(app.get('fd-day-sheet').open, false, 'the existing form is not hidden under a native dialog');
    assert.equal(app.get('f-title-field').classList.contains('hide'), type !== 'strength');
    assert.equal(app.document.activeElement, app.get(type === 'strength' ? 'f-title' : 'modal-title'));
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
  app.get('f-cardio').value = '러닝';
  app.get('f-start').value = '19:00'; app.get('f-end').value = '19:40';
  app.get('f-minutes').value = '40'; app.get('f-distance').value = '5';
  app.get('save-event').click();
  const saved = JSON.parse(app.map.get(C.STORE)), created = saved.events.find(event => event.type === 'cardio');
  assert.ok(created);
  assert.equal(created.title, '러닝');
  assert.equal(created.date, '2026-11-26');
  assert.equal(created.type, 'cardio');
  assert.equal(created.completed, false);
  assert.equal(saved.events.length, 2);
  assert.equal(saved.events.find(event => event.id === 'legacy-workout').date, '2026-11-23');
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.deepEqual([...app.map.keys()].sort(), [C.STORE, C.STORE + '_previous'].sort());
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.equal(bridge.getDetailDay(), '2026-11-26');
  assert.match(app.get('agenda').innerHTML, /러닝/);
  bridge.closeDayDetail();
  assert.doesNotMatch(app.get('agenda').innerHTML, /러닝/);
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
  assert.equal(weight.title, '체중 측정');
  assert.equal(weight.detail.weight, 76.2);
  assert.equal(weight.completed, true);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.equal(app.get('fd-day-sheet').open, true);
  assert.equal(bridge.getDetailDay(), '2026-11-22');
  assert.match(app.get('agenda').innerHTML, /76\.2kg/);
});

test('editing a repeated occurrence and then its series preserves their separate titles and recorded details', () => {
  const event = { id: 'daily-run', date: '2026-11-23', start: '07:00', end: '07:30', type: 'cardio', title: '매일 걷기', repeat: 'daily', completed: false,
    detail: { cardio: '걷기', minutes: 30, distance: 2, intensity: '가벼움' },
    occurrences: { '2026-11-24': { date: '2026-11-24', start: '07:00', end: '07:30', type: 'cardio', title: '화요일 짧게 걷기', completed: false,
      detail: { cardio: '걷기', minutes: 20, distance: 1, intensity: '가벼움' } } } };
  const raw = JSON.stringify(stateWith(event)), app = boot(raw), bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-24');
  app.get('agenda').querySelector('[data-edit="daily-run"]').click();
  assert.equal(app.get('f-date').value, '2026-11-24');
  assert.equal(app.get('f-scope').value, 'occurrence');
  assert.equal(app.get('f-title-field').classList.contains('hide'), true);
  assert.equal(app.get('f-title').value, '');
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
  app.get('agenda').querySelector('[data-edit="daily-run"]').click();
  app.get('f-scope').value = 'series'; app.get('f-scope').onchange();
  assert.equal(app.get('f-title').value, '');
  app.get('f-minutes').value = '40'; app.get('save-event').click();
  const revised = C.normalizeState(JSON.parse(app.map.get(C.STORE)));
  assert.equal(revised.events[0].title, '매일 걷기');
  assert.equal(revised.events[0].detail.minutes, 40);
  assert.equal(C.dayEvents(revised, '2026-11-24')[0].title, '화요일 짧게 걷기');
  assert.equal(C.dayEvents(revised, '2026-11-24')[0].detail.minutes, 15);
  assert.equal(C.dayEvents(revised, '2026-11-25')[0].title, '매일 걷기');
  assert.equal(C.dayEvents(revised, '2026-11-25')[0].detail.minutes, 40);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 2);
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
  app.get('f-minutes').value = '45';
  app.get('modal-root').oninput({ target: app.get('f-minutes') });
  app.get('cancel-event').click();
  assert.equal(app.confirmations.length, 1);
  assert.equal(app.get('f-minutes').value, '45');
  assert.equal(app.get('f-date').value, '2026-11-26');
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.equal(app.document.querySelector('.app').inert, true);
  assert.equal(bridge.getDetailDay(), '2026-11-26');
  assert.equal(app.map.get(C.STORE), raw);
  assert.equal(app.writes.length, 0);
});

test('a saved routine becomes a plan on the selected day without mutating the routine or copying completion state', () => {
  const iron = { ...I.empty(), routines: [{ id: 'chest-plan', name: '가슴 루틴', exercises: [{ id: 'bench-source', name: '벤치프레스', notes: '원본 루틴 메모', sets: [
    { id: 'warm-source', weight: 20, reps: 15, warmup: true, done: true, restSec: 60 },
    { id: 'work-source', weight: 60, reps: 10, warmup: false, done: true, restSec: 90 }
  ] }] }], programs: [], sessions: [] };
  const originalIron = JSON.stringify(iron), raw = JSON.stringify(stateWith()), app = boot(raw, { iron });
  app.context.FormdayBridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="strength"]').click();
  app.document.querySelector('[data-weight-route="routine"]').click();
  app.document.querySelector('[data-register-routine="chest-plan"]').click();
  assert.equal(app.get('fd-routine-date').value, '2026-11-26');
  assert.equal(app.get('workout-editor'), null);
  assert.equal(app.writes.length, 0);
  app.get('fd-routine-register').click();
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

test('a workout title survives a category round trip but does not become a cardio title', () => {
  const app = boot(JSON.stringify(stateWith()));
  app.context.FormdayBridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="strength"]').click();
  app.document.querySelector('[data-weight-route="free"]').click();
  app.get('fd-free-direct').click();
  app.get('f-title').value = '목요일 상체 훈련';
  app.document.querySelector('[data-pick="cardio"]').click();
  assert.equal(app.get('f-title-field').classList.contains('hide'), true);
  app.document.querySelector('[data-pick="strength"]').click();
  assert.equal(app.get('f-title-field').classList.contains('hide'), false);
  assert.equal(app.get('f-title').value, '목요일 상체 훈련');
  const editor=app.get('workout-editor'),add=editor.querySelector('[data-fw-action="add-exercise"]');
  for(const listener of editor.listeners.get('click')||[])listener({target:add,preventDefault(){}});
  editor.querySelector('[data-fw-field="name"]').value='벤치프레스';
  app.get('save-event').click();
  const workout = JSON.parse(app.map.get(C.STORE)).events[0];
  assert.equal(workout.type, 'strength');
  assert.equal(workout.title, '목요일 상체 훈련');
  assert.equal(workout.detail.freeWorkout,true);
  app.get('agenda').querySelector('[data-edit="' + workout.id + '"]').click();
  app.document.querySelector('[data-pick="cardio"]').click();
  app.get('f-cardio').value = '걷기';
  app.get('save-event').click();
  const changed = JSON.parse(app.map.get(C.STORE));
  assert.equal(changed.events.length, 1);
  assert.equal(changed.events[0].id, workout.id);
  assert.equal(changed.events[0].type, 'cardio');
  assert.equal(changed.events[0].title, '걷기');
  assert.equal(changed.events[0].date, '2026-11-26');
});

test('existing non-workout titles stay hidden and are not reused when their category becomes a workout', () => {
  const cases = [
    { type: 'cardio', title: '원래 아침 걷기', detail: { cardio: '걷기', minutes: 30, distance: 2, intensity: '가벼움' } },
    { type: 'meal', title: '원래 점심 식사', detail: mealDetail(food()) },
    { type: 'weight', title: '원래 아침 체중', detail: { weight: 75, bodyfat: null } }
  ];
  for (const source of cases) {
    const event = { id: 'changed-' + source.type, date: '2026-11-23', start: '07:00', end: '07:30', repeat: 'none', completed: false, ...source };
    const app = boot(JSON.stringify(stateWith(event)), { mealMount: dummyMealController });
    app.get('agenda').querySelector('[data-edit="' + event.id + '"]').click();
    assert.equal(app.get('f-title-field').classList.contains('hide'), true);
    assert.equal(app.get('f-title').value, '');
    app.document.querySelector('[data-pick="strength"]').click();
    assert.equal(app.get('f-title-field').classList.contains('hide'), false);
    assert.equal(app.get('f-title').value, '', source.type + ' title must not prefill the workout title');
    app.get('save-event').click();
    const changed = JSON.parse(app.map.get(C.STORE));
    assert.equal(changed.events.length, 1);
    assert.equal(changed.events[0].type, 'strength');
    assert.equal(changed.events[0].title, '웨이트 트레이닝');
    assert.equal(changed.events[0].id, event.id);
    assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  }
});

const plain = value => JSON.parse(JSON.stringify(value));
function scheduledFixture(repeat = 'none') {
  return C.normalizeState({ settings: C.defaults, events: [{
    id: 'scheduled-workout', date: '2026-11-23', start: '18:00', end: '19:00', type: 'strength',
    title: '월요일 상체', repeat, completed: false, detail: { notes: '원래 계획 메모', exercises: [{
      id: 'planned-bench', name: '벤치프레스', notes: '종목 원본', sets: [
        { id: 'planned-warm', weight: 20, reps: 12, rpe: null, warmup: true, done: false },
        { id: 'planned-main', weight: 60, reps: 8, rpe: 8, warmup: false, done: false }
      ]
    }] }
  }] });
}
function routineFixture() {
  return I.normalize({ ...I.empty(), routines: [{ id: 'lower-routine', name: '하체 루틴', updatedAt: '2026-11-20T00:00:00Z', exercises: [
    { id: 'routine-squat', name: '스쿼트', notes: '루틴 원본 메모', sets: [
      { id: 'routine-warm', weight: 25.5, reps: 15, rpe: null, warmup: true, restSec: 60 },
      { id: 'routine-main', weight: 82.5, reps: 6, rpe: 8.5, warmup: false, restSec: 120 }
    ] },
    { id: 'routine-leg', name: '레그프레스', notes: '', sets: [
      { id: 'routine-leg-main', weight: 120, reps: 10, rpe: 9, warmup: false, restSec: 90 }
    ] }
  ] }] });
}
function startScheduled(app, date = '2026-11-23') {
  const bridge = app.context.FormdayBridge;
  const started = I.startCalendar(app.context.FormdayIndependent.getSnapshot(), bridge.prepareScheduledWorkout('scheduled-workout', date), new Date(date + 'T18:00:00Z'));
  app.setIronSnapshot(started.next);
  return started;
}
function finishScheduled(app, date = '2026-11-23', kind = 'COMPLETED') {
  const started = startScheduled(app, date);
  const recorded = I.modify(started.next, started.session.id, session => {
    session.exercises[0].sets.forEach((set, index) => { set.done = kind === 'COMPLETED' || index === 1; });
    session.exercises[0].sets[1].weight = 65;
  }, new Date(date + 'T18:15:00Z'));
  const finished = I.finish(recorded.next, started.session.id, kind, new Date(date + 'T18:30:00Z'));
  const saved = I.createStore(app.storage).save(finished.next, '');
  app.setIronSnapshot(saved);
  return saved.sessions[0];
}

test('calendar plans expose exact sets and date-specific start and replacement actions without writing records', () => {
  const state = scheduledFixture('daily'), raw = JSON.stringify(state), app = boot(raw, { iron: routineFixture() });
  const bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-24');
  const items = bridge.getScheduledWorkouts('2026-11-24');
  assert.equal(items.length, 1); assert.equal(items[0].canReplace, true); assert.equal(items[0].session, null);
  const plan = bridge.prepareScheduledWorkout('scheduled-workout', '2026-11-24');
  assert.equal(plan.date, '2026-11-24'); assert.equal(plan.label, '월요일 상체');
  assert.deepEqual(plain(plan.exercises[0].sets.map(set => [set.id, set.weight, set.reps, set.rpe, set.warmup, set.done])), [
    ['planned-warm', 20, 12, null, true, false], ['planned-main', 60, 8, 8, false, false]
  ]);
  const start = app.get('agenda').querySelector('[data-calendar-start="scheduled-workout"]');
  const swap = app.get('agenda').querySelector('[data-calendar-swap="scheduled-workout"]');
  assert.ok(start); assert.ok(swap); assert.equal(start.dataset.occdate, '2026-11-24'); assert.equal(swap.disabled, false);
  assert.equal(start.disabled,true,'future workouts cannot start');
  start.click();assert.equal(app.ironOpens.length,0);
  bridge.openDayDetail('2026-11-23');
  const todayStart=app.get('agenda').querySelector('[data-calendar-start="scheduled-workout"]');
  assert.equal(todayStart.disabled,false);todayStart.click();
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.deepEqual(plain(app.ironOpens), [{ page: 'calendar', extra: { eventId: 'scheduled-workout', date: '2026-11-23' } }]);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
  assert.equal(bridge.getScheduledWorkouts('invalid-date').length, 0);
});

test('replacing a scheduled routine changes only that occurrence and the workout projection, preserving the saved routine', () => {
  const state = scheduledFixture('daily'), iron = routineFixture(), originalIron = JSON.stringify(iron), app = boot(JSON.stringify(state), { iron });
  const bridge = app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-24');
  app.get('agenda').querySelector('[data-calendar-swap="scheduled-workout"]').click();
  assert.equal(app.get('fd-day-sheet').open, false);
  assert.equal(app.get('apply-routine-swap').disabled, true);
  const choice = app.document.querySelector('[data-routine-choice="lower-routine"]');
  assert.equal(choice.getAttribute('aria-pressed'), 'false');
  choice.click();
  assert.equal(choice.getAttribute('aria-pressed'), 'true'); assert.equal(app.get('apply-routine-swap').disabled, false);
  assert.equal(app.writes.length, 0);
  app.get('apply-routine-swap').click();
  assert.equal(app.get('modal-root').children.length, 0); assert.equal(app.get('fd-day-sheet').open, true);
  const saved = C.normalizeState(JSON.parse(app.map.get(C.STORE))), event = saved.events[0];
  assert.equal(saved.events.length, 1); assert.equal(event.title, '월요일 상체');
  assert.deepEqual(event.detail, state.events[0].detail);
  assert.deepEqual(Object.keys(event.occurrences), ['2026-11-24']);
  const replaced = C.occurrence(event, '2026-11-24');
  assert.equal(replaced.title, '하체 루틴'); assert.equal(replaced.completed, false);
  assert.deepEqual(replaced.detail.exercises.map(ex => [ex.name, ex.sets.map(set => [set.weight, set.reps, set.rpe, set.warmup, set.done])]), [
    ['스쿼트', [[25.5, 15, null, true, false], [82.5, 6, 8.5, false, false]]],
    ['레그프레스', [[120, 10, 9, false, false]]]
  ]);
  assert.notEqual(replaced.detail.exercises[0].id, iron.routines[0].exercises[0].id);
  assert.equal(C.occurrence(event, '2026-11-25').title, '월요일 상체');
  assert.equal(bridge.getScheduledWorkouts('2026-11-24')[0].event.title, '하체 루틴');
  assert.deepEqual(plain(bridge.prepareScheduledWorkout('scheduled-workout', '2026-11-24').exercises.map(ex => ex.name)), ['스쿼트', '레그프레스']);
  assert.match(app.get('agenda').innerHTML, /하체 루틴/);
  assert.equal(JSON.stringify(iron), originalIron);
  assert.equal(app.writes.filter(([key]) => key === C.STORE).length, 1);
  assert.equal(app.map.has(I.KEY), false);
});

test('cancelled and empty routine replacement dialogs leave both stores unchanged', () => {
  const raw = JSON.stringify(scheduledFixture());
  for (const iron of [routineFixture(), I.empty()]) {
    const app = boot(raw, { iron }), bridge = app.context.FormdayBridge;
    assert.equal(bridge.canCloudApply(), true);
    assert.equal(bridge.openRoutineSwap('scheduled-workout', '2026-11-23'), true);
    assert.equal(bridge.isRoutineSwapOpen(), true);
    assert.equal(bridge.canCloudApply(), false);
    assert.equal(bridge.cloudReload(), false);
    assert.ok(app.get('apply-routine-swap'), 'a rejected cloud reload must leave the selection dialog open');
    assert.equal(app.get('apply-routine-swap').disabled, true);
    app.document.querySelector('[data-routine-choice="lower-routine"]')?.click();
    app.get('cancel-routine-swap').click();
    assert.equal(bridge.isRoutineSwapOpen(), false);
    assert.equal(bridge.canCloudApply(), true);
    assert.equal(app.get('modal-root').children.length, 0); assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
  }
});

test('already-started or recorded workouts cannot be replaced, including a start while selection is open', () => {
  const raw = JSON.stringify(scheduledFixture()), app = boot(raw, { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  assert.equal(bridge.openRoutineSwap('scheduled-workout', '2026-11-23'), true);
  app.document.querySelector('[data-routine-choice="lower-routine"]').click();
  startScheduled(app);
  assert.equal(bridge.getScheduledWorkouts('2026-11-23')[0].canReplace, false);
  app.get('apply-routine-swap').click();
  assert.match(app.get('form-error').textContent, /이미 시작/);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
  app.get('cancel-routine-swap').click();
  assert.equal(bridge.openRoutineSwap('scheduled-workout', '2026-11-23'), false);
  assert.equal(app.get('agenda').querySelector('[data-calendar-swap="scheduled-workout"]').disabled, true);
  assert.match(app.get('agenda').innerHTML, /이어하기/);

  const recorded = scheduledFixture(); recorded.events[0].detail.exercises[0].sets[0].done = true;
  const doneApp = boot(JSON.stringify(recorded), { iron: routineFixture() });
  assert.equal(doneApp.context.FormdayBridge.openRoutineSwap('scheduled-workout', '2026-11-23'), false);
  assert.equal(doneApp.writes.length, 0);
});

test('a calendar edit during routine selection prevents stale replacement and retains the newer plan', () => {
  const app = boot(JSON.stringify(scheduledFixture()), { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  bridge.openRoutineSwap('scheduled-workout', '2026-11-23');
  app.document.querySelector('[data-routine-choice="lower-routine"]').click();
  assert.equal(bridge.saveSet({ eventId: 'scheduled-workout', date: '2026-11-23', exerciseId: 'planned-bench', setId: 'planned-main', weight: 72.5, reps: 7, rpe: 9, done: false }), true);
  const edited = app.map.get(C.STORE), writes = app.writes.length;
  app.get('apply-routine-swap').click();
  assert.match(app.get('form-error').textContent, /일정이 변경/);
  assert.equal(app.map.get(C.STORE), edited); assert.equal(app.writes.length, writes);
  assert.equal(bridge.getScheduledWorkouts('2026-11-23')[0].event.detail.exercises[0].sets[1].weight, 72.5);
});

test('finalized workout reflection updates one recurring occurrence and idempotent retry does not write again', () => {
  const original = scheduledFixture('daily'), app = boot(JSON.stringify(original), { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  const session = finishScheduled(app, '2026-11-24');
  const independentRaw = app.map.get(I.KEY);
  assert.equal(bridge.getWorkoutReflection(session).applied, false);
  assert.equal(bridge.reflectWorkoutSession(session).ok, true);
  const saved = C.normalizeState(JSON.parse(app.map.get(C.STORE))), event = saved.events[0];
  assert.deepEqual(event.detail, original.events[0].detail);
  assert.deepEqual(Object.keys(event.occurrences), ['2026-11-24']);
  const actual = C.occurrence(event, '2026-11-24');
  assert.equal(actual.completed, true); assert.equal(actual.workoutSessionId, session.id);
  assert.deepEqual(actual.detail.exercises[0].sets.map(set => [set.weight, set.done]), [[20, true], [65, true]]);
  assert.equal(C.occurrence(event, '2026-11-25').completed, false);
  assert.equal(C.occurrence(event, '2026-11-25').workoutSessionId, undefined);
  assert.equal(bridge.getWorkoutReflection(session).applied, true);
  const writes = app.writes.length;
  assert.equal(bridge.reflectWorkoutSession(session).alreadyApplied, true);
  assert.equal(app.writes.length, writes); assert.equal(app.map.get(I.KEY), independentRaw);
  bridge.openDayDetail('2026-11-24');
  assert.match(app.get('agenda').innerHTML, /운동 기록/);
  assert.equal(app.get('agenda').querySelector('[data-calendar-swap="scheduled-workout"]').disabled, true);
});

test('calendar save failure preserves a finalized partial workout and can retry without changing the independent store', () => {
  const raw = JSON.stringify(scheduledFixture()), app = boot(raw, { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  const session = finishScheduled(app, '2026-11-23', 'PARTIAL'), independentRaw = app.map.get(I.KEY);
  app.failWrites();
  const failed = bridge.reflectWorkoutSession(session);
  assert.equal(failed.ok, false); assert.match(failed.error, /캘린더 저장에 실패/);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.map.get(I.KEY), independentRaw);
  assert.equal(bridge.getWorkoutReflection(session).applied, false);
  app.failWrites(false);
  assert.equal(bridge.reflectWorkoutSession(session).ok, true);
  const actual = bridge.getScheduledWorkouts('2026-11-23')[0].event;
  assert.equal(actual.completed, false); assert.equal(actual.workoutSessionId, session.id);
  assert.deepEqual(plain(actual.detail.exercises[0].sets.map(set => set.done)), [false, true]);
  assert.equal(app.map.get(I.KEY), independentRaw);
  assert.equal(app.get('stat-workout').textContent, '0 / 1');
  assert.match(app.get('stat-workout-note').textContent,/부분 완료 1회/);
  assert.match(app.get('agenda').innerHTML,/부분 완료/);
  assert.equal(app.get('agenda').querySelector('[data-toggle="scheduled-workout"]').disabled,true);
  const before=app.map.get(C.STORE),writes=app.writes.length;
  app.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
  assert.equal(app.map.get(C.STORE),before);assert.equal(app.writes.length,writes);
  assert.match(app.get('workout-progress').innerHTML, /520/);
});

test('changed source plans and an open calendar editor block reflection without losing completed sets', () => {
  const app = boot(JSON.stringify(scheduledFixture()), { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  const session = finishScheduled(app), independentRaw = app.map.get(I.KEY);
  app.get('settings-btn').click();
  assert.equal(bridge.reflectWorkoutSession(session).ok, false);
  app.get('modal-close').click();
  assert.equal(bridge.saveSet({ eventId: 'scheduled-workout', date: '2026-11-23', exerciseId: 'planned-bench', setId: 'planned-main', weight: 75, reps: 8, rpe: 9, done: false }), true);
  const edited = app.map.get(C.STORE), writes = app.writes.length;
  const result = bridge.reflectWorkoutSession(session);
  assert.equal(result.ok, false); assert.match(result.error, /일정이 변경/);
  assert.equal(bridge.getWorkoutReflection(session).applied, false);
  assert.match(bridge.getWorkoutReflection(session).message, /일정이 변경/);
  assert.equal(app.map.get(C.STORE), edited); assert.equal(app.map.get(I.KEY), independentRaw); assert.equal(app.writes.length, writes);
});

test('a reflected calendar workout cannot be moved to another date or changed to another record type', () => {
  const app = boot(JSON.stringify(scheduledFixture()), { iron: routineFixture() }), bridge = app.context.FormdayBridge;
  const session = finishScheduled(app);
  assert.equal(bridge.reflectWorkoutSession(session).ok, true);
  const raw = app.map.get(C.STORE);
  app.get('agenda').querySelector('[data-edit="scheduled-workout"]').click();
  app.get('f-date').value = '2026-11-24';
  app.get('save-event').click();
  assert.match(app.get('form-error').textContent, /날짜와 종류/); assert.equal(app.map.get(C.STORE), raw);
  app.get('f-date').value = '2026-11-23';
  app.document.querySelector('[data-pick="cardio"]').click();
  app.get('save-event').click();
  assert.match(app.get('form-error').textContent, /날짜와 종류/); assert.equal(app.map.get(C.STORE), raw);
});

test('routine replacement rejects a stale independent snapshot at apply time without changing either store', () => {
  const raw = JSON.stringify(scheduledFixture()), iron = routineFixture(), originalIron = JSON.stringify(iron), app = boot(raw, { iron });
  const bridge = app.context.FormdayBridge;
  assert.equal(bridge.openRoutineSwap('scheduled-workout', '2026-11-23'), true);
  app.document.querySelector('[data-routine-choice="lower-routine"]').click();
  app.context.FormdayIndependent.getCalendarSnapshot = () => { throw new Error('다른 탭에서 운동 기록이 변경되었습니다. 최신 기록을 불러와 주세요.'); };
  app.get('apply-routine-swap').click();
  assert.match(app.get('form-error').textContent, /다른 탭/);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(JSON.stringify(iron), originalIron); assert.equal(app.writes.length, 0);
});

test('a saved routine changed after selection must be selected again before replacing a calendar plan', () => {
  const raw = JSON.stringify(scheduledFixture()), iron = routineFixture(), originalIron = JSON.stringify(iron), app = boot(raw, { iron });
  const bridge = app.context.FormdayBridge;
  assert.equal(bridge.openRoutineSwap('scheduled-workout', '2026-11-23'), true);
  app.document.querySelector('[data-routine-choice="lower-routine"]').click();
  const latest = structuredClone(iron);
  latest.routines[0].exercises[0].sets[1].weight = 95;
  app.setIronSnapshot(latest);
  app.get('apply-routine-swap').click();
  assert.match(app.get('form-error').textContent, /루틴 구성이 변경/);
  assert.equal(app.map.get(C.STORE), raw); assert.equal(app.writes.length, 0);
  assert.equal(JSON.stringify(iron), originalIron);
  assert.equal(app.context.FormdayIndependent.getCalendarSnapshot().routines[0].exercises[0].sets[1].weight, 95);
  assert.equal(bridge.isRoutineSwapOpen(), true);
});

function calendarProgramFixture(mode){
  let iron=routineFixture();
  const upper=I.createRoutine(iron,'가슴 루틴',[I.newExercise('벤치프레스')]);iron=upper.next;
  const lower=iron.routines[0].id,upperId=upper.routine.id;
  const made=I.createProgram(iron,'테스트 프로그램',mode,[lower,upperId],mode==='fixed'?{'0':lower,'1':upperId,'3':lower,'6':upperId}:{});
  return {iron:made.next,id:made.program.id};
}
test('program registration dialog previews and saves a cycle atomically on existing calendar',()=>{
  const {iron,id}=calendarProgramFixture('cycle'),initial=legacyState(),raw=JSON.stringify(initial);
  const app=boot(raw,{iron}),bridge=app.context.FormdayBridge;
  const originalIron=JSON.stringify(iron);
  assert.equal(bridge.openProgramRegistration(id),true);
  assert.equal(app.get('fd-program-date').value,'2026-11-23');
  assert.equal(app.get('fd-program-date').min,'2026-11-23');
  assert.equal(bridge.canCloudApply(),false);
  assert.match(app.get('fd-program-preview').innerHTML,/2개 등록 예정/);
  assert.equal(app.writes.length,0);
  assert.equal(app.get('fd-program-next'),null);
  assert.match(app.get('modal-root').innerHTML,/오늘부터 순환운동을 등록할까요/);
  app.get('fd-program-start').value='09:00';app.get('fd-program-end').value='10:00';
  app.get('fd-program-end').onchange();
  app.get('fd-program-apply').click();
  const saved=C.normalizeState(JSON.parse(app.map.get(C.STORE)));
  assert.equal(saved.events.length,3);
  assert.deepEqual(saved.events.slice(1).map(e=>[e.date,e.title,e.start,e.end]),[['2026-11-23','하체 루틴','09:00','10:00'],['2026-11-24','가슴 루틴','09:00','10:00']]);
  assert.equal(saved.events[0].title,initial.events[0].title);
  assert.equal(app.writes.filter(([key])=>key===C.STORE).length,1);
  assert.equal(JSON.stringify(iron),originalIron);
  assert.equal(bridge.getScheduledWorkouts('2026-11-24').length,1);
  assert.equal(bridge.prepareScheduledWorkout(saved.events[1].id,'2026-11-23').label,'하체 루틴');
  assert.equal(app.get('fd-program-apply'),null);
});
test('fixed program registration counts the remaining current week and ends on the selected Saturday',()=>{
  const {iron,id}=calendarProgramFixture('fixed'),raw=JSON.stringify(legacyState()),app=boot(raw,{iron}),bridge=app.context.FormdayBridge;
  assert.equal(bridge.openProgramRegistration(id),true);
  assert.match(app.get('fd-program-preview').innerHTML,/지난 날짜 · 제외/);
  assert.match(app.get('fd-program-preview').innerHTML,/3개 등록 예정/);
  app.get('fd-program-date').value='2026-11-22';app.get('fd-program-date').onchange();
  assert.equal(app.get('fd-program-apply').disabled,true);
  assert.match(app.get('form-error').textContent,/과거 날짜/);
  assert.equal(app.writes.length,0);
  app.get('fd-program-date').value='2026-11-23';app.get('fd-program-date').onchange();
  app.get('fd-program-weeks').value='2';app.get('fd-program-weeks').onchange();
  assert.match(app.get('modal-root').innerHTML,/몇 주 등록할까요/);
  assert.match(app.get('fd-program-preview').innerHTML,/7개 등록 예정/);
  app.get('fd-program-apply').click();
  const saved=C.normalizeState(JSON.parse(app.map.get(C.STORE)));
  assert.deepEqual(saved.events.slice(1).map(e=>e.date),['2026-11-23','2026-11-25','2026-11-28','2026-11-29','2026-11-30','2026-12-02','2026-12-05']);
});
test('program registration retains preview on storage failure and retry does not duplicate',()=>{
  const {iron,id}=calendarProgramFixture('cycle'),raw=JSON.stringify(legacyState()),app=boot(raw,{iron}),bridge=app.context.FormdayBridge;
  bridge.openProgramRegistration(id);app.failWrites();
  app.get('fd-program-apply').click();
  assert.equal(app.map.get(C.STORE),raw);
  assert.match(app.get('form-error').textContent,/저장하지 못했습니다/);
  assert.match(app.get('fd-program-preview').innerHTML,/2개 등록 예정/);
  app.failWrites(false);app.get('fd-program-apply').click();
  const saved=app.map.get(C.STORE),count=app.writes.length;
  assert.equal(bridge.openProgramRegistration(id),true);
  assert.equal(app.get('fd-program-apply').disabled,true);
  assert.match(app.get('fd-program-preview').innerHTML,/이미 등록/);
  app.get('fd-program-apply').click();
  assert.equal(app.map.get(C.STORE),saved);assert.equal(app.writes.length,count);
});
test('changed routine or program while registration is open prevents stale batch writes',()=>{
  const {iron,id}=calendarProgramFixture('cycle'),raw=JSON.stringify(legacyState()),app=boot(raw,{iron}),bridge=app.context.FormdayBridge;
  bridge.openProgramRegistration(id);
  const latest=I.copy(iron);latest.routines[0].name='새 하체 루틴';app.setIronSnapshot(latest);
  app.get('fd-program-apply').click();
  assert.match(app.get('form-error').textContent,/프로그램 또는 루틴이 변경/);
  assert.equal(app.map.get(C.STORE),raw);assert.equal(app.writes.length,0);
});

test('bulk strength completion requires confirmation and does not turn sample or future plans into real workouts',()=>{
 const initial=scheduledFixture(),raw=JSON.stringify(initial);
 const declined=boot(raw,{confirm:false}),bridge=declined.context.FormdayBridge;
 bridge.openDayDetail('2026-11-23');declined.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
 assert.match(declined.confirmations[0],/모든 세트를 실제로 완료/);
 assert.equal(declined.map.get(C.STORE),raw);assert.equal(declined.writes.length,0);
 const accepted=boot(raw,{confirm:true});accepted.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
 assert.equal(C.normalizeState(JSON.parse(accepted.map.get(C.STORE))).events[0].completed,true);
 const future=C.normalizeState({...initial,events:[{...initial.events[0],date:'2026-11-24'}]});
 const futureRaw=JSON.stringify(future),f=boot(futureRaw);
 f.context.FormdayBridge.openDayDetail('2026-11-24');
 f.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
 assert.equal(f.map.get(C.STORE),futureRaw);assert.equal(f.writes.length,0);
 assert.match(f.get('fd-day-status').textContent,/미래 날짜/);
 assert.equal(f.context.FormdayBridge.saveSet({eventId:'scheduled-workout',date:'2026-11-24',exerciseId:'planned-bench',setId:'planned-main',weight:60,reps:8,rpe:8,done:true}),false);
 const sample=C.normalizeState({...initial,events:[{...initial.events[0],isSample:true}]});
 const sampleRaw=JSON.stringify(sample),s=boot(sampleRaw);
 s.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
 assert.equal(s.map.get(C.STORE),sampleRaw);assert.equal(s.writes.length,0);
});

test('explicit finish with skipped sets counts as one completed workout without fabricating calendar sets',()=>{
 const raw=JSON.stringify(scheduledFixture()),app=boot(raw,{iron:routineFixture()}),bridge=app.context.FormdayBridge;
 const started=startScheduled(app),s=started.session;
 const performed=I.modify(started.next,s.id,session=>{
   session.exercises[0].sets[1].weight=57.5;session.exercises[0].sets[1].reps=6;session.exercises[0].sets[1].done=true;
 },new Date('2026-11-23T18:15:00Z'));
 const finished=I.finish(performed.next,s.id,'COMPLETED',new Date('2026-11-23T18:20:00Z'));
 app.setIronSnapshot(finished.next);
 assert.equal(app.get('stat-workout').textContent,'1 / 1');
 assert.match(app.get('agenda').innerHTML,/실제 1\/2세트 수행/);
 assert.match(app.get('agenda').innerHTML,/캘린더 반영 대기/);
 assert.equal(bridge.reflectWorkoutSession(finished.session).ok,true);
 const actual=bridge.getScheduledWorkouts('2026-11-23')[0].event;
 assert.equal(actual.completed,true);
 assert.deepEqual(plain(actual.detail.exercises[0].sets.map(s=>[s.weight,s.reps,s.done])),[[20,12,false],[57.5,6,true]]);
 assert.equal(app.get('stat-workout').textContent,'1 / 1');
 assert.match(app.get('agenda').innerHTML,/실제 1\/2세트 수행 · 미수행 1세트/);
 assert.match(app.get('workout-progress').innerHTML,/345/);
 const before=app.map.get(C.STORE),writes=app.writes.length;
 app.get('agenda').querySelector('[data-toggle="scheduled-workout"]').click();
 assert.equal(app.map.get(C.STORE),before);assert.equal(app.writes.length,writes);
 const plan=bridge.getState();plan.events[0].completed=false;
 const legacy=boot(JSON.stringify(plan),{iron:finished.next});
 assert.equal(legacy.get('stat-workout').textContent,'1 / 1');
 assert.match(legacy.get('agenda').innerHTML,/실제 1\/2세트 수행/);
});


const aiFixture=overrides=>JSON.stringify({format:'formday-ai-meal-v1',date:'2026-11-23',mealPeriod:'lunch',title:'합성 시험 식단',
  notes:'실제 식사가 아닌 자동 시험',items:[{name:'시험 음식',amount:100,unit:'g',evidence:'estimate',nutrients:{kcal:120,carbs:15,protein:5,fat:4,unsat:null}}],...overrides});
function previewAI(app,raw=aiFixture()){
  app.get('ai-meal-import').click();
  const paste=app.get('fd-ai-meal-text');paste.value=raw;paste.oninput?.();
  app.get('fd-ai-meal-preview').click();
}
test('AI meal import previews without writes and appends exactly one completed meal using the original calendar store',()=>{
  const app=boot(JSON.stringify(legacyState()));
  previewAI(app);
  assert.equal(app.get('fd-ai-preview').hidden,false);
  assert.equal(app.get('fd-ai-meal-save').disabled,false);
  assert.match(app.get('fd-ai-totals').innerHTML,/120 kcal/);
  assert.match(app.get('fd-ai-totals').innerHTML,/미확인/);
  assert.equal(app.writes.length,0);
  app.get('fd-ai-meal-save').click();
  const saved=JSON.parse(app.map.get(C.STORE));
  assert.equal(saved.events.length,2);
  assert.equal(saved.events[0].id,'legacy-workout');
  const meal=saved.events[1];
  assert.equal(meal.title,'합성 시험 식단');assert.equal(meal.completed,true);
  assert.equal(meal.detail.items[0].food.nutrients.unsat,null);
  assert.equal(meal.detail.items[0].food.nutrients.kcal,120);
  assert.equal(meal.detail.mealPeriod,'lunch');assert.equal(meal.detail.mealTimeBasis,'category');
  assert.equal(app.writes.filter(([key])=>key===C.STORE).length,1);
  assert.equal(app.context.FormdayBridge.getState().events.length,2);
  previewAI(app);
  assert.equal(app.get('fd-ai-meal-save').disabled,true);
  assert.match(app.get('fd-ai-import-status').textContent,/중복 가능 식단/);
  assert.equal(app.writes.filter(([key])=>key===C.STORE).length,1);
});
test('AI import requests meal category when omitted, then invalidates preview on paste edit',()=>{
  const app=boot(JSON.stringify(legacyState()));previewAI(app,aiFixture({mealPeriod:null}));
  assert.equal(app.get('fd-ai-meal-save').disabled,true);
  assert.equal(app.get('fd-ai-start'),null);assert.equal(app.get('fd-ai-end'),null);
  app.get('fd-ai-meal-period').value='lunch';app.get('fd-ai-meal-period').oninput();
  assert.equal(app.get('fd-ai-meal-save').disabled,false);
  const input=app.get('fd-ai-meal-text');input.value=aiFixture({title:'수정된 내용'});input.oninput();
  assert.equal(app.get('fd-ai-meal-save').disabled,true);
  assert.equal(app.get('fd-ai-preview').hidden,true);assert.equal(app.writes.length,0);
});
test('AI importer escapes untrusted food text and does not execute pasted markup',()=>{
  const app=boot(JSON.stringify(legacyState()));
  previewAI(app,aiFixture({items:[{name:'<img src=x onerror=alert(1)>',amount:100,unit:'g',evidence:'unknown'}]}));
  assert.match(app.get('fd-ai-foods').innerHTML,/&lt;img/);
  assert.doesNotMatch(app.get('fd-ai-foods').innerHTML,/<img/);
  assert.equal(app.writes.length,0);
});
test('AI meal failed local write preserves the input and old records; retry may save only once',()=>{
  const raw=JSON.stringify(legacyState()),app=boot(raw);previewAI(app);app.failWrites();
  app.get('fd-ai-meal-save').click();
  assert.equal(app.map.get(C.STORE),raw);
  assert.equal(app.get('fd-ai-meal-text').value,aiFixture());
  app.failWrites(false);app.get('fd-ai-meal-save').click();
  assert.equal(JSON.parse(app.map.get(C.STORE)).events.length,2);
  assert.equal(app.writes.filter(([key])=>key===C.STORE).length,1);
});
test('AI import cannot overwrite a newer tab revision and keeps the draft',()=>{
  const app=boot(JSON.stringify(legacyState()));previewAI(app);
  const external={...C.normalizeState(legacyState()),revision:'other-tab-revision'};
  app.map.set(C.STORE,JSON.stringify(external));app.get('fd-ai-meal-save').click();
  assert.equal(app.map.get(C.STORE),JSON.stringify(external));
  assert.equal(app.get('fd-ai-meal-save').disabled,true);
  assert.equal(app.get('fd-ai-meal-text').value,aiFixture());
});


const categoryMealController=()=>({read(){return mealDetail(food());},draft(){return mealDetail(food());},destroy(){}});
test('manual meal chooses breakfast lunch dinner or snack; clock inputs hidden and disabled',()=>{
 const app=boot(JSON.stringify(stateWith()),{mealMount:categoryMealController});app.get('new-meal').click();
 assert.equal(app.get('f-meal-period').disabled,false);
 assert.deepEqual(app.get('f-meal-period').querySelectorAll('option').map(o=>o.value),['','breakfast','lunch','dinner','snack']);
 assert.equal(app.get('f-start-field').classList.contains('hide'),true);assert.equal(app.get('f-end').disabled,true);
 app.get('save-event').click();assert.equal(app.writes.length,0);
 app.get('f-meal-period').value='dinner';app.get('f-completed').checked=true;app.get('save-event').click();
 const saved=JSON.parse(app.map.get(C.STORE)).events[0];
 assert.equal(saved.detail.mealPeriod,'dinner');assert.equal(saved.detail.mealTimeBasis,'category');
 assert.equal(saved.completed,true);assert.match(app.get('agenda').innerHTML,/저녁/);
});
test('editing a time-based legacy meal uses an inferred category and preserves original clock data',()=>{
 const m=mealEvent(mealDetail(food()),{start:'07:40',end:'08:20',title:'기존 식사'});
 const raw=JSON.stringify(stateWith(m));const app=boot(raw,{mealMount:categoryMealController});
 assert.match(app.get('agenda').innerHTML,/아침/);assert.match(app.get('agenda').innerHTML,/추정/);
 assert.equal(app.map.get(C.STORE),raw);assert.equal(app.writes.length,0);
 app.get('agenda').querySelector('[data-edit="meal1"]').click();
 assert.equal(app.get('f-meal-period').value,'breakfast');assert.ok(app.get('f-meal-legacy-hint'));
 app.get('f-meal-period').value='snack';app.get('save-event').click();
 const saved=JSON.parse(app.map.get(C.STORE)).events[0];
 assert.equal(saved.start,'07:40');assert.equal(saved.end,'08:20');
 assert.equal(saved.detail.mealPeriod,'snack');assert.equal(saved.detail.mealTimeBasis,'recorded');
});
test('week/day meal rows are separate from timed exercises; month and agenda use category labels',()=>{
 const meal=mealEvent({...mealDetail(food()),mealPeriod:'lunch',mealTimeBasis:'category'},{start:'12:00',end:'12:01',title:'분류식단'});
 const exercise=legacyEvent({start:'18:00',end:'19:00',title:'운동시간보존'});
 const raw=JSON.stringify(stateWith(meal,exercise)),app=boot(raw);
 assert.match(app.get('calendar').innerHTML,/event-time" title="점심">점심/);
 assert.match(app.get('agenda').innerHTML,/agenda-time" title="점심">점심/);
 for(const view of ['week','day']){
  app.document.querySelector('[data-view="'+view+'"]').click();
  const html=app.get('calendar').innerHTML;
  assert.match(html,/fd-meal-period-board/);assert.match(html,/fd-meal-period-event[^>]*data-edit="meal1"/);
  assert.doesNotMatch(html,/time-event[^>]*data-edit="meal1"/);assert.doesNotMatch(html,/12:00–12:01/);
  assert.match(html,/time-event[^>]*data-edit="legacy-workout"/);assert.match(html,/18:00–19:00/);
 }
 assert.equal(app.map.get(C.STORE),raw);assert.equal(app.writes.length,0);
});
test('category-only meal changed into another type must receive actual clock input',()=>{
 const m=mealEvent({...mealDetail(food()),mealPeriod:'lunch',mealTimeBasis:'category'},{start:'12:00',end:'12:01'});
 const raw=JSON.stringify(stateWith(m));const app=boot(raw,{mealMount:categoryMealController});
 app.get('agenda').querySelector('[data-edit="meal1"]').click();
 app.document.querySelector('[data-pick="cardio"]').click();
 assert.equal(app.get('f-start').disabled,false);assert.equal(app.get('f-start').value,'');assert.equal(app.get('f-meal-period').disabled,true);
 app.get('save-event').click();assert.equal(app.writes.length,0);
 app.get('f-start').value='17:00';app.get('f-end').value='17:30';app.get('save-event').click();
 const saved=JSON.parse(app.map.get(C.STORE)).events[0];assert.equal(saved.type,'cardio');assert.equal(saved.start,'17:00');
});

test('free schedule stores an unstarted plan only and shows registered workouts before the registration choices',()=>{
  const app=boot(JSON.stringify(stateWith())),bridge=app.context.FormdayBridge;
  bridge.openDayDetail('2026-11-26');
  app.document.querySelector('[data-day-create="strength"]').click();
  app.document.querySelector('[data-weight-route="free"]').click();
  app.get('fd-free-empty').click();
  assert.equal(app.get('fd-free-date').value,'2026-11-26');
  assert.equal(app.writes.length,0);
  app.get('fd-free-save').click();
  const stored=JSON.parse(app.map.get(C.STORE)),plan=stored.events[0];
  assert.equal(stored.events.length,1);assert.equal(plan.title,'자유운동');
  assert.equal(plan.detail.freePlan,true);assert.deepEqual(plan.detail.exercises,[]);assert.equal(plan.completed,false);
  assert.match(app.get('agenda').innerHTML,/시작할 때 종목 선택/);
  assert.equal(app.get('agenda').querySelector('[data-toggle="'+plan.id+'"]').disabled,true);
  assert.equal(bridge.prepareScheduledWorkout(plan.id,plan.date).freePlan,true);
  app.document.querySelector('[data-day-create="strength"]').click();
  const markup=app.get('modal-root').innerHTML;
  assert.ok(markup.indexOf('fd-weight-existing')<markup.indexOf('data-weight-route="routine"'));
  app.get('fd-weight-close').click();
  assert.equal(JSON.parse(app.map.get(C.STORE)).events.length,1);
});
test('registered strength cards precede other entries and set details start folded',()=>{
  const cardio={id:'early-cardio',date:'2026-11-23',start:'06:00',end:'06:30',type:'cardio',title:'이른 러닝',repeat:'none',completed:false,detail:{cardio:'러닝',minutes:30,distance:3,intensity:'보통'}};
  const app=boot(JSON.stringify(stateWith(cardio,...legacyState().events)));
  app.context.FormdayBridge.openDayDetail('2026-11-23');
  const markup=app.get('agenda').innerHTML;
  assert.ok(markup.indexOf('fd-weight-card')<markup.indexOf('이른 러닝'));
  assert.match(markup,/<details class="fd-plan-disclosure" data-fold-key="[^"]+">/);
  assert.match(markup,/<details class="fd-plan-exercise" data-fold-key="[^"]+">/);
  assert.doesNotMatch(markup,/<details class="fd-plan-(?:disclosure|exercise)"[^>]* open>/);
});

test('meal comments preview and persist as plain notes, calendar shows them and reload preserves them',()=>{
 const app=boot(JSON.stringify(legacyState()));
 const notes='추정 근거: 합성 시험\n음식별 코멘트:\n- 시험 음식: <img src=x onerror=alert(1)>\n식사별 코멘트: 시험\n일일 코멘트(등록 시점): 미평가\n사용자 메모: 개인 메모';
 previewAI(app,aiFixture({notes}));
 assert.match(app.get('fd-ai-notes').textContent,/음식별 코멘트/);
 assert.match(app.get('fd-ai-notes').textContent,/사용자 메모: 개인 메모/);
 app.get('fd-ai-meal-save').click();
 const raw=app.map.get(C.STORE),saved=JSON.parse(raw).events.find(e=>e.type==='meal');
 assert.ok(saved.detail.notes.includes(notes));
 assert.equal(saved.detail.items[0].food.nutrients.kcal,120);
 const again=boot(raw),html=again.get('agenda').innerHTML;
 assert.match(html,/코멘트 · 식사 메모/);
 assert.match(html,/사용자 메모: 개인 메모/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img src=x/);
});
