'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../fitplan/core.js');

const empty = () => ({ events: [], settings: { ...C.defaults }, demo: false });
const legacy = (extra = {}) => ({ id: 'event1', date: '2026-11-23', start: '07:00', end: '08:00', type: 'strength', title: '운동', repeat: 'none', completed: false, detail: { exercise: '벤치프레스', sets: 3, weight: 60, reps: 10, notes: '기존 메모' }, ...extra });
const stateOf = (...events) => C.normalizeState({ ...empty(), events });
const weight = (extra = {}) => legacy({ type: 'weight', title: '체중', detail: { weight: 80, bodyfat: null }, ...extra });
function memory(initial) {
  const map = new Map(initial === undefined ? [] : [[C.STORE, initial]]);
  return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), map };
}

test('legacy workout becomes distinct sets with identical values and completion', () => {
  const s = stateOf(legacy({ completed: true }));
  const d = s.events[0].detail;
  assert.equal(s.schemaVersion, C.VERSION);
  assert.equal(d.exercises[0].sets.length, 3);
  assert.equal(new Set(d.exercises[0].sets.map(x => x.id)).size, 3);
  assert.ok(d.exercises[0].sets.every(x => x.done && x.weight === 60 && x.reps === 10));
  assert.equal(d.notes, '기존 메모');
  assert.equal(C.volume(d).volume, 1800);
});

test('legacy recurring doneDates become independent immutable snapshots; stale completed flag adds nothing', () => {
  const s = stateOf(legacy({ date: '2026-11-16', repeat: 'weekly', completed: true, doneDates: ['2026-11-16', '2026-11-23'] }));
  assert.equal(Object.keys(s.events[0].occurrences).length, 2);
  assert.ok(s.events[0].detail.exercises[0].sets.every(x => !x.done));
  const e = C.occurrence(s.events[0], '2026-11-23');
  e.detail.exercises[0].sets[0].weight = 65;
  const next = C.upsert(s, e, { scope: 'occurrence', occurrenceDate: e.date });
  assert.equal(C.occurrence(next.events[0], '2026-11-16').detail.exercises[0].sets[0].weight, 60);
  assert.equal(C.occurrence(next.events[0], '2026-11-23').detail.exercises[0].sets[0].weight, 65);
  assert.equal(C.occurrence(next.events[0], '2026-11-30').detail.exercises[0].sets[0].weight, 60);
  assert.equal(C.occurrence(s.events[0], '2026-11-23').detail.exercises[0].sets[0].weight, 60);
  assert.equal(Object.keys(stateOf(legacy({ repeat: 'daily', completed: true, doneDates: [] })).events[0].occurrences).length, 0);
});

test('completed volume excludes unfinished and warmup sets; partial records appear in history', () => {
  const s = stateOf(legacy());
  const sets = s.events[0].detail.exercises[0].sets;
  Object.assign(sets[0], { weight: 60, reps: 10, done: true });
  Object.assign(sets[1], { weight: 65, reps: 8, done: true });
  Object.assign(sets[2], { weight: 70, reps: 6, done: false });
  assert.deepEqual(C.volume(s.events[0].detail), { exerciseCount: 1, setCount: 3, completedSets: 2, volume: 1120 });
  assert.equal(C.history(s, 'strength', '2026-11-24').length, 1);
  sets[0].warmup = true;
  assert.equal(C.volume(s.events[0].detail).volume, 520);
  s.events[0].isSample = true;
  assert.equal(C.history(s, 'strength', '2026-11-24').length, 0);
});

test('weight history includes only completed real dates, sorted by date and time', () => {
  const s = stateOf(weight({ id: 'planned', completed: false }), weight({ id: 'am', completed: true, start: '06:00', end: '06:05', detail: { weight: 81 } }), weight({ id: 'pm', completed: true, start: '18:00', end: '18:05', detail: { weight: 80 } }), weight({ id: 'series', date: '2026-11-20', repeat: 'daily', doneDates: ['2026-11-21', '2026-11-22'] }));
  assert.deepEqual(C.weightRecords(s, '2026-11-23').map(x => [x.id, x.date]), [['series', '2026-11-21'], ['series', '2026-11-22'], ['am', '2026-11-23'], ['pm', '2026-11-23']]);
  assert.equal(C.occurrence(s.events.find(x => x.id === 'series'), '2026-11-24').detail.weight, null);
  assert.throws(() => C.toggleComplete(s, 'series', '2026-11-24'), /체중 측정값/);
});

test('sample weights stay available in the calendar but do not enter measured weight history', () => {
  const s = stateOf(weight({ id: 'sample-weight', completed: true, isSample: true }), weight({ id: 'my-weight', completed: true, detail: { weight: 79 } }));
  assert.equal(C.dayEvents(s, '2026-11-23').length, 2);
  assert.deepEqual(C.weightRecords(s, '2026-11-23').map(x => x.id), ['my-weight']);
  assert.equal(s.events.find(x => x.id === 'sample-weight').isSample, true);
});

test('end-date shortening retains logged snapshots; one-day removal excludes only that day', () => {
  let s = stateOf(legacy({ date: '2026-11-16', repeat: 'weekly', doneDates: ['2026-11-23', '2026-11-30'] }));
  const template = { ...s.events[0], repeatUntil: '2026-11-23' };
  s = C.upsert(s, template, { scope: 'series' });
  assert.equal(C.dayEvents(s, '2026-11-30').length, 1);
  assert.equal(C.dayEvents(s, '2026-12-07').length, 0);
  s = C.remove(s, 'event1', '2026-11-23', 'occurrence');
  assert.equal(C.dayEvents(s, '2026-11-23').length, 0);
  assert.equal(C.dayEvents(s, '2026-11-30').length, 1);
  assert.equal(C.remove(s, 'event1', '2026-11-30', 'series').events.length, 0);
});

test('editing a recurring sample into an actual record clears the sample flag for either scope', () => {
  const s = stateOf(legacy({ repeat: 'daily', isSample: true }));
  const effective = C.occurrence(s.events[0], '2026-11-24');
  effective.isSample = false;
  effective.completed = true;
  effective.detail.exercises[0].sets.forEach(set => { set.done = true; });
  const actual = C.upsert(s, effective, { scope: 'occurrence', occurrenceDate: '2026-11-24' });
  assert.equal(actual.events[0].isSample, false);
  assert.equal(actual.events.filter(event => !event.isSample).length, 1);
  assert.equal(C.history(actual, 'strength', '2026-11-25').length, 1);
  assert.equal(s.events[0].isSample, true);
  const series = C.upsert(s, { ...s.events[0], isSample: false, title: '나의 반복 운동' }, { scope: 'series' });
  assert.equal(series.events[0].isSample, false);
});

test('toggling a sample makes the user record survive clearing untouched samples', () => {
  for (const repeat of ['none', 'daily']) {
    const original = stateOf(legacy({ repeat, isSample: true }), legacy({ id: 'untouched', isSample: true }));
    const done = C.toggleComplete(original, 'event1', '2026-11-23');
    const kept = C.normalizeState({ ...done, events: done.events.filter(event => !event.isSample) });
    assert.equal(kept.events.length, 1);
    assert.equal(kept.events[0].id, 'event1');
    assert.equal(C.occurrence(kept.events[0], '2026-11-23').completed, true);
    assert.equal(C.history(kept, 'strength', '2026-11-24').length, 1);
    const undone = C.toggleComplete(kept, 'event1', '2026-11-23');
    assert.equal(undone.events[0].isSample, false);
    assert.equal(original.events[0].isSample, true);
    assert.equal(original.events[0].completed, false);
  }
});

test('malformed imports are rejected without mutating the supplied original', () => {
  const valid = stateOf(legacy());
  const before = JSON.stringify(valid);
  for (const change of [{ id: 'x" onclick="alert(1)' }, { date: '2026-99-99' }, { type: 'constructor' }, { start: undefined }, { end: '06:00' }, { title: null }, { detail: { exercise: '운동', sets: 1.5, weight: 10, reps: 10 } }]) {
    assert.throws(() => stateOf(legacy(change)));
  }
  assert.throws(() => C.normalizeState({ ...valid, version: 4 }));
  assert.throws(() => C.normalizeState({ ...valid, events: [...valid.events, valid.events[0]] }));
  const duplicatedSets = C.clone(valid);
  duplicatedSets.events[0].detail.exercises[0].sets[1].id = duplicatedSets.events[0].detail.exercises[0].sets[0].id;
  assert.throws(() => C.normalizeState(duplicatedSets), /중복된 세트/);
  assert.equal(JSON.stringify(valid), before);
});

test('transactional save backs up the prior raw state and rejects stale-tab writes', () => {
  const original = JSON.stringify({ ...empty(), events: [legacy()] });
  const storage = memory(original);
  const store = C.makeStore(storage);
  const loaded = store.load();
  const secondTabStore = C.makeStore(storage);
  const secondTabLoaded = secondTabStore.load();
  assert.equal(loaded.error, null);
  assert.equal(secondTabLoaded.data.revision, '');
  const next = C.upsert(loaded.data, legacy({ title: '새 이름' }));
  const saved = store.save(next, loaded.data.revision);
  assert.notEqual(saved.revision, '');
  assert.equal(storage.getItem(store.backupKey), original);
  assert.equal(store.load().data.events[0].title, '새 이름');
  assert.throws(() => secondTabStore.save(secondTabLoaded.data, secondTabLoaded.data.revision), { code: 'STORAGE_CONFLICT' });
  assert.equal(store.load().data.events[0].title, '새 이름');
});

test('backup failures abort saves and malformed raw records stay available for explicit CAS recovery', () => {
  const original = JSON.stringify(stateOf(legacy()));
  const storage = memory(original);
  const store = C.makeStore(storage);
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.save(stateOf(legacy({ title: 'would lose' })), ''), { code: 'STORAGE_ERROR' });
  assert.equal(storage.getItem(C.STORE), original);
  const corrupt = '{broken';
  const recoveryStorage = memory(corrupt);
  const recoveryStore = C.makeStore(recoveryStorage);
  const loaded = recoveryStore.load();
  assert.equal(loaded.data, null);
  assert.equal(loaded.raw, corrupt);
  assert.throws(() => recoveryStore.save(stateOf(), ''), { code: 'STORAGE_ERROR' });
  assert.throws(() => recoveryStore.save(stateOf(), '', { expectedRaw: 'different' }), { code: 'STORAGE_CONFLICT' });
  recoveryStore.save(stateOf(legacy()), '', { expectedRaw: corrupt });
  assert.equal(recoveryStorage.getItem(recoveryStore.backupKey), corrupt);
  assert.equal(recoveryStore.load().data.events.length, 1);
});

test('new completed recurring workout records only the first date and template stays pending', () => {
  const s = C.upsert(stateOf(), legacy({ repeat: 'daily', completed: true }));
  assert.equal(C.occurrence(s.events[0], '2026-11-23').completed, true);
  assert.equal(C.volume(C.occurrence(s.events[0], '2026-11-23').detail).volume, 1800);
  assert.equal(C.occurrence(s.events[0], '2026-11-24').completed, false);
  assert.equal(C.volume(C.occurrence(s.events[0], '2026-11-24').detail).volume, 0);
  const undone = C.toggleComplete(s, 'event1', '2026-11-23');
  assert.equal(C.volume(C.occurrence(undone.events[0], '2026-11-23').detail).volume, 0);
});

test('calendar validation and local date movement cover leap dates and year boundaries', () => {
  assert.equal(C.validDate('2024-02-29'), true);
  assert.equal(C.validDate('2026-02-29'), false);
  assert.equal(C.validTime('23:59'), true);
  assert.equal(C.validTime('24:00'), false);
  assert.equal(C.shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(C.shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(C.iso(C.dateOf('0099-12-31')), '0099-12-31');
});
