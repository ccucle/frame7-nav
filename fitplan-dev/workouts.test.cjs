'use strict';

// Dependency-free behavioral tests. The DOM adapter below models the editor's
// fields and event contract; browser layout and native input behavior are
// intentionally left to the application's browser checks.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../fitplan/workouts.js'), 'utf8');
const api = require('../fitplan/workouts.js');

const set = (overrides = {}) => ({ id: 's1', weight: 60, reps: 10, rpe: null, done: false, warmup: false, ...overrides });
const exercise = (overrides = {}) => ({ id: 'e1', name: '벤치프레스', sets: [set()], notes: '', ...overrides });
const workout = (overrides = {}) => ({ exercises: [exercise()], notes: '', ...overrides });
const copy = (value) => JSON.parse(JSON.stringify(value));
const decode = (s = '') => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (s, name) => decode((s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')) || [])[1] || '');
class ClassList {
  constructor() { this.items = new Set(); }
  toggle(name, enabled) { if (enabled) this.items.add(name); else this.items.delete(name); }
  contains(name) { return this.items.has(name); }
}
function field(value = '', options = {}) {
  return { value, checked: false, disabled: false, textContent: '', hidden: false, dataset: {}, classList: new ClassList(), attrs: {},
    focus() { this.focused = true; }, scrollIntoView() {},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, ...options };
}
function parseExercises(html) {
  return [...html.matchAll(/<section class="fw-exercise"\s+([^>]*)>([\s\S]*?)<\/section>/g)].map((match) => {
    const ex = { dataset: { fwExercise: attribute(match[1], 'data-fw-exercise') }, fields: {}, rows: [], classList: new ClassList() };
    const markup = match[2];
    const nameTag = markup.match(/<input\b[^>]*data-fw-field="name"[^>]*>/)[0];
    ex.fields.name = field(attribute(nameTag, 'value'));
    ex.fields['exercise-notes'] = field(decode(markup.match(/<textarea\b[^>]*data-fw-field="exercise-notes"[^>]*>([\s\S]*?)<\/textarea>/)[1]));
    const starts = [...markup.matchAll(/<div class="fw-set-row[^>]*data-fw-set="([^"]*)"[^>]*>/g)];
    ex.rows = starts.map((start, i) => {
      const rowMarkup = markup.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : markup.indexOf('<div class="fw-exercise-foot">'));
      const row = { dataset: { fwSet: decode(start[1]) }, fields: {}, classList: new ClassList() };
      for (const key of ['weight', 'reps', 'rpe', 'done']) {
        const tag = rowMarkup.match(new RegExp('<input\\b[^>]*data-fw-field="' + key + '"[^>]*>'))[0];
        let value = attribute(tag, 'value');
        if (key !== 'done' && value && !Number.isFinite(Number(value))) value = '';
        row.fields[key] = field(value, { checked: /\schecked(?:\s|>)/.test(tag), disabled: /\sdisabled(?:\s|>)/.test(tag) });
      }
      row.fields.warmup = field(/<option value="warmup" selected>/.test(rowMarkup) ? 'warmup' : 'work');
      for (const [key, input] of Object.entries(row.fields)) {
        input.dataset.fwField = key;
        input.matches = (sel) => sel === '[data-fw-field]';
        input.closest = (sel) => sel === '[data-fw-set]' ? row : sel === '[data-fw-exercise]' ? ex : null;
      }
      row.querySelector = (sel) => row.fields[(sel.match(/data-fw-field="([^"]+)"/) || [])[1]] || null;
      return row;
    });
    const historyText = field();
    const history = field('', { querySelector: (sel) => sel === 'p' ? historyText : null });
    ex.querySelector = (sel) => sel === '[data-fw-history]' ? history : ex.fields[(sel.match(/data-fw-field="([^"]+)"/) || [])[1]] || null;
    ex.querySelectorAll = (sel) => sel === '[data-fw-set]' ? ex.rows : [];
    for (const [key, input] of Object.entries(ex.fields)) {
      input.dataset.fwField = key;
      input.matches = (sel) => sel === '[data-fw-field]';
      input.closest = (sel) => sel === '[data-fw-exercise]' ? ex : null;
    }
    return ex;
  });
}
function harness(detail = workout(), options = {}) {
  let now = 100000, interval, clearCount = 0, intervalCount = 0;
  const listeners = new Map(), docListeners = new Map();
  const nodes = {
    '[data-fw-clock]': field(), '[data-fw-action="timer-toggle"]': field(),
    '[data-fw-timer-status]': field(), '.fw-timer': field(),
    '[data-fw-error]': field(), '[data-fw-summary]': field(),
    '[data-fw-action="add-exercise"]': field(), '[data-fw-field="notes"]': field()
  };
  const presets = [60, 90, 120].map((seconds) => field('', { dataset: { fwAction: 'timer-preset', seconds: String(seconds) } }));
  let fullHtml = '';
  const container = {
    exercises: [], ownerDocument: { addEventListener: (type, fn) => docListeners.set(type, fn), removeEventListener: (type) => docListeners.delete(type) },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type),
    contains: () => true,
    querySelector(sel) { return nodes[sel] || null; },
    querySelectorAll(sel) {
      if (sel === '[data-fw-exercise]') return this.exercises;
      if (sel === '[data-fw-action="timer-preset"]') return presets;
      if (sel === '[data-fw-field="done"]') return this.exercises.flatMap((ex) => ex.rows.map((row) => row.fields.done));
      return [];
    },
    get innerHTML() { return fullHtml; },
    set innerHTML(html) {
      fullHtml = html;
      this.exercises = parseExercises(html);
      nodes['[data-fw-field="notes"]'].value = decode((html.match(/<textarea\b[^>]*data-fw-field="notes"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '');
    }
  };
  nodes['.fw-exercises'] = { set innerHTML(html) { container.exercises = parseExercises(html); } };
  class FakeDate extends Date { static now() { return now; } }
  let idSequence = 0;
  const window = {
    crypto: { randomUUID: () => 'uuid-' + ++idSequence },
    setInterval(fn) { interval = fn; intervalCount++; return 42; },
    clearInterval(id) { assert.equal(id, 42); clearCount++; }
  };
  const context = vm.createContext({ window, Date: FakeDate });
  vm.runInContext(source, context);
  const editor = window.FormdayWorkouts.mount(container, detail, options);
  return { editor, container, nodes, listeners, docListeners, presets,
    advance(ms) { now += ms; if (interval) interval(); },
    elapseWithoutTick(ms) { now += ms; },
    get clearCount() { return clearCount; },
    get intervalCount() { return intervalCount; },
    click(action, exIndex, rowIndex, seconds) {
      const ex = container.exercises[exIndex], row = ex && ex.rows[rowIndex];
      const button = { dataset: { fwAction: action, seconds: String(seconds) }, disabled: false,
        closest: (sel) => sel === '[data-fw-exercise]' ? ex : sel === '[data-fw-set]' ? row : null };
      listeners.get('click')({ target: { closest: () => button } });
    },
    input(node, type = 'input') { listeners.get(type)({ type, target: node }); }
  };
}

test('legacy records migrate all sets and completion without changing the source', () => {
  const original = { exercise: '스쿼트', sets: 4, weight: 60, reps: 10, notes: '지난 기록' };
  const saved = copy(original), actual = api.normalize(original, true);
  assert.deepEqual(original, saved);
  assert.equal(actual.exercises[0].name, '스쿼트');
  assert.equal(actual.notes, '지난 기록');
  assert.equal(new Set(actual.exercises[0].sets.map((s) => s.id)).size, 4);
  assert.deepEqual(api.summary(actual), { exerciseCount: 1, setCount: 4, completedSets: 4, volume: 2400 });
  assert.equal(api.summary(api.normalize(original, false)).volume, 0);
});

test('normalization preserves independent per-exercise and per-set values and repairs duplicate IDs', () => {
  const original = workout({ exercises: [exercise({ notes: '의자 3단', sets: [set({ weight: 20.5, reps: 12, rpe: 8.5, done: true }), set({ weight: 25, reps: 8, warmup: true })] }), exercise({ name: '랫풀다운', notes: '가슴 고정', sets: [set({ weight: 47.5, reps: 7 })] })], notes: '전체 메모' });
  const saved = copy(original), result = api.normalize(original);
  assert.deepEqual(original, saved);
  assert.equal(result.exercises[1].sets[0].weight, 47.5);
  assert.equal(result.exercises[0].sets[0].rpe, 8.5);
  assert.equal(result.exercises[0].sets[1].warmup, true);
  assert.equal(result.exercises[1].notes, '가슴 고정');
  assert.equal(result.notes, '전체 메모');
  assert.equal(new Set(result.exercises.map((ex) => ex.id)).size, 2);
  assert.equal(new Set(result.exercises.flatMap((ex) => ex.sets.map((s) => s.id))).size, 3);
});

test('volume includes only completed work sets; warmups remain in completion count', () => {
  const detail = workout({ exercises: [exercise({ sets: [set({ done: true }), set({ id: 's2', weight: 65, reps: 8, done: true }), set({ id: 's3', weight: 70, reps: 6 }), set({ id: 's4', weight: 20, reps: 10, done: true, warmup: true })] }), exercise({ id: 'e2', name: '푸시업', sets: [set({ id: 's5', weight: 0, reps: 20, done: true })] })] });
  assert.deepEqual(api.summary(detail), { exerciseCount: 2, setCount: 5, completedSets: 4, volume: 1120 });
  assert.match(api.describe(detail), /벤치프레스 외 1종목 · 4\/5세트 완료 · 1,120kg/);
  assert.equal(api.summary(workout({ exercises: [exercise({ sets: [set({ weight: 1.25, reps: 3, done: true })] })] })).volume, 3.75);
});

test('numeric validation rejects invalid, missing, nonfinite and out-of-range values', () => {
  for (const weight of [-1, 2001, Infinity, -Infinity, NaN, '60', '', null]) assert.throws(() => api.validate(workout({ exercises: [exercise({ sets: [set({ weight })] })] })), /중량/);
  for (const reps of [0, -1, 1001, 2.5, Infinity, NaN, '10', '', null]) assert.throws(() => api.validate(workout({ exercises: [exercise({ sets: [set({ reps })] })] })), /횟수/);
  for (const rpe of [0, 10.1, Infinity, NaN, '8', '']) assert.throws(() => api.validate(workout({ exercises: [exercise({ sets: [set({ rpe })] })] })), /RPE/);
  for (const done of [1, 0, 'false', null]) assert.throws(() => api.validate(workout({ exercises: [exercise({ sets: [set({ done })] })] })), /완료 상태/);
  assert.doesNotThrow(() => api.validate(workout({ exercises: [exercise({ sets: [set({ weight: 0, reps: 1, rpe: null }), set({ weight: 2000, reps: 1000, rpe: 10 })] })] })));
  assert.throws(() => api.validate(api.normalize(workout({ exercises: [exercise({ sets: [set({ weight: null })] })] }))), /중량/);
  assert.throws(() => api.validate(api.normalize(workout({ exercises: [exercise({ sets: [set({ reps: '' })] })] }))), /횟수/);
});

test('legacy invalid counts fail, oversized records and explicit empties are never silently truncated or filled', () => {
  for (const sets of [0, -1, 2.5, Infinity, '', null, 'bad', 1001]) assert.throws(() => api.normalize({ sets }), /세트 수/);
  const large = api.normalize({ exercise: '스쿼트', sets: 60, weight: 20, reps: 8 });
  assert.equal(large.exercises[0].sets.length, 60);
  assert.throws(() => api.validate(large), /1~50개/);
  const h = harness(large);
  assert.equal(h.container.exercises[0].rows.length, 60);
  assert.throws(() => h.editor.read(), /1~50개/);
  h.editor.destroy();
  assert.deepEqual(api.normalize({ exercises: [] }).exercises, []);
  const empty = harness({ exercises: [] });
  assert.equal(empty.container.exercises.length, 0);
  assert.throws(() => empty.editor.read(), /1~30개/);
  empty.editor.destroy();
  const tooMany = harness(workout({ exercises: Array.from({ length: 31 }, (_, i) => exercise({ id: 'e' + i })) }));
  assert.equal(tooMany.container.exercises.length, 31);
  assert.throws(() => tooMany.editor.read(), /1~30개/);
  tooMany.editor.destroy();
});

test('text lengths and required names are validated', () => {
  for (const name of ['', '  ', 'a'.repeat(81)]) assert.throws(() => api.validate(workout({ exercises: [exercise({ name })] })), /이름/);
  assert.throws(() => api.validate(workout({ notes: 'n'.repeat(4001) })), /4,000자/);
  assert.throws(() => api.validate(workout({ exercises: [exercise({ notes: 'n'.repeat(2001) })] })), /2,000자/);
  assert.throws(() => api.validate(workout({ exercises: [exercise({ sets: [] })] })), /1~50개/);
});

test('render escapes names, IDs, notes and history text', () => {
  const attack = '\"><img src=x onerror=alert(1)>&\' </textarea><script>alert(1)</script>';
  const html = api.render(workout({ exercises: [exercise({ id: attack, name: attack, notes: attack, sets: [set({ id: attack })] })], notes: attack }), { history: [{ date: attack, event: { detail: workout({ exercises: [exercise({ name: attack, sets: [set({ done: true })] })] }) } }] });
  assert.doesNotMatch(html, /<script>|<img\s|<\/textarea><script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&quot;&gt;/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
});

test('previous record chooses latest completed non-sample work sets', () => {
  const history = [
    { date: '2026-11-19', event: { detail: workout({ exercises: [exercise({ sets: [set({ weight: 40, reps: 12, done: true })] })] }) } },
    { date: '2026-11-23', event: { isSample: true, detail: workout({ exercises: [exercise({ sets: [set({ weight: 999, reps: 1, done: true })] })] }) } },
    { date: '2026-11-22', event: { detail: workout({ exercises: [exercise({ sets: [set({ weight: 80, done: false }), set({ weight: 10, done: true, warmup: true })] })] }) } },
    { date: '2026-11-21', event: { detail: workout({ exercises: [exercise({ sets: [set({ weight: 65, reps: 8, done: true }), set({ id: 's2', weight: 65, reps: 8, done: true })] })] }) } }
  ];
  const before = copy(history), html = api.render(workout(), { history });
  assert.match(html, /2026-11-21 · 65kg × 8회 × 2세트/);
  assert.doesNotMatch(html, /999kg|2026-11-19 · 40kg|2026-11-22 ·/);
  assert.deepEqual(history, before);
});

test('adding and duplicating sets preserve unsaved fields from every exercise', () => {
  const h = harness(workout({ exercises: [exercise(), exercise({ id: 'e2', name: '랫풀다운', sets: [set({ id: 's2', weight: 45, reps: 12 })] })] }));
  h.container.exercises[0].rows[0].fields.weight.value = '62.5';
  h.container.exercises[0].rows[0].fields.reps.value = '8';
  h.container.exercises[0].rows[0].fields.rpe.value = '8.5';
  h.container.exercises[0].rows[0].fields.done.checked = true;
  h.container.exercises[0].fields['exercise-notes'].value = '벤치 메모';
  h.container.exercises[1].rows[0].fields.weight.value = '47.5';
  h.container.exercises[1].rows[0].fields.reps.value = '9';
  h.container.exercises[1].fields['exercise-notes'].value = '풀다운 메모';
  h.nodes['[data-fw-field="notes"]'].value = '전체 컨디션';
  h.click('duplicate-set', 0, 0);
  let result = h.editor.read();
  assert.equal(result.exercises[0].sets.length, 2);
  assert.equal(result.exercises[0].sets[0].rpe, 8.5);
  assert.equal(result.exercises[0].sets[0].done, true);
  assert.equal(result.exercises[0].sets[1].weight, 62.5);
  assert.equal(result.exercises[0].sets[1].reps, 8);
  assert.equal(result.exercises[0].sets[1].rpe, null);
  assert.equal(result.exercises[0].sets[1].done, false);
  assert.notEqual(result.exercises[0].sets[0].id, result.exercises[0].sets[1].id);
  assert.equal(result.exercises[1].sets[0].weight, 47.5);
  assert.equal(result.exercises[1].sets[0].reps, 9);
  assert.equal(result.exercises[1].notes, '풀다운 메모');
  assert.equal(result.notes, '전체 컨디션');
  h.click('add-set', 1);
  result = h.editor.read();
  assert.equal(result.exercises[1].sets[1].weight, 47.5);
  assert.equal(result.exercises[0].sets[0].weight, 62.5);
  h.click('remove-set', 0, 1);
  result = h.editor.read();
  assert.equal(result.exercises[0].sets.length, 1);
  assert.equal(result.exercises[1].sets.length, 2);
  h.click('add-exercise');
  assert.equal(h.container.exercises.length, 3);
  h.container.exercises[2].fields.name.value = '사이드 레터럴 레이즈';
  result = h.editor.read();
  assert.equal(result.exercises[2].sets.length, 3);
  assert.equal(result.exercises[1].sets[0].weight, 47.5);
  h.click('remove-exercise', 2);
  assert.equal(h.editor.read().exercises.length, 2);
  h.editor.destroy();
});

test('read rejects blank/invalid values, focuses the field and preserves the draft', () => {
  const h = harness();
  const row = h.container.exercises[0].rows[0];
  row.fields.weight.value = '';
  assert.throws(() => h.editor.read(), /중량/);
  assert.equal(row.fields.weight.focused, true);
  assert.equal(row.fields.weight.attrs['aria-invalid'], 'true');
  assert.equal(h.nodes['[data-fw-error]'].hidden, false);
  row.fields.weight.value = '62.5';
  h.input(row.fields.weight);
  assert.equal(h.nodes['[data-fw-error]'].hidden, true);
  row.fields.reps.value = '8.5';
  assert.throws(() => h.editor.read(), /횟수/);
  row.fields.reps.value = '8'; row.fields.rpe.value = '11';
  assert.throws(() => h.editor.read(), /RPE/);
  row.fields.rpe.value = '';
  assert.equal(h.editor.read().exercises[0].sets[0].weight, 62.5);
  h.editor.destroy();
});

test('markAllDone updates every exercise and keeps independent values', () => {
  const h = harness(workout({ exercises: [exercise(), exercise({ id: 'e2', name: '스쿼트', sets: [set({ id: 's2', weight: 80, reps: 8, warmup: true }), set({ id: 's3', weight: 90, reps: 5 })] })] }));
  h.editor.markAllDone(true);
  assert.equal(h.editor.read().exercises.flatMap((ex) => ex.sets).filter((s) => s.done).length, 3);
  assert.equal(api.summary(h.editor.read()).volume, 1050);
  h.editor.markAllDone(false);
  assert.equal(api.summary(h.editor.read()).completedSets, 0);
  assert.equal(h.editor.read().exercises[1].sets[1].weight, 90);
  h.editor.destroy();
});

test('timer handles pause, resume, wall-clock jumps, presets and cleanup without losing input', () => {
  const h = harness();
  const clock = h.nodes['[data-fw-clock]'];
  assert.equal(clock.textContent, '01:30');
  h.container.exercises[0].rows[0].fields.weight.value = '67.5';
  h.click('timer-preset', undefined, undefined, 60);
  assert.equal(clock.textContent, '01:00');
  h.click('timer-toggle'); h.advance(10200);
  assert.equal(clock.textContent, '00:50');
  h.click('timer-toggle'); h.advance(300000);
  assert.equal(clock.textContent, '00:50');
  assert.equal(h.nodes['[data-fw-action="timer-toggle"]'].textContent, '계속');
  h.click('timer-toggle'); h.advance(50000);
  assert.equal(clock.textContent, '00:00');
  assert.equal(h.nodes['[data-fw-timer-status]'].textContent, '휴식 시간이 끝났습니다.');
  assert.equal(h.nodes['.fw-timer'].classList.contains('is-finished'), true);
  h.click('timer-toggle');
  assert.equal(clock.textContent, '01:00');
  h.click('timer-preset', undefined, undefined, 120);
  assert.equal(clock.textContent, '02:00');
  assert.equal(h.presets[2].attrs['aria-pressed'], 'true');
  h.click('timer-toggle'); h.advance(2000); h.click('timer-reset');
  assert.equal(clock.textContent, '02:00');
  assert.equal(h.editor.read().exercises[0].sets[0].weight, 67.5);
  assert.equal(h.listeners.size, 3); assert.equal(h.docListeners.size, 1);
  h.editor.destroy(); h.editor.destroy();
  assert.equal(h.clearCount, 1); assert.equal(h.listeners.size, 0); assert.equal(h.docListeners.size, 0);
  h.advance(500000); assert.equal(clock.textContent, '02:00');
  assert.throws(() => h.editor.read(), /창이 닫혔습니다/);
});

test('exercise suggestions are nonempty, unique and cover the major groups', () => {
  assert.ok(api.catalog.length >= 40);
  assert.equal(new Set(api.catalog.map((entry) => entry.name)).size, api.catalog.length);
  for (const group of ['가슴', '등', '어깨', '하체', '팔', '코어']) assert.ok(api.catalog.some((entry) => entry.group === group));
});

test('series plan editor disables completion and timer while preserving planned values after edits', () => {
  const detail = workout({ exercises: [exercise({ sets: [set({ done: true }), set({ id: 's2', weight: 20, reps: 10, done: true, warmup: true })] })] });
  const before = copy(detail), h = harness(detail, { planOnly: true });
  assert.deepEqual(detail, before);
  assert.equal(h.intervalCount, 0);
  assert.match(h.container.innerHTML, /기본 운동 계획/);
  assert.match(h.container.innerHTML, /계획 운동량<\/span><strong>600/);
  assert.match(h.container.innerHTML, /class="fw-timer" hidden/);
  assert.doesNotMatch(h.container.innerHTML, /완료 운동량/);
  assert.ok(h.container.exercises[0].rows.every((row) => row.fields.done.disabled && !row.fields.done.checked));
  h.editor.markAllDone(true);
  assert.ok(h.editor.read().exercises[0].sets.every((s) => !s.done));
  h.container.exercises[0].rows[0].fields.done.checked = true;
  assert.equal(h.editor.read().exercises[0].sets[0].done, false);
  h.click('duplicate-set', 0, 0);
  h.click('add-set', 0);
  assert.ok(h.container.exercises[0].rows.every((row) => row.fields.done.disabled));
  const result = h.editor.read();
  assert.equal(result.exercises[0].sets[0].weight, 60);
  assert.equal(result.exercises[0].sets[0].reps, 10);
  assert.equal(result.exercises[0].sets.length, 4);
  assert.ok(result.exercises[0].sets.every((s) => !s.done));
  h.editor.destroy(); assert.equal(h.clearCount, 0);
});

test('pausing at the deadline before the next timer tick records completion', () => {
  const h = harness();
  h.click('timer-preset', undefined, undefined, 60);
  h.click('timer-toggle');
  h.elapseWithoutTick(60001);
  h.click('timer-toggle');
  assert.equal(h.nodes['[data-fw-clock]'].textContent, '00:00');
  assert.equal(h.nodes['[data-fw-action="timer-toggle"]'].textContent, '다시 시작');
  assert.equal(h.nodes['[data-fw-timer-status]'].textContent, '휴식 시간이 끝났습니다.');
  assert.equal(h.nodes['.fw-timer'].classList.contains('is-finished'), true);
  h.editor.destroy();
});
