/* FORMDAY v3: food snapshots, validated records and transactional local storage. */
(function (root, factory) {
  'use strict';
  const nutrition = typeof module === 'object' && module.exports ? require('./nutrition.js') : root.FormdayNutrition;
  const api = factory(nutrition);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormdayCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (N) {
  'use strict';

  if (!N || typeof N.normalizeMeal !== 'function') throw new Error('식품 계산 모듈을 불러오지 못했습니다.');
  const VERSION = 3;
  const STORE = 'formday_calendar_proto_v1';
  const defaults = Object.freeze({ protein: 150, carbs: 200, fat: 50 });
  const TYPES = ['strength', 'cardio', 'meal', 'weight'];
  const REPEATS = ['none', 'daily', 'weekly'];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { const error = new Error(message); error.code = 'INVALID_DATA'; throw error; };
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);

  function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function dateOf(value) {
    if (!validDate(value)) fail('올바른 날짜를 입력해 주세요.');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    return date;
  }

  function iso(date) {
    if (!date || typeof date.getTime !== 'function' || !Number.isFinite(date.getTime())) fail('올바른 날짜가 아닙니다.');
    return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function shiftDate(value, days) {
    if (!Number.isInteger(days)) fail('날짜 이동 값이 올바르지 않습니다.');
    const date = dateOf(value);
    date.setDate(date.getDate() + days);
    const result = iso(date);
    if (!validDate(result)) fail('날짜 범위를 벗어났습니다.');
    return result;
  }

  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

  function textValue(value, label, max, optional) {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail(label + '을(를) 확인해 주세요.');
    return value;
  }

  function numberValue(value, label, min, max, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(label + '을(를) 확인해 주세요.');
    return value;
  }

  function booleanValue(value, label, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail(label + ' 값이 올바르지 않습니다.');
    return value;
  }

  function recordId(value, label, allowMissing) {
    if (value === undefined && allowMissing) return uid();
    if (!idOK(value)) fail(label + ' 식별자가 올바르지 않습니다.');
    return value;
  }

  function times(raw) {
    if (!validTime(raw.start) || !validTime(raw.end) || raw.end <= raw.start) fail('종료 시간은 시작 시간보다 늦어야 합니다.');
    return { start: raw.start, end: raw.end };
  }

  function normalizeStrength(detail, legacyCompleted) {
    if (!plain(detail)) fail('웨이트 상세 기록이 올바르지 않습니다.');
    let exercises;
    if (own(detail, 'exercises')) {
      if (!Array.isArray(detail.exercises) || detail.exercises.length < 1 || detail.exercises.length > 30) fail('운동 종목은 1~30개로 입력해 주세요.');
      const exerciseIds = new Set();
      const setIds = new Set();
      exercises = detail.exercises.map(exercise => {
        if (!plain(exercise)) fail('운동 종목 기록이 올바르지 않습니다.');
        const id = recordId(exercise.id, '운동', true);
        if (exerciseIds.has(id)) fail('중복된 운동 식별자가 있습니다.');
        exerciseIds.add(id);
        if (!Array.isArray(exercise.sets) || exercise.sets.length < 1 || exercise.sets.length > 50) fail('종목별 세트는 1~50개로 입력해 주세요.');
        const sets = exercise.sets.map(set => {
          if (!plain(set)) fail('세트 기록이 올바르지 않습니다.');
          const setId = recordId(set.id, '세트', true);
          if (setIds.has(setId)) fail('중복된 세트 식별자가 있습니다.');
          setIds.add(setId);
          return {
            id: setId,
            weight: numberValue(set.weight, '중량', 0, 2000, false),
            reps: numberValue(set.reps, '횟수', 1, 1000, true),
            rpe: set.rpe === null || set.rpe === undefined ? null : numberValue(set.rpe, 'RPE', 1, 10, false),
            done: booleanValue(set.done, '세트 완료', false),
            warmup: booleanValue(set.warmup, '준비 세트', false)
          };
        });
        return { id, name: textValue(exercise.name, '운동 이름', 80, false), sets, notes: textValue(exercise.notes, '종목 메모', 2000, true) };
      });
    } else {
      const name = textValue(detail.exercise, '운동 이름', 80, false);
      const count = numberValue(detail.sets, '세트 수', 1, 50, true);
      const weight = numberValue(detail.weight, '중량', 0, 2000, false);
      const reps = numberValue(detail.reps, '횟수', 1, 1000, true);
      exercises = [{ id: uid(), name, sets: Array.from({ length: count }, () => ({ id: uid(), weight, reps, rpe: null, done: !!legacyCompleted, warmup: false })), notes: '' }];
    }
    return { exercises, notes: textValue(detail.notes, '운동 메모', 4000, true) };
  }

  function normalizeDetail(type, detail, completed) {
    if (!plain(detail)) fail('일정 상세 기록이 올바르지 않습니다.');
    if (type === 'strength') return normalizeStrength(detail, completed);
    if (type === 'cardio') {
      const intensity = detail.intensity === undefined ? '보통' : detail.intensity;
      if (!['가벼움', '보통', '높음'].includes(intensity)) fail('유산소 강도가 올바르지 않습니다.');
      return { cardio: textValue(detail.cardio, '유산소 종목', 80, false), minutes: numberValue(detail.minutes, '운동 시간', 0, 1440, false), distance: numberValue(detail.distance, '거리', 0, 10000, false), intensity };
    }
    if (type === 'meal') return N.normalizeMeal(detail);
    if (type === 'weight') {
      let weight = detail.weight;
      if (weight === undefined || weight === null) {
        if (completed) fail('체중 측정값을 입력해 주세요.');
        weight = null;
      } else {
        numberValue(weight, '체중', 0, 500, false);
        if (weight <= 0) fail('체중은 0kg보다 커야 합니다.');
      }
      const bodyfat = detail.bodyfat === undefined || detail.bodyfat === null ? null : numberValue(detail.bodyfat, '체지방률', 0, 100, false);
      return { weight, bodyfat };
    }
    fail('알 수 없는 일정 종류입니다.');
  }

  function markStrength(detail, done) {
    const result = clone(detail);
    result.exercises.forEach(exercise => exercise.sets.forEach(set => { set.done = done; }));
    return result;
  }

  function baseRule(event, day, enforceEnd) {
    if (!validDate(day) || day < event.date) return false;
    if (enforceEnd && event.repeatUntil && day > event.repeatUntil) return false;
    if (event.repeat === 'daily') return true;
    if (event.repeat === 'weekly') return dateOf(day).getDay() === dateOf(event.date).getDay();
    return day === event.date;
  }

  function normalizeSnapshot(raw, event, day) {
    if (!plain(raw) || (raw.date !== undefined && raw.date !== day)) fail('날짜별 기록의 날짜가 올바르지 않습니다.');
    if (!baseRule(event, day, false)) fail('반복 일정 범위를 벗어난 날짜별 기록입니다.');
    if (raw.type !== event.type) fail('날짜별 기록의 종류가 반복 일정과 다릅니다.');
    const completed = booleanValue(raw.completed, '완료', false);
    return { date: day, ...times(raw), type: event.type, title: textValue(raw.title, '일정 제목', 300, false), detail: normalizeDetail(event.type, raw.detail, completed), completed };
  }

  function normalizeEvent(raw, counts) {
    if (!plain(raw)) fail('일정 데이터가 올바르지 않습니다.');
    const id = recordId(raw.id, '일정', false);
    if (!validDate(raw.date)) fail('일정 날짜가 올바르지 않습니다.');
    if (!TYPES.includes(raw.type) || !REPEATS.includes(raw.repeat)) fail('일정 종류 또는 반복 설정이 올바르지 않습니다.');
    const completed = booleanValue(raw.completed, '완료', false);
    const event = { id, date: raw.date, ...times(raw), type: raw.type, title: textValue(raw.title, '일정 제목', 300, false), repeat: raw.repeat, repeatUntil: null, completed, detail: normalizeDetail(raw.type, raw.detail, completed), occurrences: {}, excludedDates: [], isSample: booleanValue(raw.isSample, '샘플', false) };
    if (raw.repeatUntil !== undefined && raw.repeatUntil !== null && raw.repeatUntil !== '') {
      if (!validDate(raw.repeatUntil) || raw.repeatUntil < event.date) fail('반복 종료일은 시작일 이후여야 합니다.');
      event.repeatUntil = raw.repeatUntil;
    }
    if (event.repeat === 'none') {
      if (raw.occurrences !== undefined && (!plain(raw.occurrences) || Object.keys(raw.occurrences).length)) fail('일반 일정에는 반복 기록을 넣을 수 없습니다.');
      if (raw.excludedDates !== undefined && (!Array.isArray(raw.excludedDates) || raw.excludedDates.length)) fail('일반 일정에는 제외 날짜를 넣을 수 없습니다.');
      event.repeatUntil = null;
      return event;
    }
    if (raw.occurrences !== undefined) {
      if (!plain(raw.occurrences)) fail('날짜별 기록 형식이 올바르지 않습니다.');
      for (const [day, snapshot] of Object.entries(raw.occurrences)) {
        if (++counts.occurrences > 20000) fail('날짜별 기록은 최대 20,000개까지 지원합니다.');
        event.occurrences[day] = normalizeSnapshot(snapshot, event, day);
      }
    }
    if (raw.doneDates !== undefined) {
      if (!Array.isArray(raw.doneDates) || raw.doneDates.length > 20000) fail('기존 완료 날짜 형식이 올바르지 않습니다.');
      for (const day of new Set(raw.doneDates)) {
        if (!baseRule(event, day, false)) fail('기존 완료 날짜가 반복 일정에 맞지 않습니다.');
        if (own(event.occurrences, day)) continue;
        if (++counts.occurrences > 20000) fail('날짜별 기록은 최대 20,000개까지 지원합니다.');
        let detail = normalizeDetail(event.type, raw.detail, true);
        if (event.type === 'strength') detail = markStrength(detail, true);
        event.occurrences[day] = { date: day, start: event.start, end: event.end, type: event.type, title: event.title, detail, completed: true };
      }
    }
    if (raw.excludedDates !== undefined) {
      if (!Array.isArray(raw.excludedDates) || raw.excludedDates.length > 20000) fail('제외 날짜 형식이 올바르지 않습니다.');
      for (const day of new Set(raw.excludedDates)) {
        if (!baseRule(event, day, false)) fail('제외 날짜가 반복 일정에 맞지 않습니다.');
        if (own(event.occurrences, day)) fail('같은 날짜에 기록과 제외 설정이 함께 있습니다.');
        event.excludedDates.push(day);
      }
      event.excludedDates.sort();
    }
    event.completed = false;
    if (event.type === 'strength') event.detail = markStrength(event.detail, false);
    if (event.type === 'weight') event.detail = { weight: null, bodyfat: null };
    return event;
  }

  function normalizeState(raw) {
    if (!plain(raw)) fail('FORMDAY 기록 파일이 아닙니다.');
    // v0.6.0's sync dialog exported a wrapper that the normal importer did not read.
    // Unwrap only the calendar slot, then apply every existing schema check.
    if (raw.app === 'FORMDAY-cloud-manual-backup') {
      if (raw.kind !== 'calendar' || !plain(raw.data)) fail('캘린더 백업 파일이 아닙니다.');
      raw = raw.data;
    }
    if (raw.app !== undefined && raw.app !== 'formday') fail('FORMDAY 기록 파일이 아닙니다.');
    if (raw.version !== undefined && ![1, 2, 3].includes(raw.version)) fail('지원하지 않는 백업 버전입니다.');
    if (raw.schemaVersion !== undefined && ![1, 2, 3].includes(raw.schemaVersion)) fail('지원하지 않는 기록 버전입니다.');
    if (!Array.isArray(raw.events) || raw.events.length > 5000) fail('일정은 최대 5,000개까지 지원합니다.');
    if (!plain(raw.settings)) fail('영양 목표 형식이 올바르지 않습니다.');
    const settings = {};
    for (const name of Object.keys(defaults)) settings[name] = own(raw.settings, name) ? numberValue(raw.settings[name], '영양 목표', 0, 1000, false) : defaults[name];
    settings.targetWeight = raw.settings.targetWeight == null ? null : numberValue(raw.settings.targetWeight, '목표 체중', 0.1, 500, false);
    if (settings.protein * 4 + settings.carbs * 4 + settings.fat * 9 <= 0) fail('영양 목표를 입력해 주세요.');
    const revision = raw.revision === undefined ? '' : raw.revision;
    if (typeof revision !== 'string' || (revision !== '' && !idOK(revision))) fail('기록 버전 식별자가 올바르지 않습니다.');
    const counts = { occurrences: 0 };
    const ids = new Set();
    const events = raw.events.map(item => {
      const event = normalizeEvent(item, counts);
      if (ids.has(event.id)) fail('중복된 일정 식별자가 있습니다.');
      ids.add(event.id);
      return event;
    });
    const collections = N.normalizeCollections(raw);
    return { schemaVersion: VERSION, revision, events, settings, demo: booleanValue(raw.demo, '샘플 모드', false), ...collections };
  }

  function occurs(event, day) {
    if (!validDate(day)) return false;
    if (event.occurrences && own(event.occurrences, day)) return true;
    if ((event.excludedDates || []).includes(day)) return false;
    return baseRule(event, day, true);
  }

  function occurrence(event, day) {
    if (!occurs(event, day)) return null;
    const snapshot = event.repeat !== 'none' && event.occurrences && own(event.occurrences, day) ? event.occurrences[day] : null;
    const source = snapshot || event;
    let detail = clone(source.detail);
    let completed = !!source.completed;
    if (event.repeat !== 'none' && !snapshot) {
      completed = false;
      if (event.type === 'strength') detail = markStrength(detail, false);
      if (event.type === 'weight') detail = { weight: null, bodyfat: null };
    }
    return { id: event.id, date: day, start: source.start, end: source.end, type: source.type, title: source.title, repeat: event.repeat, repeatUntil: event.repeatUntil || null, detail, completed, isSample: !!event.isSample, seriesDate: event.date };
  }

  function dayEvents(state, day) {
    if (!validDate(day)) fail('조회 날짜가 올바르지 않습니다.');
    return state.events.map(event => occurrence(event, day)).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }

  function actualRecords(state) {
    const records = [];
    for (const event of state.events) {
      if (event.repeat === 'none') records.push(occurrence(event, event.date));
      else for (const day of Object.keys(event.occurrences || {})) records.push(occurrence(event, day));
    }
    return records.filter(Boolean);
  }

  function weightRecords(state, until) {
    if (!validDate(until)) fail('조회 날짜가 올바르지 않습니다.');
    return actualRecords(state).filter(record => !record.isSample && record.type === 'weight' && record.date <= until && record.completed && typeof record.detail.weight === 'number' && Number.isFinite(record.detail.weight) && record.detail.weight > 0).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  }

  function volume(detail) {
    const exercises = detail && Array.isArray(detail.exercises) ? detail.exercises : [];
    const result = { exerciseCount: exercises.length, setCount: 0, completedSets: 0, volume: 0 };
    for (const exercise of exercises) {
      for (const set of exercise.sets || []) {
        result.setCount++;
        if (set.done) {
          result.completedSets++;
          if (!set.warmup && Number.isFinite(set.weight) && Number.isFinite(set.reps)) result.volume += set.weight * set.reps;
        }
      }
    }
    result.volume = Math.round(result.volume * 1000000) / 1000000;
    return result;
  }

  function history(state, type, until, excludeId) {
    if (!TYPES.includes(type) || !validDate(until)) fail('운동 이력 조회 조건이 올바르지 않습니다.');
    return actualRecords(state).filter(record => record.type === type && record.date < until && !record.isSample && record.id !== excludeId && (type === 'strength' ? volume(record.detail).completedSets > 0 : record.completed)).sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start) || a.id.localeCompare(b.id)).slice(0, 100);
  }

  function snapshotFrom(updated, event, day) {
    return normalizeSnapshot({ date: day, start: updated.start, end: updated.end, type: updated.type, title: updated.title, detail: updated.detail, completed: updated.completed }, event, day);
  }

  function upsert(state, updated, options) {
    const { occurrenceDate = null, scope = 'single' } = options || {};
    if (!plain(updated)) fail('저장할 일정이 올바르지 않습니다.');
    const next = normalizeState(state);
    const index = next.events.findIndex(event => event.id === updated.id);
    const existing = index >= 0 ? next.events[index] : null;
    if (existing && existing.repeat !== 'none') {
      if (own(updated, 'isSample')) existing.isSample = booleanValue(updated.isSample, '샘플', existing.isSample);
      if (scope === 'occurrence') {
        const day = occurrenceDate || updated.date;
        if (!validDate(day) || updated.date !== day || !occurs(existing, day)) fail('수정할 반복 일정 날짜가 올바르지 않습니다.');
        existing.occurrences[day] = snapshotFrom(updated, existing, day);
        existing.excludedDates = existing.excludedDates.filter(value => value !== day);
      } else if (scope === 'series') {
        if (updated.type !== existing.type || (updated.date && updated.date !== existing.date && updated.date !== occurrenceDate) || (updated.repeat && updated.repeat !== existing.repeat)) fail('반복 일정의 시작일·종류·반복 간격은 새 일정으로 등록해 주세요.');
        for (const key of ['title', 'start', 'end', 'detail', 'repeatUntil']) if (own(updated, key)) existing[key] = clone(updated[key]);
        existing.completed = false;
        if (existing.type === 'strength') existing.detail = markStrength(normalizeStrength(existing.detail, false), false);
        if (existing.type === 'weight') existing.detail = { weight: null, bodyfat: null };
      } else fail('반복 일정의 수정 범위를 선택해 주세요.');
    } else {
      const prepared = clone(updated);
      prepared.id = prepared.id === undefined ? uid() : prepared.id;
      prepared.occurrences = {};
      prepared.excludedDates = [];
      const newEvent = normalizeEvent(prepared, { occurrences: 0 });
      if (newEvent.repeat !== 'none') {
        const detail = normalizeDetail(prepared.type, prepared.detail, !!prepared.completed);
        const hasActual = !!prepared.completed || (prepared.type === 'strength' && volume(detail).completedSets > 0) || (prepared.type === 'weight' && detail.weight !== null);
        if (hasActual) newEvent.occurrences[newEvent.date] = snapshotFrom({ ...prepared, detail }, newEvent, newEvent.date);
      }
      if (index >= 0) next.events[index] = newEvent;
      else next.events.push(newEvent);
    }
    next.demo = false;
    return normalizeState(next);
  }

  function toggleComplete(state, id, day) {
    const event = state.events.find(item => item.id === id);
    if (!event) fail('일정을 찾을 수 없습니다.');
    const effective = occurrence(event, day);
    if (!effective) fail('해당 날짜의 일정을 찾을 수 없습니다.');
    const target = !effective.completed;
    if (target && effective.type === 'weight' && !(typeof effective.detail.weight === 'number' && effective.detail.weight > 0)) fail('체중 측정값을 입력해 주세요.');
    effective.completed = target;
    effective.isSample = false;
    if (effective.type === 'strength') effective.detail = markStrength(effective.detail, target);
    if (event.repeat === 'none') return upsert(state, { ...event, ...effective });
    return upsert(state, effective, { occurrenceDate: day, scope: 'occurrence' });
  }

  function remove(state, id, day, scope) {
    const next = normalizeState(state);
    const event = next.events.find(item => item.id === id);
    if (!event) fail('일정을 찾을 수 없습니다.');
    if (event.repeat === 'none' || scope === 'series' || scope === 'all') next.events = next.events.filter(item => item.id !== id);
    else {
      if (scope !== undefined && scope !== 'occurrence') fail('삭제 범위를 선택해 주세요.');
      if (!occurs(event, day)) fail('해당 날짜의 일정을 찾을 수 없습니다.');
      delete event.occurrences[day];
      if (!event.excludedDates.includes(day)) event.excludedDates.push(day);
    }
    next.demo = false;
    return normalizeState(next);
  }

  function makeStore(storage) {
    const backupKey = STORE + '_previous';
    const storageError = message => { const error = new Error(message); error.code = 'STORAGE_ERROR'; return error; };
    const conflict = () => { const error = new Error('다른 창에서 기록이 변경되었습니다. 최신 기록을 불러온 뒤 다시 저장해 주세요.'); error.code = 'STORAGE_CONFLICT'; return error; };
    function load() {
      let raw = null;
      try {
        raw = storage.getItem(STORE);
        if (raw === null) return { data: null, error: null, raw: null };
        if (typeof raw !== 'string' || raw.length > 16000000) throw new Error('저장된 기록 크기가 지원 범위를 벗어났습니다.');
        return { data: normalizeState(JSON.parse(raw)), error: null, raw };
      } catch (error) {
        return { data: null, error: '기록을 불러오지 못했습니다. 원본은 보존되어 있습니다. ' + (error && error.message ? error.message : ''), raw };
      }
    }
    function save(next, expectedRevision, options) {
      const normalized = normalizeState(next);
      let currentRaw;
      try { currentRaw = storage.getItem(STORE); }
      catch (error) { throw storageError('저장 공간에 접근할 수 없습니다. 입력 내용은 유지됩니다.'); }
      const recovery = options && own(options, 'expectedRaw');
      if (recovery) {
        if (currentRaw !== options.expectedRaw) throw conflict();
      } else {
        let revision = '';
        if (currentRaw !== null) {
          try { revision = normalizeState(JSON.parse(currentRaw)).revision; }
          catch (error) { throw storageError('기존 기록을 확인할 수 없어 덮어쓰지 않았습니다. 원본을 백업한 뒤 복구해 주세요.'); }
        }
        if (typeof expectedRevision !== 'string' || revision !== expectedRevision) throw conflict();
      }
      normalized.revision = uid();
      const serialized = JSON.stringify(normalized);
      try {
        if (currentRaw !== null) storage.setItem(backupKey, currentRaw);
        if (storage.getItem(STORE) !== currentRaw) throw conflict();
        storage.setItem(STORE, serialized);
      } catch (error) {
        if (error && error.code === 'STORAGE_CONFLICT') throw error;
        throw storageError('기록을 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요. 입력 내용은 유지됩니다.');
      }
      return normalized;
    }
    return { load, save, backupKey };
  }

  return { VERSION, STORE, defaults, uid, clone, iso, dateOf, shiftDate, validDate, validTime, normalizeState, occurs, occurrence, dayEvents, weightRecords, history, upsert, toggleComplete, remove, volume, makeStore };
});
