/* FORMDAY workout editor — no network or storage side effects. */
(function (root) {
  'use strict';
  const MAX_EXERCISES = 30;
  const MAX_SETS = 50;
  const CATALOG = [
    ['가슴', '벤치프레스'], ['가슴', '인클라인 벤치프레스'], ['가슴', '디클라인 벤치프레스'],
    ['가슴', '덤벨프레스'], ['가슴', '인클라인 덤벨프레스'], ['가슴', '체스트 프레스 머신'],
    ['가슴', '펙덱 플라이'], ['가슴', '케이블 플라이'], ['가슴', '덤벨 플라이'], ['가슴', '푸시업'], ['가슴', '딥스'],
    ['등', '데드리프트'], ['등', '바벨로우'], ['등', '덤벨로우'], ['등', '시티드 케이블로우'],
    ['등', '체스트 서포티드 로우'], ['등', '티바로우'], ['등', '랫풀다운'], ['등', '클로즈그립 랫풀다운'],
    ['등', '풀업'], ['등', '어시스트 풀업'], ['등', '스트레이트암 풀다운'], ['등', '백 익스텐션'],
    ['어깨', '오버헤드프레스'], ['어깨', '덤벨 숄더프레스'], ['어깨', '숄더프레스 머신'],
    ['어깨', '아놀드 프레스'], ['어깨', '사이드 레터럴 레이즈'], ['어깨', '케이블 레터럴 레이즈'],
    ['어깨', '리어델트 플라이'], ['어깨', '페이스풀'], ['어깨', '프론트 레이즈'],
    ['하체', '스쿼트'], ['하체', '프론트 스쿼트'], ['하체', '고블릿 스쿼트'], ['하체', '스미스 스쿼트'],
    ['하체', '핵스쿼트'], ['하체', '레그프레스'], ['하체', '레그 익스텐션'], ['하체', '레그컬'],
    ['하체', '루마니안 데드리프트'], ['하체', '런지'], ['하체', '불가리안 스플릿 스쿼트'], ['하체', '스텝업'],
    ['하체', '힙쓰러스트'], ['하체', '글루트 브리지'], ['하체', '힙 어브덕션'], ['하체', '힙 어덕션'],
    ['하체', '스탠딩 카프레이즈'], ['하체', '시티드 카프레이즈'],
    ['팔', '바이셉 컬'], ['팔', '덤벨 컬'], ['팔', '해머 컬'], ['팔', '프리처 컬'], ['팔', '케이블 컬'],
    ['팔', '트라이셉 푸시다운'], ['팔', '오버헤드 트라이셉 익스텐션'], ['팔', '라잉 트라이셉 익스텐션'],
    ['코어', '크런치'], ['코어', '케이블 크런치'], ['코어', '레그레이즈'], ['코어', '행잉 니레이즈'],
    ['코어', '앱휠 롤아웃'], ['전신', '케틀벨 스윙'], ['전신', '클린'], ['전신', '스내치']
  ];
  let sequence = 0;
  function uid(prefix) {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return prefix + root.crypto.randomUUID();
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const words = root.crypto.getRandomValues(new Uint32Array(3));
      return prefix + Array.from(words, (n) => n.toString(36)).join('-');
    }
    // Record IDs are not credentials; this fallback remains unique within the editor.
    return prefix + Date.now().toString(36) + '-' + (++sequence).toString(36);
  }
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const number = (value, fallback) => value === undefined ? fallback : value === null || value === '' ? NaN : Number(value);
  function normalizeSet(set, fallbackDone) {
    const s = set && typeof set === 'object' ? set : {};
    return {
      id: typeof s.id === 'string' && s.id ? s.id : uid('set-'),
      weight: number(s.weight, 0), reps: number(s.reps, 10),
      rpe: s.rpe === '' || s.rpe == null ? null : Number(s.rpe),
      done: s.done === undefined ? !!fallbackDone : s.done === true,
      warmup: s.warmup === true
    };
  }
  function normalize(detail, legacyCompleted) {
    const d = detail && typeof detail === 'object' ? detail : {};
    let exercises;
    if (Array.isArray(d.exercises)) {
      exercises = d.exercises.map((item) => {
        const ex = item && typeof item === 'object' ? item : {};
        return {
          id: typeof ex.id === 'string' && ex.id ? ex.id : uid('exercise-'),
          name: typeof ex.name === 'string' ? ex.name : '',
          sets: Array.isArray(ex.sets) ? ex.sets.map((s) => normalizeSet(s, false)) : [],
          notes: typeof ex.notes === 'string' ? ex.notes : ''
        };
      });
    } else {
      const count = number(d.sets, 4);
      if (d.sets !== undefined && (!Number.isInteger(count) || count < 1 || count > 1000)) throw new Error('기존 운동의 세트 수를 확인해 주세요. 원본 기록은 유지됩니다.');
      const safeCount = Number.isInteger(count) && count >= 1 ? count : 4;
      exercises = [{
        id: uid('exercise-'), name: typeof d.exercise === 'string' && d.exercise ? d.exercise : '벤치프레스',
        sets: Array.from({ length: safeCount }, () => normalizeSet({ weight: d.weight, reps: d.reps }, legacyCompleted)),
        notes: ''
      }];
    }
    const seenExercises = new Set(), seenSets = new Set();
    for (const ex of exercises) {
      if (seenExercises.has(ex.id)) ex.id = uid('exercise-');
      seenExercises.add(ex.id);
      for (const set of ex.sets) {
        if (seenSets.has(set.id)) set.id = uid('set-');
        seenSets.add(set.id);
      }
    }
    return { exercises, notes: typeof d.notes === 'string' ? d.notes : '' };
  }
  function validate(detail) {
    if (!detail || !Array.isArray(detail.exercises) || detail.exercises.length < 1 || detail.exercises.length > MAX_EXERCISES) {
      throw new Error('운동 종목은 1~30개까지 기록할 수 있습니다.');
    }
    for (let i = 0; i < detail.exercises.length; i++) {
      const ex = detail.exercises[i];
      if (typeof ex.name !== 'string' || !ex.name.trim() || ex.name.trim().length > 80) throw new Error((i + 1) + '번째 운동 이름을 1~80자로 입력해 주세요.');
      if (!Array.isArray(ex.sets) || ex.sets.length < 1 || ex.sets.length > MAX_SETS) throw new Error(ex.name + ': 세트는 1~50개까지 기록할 수 있습니다.');
      for (let j = 0; j < ex.sets.length; j++) {
        const s = ex.sets[j], prefix = ex.name + ' ' + (j + 1) + '세트: ';
        if (typeof s.weight !== 'number' || !Number.isFinite(s.weight) || s.weight < 0 || s.weight > 2000) throw new Error(prefix + '중량을 0~2,000kg 사이의 숫자로 입력해 주세요.');
        if (typeof s.reps !== 'number' || !Number.isInteger(s.reps) || s.reps < 1 || s.reps > 1000) throw new Error(prefix + '횟수를 1~1,000 사이의 정수로 입력해 주세요.');
        if (s.rpe != null && (typeof s.rpe !== 'number' || !Number.isFinite(s.rpe) || s.rpe < 1 || s.rpe > 10)) throw new Error(prefix + 'RPE는 비워 두거나 1~10 사이로 입력해 주세요.');
        if (typeof s.done !== 'boolean' || typeof s.warmup !== 'boolean') throw new Error(prefix + '세트 완료 상태를 확인해 주세요.');
      }
      if (ex.notes != null && (typeof ex.notes !== 'string' || ex.notes.length > 2000)) throw new Error(ex.name + ': 메모는 2,000자 이하로 입력해 주세요.');
    }
    if (detail.notes != null && (typeof detail.notes !== 'string' || detail.notes.length > 4000)) throw new Error('운동 전체 메모는 4,000자 이하로 입력해 주세요.');
    return detail;
  }
  function summary(detail) {
    const d = detail && Array.isArray(detail.exercises) ? detail : normalize(detail, false);
    let setCount = 0, completedSets = 0, volume = 0;
    d.exercises.forEach((ex) => (ex.sets || []).forEach((s) => {
      setCount++;
      if (s.done === true) {
        completedSets++;
        const weight = Number(s.weight), reps = Number(s.reps);
        if (!s.warmup && Number.isFinite(weight) && weight >= 0 && Number.isInteger(reps) && reps > 0) volume += weight * reps;
      }
    }));
    return { exerciseCount: d.exercises.length, setCount, completedSets, volume: Math.round(volume * 100) / 100 };
  }
  function describe(detail) {
    const d = detail && Array.isArray(detail.exercises) ? detail : normalize(detail, false);
    if(d.freePlan===true&&!d.exercises.length)return '자유운동 · 시작할 때 종목 선택';
    const s = summary(d), first = d.exercises[0];
    return (first && first.name ? first.name : '웨이트') + (s.exerciseCount > 1 ? ' 외 ' + (s.exerciseCount - 1) + '종목' : '') + ' · ' + s.completedSets + '/' + s.setCount + '세트 완료' + (s.volume > 0 ? ' · ' + fmt(s.volume) + 'kg' : '');
  }
  function historyFor(name, options) {
    const records = Array.isArray(options.history) ? options.history : [];
    const sorted = records.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const record of sorted) {
      const source = record.event || record;
      if (source.isSample || !source.detail) continue;
      const normalized = normalize(source.detail, source.completed === true);
      const ex = normalized.exercises.find((item) => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
      if (!ex) continue;
      const done = ex.sets.filter((s) => s.done && !s.warmup && Number.isFinite(Number(s.weight)) && Number(s.reps) > 0);
      if (!done.length) continue;
      const date = record.date || source.date || '';
      const groups = [];
      for (const set of done) {
        const label = fmt(set.weight) + 'kg × ' + fmt(set.reps) + '회';
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.count++;
        else groups.push({ label, count: 1 });
      }
      return (date ? date + ' · ' : '') + groups.map((g) => g.label + (g.count > 1 ? ' × ' + g.count + '세트' : '')).join(' / ');
    }
    return '';
  }
  function summaryMarkup(detail, options) {
    const s = summary(detail);
    if (options && options.planOnly) {
      let planned = 0;
      for (const ex of detail.exercises) for (const set of ex.sets || []) {
        const weight = Number(set.weight), reps = Number(set.reps);
        if (!set.warmup && Number.isFinite(weight) && weight >= 0 && Number.isInteger(reps) && reps > 0) planned += weight * reps;
      }
      return '<div><span>계획 종목</span><strong>' + s.exerciseCount + '<small>개</small></strong></div>' +
        '<div><span>계획 세트</span><strong>' + s.setCount + '<small>세트</small></strong></div>' +
        '<div><span>계획 운동량</span><strong>' + fmt(planned) + '<small> kg</small></strong></div>';
    }
    return '<div><span>운동 종목</span><strong>' + s.exerciseCount + '<small>개</small></strong></div>' +
      '<div><span>완료한 세트</span><strong>' + s.completedSets + '<small> / ' + s.setCount + '</small></strong></div>' +
      '<div><span>완료 운동량</span><strong>' + fmt(s.volume) + '<small> kg</small></strong></div>';
  }
  function setMarkup(set, index, exIndex, total, options) {
    const prefix = (exIndex + 1) + '번째 운동 ' + (index + 1) + '세트 ';
    return '<div class="fw-set-row' + (set.done && !(options && options.planOnly) ? ' is-done' : '') + (set.warmup ? ' is-warmup' : '') + '" data-fw-set="' + esc(set.id) + '">' +
      '<span class="fw-set-number" title="' + (index + 1) + '세트">' + (index + 1) + '</span>' +
      '<label class="fw-value fw-value-weight"><span>중량 <small>kg</small></span><input data-fw-field="weight" type="number" inputmode="decimal" min="0" max="2000" step="any" value="' + esc(set.weight) + '" aria-label="' + prefix + '중량 (kg)" required></label>' +
      '<label class="fw-value fw-value-reps"><span>횟수 <small>회</small></span><input data-fw-field="reps" type="number" inputmode="numeric" min="1" max="1000" step="1" value="' + esc(set.reps) + '" aria-label="' + prefix + '횟수" required></label>' +
      '<label class="fw-value fw-value-rpe"><span>RPE <small>선택</small></span><input data-fw-field="rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5" value="' + esc(set.rpe == null ? '' : set.rpe) + '" placeholder="—" aria-label="' + prefix + 'RPE (선택)"></label>' +
      '<label class="fw-check"' + (options && options.planOnly ? ' title="완료 체크는 해당 날짜의 일정에서 할 수 있습니다."' : '') + '><span>' + (options && options.planOnly ? '날짜별' : '완료') + '</span><input data-fw-field="done" type="checkbox"' + (options && options.planOnly ? ' disabled' : set.done ? ' checked' : '') + ' aria-label="' + prefix + '완료"></label>' +
      '<div class="fw-set-controls"><label class="fw-kind"><span class="fw-sr">' + prefix + '종류</span><select data-fw-field="warmup" aria-label="' + prefix + '종류"><option value="work"' + (!set.warmup ? ' selected' : '') + '>본 세트</option><option value="warmup"' + (set.warmup ? ' selected' : '') + '>워밍업</option></select></label>' +
      '<span class="fw-row-actions"><button type="button" class="fw-icon-button" data-fw-action="duplicate-set" aria-label="' + prefix + '복제" title="세트 복제"' + (total >= MAX_SETS ? ' disabled' : '') + '>복제</button><button type="button" class="fw-icon-button fw-remove" data-fw-action="remove-set" aria-label="' + prefix + '삭제" title="세트 삭제"' + (total <= 1 ? ' disabled' : '') + '>삭제</button></span></div></div>';
  }
  // Read-only preview: exercise and set lists are folded by default.
  function planDisclosure(exercises, key='', opened=new Set()) {
    if(!Array.isArray(exercises)||!exercises.length)return '';
    const fold=(id)=>' data-fold-key="'+esc(id)+'"'+(opened.has(id)?' open':'');
    return '<details class="fd-plan-disclosure"'+fold(key+'-all')+'><summary>운동 종목 · 세트 보기</summary><div class="fd-plan-exercises">'+exercises.map((ex,i)=>{
      const sets=Array.isArray(ex.sets)?ex.sets:[],done=sets.filter(set=>set.done===true).length;
      return '<details class="fd-plan-exercise"'+fold(key+'-'+i)+'><summary><b>'+esc(ex.name)+'</b><span>'+done+'/'+sets.length+'세트</span></summary><div class="fd-plan-set-list">'+sets.map((set,j)=>'<div><span>SET '+(j+1)+(set.warmup?' · 준비':'')+'</span><b>'+esc(fmt(set.weight))+'kg × '+esc(set.reps)+'회'+(set.rpe!=null?' · RPE '+esc(set.rpe):'')+'</b><span class="fd-plan-set-state">'+(set.done===true?'완료':'예정')+'</span></div>').join('')+'</div></details>';
    }).join('')+'</div></details>';
  }
  function exerciseMarkup(ex, index, count, listId, options) {
    const history = historyFor(ex.name, options),fold=options?.collapseExercises===true;
    return '<section class="fw-exercise" data-fw-exercise="' + esc(ex.id) + '">' +
      (fold ? '<details class="fw-edit-fold"'+(!ex.name.trim()?' open':'')+'><summary><b data-fw-fold-name>'+esc(ex.name||'새 운동 종목')+'</b><span>'+ex.sets.length+'세트</span></summary>' : '') +
      '<div class="fw-exercise-head"><span class="fw-exercise-index">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<label class="fw-exercise-name"><span>운동 이름 · 검색 또는 직접 입력</span><input type="text" data-fw-field="name" list="' + esc(listId) + '" value="' + esc(ex.name) + '" maxlength="80" autocomplete="off" placeholder="예: 벤치프레스" aria-label="' + (index + 1) + '번째 운동 이름" required></label>' +
      '<button type="button" class="fw-exercise-remove" data-fw-action="remove-exercise" aria-label="' + (index + 1) + '번째 운동 삭제" title="운동 삭제"' + (count <= 1 ? ' disabled' : '') + '>×</button></div>' +
      '<div class="fw-last-record' + (history ? '' : ' is-empty') + '" data-fw-history><span>지난 기록</span><p>' + esc(history || '완료한 같은 종목의 기록이 쌓이면 여기에 표시됩니다.') + '</p></div>' +
      (fold ? '<details class="fw-edit-sets"><summary>'+ex.sets.length+'개 세트 편집</summary>' : '') +
      '<div class="fw-sets">' + ex.sets.map((s, i) => setMarkup(s, i, index, ex.sets.length, options)).join('') + '</div>' +
      (fold ? '</details>' : '') +
      '<div class="fw-exercise-foot"><button type="button" class="fw-add-set" data-fw-action="add-set"' + (ex.sets.length >= MAX_SETS ? ' disabled' : '') + '>＋ 세트 추가</button>' +
      '<details class="fw-exercise-note"' + (ex.notes ? ' open' : '') + '><summary>운동 메모</summary><textarea data-fw-field="exercise-notes" maxlength="2000" rows="2" placeholder="자세, 컨디션, 기구 설정 등을 기록하세요." aria-label="' + (index + 1) + '번째 운동 메모">' + esc(ex.notes || '') + '</textarea></details></div>'+(fold?'</details>':'')+'</section>';
  }
  function editorMarkup(detail, options, listId) {
    return '<div class="fw-editor' + (options.planOnly ? ' is-plan' : '') + '"><div class="fw-section-intro"><div><h3>' + (options.planOnly ? '기본 운동 계획' : '세트별 운동 기록') + '</h3><p>' + (options.planOnly ? '반복 일정에 사용할 종목과 세트를 구성하세요.' : '중량과 횟수를 기록하고, 마친 세트를 체크하세요.') + '</p></div><span class="fw-stage-badge">' + (options.planOnly ? 'WORKOUT PLAN' : 'WEIGHT LOG') + '</span></div>' +
      '<div class="fw-summary" data-fw-summary aria-label="웨이트 기록 요약">' + summaryMarkup(detail, options) + '</div>' +
      '<p class="fw-volume-note">' + (options.planOnly ? '기본 계획의 운동량입니다. 실제 수행은 해당 날짜의 일정에서 완료한 세트로 기록됩니다. 워밍업은 운동량에서 제외됩니다.' : '운동량 = 완료한 본 세트의 중량 × 횟수 합계. 워밍업은 제외됩니다.') + '</p>' +
      '<div class="fw-exercises">' + detail.exercises.map((ex, i) => exerciseMarkup(ex, i, detail.exercises.length, listId, options)).join('') + '</div>' +
      '<button type="button" class="fw-add-exercise" data-fw-action="add-exercise"' + (detail.exercises.length >= MAX_EXERCISES ? ' disabled' : '') + '>＋ 운동 종목 추가</button>' +
      '<label class="fw-workout-note"><span>오늘 운동 메모</span><textarea data-fw-field="notes" maxlength="4000" rows="2" placeholder="오늘의 컨디션이나 다음 운동에서 기억할 점">' + esc(detail.notes || '') + '</textarea></label>' +
      '<details class="fw-rpe-help"><summary>RPE가 뭔가요?</summary><p>세트가 얼마나 힘들었는지 1~10으로 남기는 선택 기록입니다. 모르면 비워 두셔도 됩니다.</p></details>' +
      '<div class="fw-timer"' + (options.planOnly ? ' hidden' : '') + ' aria-label="세트 사이 휴식 타이머"><div class="fw-timer-heading"><span>휴식 타이머</span><small data-fw-timer-status aria-live="polite">시간을 정한 뒤 시작하세요.</small></div>' +
      '<div class="fw-timer-body"><output class="fw-clock" data-fw-clock aria-label="남은 휴식 시간">01:30</output><div class="fw-timer-presets" role="group" aria-label="휴식 시간 선택"><button type="button" data-fw-action="timer-preset" data-seconds="60" aria-pressed="false">60초</button><button type="button" data-fw-action="timer-preset" data-seconds="90" class="active" aria-pressed="true">90초</button><button type="button" data-fw-action="timer-preset" data-seconds="120" aria-pressed="false">120초</button></div></div>' +
      '<div class="fw-timer-actions"><button type="button" class="fw-timer-start" data-fw-action="timer-toggle">시작</button><button type="button" class="fw-timer-reset" data-fw-action="timer-reset">초기화</button><span>이 창을 닫으면 종료됩니다.</span></div></div>' +
      '<p class="fw-editor-error" data-fw-error role="alert" hidden></p>' +
      '<datalist id="' + esc(listId) + '">' + CATALOG.map((entry) => '<option value="' + esc(entry[1]) + '">' + esc(entry[0]) + '</option>').join('') + '</datalist></div>';
  }
  function render(detail, options) {
    return editorMarkup(normalize(detail, false), options || {}, uid('exercise-list-'));
  }
  function mount(container, detail, options) {
    if (!container || typeof container.querySelector !== 'function') throw new Error('운동 기록 화면을 찾을 수 없습니다.');
    const opts = options || {};
    let state = normalize(detail, false);
    if (opts.planOnly) for (const ex of state.exercises) for (const set of ex.sets) set.done = false;
    const listId = uid('exercise-list-');
    let disposed = false;
    let duration = 90, remaining = 90, deadline = 0, running = false, timerDone = false;
    let lastClock = '';
    container.innerHTML = editorMarkup(state, opts, listId);
    function readDraft() {
      return {
        exercises: Array.from(container.querySelectorAll('[data-fw-exercise]')).map((element) => ({
          id: element.dataset.fwExercise,
          name: element.querySelector('[data-fw-field="name"]').value,
          sets: Array.from(element.querySelectorAll('[data-fw-set]')).map((row) => ({
            id: row.dataset.fwSet,
            weight: row.querySelector('[data-fw-field="weight"]').value,
            reps: row.querySelector('[data-fw-field="reps"]').value,
            rpe: row.querySelector('[data-fw-field="rpe"]').value,
            done: opts.planOnly ? false : row.querySelector('[data-fw-field="done"]').checked,
            warmup: row.querySelector('[data-fw-field="warmup"]').value === 'warmup'
          })),
          notes: element.querySelector('[data-fw-field="exercise-notes"]').value
        })),
        notes: container.querySelector('[data-fw-field="notes"]').value
      };
    }
    function updateSummary() {
      const target = container.querySelector('[data-fw-summary]');
      if (target) target.innerHTML = summaryMarkup(state, opts);
    }
    function notify() {
      updateSummary();
      if (typeof opts.onChange === 'function') opts.onChange(state, summary(state));
    }
    function showError(message, input) {
      const box = container.querySelector('[data-fw-error]');
      box.hidden = !message; box.textContent = message || '';
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        for(let p=input.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
        input.focus();
        input.scrollIntoView({ block: 'nearest' });
      }
    }
    function clearError(target) {
      const box = container.querySelector('[data-fw-error]');
      if (box) { box.hidden = true; box.textContent = ''; }
      if (target && target.removeAttribute) target.removeAttribute('aria-invalid');
    }
    function rebuild(focusSelector) {
      const notes = state.notes;
      const list = container.querySelector('.fw-exercises');
      const opened=new Map(Array.from(list.querySelectorAll('[data-fw-exercise]')).map(el=>[el.dataset.fwExercise,[el.querySelector('.fw-edit-fold')?.open,el.querySelector('.fw-edit-sets')?.open]]));
      list.innerHTML = state.exercises.map((ex, i) => exerciseMarkup(ex, i, state.exercises.length, listId, opts)).join('');
      if(opts.collapseExercises)for(const el of list.querySelectorAll('[data-fw-exercise]')){
        const old=opened.get(el.dataset.fwExercise);
        if(old){el.querySelector('.fw-edit-fold').open=!!old[0];el.querySelector('.fw-edit-sets').open=!!old[1];}
      }
      container.querySelector('[data-fw-action="add-exercise"]').disabled = state.exercises.length >= MAX_EXERCISES;
      container.querySelector('[data-fw-field="notes"]').value = notes;
      clearError(); notify();
      if (focusSelector) {
        const target = container.querySelector(focusSelector);
        if (target) { for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;target.focus(); target.scrollIntoView({ block: 'nearest' }); }
      }
    }
    function clockText(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
    function paintTimer() {
      if (disposed) return;
      if (running) {
        remaining = Math.max(0, (deadline - Date.now()) / 1000);
        if (remaining <= 0) { running = false; timerDone = true; }
      }
      const clock = clockText(remaining);
      if (clock !== lastClock) { container.querySelector('[data-fw-clock]').textContent = clock; lastClock = clock; }
      const button = container.querySelector('[data-fw-action="timer-toggle"]');
      const label = running ? '일시정지' : timerDone ? '다시 시작' : remaining < duration ? '계속' : '시작';
      if (button.textContent !== label) button.textContent = label;
      const status = container.querySelector('[data-fw-timer-status]');
      const message = timerDone ? '휴식 시간이 끝났습니다.' : running ? '휴식 중입니다.' : remaining < duration ? '일시정지했습니다.' : '시간을 정한 뒤 시작하세요.';
      if (status.textContent !== message) status.textContent = message;
      container.querySelector('.fw-timer').classList.toggle('is-finished', timerDone);
      for (const preset of container.querySelectorAll('[data-fw-action="timer-preset"]')) {
        const active = Number(preset.dataset.seconds) === duration;
        preset.classList.toggle('active', active); preset.setAttribute('aria-pressed', String(active));
      }
    }
    function onInput(event) {
      if (!event.target.matches('[data-fw-field]')) return;
      clearError(event.target); state = readDraft();
      const row = event.target.closest('[data-fw-set]');
      if (row) {
        row.classList.toggle('is-done', row.querySelector('[data-fw-field="done"]').checked);
        row.classList.toggle('is-warmup', row.querySelector('[data-fw-field="warmup"]').value === 'warmup');
      }
      if (event.type === 'change' && event.target.dataset.fwField === 'name') {
        const ex = event.target.closest('[data-fw-exercise]');
        const foldName=ex.querySelector('[data-fw-fold-name]');if(foldName)foldName.textContent=event.target.value.trim()||'새 운동 종목';
        const history = historyFor(event.target.value, opts);
        const target = ex.querySelector('[data-fw-history]');
        target.querySelector('p').textContent = history || '완료한 같은 종목의 기록이 쌓이면 여기에 표시됩니다.';
        target.classList.toggle('is-empty', !history);
      }
      notify();
    }
    function onClick(event) {
      const button = event.target.closest('[data-fw-action]');
      if (!button || !container.contains(button) || button.disabled) return;
      const action = button.dataset.fwAction;
      if (action.startsWith('timer-')) {
        if (action === 'timer-preset') {
          duration = Number(button.dataset.seconds); remaining = duration; running = false; timerDone = false;
        } else if (action === 'timer-reset') {
          remaining = duration; running = false; timerDone = false;
        } else {
          if (running) { remaining = Math.max(0, (deadline - Date.now()) / 1000); running = false; if (remaining <= 0) timerDone = true; }
          else { if (remaining <= 0) remaining = duration; deadline = Date.now() + remaining * 1000; running = true; timerDone = false; }
        }
        paintTimer(); return;
      }
      state = readDraft();
      const exElement = button.closest('[data-fw-exercise]');
      const exIndex = exElement ? state.exercises.findIndex((ex) => ex.id === exElement.dataset.fwExercise) : -1;
      const ex = state.exercises[exIndex];
      const row = button.closest('[data-fw-set]');
      const setIndex = ex && row ? ex.sets.findIndex((set) => set.id === row.dataset.fwSet) : -1;
      if (action === 'add-exercise') {
        if (state.exercises.length >= MAX_EXERCISES) return;
        state.exercises.push({ id: uid('exercise-'), name: '', sets: Array.from({ length: 3 }, () => normalizeSet({}, false)), notes: '' });
        rebuild('.fw-exercise:last-child [data-fw-field="name"]');
      } else if (action === 'remove-exercise' && ex && state.exercises.length > 1) {
        state.exercises.splice(exIndex, 1); rebuild();
      } else if (action === 'add-set' && ex && ex.sets.length < MAX_SETS) {
        const previous = ex.sets[ex.sets.length - 1] || normalizeSet({}, false);
        ex.sets.push({ ...previous, id: uid('set-'), rpe: '', done: false });
        rebuild('.fw-exercise:nth-child(' + (exIndex + 1) + ') .fw-set-row:last-child [data-fw-field="weight"]');
      } else if (action === 'duplicate-set' && ex && setIndex >= 0 && ex.sets.length < MAX_SETS) {
        ex.sets.splice(setIndex + 1, 0, { ...ex.sets[setIndex], id: uid('set-'), rpe: '', done: false });
        rebuild('.fw-exercise:nth-child(' + (exIndex + 1) + ') .fw-set-row:nth-child(' + (setIndex + 2) + ') [data-fw-field="weight"]');
      } else if (action === 'remove-set' && ex && setIndex >= 0 && ex.sets.length > 1) {
        ex.sets.splice(setIndex, 1); rebuild();
      }
    }
    const interval = opts.planOnly ? null : root.setInterval(paintTimer, 250);
    const documentRef = container.ownerDocument;
    const visibility = () => paintTimer();
    container.addEventListener('input', onInput);
    container.addEventListener('change', onInput);
    container.addEventListener('click', onClick);
    documentRef.addEventListener('visibilitychange', visibility);
    paintTimer();
    return {
      read() {
        if (disposed) throw new Error('운동 기록 창이 닫혔습니다. 다시 열어 주세요.');
        clearError();
        const draft = readDraft();
        const converted = { exercises: [], notes: draft.notes };
        const fail = (message, input) => { showError(message, input); throw new Error(message); };
        draft.exercises.forEach((ex, i) => {
          const element = container.querySelectorAll('[data-fw-exercise]')[i];
          const name = ex.name.trim();
          if (!name || name.length > 80) fail((i + 1) + '번째 운동 이름을 1~80자로 입력해 주세요.', element.querySelector('[data-fw-field="name"]'));
          const sets = ex.sets.map((set, j) => {
            const row = element.querySelectorAll('[data-fw-set]')[j];
            const weight = set.weight === '' ? NaN : Number(set.weight);
            const reps = set.reps === '' ? NaN : Number(set.reps);
            const rpe = set.rpe === '' ? null : Number(set.rpe);
            const prefix = name + ' ' + (j + 1) + '세트: ';
            if (!Number.isFinite(weight) || weight < 0 || weight > 2000) fail(prefix + '중량을 0~2,000kg 사이의 숫자로 입력해 주세요.', row.querySelector('[data-fw-field="weight"]'));
            if (!Number.isInteger(reps) || reps < 1 || reps > 1000) fail(prefix + '횟수를 1~1,000 사이의 정수로 입력해 주세요.', row.querySelector('[data-fw-field="reps"]'));
            if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) fail(prefix + 'RPE는 비워 두거나 1~10 사이로 입력해 주세요.', row.querySelector('[data-fw-field="rpe"]'));
            return { id: set.id, weight, reps, rpe, done: set.done, warmup: set.warmup };
          });
          converted.exercises.push({ id: ex.id, name, sets, notes: ex.notes });
        });
        try { validate(converted); } catch (error) { showError(error.message); throw error; }
        state = converted;
        return converted;
      },
      markAllDone(value) {
        if (disposed || opts.planOnly) return;
        for (const input of container.querySelectorAll('[data-fw-field="done"]')) {
          input.checked = !!value;
          input.closest('[data-fw-set]').classList.toggle('is-done', !!value);
        }
        state = readDraft(); notify();
      },
      destroy() {
        if (disposed) return;
        disposed = true;
        if (interval !== null) root.clearInterval(interval);
        container.removeEventListener('input', onInput);
        container.removeEventListener('change', onInput);
        container.removeEventListener('click', onClick);
        documentRef.removeEventListener('visibilitychange', visibility);
      }
    };
  }
  const api = { normalize, validate, render, mount, summary, describe, planDisclosure, catalog: CATALOG.map((entry) => ({ group: entry[0], name: entry[1] })) };
  root.FormdayWorkouts = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
