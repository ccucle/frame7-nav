'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../fitplan/exercise-picker.js');
const W = require('../fitplan/workouts.js');
const D = require('../fitplan/iron-data.js');

const rows = P.catalogRows(W.catalog, D.all(W.catalog));
const selectedNames = model => model.selection();

test('search matches full names, separated words and Korean initials', () => {
  assert.equal(P.matchesName('인클라인 벤치프레스', '벤치 프레스'), true);
  assert.equal(P.matchesName('인클라인 벤치프레스', 'ㅂㅊㅍㄹㅅ'), true);
  assert.equal(P.matchesName('인클라인 벤치프레스', '인클 ㅂㅊ'), true);
  assert.equal(P.matchesName('벤치프레스', 'ᄇᄎ'), true);
  assert.equal(P.matchesName('벤치프레스', '바벨'), false);
  assert.equal(P.matchesName('스쿼트', '벤치'), false);
  assert.equal(P.matchesName('ABC Press', 'abc pre'), true);
  assert.equal(P.matchesName('스쿼트', '  '), true);
});

test('muscle, equipment, query and favorites filters combine without clearing selection', () => {
  const model = P.createModel(rows, {multiple: true, favorites: ['덤벨프레스', '벤치프레스']});
  model.toggle('스쿼트'); model.toggle('벤치프레스');
  model.setFilter('group', '가슴'); model.setFilter('equipment', '덤벨');
  model.setFilter('favoritesOnly', true); model.setFilter('query', 'ㅍㄹㅅ');
  assert.deepEqual(model.visible().map(row => row.name), ['덤벨프레스']);
  assert.deepEqual(selectedNames(model), ['스쿼트', '벤치프레스']);
  model.resetFilters();
  assert.equal(model.visible().length, W.catalog.length);
  assert.deepEqual(selectedNames(model), ['스쿼트', '벤치프레스']);
});

test('multi selection preserves order, enforces limits and permits deselection at the limit', () => {
  const model = P.createModel(rows, {multiple: true, limit: 2});
  assert.equal(model.toggle('벤치프레스'), 'selected');
  assert.equal(model.toggle('스쿼트'), 'selected');
  assert.equal(model.toggle('랫풀다운'), 'limit');
  assert.deepEqual(selectedNames(model), ['벤치프레스', '스쿼트']);
  assert.equal(model.toggle('벤치프레스'), 'removed');
  assert.equal(model.toggle('랫풀다운'), 'selected');
  assert.equal(model.toggle('arbitrary imported exercise'), 'unknown');
  assert.deepEqual(selectedNames(model), ['스쿼트', '랫풀다운']);
});

test('single selection replaces the previous choice; zero capacity stays empty', () => {
  const single = P.createModel(rows, {limit: 25});
  single.toggle('벤치프레스'); single.toggle('스쿼트');
  assert.deepEqual(selectedNames(single), ['스쿼트']);
  assert.equal(single.limit, 1);
  const full = P.createModel(rows, {multiple: true, limit: 0});
  assert.equal(full.toggle('스쿼트'), 'limit');
  assert.deepEqual(selectedNames(full), []);
  assert.equal(P.createModel(rows, {multiple: true, limit: 500}).limit, 30);
});

test('catalog and favorites accept known names only and do not use generic photos', () => {
  const source = [{name: '스쿼트', group: '하체'}, {name: '스쿼트', group: '하체'}, null, {name: ''}];
  const catalog = P.catalogRows(source, [{name: '스쿼트', equipment: '바벨', photo: 'unrelated.jpg'}]);
  assert.deepEqual(catalog, [{name: '스쿼트', group: '하체', equipment: '바벨'}]);
  const model = P.createModel(catalog, {favorites: ['스쿼트', 'unknown']});
  assert.equal(model.isFavorite('unknown'), false);
  assert.equal(model.isFavorite('스쿼트'), true);
});

test('image URLs and credits reject executable, credentialed and insecure URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg>', '//example.com/a.jpg', 'http://example.com/a.jpg', 'https://name:password@example.com/a.jpg', 'https://bad host/a.jpg', '\\evil.test/a.jpg', '#image']) {
    assert.equal(P.safeURL(url), '', url);
  }
  assert.equal(P.safeURL('assets/exercises/squat.webp'), 'assets/exercises/squat.webp');
  assert.equal(P.safeURL('./assets/squat.webp'), './assets/squat.webp');
  assert.equal(P.safeURL('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
  assert.equal(P.safeURL('/credits', true), '');
});

// A small DOM implementation exercises the actual picker event handlers,
// element replacement, focus restoration and dialog lifecycle without a browser.
const decode = str => String(str).replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[value]));
class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback); }
  removeEventListener(type, callback) { this.events.get(type)?.delete(callback); }
  emit(type, details = {}) {
    const event = {type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...details};
    for (const callback of Array.from(this.events.get(type) || [])) callback(event);
    return event;
  }
  listenerCount() { return Array.from(this.events.values()).reduce((sum, handlers) => sum + handlers.size, 0); }
}
class Element extends Events {
  constructor(tagName, document) {
    super(); this.tagName = tagName.toUpperCase(); this.document = document; this.children = []; this.attributes = new Map();
    this.dataset = {}; this.parentElement = null; this.disabled = false; this.hidden = false; this.value = ''; this.open = false; this._text = ''; this._html = '';
    this.style = {values: new Map(), setProperty(key, value) { this.values.set(key, value); }};
    this.classList = {contains: name => (this.className || '').split(/\s+/).includes(name),
      add: name => { this.className = [...new Set((this.className || '').split(/\s+/).filter(Boolean).concat(name))].join(' '); },
      remove: name => { this.className = (this.className || '').split(/\s+/).filter(value => value !== name).join(' '); }};
  }
  get isConnected() { return this === this.document.body || !!this.document.body?.contains(this); }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
    if (key === 'class') this.className = String(value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    if (key === 'disabled') this.disabled = true;
    if (key === 'hidden') this.hidden = true;
    if (key === 'value') this.value = String(value);
  }
  getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
  removeAttribute(key) { this.attributes.delete(key); if (key === 'hidden') this.hidden = false; if (key === 'disabled') this.disabled = false; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const tag = selector.match(/^[a-z][a-z\d-]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const className = selector.match(/\.([a-z\d_-]+)/i)?.[1];
    if (className && !this.classList.contains(className)) return false;
    for (const [, key, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!this.attributes.has(key) || value !== undefined && this.getAttribute(key) !== value) return false;
    }
    return true;
  }
  closest(selector) { if (this.matches(selector)) return this; return this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); for (const child of this.children) child.parentElement = null; this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = value; this._text = ''; for (const child of this.children) child.parentElement = null; this.children = [];
    const stack = [this];
    for (const token of value.match(/<[^>]*>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
      const tag = token.match(/^<([a-z\d-]+)/i)?.[1];
      if (!tag) continue;
      const child = new Element(tag, this.document);
      const attributeText = token.slice(tag.length + 1, -1);
      for (const match of attributeText.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) child.setAttribute(match[1], decode(match[2] || ''));
      stack.at(-1).appendChild(child);
      if (!['input', 'img', 'br', 'hr'].includes(tag)) stack.push(child);
    }
  }
}
function environment() {
  const document = {createElement(tag) { return new Element(tag, this); }, querySelector(selector) { return this.body.querySelector(selector); }};
  document.body = new Element('body', document);
  const main = document.body.appendChild(new Element('main', document));
  const opener = main.appendChild(new Element('button', document)); opener.focus();
  const root = new Events(); root.document = document; root.innerHeight = 844;
  root.visualViewport = new Events(); root.visualViewport.height = 844; root.visualViewport.offsetTop = 0;
  root.FormdayWorkouts = {catalog: [W.catalog[0], W.catalog.find(row => row.name === '스쿼트'), W.catalog.find(row => row.name === '덤벨프레스')]};
  root.FormdayIronData = D;
  root.FormdayExerciseMedia = {byName: {'벤치프레스': {src: 'assets/bench.webp', alt: '벤치프레스 동작', sourceUrl: 'https://example.com/bench'}}};
  const api = P.createPicker(root);
  const dialog = () => document.querySelector('dialog');
  const button = (action, index) => dialog()?.querySelector('[data-picker-action="' + action + '"]' + (index === undefined ? '' : '[data-picker-index="' + index + '"]'));
  const click = (action, index) => { const target = button(action, index); assert.ok(target, 'button ' + action + '/' + index + ' exists'); dialog().emit('click', {target}); };
  return {root, document, opener, main, api, dialog, button, click};
}

test('confirmation rejection/exception keeps the dialog and selection; explicit true closes once', () => {
  const env = environment(); const submissions = [], closed = []; let answer = false;
  assert.equal(env.api.open({multiple: true, onConfirm(names) { submissions.push(names); if (answer === 'throw') throw Error('storage failed'); return answer; }, onClose: detail => closed.push(detail)}), true);
  assert.equal(env.document.activeElement.tagName, 'H2');
  env.click('select', 0); env.click('select', 1); env.click('confirm');
  assert.equal(env.api.isOpen(), true); assert.equal(env.dialog().querySelector('[data-picker-message]').hidden, false);
  assert.deepEqual(submissions[0], ['벤치프레스', '스쿼트']);
  answer = 'throw'; env.click('confirm'); assert.equal(env.api.isOpen(), true);
  answer = Promise.resolve(true); env.click('confirm'); assert.equal(env.api.isOpen(), true);
  answer = true; env.click('confirm');
  assert.equal(env.api.isOpen(), false); assert.equal(env.dialog(), null);
  assert.deepEqual(closed, [{reason: 'confirmed'}]);
  assert.deepEqual(submissions.at(-1), ['벤치프레스', '스쿼트']);
  assert.equal(env.document.activeElement, env.opener);
  assert.equal(env.root.visualViewport.listenerCount(), 0); assert.equal(env.root.listenerCount(), 0);
  assert.equal(env.document.body.classList.contains('fd-picker-open'), false);
});

test('favorite action never selects an exercise and failed persistence does not change its star', () => {
  const env = environment(); let favorites = []; let accepted = false; const writes = [];
  env.api.open({multiple: true, getFavorites: () => favorites, onFavoriteChange(name, value) { writes.push([name, value]); if (accepted) favorites = value ? [name] : []; return accepted; }});
  env.click('favorite', 0);
  assert.equal(env.button('favorite', 0).getAttribute('aria-pressed'), 'false');
  assert.equal(env.button('confirm').disabled, true);
  accepted = true; env.click('favorite', 0);
  assert.equal(env.button('favorite', 0).getAttribute('aria-pressed'), 'true');
  assert.equal(env.button('confirm').disabled, true);
  env.click('select', 1); env.click('favorites-only');
  assert.equal(env.button('select', 1), null);
  assert.ok(env.button('remove', 1), 'filtered-out selection remains removable');
  env.click('favorite', 0);
  assert.equal(env.dialog().querySelector('[data-picker-empty]').hidden, false);
  assert.equal(env.document.activeElement.tagName, 'H2');
  assert.deepEqual(writes, [['벤치프레스', true], ['벤치프레스', true], ['벤치프레스', false]]);
  env.api.close();
});

test('Escape, close button and backdrop cancel without confirmation; each reopen is empty', () => {
  const env = environment(); const closed = []; let confirmed = 0;
  const opts = {multiple: true, onConfirm() { confirmed++; return true; }, onClose: detail => closed.push(detail)};
  env.api.open(opts); env.click('select', 0);
  const event = env.dialog().emit('cancel'); assert.equal(event.defaultPrevented, true);
  assert.equal(confirmed, 0); assert.equal(env.api.isOpen(), false);
  env.api.open(opts); assert.equal(env.button('confirm').disabled, true); env.click('cancel');
  env.api.open(opts); env.dialog().emit('click');
  assert.deepEqual(closed, [{reason: 'cancel'}, {reason: 'cancel'}, {reason: 'cancel'}]);
  assert.equal(confirmed, 0);
});

test('filter events preserve selected names, and a full limit leaves earlier choices intact', () => {
  const env = environment(); let result;
  env.api.open({multiple: true, limit: 1, onConfirm(names) { result = names; return true; }});
  env.click('select', 0); env.click('select', 1);
  assert.match(env.dialog().querySelector('[data-picker-message]').textContent, /최대 1개/);
  const query = env.dialog().querySelector('[data-picker-query]'); query.value = 'ㅅㅋㅌ';
  env.dialog().emit('input', {target: query});
  assert.equal(env.button('select', 0), null); assert.ok(env.button('select', 1));
  assert.ok(env.button('remove', 0));
  assert.equal(env.api.open({}), false, 'reentry must not discard current selection');
  env.click('confirm'); assert.deepEqual(result, ['벤치프레스']);
});

test('clearing selection does not leave focus in the now-hidden selection tray', () => {
  const env = environment(); env.api.open({multiple: true}); env.click('select', 0);
  env.button('clear').focus(); env.click('clear');
  assert.equal(env.dialog().querySelector('[data-picker-selected]').hidden, true);
  assert.equal(env.button('confirm').disabled, true);
  assert.equal(env.document.activeElement.tagName, 'H2');
  env.api.close();
});

test('only mapped images are rendered and image failure has an explicit fallback', () => {
  const env = environment(); env.api.open({});
  const images = env.dialog().querySelectorAll('img');
  assert.equal(images.length, 1); assert.equal(images[0].getAttribute('src'), 'assets/bench.webp');
  assert.equal(images[0].getAttribute('alt'), '벤치프레스 동작');
  assert.equal(images[0].getAttribute('loading'), 'lazy');
  assert.equal(env.dialog().querySelectorAll('.fd-picker-missing').length, 2);
  const link = env.dialog().querySelector('a'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  env.dialog().emit('error', {target: images[0]});
  assert.equal(env.dialog().querySelectorAll('img').length, 0);
  assert.match(env.dialog().querySelector('.fd-picker-missing').textContent, /불러오기 실패/);
  env.api.close();
});

test('verified media equipment overrides inferred equipment and the footer links full credits', () => {
  const env = environment(); env.root.FormdayExerciseMedia.byName['벤치프레스'].equipment = '스미스 머신';
  env.api.open({});
  const equipment = env.dialog().querySelector('[data-picker-equipment]');
  assert.match(equipment.textContent, /스미스 머신/);
  equipment.value = '스미스 머신'; env.dialog().emit('change', {target: equipment});
  assert.ok(env.button('select', 0)); assert.equal(env.button('select', 1), null);
  const credits = env.dialog().querySelector('.fd-picker-attribution');
  assert.equal(credits.getAttribute('href'), 'exercise-credits.html');
  assert.equal(credits.getAttribute('rel'), 'noopener noreferrer');
  env.api.close();
});

test('viewport changes reposition the modal and cleanup preserves an existing body lock', () => {
  const env = environment(); env.document.body.classList.add('fd-picker-open');
  env.api.open({});
  env.root.visualViewport.height = 370; env.root.visualViewport.offsetTop = 28; env.root.visualViewport.emit('resize');
  assert.equal(env.dialog().style.values.get('--fd-picker-vh'), '370px');
  assert.equal(env.dialog().style.values.get('--fd-picker-vtop'), '28px');
  assert.equal(env.dialog().getAttribute('data-picker-compact'), 'true');
  assert.equal(env.dialog().getAttribute('data-picker-short'), 'true');
  env.opener.remove(); env.api.close();
  assert.equal(env.document.activeElement, env.main);
  assert.equal(env.main.getAttribute('tabindex'), null);
  assert.equal(env.document.body.classList.contains('fd-picker-open'), true);
  assert.equal(env.root.visualViewport.listenerCount(), 0);
});

test('a missing native dialog or failed favorites read never mutates caller state', () => {
  const env = environment(); const oldCreate = env.document.createElement;
  env.document.createElement = function (tag) { const element = oldCreate.call(this, tag); if (tag === 'dialog') element.showModal = undefined; return element; };
  assert.equal(env.api.open({onConfirm() { throw Error('should not run'); }}), false);
  assert.equal(env.api.isOpen(), false);
  assert.equal(env.document.body.classList.contains('fd-picker-open'), false);
  env.document.createElement = oldCreate;
  env.api.open({getFavorites() { throw Error('unavailable'); }, onFavoriteChange() { throw Error('should stay disabled'); }});
  assert.equal(env.button('favorite', 0).disabled, true);
  assert.match(env.dialog().querySelector('[data-picker-message]').textContent, /불러오지 못/);
  env.click('select', 0); assert.equal(env.button('confirm').disabled, false); env.api.close();
});
