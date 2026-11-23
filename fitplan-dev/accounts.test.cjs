'use strict';

// Small DOM adapter for behavior and data-retention checks. Browser QA covers
// native layout, focus, password-manager integration and responsive styling.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const A = require('../fitplan/accounts.js');
const BASE = { available: true, loading: false, user: null, active: false, dirty: false, syncing: false, conflict: null, error: '', lastSyncedAt: null, selectionRequired: false, localCount: 3, remoteCount: 0 };
const PASSWORD = 'a valid test password';
const RECOVERY = 'fixture-only-recovery-code-never-real-secret';
const attribute = (text, name) => (text.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')) || [])[1] || '';
const tick = () => new Promise(resolve => setImmediate(resolve));
function element(tag = '') {
  return { value: '', checked: false, hidden: /\shidden(?:\s|>)/.test(tag), disabled: /\sdisabled(?:\s|>)/.test(tag), readOnly: false, dataset: {}, attrs: {}, textContent: '',
    setAttribute(name, value) { this.attrs[name] = value; }, focus() { this.focused = true; }, closest() { return this; } };
}
function harness(initial = {}, overrides = {}, extra = {}) {
  let status = { ...BASE, ...initial }, html = '', builds = 0;
  const listeners = new Map(), nodes = new Map(), fields = new Map(), forms = new Map(), submits = new Map(), actions = [];
  const calls = [];
  const cloud = {
    status: () => ({ ...status }),
    init: async () => ({ ...status }),
    register: async args => { calls.push(['register', { ...args }]); status = { ...status, user: { id: 'u1', username: args.username }, selectionRequired: true }; return { user: status.user, recoveryCode: RECOVERY }; },
    login: async args => { calls.push(['login', { ...args }]); status = { ...status, user: { id: 'u1', username: args.username }, selectionRequired: true }; return { user: status.user }; },
    recover: async args => { calls.push(['recover', { ...args }]); status = { ...status, user: null, active: false, selectionRequired: false }; return { recoveryCode: RECOVERY }; },
    selectSource: async source => { calls.push(['selectSource', source]); status = { ...status, active: true, selectionRequired: false }; return status; },
    resolveConflict: async source => { calls.push(['resolveConflict', source]); status = { ...status, conflict: null, dirty: false }; return status; },
    syncNow: async () => { calls.push(['syncNow']); status = { ...status, dirty: false, lastSyncedAt: '2026-11-23T10:00:00Z' }; return status; },
    logout: async () => { calls.push(['logout']); status = { ...status, user: null, active: false, selectionRequired: false }; return status; },
    ...overrides
  };
  const container = {
    get innerHTML() { return html; }, set innerHTML(value) {
      html = value; builds++;
      for (const match of value.matchAll(/<[a-z][^>]*data-fa-node="([^"]+)"[^>]*>/g)) nodes.set(match[1], element(match[0]));
      for (const match of value.matchAll(/<input\b[^>]*data-fa-field="([^"]+)"[^>]*>/g)) {
        const field = element(match[0]); field.dataset.faField = match[1]; fields.set(match[1], field);
      }
      for (const match of value.matchAll(/<form\b[^>]*data-fa-form="([^"]+)"[^>]*>/g)) {
        const form = element(match[0]); form.dataset.faForm = match[1]; forms.set(match[1], form);
      }
      for (const match of value.matchAll(/<button\b[^>]*data-fa-submit="([^"]+)"[^>]*>/g)) submits.set(match[1], element(match[0]));
      for (const match of value.matchAll(/<button\b[^>]*data-fa-action="([^"]+)"[^>]*>/g)) {
        const button = element(match[0]); button.dataset = { faAction: match[1], tab: attribute(match[0], 'data-tab') }; actions.push(button);
      }
    },
    querySelector(selector) {
      let match;
      if ((match = selector.match(/\[data-fa-node="([^"]+)"\]/))) return nodes.get(match[1]);
      if ((match = selector.match(/\[data-fa-field="([^"]+)"\]/))) return fields.get(match[1]);
      if ((match = selector.match(/\[data-fa-form="([^"]+)"\]/))) return forms.get(match[1]);
      if ((match = selector.match(/\[data-fa-submit="([^"]+)"\]/))) return submits.get(match[1]);
      return null;
    },
    querySelectorAll(selector) { const match = selector.match(/\[data-fa-action="([^"]+)"\]/); return match ? actions.filter(button => button.dataset.faAction === match[1]) : []; },
    contains() { return true; }, addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); }
  };
  const controller = A.mount(container, { cloud, ...extra });
  return {
    controller, cloud, calls, nodes, fields, forms, submits, actions, listeners, container,
    status: () => status,
    update(next) { status = { ...status, ...next }; controller.update(status); },
    builds: () => builds,
    input(name, value) { const field = fields.get(name); field.value = value; listeners.get('input')({ target: field }); },
    check(value) { const field = fields.get('recovery-ack'); field.checked = value; listeners.get('change')({ target: field }); },
    submit(name) { listeners.get('submit')({ target: forms.get(name), preventDefault() {} }); },
    click(action, tab) { const button = actions.find(item => item.dataset.faAction === action && (!tab || item.dataset.tab === tab)); assert.ok(button, action); return listeners.get('click')({ target: button, preventDefault() {} }); }
  };
}
function fill(h, kind = 'login') {
  h.input(kind + '-username', 'user.test'); h.input(kind + '-password', PASSWORD);
  if (kind !== 'login') h.input(kind + '-confirm', PASSWORD);
  if (kind === 'recover') h.input('recover-code', 'old-fixture-recovery-code');
}

test('status refreshes preserve credential inputs, DOM identity and focus', () => {
  const h = harness(); fill(h);
  const input = h.fields.get('login-password'); input.focus();
  h.update({ loading: true }); h.update({ loading: false, error: '연결 재확인' }); h.update({ error: '' });
  assert.equal(h.fields.get('login-password'), input); assert.equal(input.value, PASSWORD); assert.equal(input.focused, true);
  assert.equal(h.builds(), 1); assert.equal(h.controller.isDirty(), true);
  const draft = JSON.stringify(h.controller.draft());
  assert.doesNotMatch(draft, /user\.test|password|a valid/);
  h.controller.destroy();
});

test('unavailable account service never submits or pretends registration succeeded', async () => {
  let called = 0;
  const h = harness({ available: false }, { register: async () => { called++; } });
  h.click('tab', 'register'); fill(h, 'register'); h.submit('register'); await tick();
  assert.equal(called, 0); assert.equal(h.nodes.get('recovery').hidden, true);
  assert.match(h.nodes.get('connection-title').textContent, /현재 브라우저/);
  assert.equal(h.fields.get('register-password').value, PASSWORD);
  h.controller.destroy();
});

test('validation prevents invalid IDs, short passwords and mismatched confirmation', async () => {
  const h = harness(); h.click('tab', 'register'); fill(h, 'register');
  h.input('register-username', 'UPPER'); h.submit('register'); await tick();
  assert.equal(h.calls.length, 0); assert.match(h.nodes.get('error').textContent, /아이디/);
  h.input('register-username', 'valid_id'); h.input('register-password', 'short'); h.submit('register'); await tick();
  assert.equal(h.calls.length, 0); assert.match(h.nodes.get('error').textContent, /15~128/);
  h.input('register-password', PASSWORD); h.input('register-confirm', 'different password'); h.submit('register'); await tick();
  assert.equal(h.calls.length, 0); assert.match(h.nodes.get('error').textContent, /일치하지/);
  h.controller.destroy();
});

test('failed login preserves all inputs and pending requests cannot be submitted twice', async () => {
  let reject, requests = 0;
  const h = harness({}, { login: () => { requests++; return new Promise((_, failure) => { reject = failure; }); } });
  fill(h); h.submit('login'); h.submit('login');
  assert.equal(requests, 1); assert.equal(h.controller.draft().pending, true);
  reject(new Error('로그인 정보를 확인해 주세요.')); await tick();
  assert.equal(h.fields.get('login-password').value, PASSWORD); assert.equal(h.fields.get('login-username').value, 'user.test');
  assert.equal(h.controller.isDirty(), true); assert.equal(h.controller.draft().pending, false);
  assert.match(h.nodes.get('error').textContent, /로그인 정보를 확인/);
  h.controller.destroy();
});

test('registration requires recovery-code acknowledgement before record selection', async () => {
  const h = harness(); h.click('tab', 'register'); fill(h, 'register'); h.submit('register'); await tick();
  assert.equal(h.nodes.get('recovery').hidden, false); assert.equal(h.nodes.get('selection').hidden, true);
  assert.equal(h.nodes.get('recovery-code').textContent, RECOVERY);
  assert.equal(h.fields.get('register-password').value, ''); assert.equal(h.controller.isDirty(), true);
  assert.equal(h.controller.draft().recoveryPending, true);
  assert.doesNotMatch(JSON.stringify(h.controller.draft()), /fixture|recovery-code/);
  h.click('select-local'); assert.equal(h.calls.filter(call => call[0] === 'selectSource').length, 0);
  h.click('ack-recovery'); assert.equal(h.nodes.get('recovery').hidden, false);
  h.check(true); h.click('ack-recovery');
  assert.equal(h.nodes.get('recovery').hidden, true); assert.equal(h.nodes.get('recovery-code').textContent, '');
  assert.equal(h.nodes.get('selection').hidden, false); assert.equal(h.controller.isDirty(), false);
  const previousConfirm = globalThis.confirm; globalThis.confirm = () => true;
  try { h.click('select-local'); } finally { globalThis.confirm = previousConfirm; }
  await tick();
  assert.deepEqual(h.calls.at(-1), ['selectSource', 'local']); assert.equal(h.nodes.get('account').hidden, false);
  h.controller.destroy();
});

test('recovery displays the new code, then returns to login without an authenticated user', async () => {
  const h = harness(); h.click('tab', 'recover'); fill(h, 'recover'); h.submit('recover'); await tick();
  assert.equal(h.status().user, null); assert.equal(h.nodes.get('recovery').hidden, false);
  assert.match(h.nodes.get('recovery-title').textContent, /비밀번호가 변경/);
  assert.equal(h.fields.get('recover-code').value, '');
  h.check(true); h.click('ack-recovery');
  assert.equal(h.nodes.get('auth').hidden, false); assert.equal(h.forms.get('login').hidden, false);
  assert.equal(h.fields.get('login-username').value, 'user.test'); assert.equal(h.controller.isDirty(), false);
  assert.equal(h.nodes.get('selection').hidden, true);
  h.controller.destroy();
});

test('successful login clears credentials and close protection, while logout failure preserves state', async () => {
  const h = harness({}, { logout: async () => { throw new Error('미전송 변경 사항을 먼저 동기화해 주세요.'); } });
  fill(h); h.submit('login'); await tick();
  assert.equal(h.controller.isDirty(), false); assert.equal(h.fields.get('login-password').value, '');
  h.update({ active: true, selectionRequired: false, dirty: true });
  h.click('logout'); await tick();
  assert.equal(h.status().user.username, 'user.test'); assert.equal(h.nodes.get('account').hidden, false);
  assert.match(h.nodes.get('error').textContent, /로그아웃하지 않았으며 현재 기록과 상태는 유지/);
  h.controller.destroy();
});

test('an expired session keeps unsent records and allows only the same account to sign in again', async () => {
  let loginCount = 0, exported = 0;
  const h = harness({ user: { id: 'u1', username: 'saved_user' }, active: true, dirty: true, reauthRequired: true }, {
    login: async args => {
      loginCount++; assert.equal(args.username, 'saved_user');
      h.update({ reauthRequired: false, error: '' });
      return { user: h.status().user };
    }
  }, { onExport: () => { exported++; } });
  assert.equal(h.nodes.get('auth').hidden, false); assert.equal(h.nodes.get('tabs').hidden, true);
  assert.equal(h.forms.get('login').hidden, false); assert.equal(h.forms.get('register').hidden, true);
  assert.equal(h.fields.get('login-username').value, 'saved_user');
  assert.equal(h.fields.get('login-username').readOnly, true);
  assert.equal(h.controller.isDirty(), false);
  h.input('login-password', PASSWORD);
  const password = h.fields.get('login-password'); password.focus();
  h.update({ localCount: 4 });
  assert.equal(password.value, PASSWORD); assert.equal(password.focused, true);
  h.click('tab', 'register'); assert.equal(h.forms.get('login').hidden, false);
  h.click('export'); await tick(); assert.equal(exported, 1);
  h.submit('login'); await tick();
  assert.equal(loginCount, 1); assert.equal(h.status().active, true); assert.equal(h.status().dirty, true);
  assert.equal(h.status().reauthRequired, false); assert.equal(h.nodes.get('auth').hidden, true);
  assert.equal(h.fields.get('login-password').value, ''); assert.equal(h.controller.isDirty(), false);
  assert.equal(h.calls.filter(call => call[0] === 'selectSource').length, 0);
  h.controller.destroy();
});

test('overwriting account records needs confirmation and offers an export action', async () => {
  const previous = globalThis.confirm, messages = []; let accept = false, exports = 0;
  globalThis.confirm = message => { messages.push(message); return accept; };
  try {
    const h = harness({ user: { id: 'u1', username: 'user.test' }, selectionRequired: true, remoteCount: 7, localCount: 3 }, {}, { onExport: () => { exports++; } });
    h.click('select-local'); await tick(); assert.equal(h.calls.length, 0);
    assert.match(messages[0], /계정 일정 7개 \/ 이 기기 일정 3개/); assert.match(messages[0], /내보냈는지/);
    assert.match(messages[0], /일정·내 식품·즐겨찾기·목표가 모두 덮어써지며/);
    h.click('export'); await tick(); assert.equal(exports, 1);
    accept = true; h.click('select-local'); await tick(); assert.deepEqual(h.calls.at(-1), ['selectSource', 'local']);
    h.controller.destroy();
  } finally { globalThis.confirm = previous; }
});

test('each conflict resolution explains which changes are lost and requires confirmation', async () => {
  const previous = globalThis.confirm, messages = []; globalThis.confirm = message => { messages.push(message); return false; };
  try {
    const h = harness({ user: { id: 'u1', username: 'user.test' }, active: true, conflict: true, dirty: true, remoteCount: 8, localCount: 5 });
    h.click('resolve-cloud'); h.click('resolve-local');
    assert.equal(h.calls.length, 0); assert.match(messages[0], /이 기기에서 아직 전송하지 못한 변경 사항은 사라집니다/);
    assert.match(messages[1], /계정 일정 8개 \/ 이 기기 일정 5개/);
    assert.match(messages[0], /일정·내 식품·즐겨찾기·목표가 모두 계정 기록으로 대체/);
    assert.match(messages[1], /일정·내 식품·즐겨찾기·목표가 모두 교체/);
    assert.match(messages[1], /다른 기기에서 계정에 저장한 변경 사항은 합쳐지지 않습니다/);
    globalThis.confirm = () => true; h.click('resolve-cloud'); await tick();
    assert.deepEqual(h.calls.at(-1), ['resolveConflict', 'cloud']);
    h.controller.destroy();
  } finally { globalThis.confirm = previous; }
});

test('unknown record counts never appear as zero and still require overwrite confirmation', () => {
  const previous = globalThis.confirm, messages = []; globalThis.confirm = message => { messages.push(message); return false; };
  try {
    const h = harness({ user: { id: 'u1', username: 'user.test' }, selectionRequired: true, remoteCount: null });
    assert.equal(h.nodes.get('selection-remote-count').textContent, '미확인');
    assert.equal(h.nodes.get('selection-remote-unit').textContent, '');
    assert.match(h.nodes.get('selection-warning').textContent, /아직 확인하지 못했습니다/);
    h.click('select-local'); assert.equal(h.calls.length, 0); assert.match(messages[0], /일정 수 미확인/);
    assert.doesNotMatch(messages[0], /0개/);
    for (const remoteCount of [undefined, NaN, Infinity]) {
      h.update({ remoteCount }); assert.equal(h.nodes.get('selection-remote-count').textContent, '미확인');
    }
    h.update({ remoteCount: 0 }); assert.equal(h.nodes.get('selection-remote-count').textContent, '0');
    assert.equal(h.nodes.get('selection-remote-unit').textContent, '개');
    h.controller.destroy();
  } finally { globalThis.confirm = previous; }
});

test('zero schedules do not bypass confirmation before replacing saved foods, favorites and goals', async () => {
  const previous = globalThis.confirm, messages = []; let accept = false, selections = 0;
  const savedAccount = { events: [], customFoods: [{ id: 'saved-food', name: '보관한 제품' }], favoriteFoodIds: ['saved-food'], settings: { protein: 120, carbs: 200, fat: 50 } };
  const before = JSON.stringify(savedAccount);
  globalThis.confirm = message => { messages.push(message); return accept; };
  try {
    const h = harness({ user: { id: 'u1', username: 'user.test' }, selectionRequired: true, remoteCount: savedAccount.events.length }, {
      selectSource: async source => { selections++; assert.equal(source, 'local'); }
    });
    assert.match(h.container.innerHTML, /아래 개수는 일정 수입니다/);
    assert.match(h.nodes.get('selection-warning').textContent, /일정이 0개여도 보관한 식품과 목표/);
    h.click('select-local'); await tick();
    assert.equal(selections, 0); assert.equal(JSON.stringify(savedAccount), before);
    assert.match(messages[0], /계정 일정 0개/);
    assert.match(messages[0], /일정·내 식품·즐겨찾기·목표가 모두 덮어써지며/);
    accept = true; h.click('select-local'); await tick(); assert.equal(selections, 1);
    h.controller.destroy();
  } finally { globalThis.confirm = previous; }
});

test('untrusted account names and errors remain text, never injected markup', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const h = harness({ user: { id: 'u1', username: payload }, active: true, error: payload });
  assert.equal(h.nodes.get('username').textContent, payload); assert.equal(h.nodes.get('error').textContent, payload);
  assert.doesNotMatch(h.container.innerHTML, /<img/); assert.equal(h.builds(), 1);
  h.controller.destroy();
});

test('destroy clears secret DOM values and code, removes listeners, and ignores later updates', async () => {
  const h = harness(); h.click('tab', 'register'); fill(h, 'register'); h.submit('register'); await tick();
  assert.equal(h.nodes.get('recovery-code').textContent, RECOVERY);
  h.controller.destroy();
  assert.equal(h.nodes.get('recovery-code').textContent, ''); assert.equal(h.listeners.size, 0);
  for (const field of h.fields.values()) assert.equal(field.value, '');
  assert.deepEqual(h.controller.draft(), { dirty: false, recoveryPending: false, pending: false });
  h.controller.update({ ...BASE, user: { id: 'another', username: 'other-user' }, active: true });
  assert.notEqual(h.nodes.get('username').textContent, 'other-user');
});
