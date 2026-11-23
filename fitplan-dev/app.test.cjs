'use strict';

// Integration smoke tests for the four real browser scripts. This intentionally
// small DOM adapter covers startup, settings and backup handlers. It is not a
// browser layout engine and does not replace the deployed UI checks.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../fitplan/core.js');
const directory = path.join(__dirname, '../fitplan');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const scripts = ['data.js', 'workouts.js', 'core.js', 'app.js'].map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]);
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
  const map = new Map(raw === undefined ? [] : [[C.STORE, raw]]), writes = [], confirmations = [], windowListeners = new Map();
  let failWrites = false, unique = 0;
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) { if (failWrites && key === C.STORE) throw new Error('QuotaExceededError'); writes.push([key, value]); map.set(key, value); }
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-23T12:00:00Z'])); } static now() { return Date.parse('2026-11-23T12:00:00Z'); } }
  const context = vm.createContext({ document, Date: FixedDate, console, localStorage: storage,
    crypto: { randomUUID: () => 'test-' + ++unique },
    setTimeout: () => ++unique, clearTimeout() {}, setInterval: () => ++unique, clearInterval() {}, requestAnimationFrame: (fn) => fn(),
    confirm(message) { confirmations.push(message); return options.confirm !== false; },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }
  });
  context.window = context;
  if (options.storageDenied) Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  for (const [name, code] of scripts) vm.runInContext(code, context, { filename: name });
  return { document, context, map, writes, storage, confirmations, windowListeners,
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

test('empty storage starts the real four scripts, renders the calendar and labels samples without auto-saving', () => {
  const app = boot();
  assert.equal(app.get('date-heading').textContent, '2026년 11월');
  assert.equal((app.get('calendar').innerHTML.match(/class="month-cell /g) || []).length, 42);
  assert.equal(app.get('stat-workout').textContent, '0 / 1');
  assert.match(app.get('stat-kcal').innerHTML, /365\.5/);
  assert.equal(app.get('demo-banner').classList.contains('hide'), false);
  assert.match(app.get('storage-status').innerHTML, /이 브라우저에 저장/);
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
