/* FORMDAY IRON MODE routines & sessions.
   Separate from legacy calendar records, with validated local save and device sync. */
(function(root){
  'use strict';
  const M=root.FormdayIronStore,W=root.FormdayWorkouts;
  const host=document.getElementById('fd-ind-root'),calendar=document.getElementById('fd-iron-calendar');
  if(!host||!M||!Array.isArray(W?.catalog)){
    const unavailable=()=>{
      if(host){document.body.dataset.fdScreen='independent';host.innerHTML='<section class="fi-panel fi-alert" role="alert"><h2>운동 화면을 불러오지 못했습니다.</h2><p>페이지를 새로고침한 뒤 다시 열어 주세요. 기기에 저장된 기록은 유지됩니다.</p></section>';}
      return false;
    };
    root.FormdayIndependent=Object.freeze({open:unavailable,beforeNavigate:()=>true,getSnapshot:()=>null,canCloudApply:()=>false});
    document.addEventListener('click',event=>{if(event.target.closest?.('[data-ind-nav]')){event.preventDefault();unavailable();}});
    return;
  }
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=x=>Number(x||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const iso=d=>new Date(d).toLocaleDateString('sv-SE');
  const weekdays=['일','월','화','수','목','금','토'];
  const TIME_LIMIT_MS=24*60*60*1000;
  let store,blocked='',state=null,screen='home',editingRoutine=null,draft=null,programDraft=null,
      draftBaseline='',programBaseline='',pickerOpen=false,
      focusedSession=null,message='',error=false,revisionConflict=false,clockTick=Date.now(),timerSecs=90,timerEnd=0,
      timerVisible=false,timerAutoPaused=false,sessionDirty=false,sessionViewMode='all',sessionExerciseIndex=0,
      backgroundStoppedAt=null,previousCacheSession=null;
  const previousCache=new Map();
  try{
    store=M.createStore(root.localStorage);
    const result=store.load();
    if(result.error)blocked=result.error;
    else{
      state=result.data;
      const unfinished=M.getUnfinished(state);
      if(unfinished?.status==='ACTIVE'){
        try{
          const safe=M.resumeAfterReload(state);
          state=store.save(safe,state.revision);
          message='이전 운동을 안전하게 임시 보관했습니다. 이어서 진행할 수 있습니다.';
        }catch(e){blocked='이전 운동 상태를 복구하지 못했습니다. '+e.message;}
      }
    }
  }catch(e){blocked='브라우저 저장소에 접근할 수 없습니다. '+e.message;}
  const active=()=>state&&M.getUnfinished(state);
  const completed=()=>state?.sessions.filter(x=>x.status==='COMPLETED'||x.status==='PARTIAL')||[];
  const summary=s=>M.recordSummary(s);
  const current=()=>active();
  const setMessage=(value,isError=false)=>{message=value;error=isError;};
  function paintMessage(){
    const banner=host.querySelector('#fi-banner');
    if(banner){banner.hidden=!message;banner.textContent=message;banner.classList?.toggle('fi-msg-error',error);}
    const reload=host.querySelector('#fi-session-reload');
    if(reload)reload.hidden=!revisionConflict;
    const saved=host.querySelector('#fi-session-save-state');
    if(saved)saved.textContent=error?'저장 상태를 확인해 주세요':sessionDirty?'입력 중 · 입력을 마치면 저장됩니다':'기기에 저장됨';
  }
  function editable(){
    if(blocked||!state)throw Error(blocked||'운동 기록을 먼저 불러와 주세요.');
    if(revisionConflict)throw Error('다른 탭에서 데이터가 변경되었습니다. 먼저 최신 기록을 불러와 주세요.');
  }
  function commit(result,success,refresh=true){
    if(blocked||revisionConflict){setMessage(blocked||'다른 탭에서 데이터가 변경되었습니다. 먼저 기록을 다시 불러와 주세요.',true);if(refresh)render();else paintMessage();return false;}
    try{
      state=store.save(result.next,state.revision);
      root.dispatchEvent(new CustomEvent('formday:iron-changed'));
      if(success)setMessage(success,false);
      if(refresh)render();else paintMessage();
      return true;
    }catch(e){
      setMessage(e.message,true);
      if(/다른 탭/.test(e.message))revisionConflict=true;
      if(refresh)render();else paintMessage();
      return false;
    }
  }
  function changed(mutator,success,refresh=true){
    try{editable();return commit(mutator(),success,refresh);}catch(e){setMessage(e.message,true);if(refresh)render();else paintMessage();return false;}
  }
  function clearDrafts(){
    draft=null;editingRoutine=null;programDraft=null;draftBaseline='';programBaseline='';
  }
  function hasUnsavedDraft(){
    if(screen==='builder')readDraft();
    if(screen==='programBuilder')readProgram();
    return !!((draft&&JSON.stringify(draft)!==draftBaseline)||
      (programDraft&&JSON.stringify(programDraft)!==programBaseline));
  }
  function beforeNavigate(){
    if(pickerOpen||root.FormdayExercisePicker?.isOpen?.()){setMessage('종목 선택을 완료하거나 선택창을 닫은 뒤 이동해 주세요.',true);paintMessage();return false;}
    if(screen==='session'&&!saveSessionInputs())return false;
    const discarded=hasUnsavedDraft();
    if(discarded&&!root.confirm('저장하지 않은 루틴 또는 프로그램 변경사항을 버리고 이동할까요? 계속 작성하려면 취소를 누르세요.'))return false;
    clearDrafts();
    if(discarded)setMessage('저장하지 않은 변경사항을 취소했습니다.');
    return true;
  }
  function go(page){
    if(page==='choose')page='routines';
    if(!['home','routines','builder','programs','programBuilder','session','history'].includes(page))page='home';
    if(screen==='session'&&page!=='session'&&!saveSessionInputs())return false;
    const leavingDraft=(screen==='builder'&&page!=='builder'&&draft)||(screen==='programBuilder'&&page!=='programBuilder'&&programDraft);
    if(leavingDraft&&!beforeNavigate())return false;
    document.body.dataset.fdScreen='independent';
    screen=page;
    if(screen==='session'&&!current())screen='home';
    if(screen==='history'&&!focusedSession)focusedSession=completed().at(-1)?.id||null;
    render();
    document.getElementById('main-content')?.scrollIntoView({behavior:'smooth',block:'start'});
    return true;
  }
  function open(page='home',extra){
    try{
      if(!beforeNavigate())return false;
      if(blocked||!state){go('home');return false;}
      if(page==='start'&&extra?.exercise){
        if(current()){
          const s=current();
          if(s.status!=='ACTIVE'){setMessage('보관된 운동을 먼저 재개한 뒤 종목을 추가해 주세요.',true);go('session');return false;}
          const added=changed(()=>M.addExercises(state,s.id,[extra.exercise]),'기존 운동 세션에 종목을 추가했습니다.');
          go('session');return added;
        }
        const started=doStart(null,null,[extra.exercise]);
        if(!started)go('home');
        return started;
      }
      return go(page==='start'?'home':page);
    }catch(e){
      setMessage('운동 화면을 열지 못했습니다. '+e.message,true);go('home');return false;
    }
  }
  function top(){
    document.body.dataset.fdScreen='independent';
    const title=document.querySelector('.page-title');
    const sub=document.querySelector('.page-sub');
    const crumb=document.querySelector('.crumb');
    if(title)title.textContent=({home:'운동',routines:'내 루틴',builder:'루틴 만들기',programs:'훈련 프로그램',session:'운동 기록하기',history:'운동 기록',programBuilder:'프로그램 만들기'})[screen]||'운동';
    if(sub)sub.textContent='종목 선택부터 루틴, 운동 기록까지 한곳에서 관리하세요.';
    if(crumb?.firstChild)crumb.firstChild.textContent='TRAINING  ';
    document.querySelectorAll('[data-ind-nav]').forEach(b=>{
      const selected=b.dataset.indNav==='start';
      b.classList.toggle('fd-current',selected);
      b.classList.toggle('active',selected);
      b.setAttribute('aria-current',selected?'page':'false');
    });
    document.querySelectorAll('[data-fd-route],[data-go],[data-mobile]').forEach(b=>{
      b.classList.remove('fd-current','active');b.setAttribute('aria-current','false');
    });
  }
  const button=(action,label,kind='primary',more='')=>'<button class="fi-btn fi-'+kind+'" type="button" data-fi-action="'+action+'" '+more+'>'+label+'</button>';
  function hubNav(){
    const selected=screen==='builder'?'routines':screen==='programBuilder'?'programs':screen==='session'?'home':screen;
    return '<nav class="fi-hub-nav" aria-label="운동 하위 메뉴">'+[['home','운동','◉'],['routines','루틴','▤'],['programs','프로그램','◎'],['history','기록','▦']].map(([page,label,icon])=>
      '<button type="button" data-fi-nav="'+page+'" aria-current="'+(selected===page?'page':'false')+'"><span aria-hidden="true">'+icon+'</span><b>'+label+'</b></button>').join('')+'</nav>';
  }
  function banner(){
    const s=current();
    if(!s)return '';
    const sum=summary(s);
    const stale=Date.now()-Date.parse(s.lastSavedAt)>=TIME_LIMIT_MS;
    return '<div class="fi-resume '+(stale?'fi-stale':'')+'"><span class="fi-kicker">'+(stale?'24시간 경과 · 삭제되지 않았습니다':'보관 또는 진행 중인 운동')+'</span>'+
      '<h3>'+esc(s.label)+'</h3><p>'+esc(s.date)+' · '+sum.completedSets+'세트 완료 · '+fmt(sum.volume)+'kg · '+s.status+'</p>'+
      '<div class="fi-inline-actions">'+button(s.status==='ACTIVE'?'inspect-session':'resume','운동 이어하기','primary')+button('inspect-session','진행 기록 보기','outline')+'</div></div>';
  }
  function home(){
    const history=completed().slice().reverse();
    return '<section class="fi-view"><div class="fi-hub-hero"><span class="fi-kicker">YOUR WORKOUT</span><h2>오늘의 운동을 시작하세요.</h2><p>종목을 선택해 바로 시작하거나, 저장한 루틴을 실행하세요.</p></div>'+
      banner()+'<div class="fi-stats"><div><span>저장된 루틴</span><strong>'+state.routines.length+'</strong></div><div><span>훈련 프로그램</span><strong>'+state.programs.length+'</strong></div><div><span>확정한 운동</span><strong>'+history.length+'</strong></div></div>'+
      '<div class="fi-hub-start"><div><span class="fi-kicker">START TRAINING</span><h3>어떻게 운동할까요?</h3><p>자유 운동에서는 검색과 즐겨찾기로 여러 종목을 한 번에 고를 수 있습니다.</p></div><div class="fi-action-grid">'+
      button('start-free','＋ 종목 골라 운동 시작')+button('routine-list','저장한 루틴으로 시작','outline')+'</div></div>'+
      (state.programs.some(p=>p.active)?'<div class="fi-panel"><div class="fi-section-head"><h3>프로그램의 다음 운동</h3>'+button('program-list','프로그램 보기','subtle')+'</div>'+programStarts()+'</div>':'')+
      '<div class="fi-panel"><div class="fi-section-head"><h3>최근 운동</h3>'+button('show-history','기록 전체 →','subtle')+'</div>'+
      (!history.length?'<p class="fi-empty">아직 확정된 운동 기록이 없습니다.</p>':history.slice(0,4).map(s=>recordCard(s)).join(''))+'</div></section>';
  }
  function routines(){
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">MY ROUTINES</span><h2>내 루틴 <small>'+state.routines.length+'</small></h2><p class="fi-note">자주 하는 종목과 목표 세트를 묶어 두세요.</p></div>'+button('new-routine','＋ 새 루틴')+'</div>'+
      (!state.routines.length?'<div class="fi-panel fi-hub-empty"><h3>첫 루틴을 만들어 보세요.</h3><p>종목을 고르고 목표 중량, 횟수와 휴식 시간을 저장할 수 있습니다.</p>'+button('new-routine','종목을 골라 루틴 만들기')+'</div>':
      '<div class="fi-routine-list">'+state.routines.map(r=>'<article class="fi-panel fi-routine-card"><div><span class="fi-kicker">'+r.exercises.length+'종목 · '+r.exercises.reduce((n,x)=>n+x.sets.length,0)+'세트</span><h3>'+esc(r.name)+'</h3><p>'+esc(r.exercises.map(ex=>ex.name).join(' · '))+'</p></div><div class="fi-inline-actions">'+
       button('begin-routine','이 루틴으로 운동','primary','data-id="'+esc(r.id)+'"')+button('edit-routine','루틴 편집','outline','data-id="'+esc(r.id)+'"')+'</div></article>').join('')+'</div>')+'</section>';
  }
  function recordCard(s,calendarMode=false){
    const result=summary(s),kind=s.status==='PARTIAL'?'부분 완료':'완료';
    return '<button type="button" class="fi-history-card" data-fi-action="record-detail" data-id="'+esc(s.id)+'">'+
      '<div class="fi-record-leading"><b>'+esc(s.label)+'</b><small>'+esc(s.date)+' · '+result.completedSets+'세트 · '+fmt(result.volume)+'kg · '+esc(s.exercises.map(e=>e.name).slice(0,2).join(' / '))+'</small></div>'+
      '<span class="fi-status '+(s.status==='PARTIAL'?'fi-partial':'fi-complete')+'">'+kind+'</span><span aria-hidden="true">↗</span></button>';
  }
  function routineOptions(){
    return state.routines.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('');
  }
  function programNext(p){
    if(p.mode==='cycle')return p.routineIds[p.nextIndex];
    return p.weekdays[String(new Date().getDay())]||null;
  }
  function programStarts(){
    return state.programs.filter(p=>p.active).map(p=>{
      const rid=programNext(p),routine=state.routines.find(r=>r.id===rid);
      return '<div class="fi-list-row"><div><b>'+esc(p.name)+'</b><small>'+esc(p.mode==='cycle'?'순환형':'요일 고정형')+' · '+(routine?esc(routine.name):'오늘 지정된 루틴 없음')+'</small></div>'+
        (rid?button('begin-program-routine','시작','primary','data-id="'+esc(p.id)+'"'):'')+'</div>';
    }).join('');
  }
  function builderRows(){
    return draft.exercises.map((ex,i)=>'<div class="fi-builder-ex" data-fi-ex="'+esc(ex.id)+'">'+
      '<div class="fi-builder-ex-title fi-picker-ex-title"><span>EXERCISE '+(i+1)+'</span><div class="fi-exercise-name"><b>'+esc(ex.name)+'</b><small>'+esc(W.catalog.find(c=>c.name===ex.name)?.group||'직접 입력한 종목')+'</small></div>'+
      button('replace-builder-ex','종목 바꾸기','outline','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+' 종목 바꾸기"')+
      '<button type="button" class="fi-icon" data-fi-action="remove-ex" data-id="'+esc(ex.id)+'" aria-label="종목 삭제">×</button></div>'+
      '<div class="fi-builder-head"><span>SET</span><span>목표 kg</span><span>횟수</span><span>휴식초</span><span></span></div>'+
      ex.sets.map((s,j)=>'<div class="fi-builder-set" data-fi-set="'+esc(s.id)+'"><strong>'+(j+1)+'</strong>'+
      '<input type="number" inputmode="decimal" min="0" max="2000" step="0.5" value="'+s.weight+'" data-fi-weight aria-label="목표 중량">'+
      '<input type="number" inputmode="numeric" min="1" max="1000" step="1" value="'+s.reps+'" data-fi-reps aria-label="목표 횟수">'+
      '<input type="number" inputmode="numeric" min="0" max="600" step="15" value="'+s.restSec+'" data-fi-rest aria-label="휴식 초">'+
      '<button type="button" class="fi-icon" data-fi-action="remove-builder-set" data-ex="'+esc(ex.id)+'" data-id="'+esc(s.id)+'" aria-label="세트 삭제">×</button></div>').join('')+
      '<div class="fi-inline-actions">'+button('add-builder-set','＋ 세트 추가','outline','data-id="'+esc(ex.id)+'"')+'</div></div>').join('');
  }
  function builder(){
    if(!draft)resetDraft();
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">PROGRAM BUILDER / ROUTINE</span><h2>'+ (editingRoutine?'루틴 수정':'새 루틴 제작')+'</h2></div>'+
      button('routine-list','← 루틴 목록','outline')+'</div><div class="fi-panel"><label class="fi-label" for="fi-routine-name">루틴 이름</label>'+
      '<input class="fi-text-input" id="fi-routine-name" maxlength="100" placeholder="예: 가슴 · 삼두" value="'+esc(draft.name)+'">'+
      '<p class="fi-note">루틴은 목표 계획만 저장합니다. 과거 실제 운동 기록과 완료 여부는 변경하지 않습니다.</p></div>'+
      '<div class="fi-builder-exercises">'+(draft.exercises.length?builderRows():'<div class="fi-panel fi-hub-empty"><h3>루틴에 넣을 종목을 골라 주세요.</h3><p>검색, 부위별 필터와 즐겨찾기를 사용할 수 있습니다.</p></div>')+'</div>'+
      '<div class="fi-picker-add"><div><b>'+draft.exercises.length+' / 30종목</b><p>여러 종목을 선택해 한 번에 추가하세요.</p></div>'+
      button('add-builder-ex','＋ 종목 선택','outline',draft.exercises.length>=30?'disabled':'')+'</div>'+
      '<div class="fi-sticky-actions">'+button('save-routine','루틴 저장','primary',draft.exercises.length?'':'disabled')+button('routine-list','취소','outline')+'</div></section>';
  }
  function resetDraft(id){
    const existing=id?state.routines.find(r=>r.id===id):null;
    editingRoutine=existing?.id||null;
    draft=existing?M.copy(existing):{name:'새 웨이트 루틴',exercises:[]};
    draftBaseline=JSON.stringify(draft);
  }
  function readDraft(){
    if(!draft)return;
    const name=host.querySelector('#fi-routine-name');
    if(name)draft.name=name.value;
    host.querySelectorAll('[data-fi-ex]').forEach(block=>{
      const ex=draft.exercises.find(x=>x.id===block.dataset.fiEx);
      if(!ex)return;
      block.querySelectorAll('[data-fi-set]').forEach(row=>{
        const set=ex.sets.find(s=>s.id===row.dataset.fiSet);
        if(!set)return;
        for(const [key,selector] of [['weight','[data-fi-weight]'],['reps','[data-fi-reps]'],['restSec','[data-fi-rest]']]){
          const input=row.querySelector(selector);
          if(input)set[key]=input.value===''?'':Number(input.value);
        }
      });
    });
  }
  function programBuilder(){
    if(!programDraft){
      programDraft={name:'새 훈련 프로그램',mode:'cycle',selected:state.routines.map(x=>x.id).slice(0,3),weekdays:{}};
      programBaseline=JSON.stringify(programDraft);
    }
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">TRAINING PROGRAM</span><h2>새 프로그램 만들기</h2></div>'+
      button('program-list','뒤로','outline')+'</div><div class="fi-panel"><label class="fi-label">프로그램 이름</label><input id="fi-program-name" class="fi-text-input" maxlength="100" value="'+esc(programDraft.name)+'">'+
      '<div class="fi-mode-row"><label><input type="radio" name="fi-mode" value="cycle" '+(programDraft.mode==='cycle'?'checked':'')+'> 순환형</label>'+
      '<label><input type="radio" name="fi-mode" value="fixed" '+(programDraft.mode==='fixed'?'checked':'')+'> 요일 고정형</label></div>'+
      '<h3>포함할 루틴과 순서</h3><p class="fi-note">순환형은 이 목록 순서대로 완료 시 다음 루틴으로 이동합니다.</p>'+
      state.routines.map(r=>'<label class="fi-program-check"><input type="checkbox" data-fi-program-routine="'+esc(r.id)+'" '+(programDraft.selected.includes(r.id)?'checked':'')+'>'+esc(r.name)+'</label>').join('')+
      (programDraft.mode==='fixed'?'<h3>요일별 루틴 배치</h3>'+Array.from({length:7},(_,i)=>i).map(day=>
      '<label class="fi-day-picker">'+weekdays[day]+'요일 <select data-fi-weekday="'+day+'"><option value="">운동 없음</option>'+
      state.routines.map(r=>'<option value="'+esc(r.id)+'" '+(programDraft.weekdays[day]===r.id?'selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select></label>').join(''):'')+
      '</div><div class="fi-sticky-actions">'+button('save-program','프로그램 저장')+button('program-list','취소','outline')+'</div></section>';
  }
  function programs(){
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">TRAINING PROGRAMS</span><h2>프로그램 관리</h2></div>'+
      button('new-program','＋ 프로그램','primary')+'</div><p class="fi-note">요일 고정형과 순환형을 모두 지원합니다. 자유 운동은 프로그램 순서를 변경하지 않습니다.</p>'+
      (state.programs.length?state.programs.map(p=>{
        const rid=programNext(p),r=state.routines.find(x=>x.id===rid);
        return '<div class="fi-panel"><div class="fi-section-head"><h3>'+esc(p.name)+'</h3><span>'+ (p.mode==='cycle'?'순환형':'요일 고정형')+'</span></div>'+
        '<p>'+p.routineIds.map(id=>state.routines.find(x=>x.id===id)?.name||'삭제된 루틴').map(esc).join(' → ')+'</p>'+
        '<p class="fi-note">다음 운동: '+(r?esc(r.name):'오늘 배정 없음')+'</p>'+
        (r?button('begin-program-routine','이 프로그램으로 운동 시작','primary','data-id="'+esc(p.id)+'"'):'')+'</div>';
      }).join(''):'<div class="fi-panel fi-empty">저장된 프로그램이 없습니다. 먼저 루틴을 만든 뒤 프로그램을 구성하세요.</div>')+
      '<div class="fi-panel"><h3>루틴 보관함</h3>'+state.routines.map(r=>'<div class="fi-list-row"><div><b>'+esc(r.name)+'</b><small>'+r.exercises.length+'종목</small></div>'+
      button('edit-routine','편집','outline','data-id="'+esc(r.id)+'"')+'</div>').join('')+'</div></section>';
  }
  const duration=s=>{
    const active=s.status==='ACTIVE'&&s.activeSince?Math.max(0,(backgroundStoppedAt??Date.now())-Date.parse(s.activeSince)):0;
    return Math.floor((s.activeMs+active)/1000);
  };
  const timeLabel=n=>String(Math.floor(n/3600)).padStart(2,'0')+':'+String(Math.floor((n%3600)/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const sessionButton=(action,label,classes='',attrs='')=>'<button type="button" class="'+classes+'" data-fi-action="'+action+'" '+attrs+'>'+label+'</button>';
  const restLabel=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
  const mainSetCount=s=>s.exercises.reduce((n,ex)=>n+ex.sets.filter(set=>set.done&&!set.warmup).length,0);
  const finishedExerciseCount=s=>s.exercises.filter(ex=>{const sets=ex.sets.filter(set=>!set.warmup);return sets.length&&sets.every(set=>set.done);}).length;
  function previousExercise(name,sessionId){
    // Finalized history cannot change during this workout; explicit reload invalidates this cache.
    if(previousCacheSession!==sessionId){previousCacheSession=sessionId;previousCache.clear();}
    if(!previousCache.has(name))previousCache.set(name,M.getPreviousExercise(state,name,sessionId));
    return previousCache.get(name);
  }
  function sessionExercise(ex,index,s){
    const enabled=s.status==='ACTIVE',disabled=enabled?'':'disabled';
    const media=root.FormdayExerciseMedia?.byName?.[ex.name];
    const previous=previousExercise(ex.name,s.id);
    const previousSet=previous?.exercise.sets.filter(set=>set.done&&!set.warmup).at(-1);
    const allDone=ex.sets.every(set=>set.done),hasDone=ex.sets.some(set=>set.done);
    const nextSet=ex.sets.find(set=>!set.done)||ex.sets.at(-1);
    let workIndex=0;
    return '<article class="fs-exercise" data-fi-ex="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+'">'+
      '<div class="fs-ex-head"><div class="fs-art">'+(media?'<img src="'+esc(media.src)+'" alt="'+esc(media.alt)+'" width="96" height="112" loading="lazy">':'<span>이미지<br>준비 중</span>')+'</div>'+
      '<div class="fs-ex-title"><span class="fs-ex-order">EXERCISE '+String(index+1).padStart(2,'0')+'</span><h3>'+esc(ex.name)+'</h3><div class="fs-ex-meta">'+
      sessionButton('rest-exercise','◷ 휴식 '+restLabel(nextSet.restSec),'','data-id="'+esc(ex.id)+'" '+disabled)+
      '<span>'+(previousSet?'이전 '+esc(previous.date.slice(5).replace('-','.'))+' · '+fmt(previousSet.weight)+'kg × '+previousSet.reps+'회':previous?'이전 워밍업 기록 있음':'이전 기록 없음')+'</span></div></div>'+
      '<div class="fs-ex-actions">'+sessionButton('replace-session-ex','⇄','fs-icon','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+' 종목 교체" title="'+(hasDone?'완료 체크를 해제한 뒤 교체할 수 있습니다':'종목 교체')+'" '+(enabled&&!hasDone?'':'disabled'))+'</div></div>'+
      '<label class="sr-only" for="note-'+esc(ex.id)+'">'+esc(ex.name)+' 메모</label><input id="note-'+esc(ex.id)+'" class="fs-ex-note" data-fi-ex-note="'+esc(ex.id)+'" maxlength="2000" placeholder="이 종목의 메모를 남겨보세요" value="'+esc(ex.notes)+'" '+disabled+'>'+
      '<div class="fs-set-tools"><div class="fs-stepper">'+
      sessionButton('remove-session-set','−','','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+' 마지막 세트 삭제" '+(enabled&&ex.sets.length>1&&!ex.sets.at(-1).done?'':'disabled'))+
      '<span>'+ex.sets.length+' 세트</span>'+sessionButton('add-session-set','＋','','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+' 세트 추가" '+(enabled&&ex.sets.length<50?'':'disabled'))+'</div>'+
      sessionButton('load-previous','불러오기','fs-load','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+' 이전 기록 불러오기" title="'+(hasDone?'완료 체크를 해제한 뒤 불러올 수 있습니다':previous?'최근 완료 기록을 불러옵니다':'불러올 이전 완료 기록이 없습니다')+'" '+(enabled&&!hasDone&&previous?'':'disabled'))+
      sessionButton('complete-exercise','✓✓','fs-all-done','data-id="'+esc(ex.id)+'" aria-label="'+esc(ex.name)+(allDone?' 전체 완료 해제':' 전체 세트 완료')+'" aria-pressed="'+allDone+'" '+disabled)+'</div>'+
      '<div class="fs-columns" aria-hidden="true"><span>세트</span><span>중량</span><span>횟수</span><span>완료</span></div>'+
      ex.sets.map((set,j)=>{
        const count=set.warmup?'W':++workIndex;
        return '<div class="fs-set-wrap" data-fi-set="'+esc(set.id)+'" data-fi-exid="'+esc(ex.id)+'"><div class="fs-set" data-done="'+set.done+'">'+
          sessionButton('toggle-warmup',count,'fs-set-number'+(set.warmup?' fs-warmup':''),'data-ex="'+esc(ex.id)+'" data-id="'+esc(set.id)+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 '+(set.warmup?'본세트로 변경':'워밍업으로 변경')+'" aria-pressed="'+set.warmup+'" '+disabled)+
          '<label class="fs-number"><input type="number" inputmode="decimal" data-fi-kg min="0" max="2000" step="any" value="'+set.weight+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 중량" '+disabled+'><span>kg</span></label>'+
          '<label class="fs-number"><input type="number" inputmode="numeric" data-fi-reps min="1" max="1000" step="1" value="'+set.reps+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 횟수" '+disabled+'><span>회</span></label>'+
          sessionButton('save-session-set','✓','fs-check','data-ex="'+esc(ex.id)+'" data-id="'+esc(set.id)+'" data-done="'+set.done+'" aria-pressed="'+set.done+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 '+(set.done?'완료 해제':'완료')+'" '+disabled)+'</div>'+
          '<details class="fs-set-details"><summary>'+ (j+1)+'세트 상세 <span>휴식 '+restLabel(set.restSec)+(set.rpe?' · RPE '+set.rpe:'')+'</span></summary><div>'+
          '<label>휴식(초)<input type="number" inputmode="numeric" data-fi-rest min="0" max="600" step="1" value="'+set.restSec+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 휴식 시간" '+disabled+'></label>'+
          '<label>RPE <small>선택 · 1–10</small><input type="number" inputmode="decimal" data-fi-rpe min="1" max="10" step="0.5" placeholder="—" value="'+(set.rpe??'')+'" aria-label="'+esc(ex.name)+' '+(j+1)+'세트 RPE" '+disabled+'></label></div></details></div>';
      }).join('')+'</article>';
  }
  function sessionView(){
    const s=current();
    if(!s)return home();
    const result=summary(s),enabled=s.status==='ACTIVE';
    const finishedExercises=finishedExerciseCount(s);
    sessionExerciseIndex=Math.min(sessionExerciseIndex,s.exercises.length-1);
    const shown=sessionViewMode==='one'?[[s.exercises[sessionExerciseIndex],sessionExerciseIndex]]:s.exercises.map((ex,i)=>[ex,i]);
    return '<section class="fs-session" aria-label="진행 중인 운동"><header class="fs-top"><div class="fs-top-row">'+
      sessionButton('minimize-session','⌄','fs-icon fs-back','aria-label="운동 화면 접기"')+
      sessionButton(enabled?'pause':'resume','<span id="fi-duration">'+timeLabel(duration(s))+'</span><span aria-hidden="true">'+(enabled?'Ⅱ':'▶')+'</span>','fs-clock','aria-label="'+(enabled?'운동 일시정지':'운동 재개')+'"')+
      sessionButton('finish','완료','fs-finish')+'</div><div class="fs-metrics"><div><span>운동량</span><strong><span id="fi-session-volume">'+fmt(result.volume)+'</span> <small>kg</small></strong></div><div><span>완료 본세트</span><strong><span id="fi-session-sets">'+mainSetCount(s)+'</span> <small>세트</small></strong></div><div><span>완료 종목</span><strong><span id="fi-session-exercises">'+finishedExercises+'</span> <small>/ '+s.exercises.length+'</small></strong></div></div></header>'+
      '<div class="fs-body"><div id="fi-banner" class="'+(error?'fi-msg-error':'')+'" '+(!message?'hidden':'')+' role="status">'+esc(message)+'</div>'+
      sessionButton('reload','다른 탭의 최신 기록 불러오기','fi-btn fi-outline','id="fi-session-reload" '+(revisionConflict?'':'hidden'))+
      (!enabled?'<div class="fs-pause-note"><b>'+(s.status==='SAVED'?'임시 보관한 운동':'운동을 잠시 멈췄습니다')+'</b><span>상단의 재생 버튼을 누르면 이어서 기록할 수 있습니다.</span></div>':'')+
      (Date.now()-Date.parse(s.lastSavedAt)>=TIME_LIMIT_MS?'<div class="fi-alert">마지막 저장 이후 24시간이 지났습니다. 이어서 진행하거나 여기까지 완료할 수 있습니다.</div>':'')+
      '<div class="fs-heading"><span class="fi-kicker">TODAY’S TRAINING · '+esc(s.date)+'</span><h2>'+esc(s.label)+'</h2><label class="sr-only" for="fi-session-note">오늘의 운동 메모</label><textarea id="fi-session-note" class="fs-note-input" rows="2" maxlength="4000" placeholder="오늘의 컨디션이나 메모를 남겨보세요" '+(enabled?'':'disabled')+'>'+esc(s.notes)+'</textarea><span id="fi-session-save-state" class="fs-save-state">기기에 저장됨</span></div>'+
      sessionButton('toggle-session-view',sessionViewMode==='all'?'▤ 한 종목씩 보기':'☷ 모든 종목 보기','fs-view-switch','aria-pressed="'+(sessionViewMode==='one')+'"')+
      (sessionViewMode==='one'?'<nav class="fs-focus-nav" aria-label="현재 운동 종목">'+sessionButton('session-prev','← 이전','','aria-label="이전 운동 종목" '+(sessionExerciseIndex===0?'disabled':''))+'<span>'+(sessionExerciseIndex+1)+' / '+s.exercises.length+'</span>'+sessionButton('session-next','다음 →','','aria-label="다음 운동 종목" '+(sessionExerciseIndex===s.exercises.length-1?'disabled':''))+'</nav>':'')+
      '<div class="fs-exercises">'+shown.map(([ex,i])=>sessionExercise(ex,i,s)).join('')+'</div>'+
      '<p class="fs-footer-note">세트 번호를 누르면 워밍업(W)으로 바뀝니다. 운동량과 완료 본세트에는 완료한 본세트만 반영됩니다.</p>'+
      '<details class="fs-session-actions"><summary>운동 관리</summary><div class="fi-inline-actions">'+
      (s.status!=='SAVED'?button('stash','나중에 이어하기','outline'):'')+button('partial','여기까지 부분 완료','outline')+button('cancel-session','이 운동 취소','danger')+'</div><p>완료하면 기록에 저장됩니다. 운동 중의 종목·세트 변경은 원래 루틴에 영향을 주지 않습니다.</p></details>'+
      '<a class="fs-credits" href="exercise-credits.html" target="_blank" rel="noopener">운동 이미지 출처</a></div>'+
      '<div class="fs-dock"><div class="fs-rest" '+(timerVisible?'':'hidden')+' role="group" aria-label="휴식 타이머"><div><span id="fi-timer-label">휴식</span><strong id="fi-timer-number">'+restLabel(Math.ceil(timerSecs))+'</strong></div>'+sessionButton('timer-toggle',timerEnd?'Ⅱ':'▶','fs-icon','id="fi-timer-toggle" aria-label="휴식 타이머 '+(timerEnd?'일시정지':'시작')+'" '+(enabled?'':'disabled'))+sessionButton('timer-add','+15초','','aria-label="휴식 15초 추가" '+(enabled?'':'disabled'))+sessionButton('timer-skip','닫기','','aria-label="휴식 타이머 닫기"')+'</div>'+
      sessionButton('add-session-ex','<span aria-hidden="true">＋</span> 종목 추가','fs-add',enabled&&s.exercises.length<30?'':'disabled')+'</div></section>';
  }
  function historyView(){
    const records=completed().slice().sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
    const selected=records.find(x=>x.id===focusedSession);
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">WORKOUT HISTORY</span><h2>확정된 운동 기록</h2></div>'+
      button('back-home','웨이트 홈','outline')+'</div>'+
      '<div class="fi-panel">'+(records.length?records.map(s=>recordCard(s)).join(''):'<p class="fi-empty">완료된 운동 세션이 없습니다.</p>')+'</div>'+
      (selected?'<div class="fi-panel"><div class="fi-section-head"><h3>'+esc(selected.label)+'</h3><span>'+ (selected.status==='PARTIAL'?'부분 완료':'정상 완료')+'</span></div>'+
      '<p class="fi-note">'+esc(selected.date)+' · 운동 '+timeLabel(Math.floor(selected.activeMs/1000))+'</p>'+
      (selected.notes?'<p class="fi-history-note">'+esc(selected.notes)+'</p>':'')+
      selected.exercises.map(ex=>'<div class="fi-history-ex"><b>'+esc(ex.name)+'</b><small>'+(ex.sets.filter(s=>s.done).map(s=>fmt(s.weight)+'kg × '+s.reps+'회'+(s.warmup?' (워밍업)':'')).join(' · ')||'완료 세트 없음')+'</small>'+(ex.notes?'<p class="fi-history-note">'+esc(ex.notes)+'</p>':'')+'</div>').join('')+
      '<p class="fi-note">이 화면에서는 확정 기록이 읽기 전용입니다. 루틴을 변경해도 이 기록은 유지됩니다.</p>'+
      '<div class="fi-inline-actions">'+button('save-from-history','새 루틴으로 저장','outline','data-id="'+esc(selected.id)+'"')+
      (state.routines.length?'<select id="fi-apply-routine">'+routineOptions()+'</select>'+button('apply-from-history','기존 루틴 반영','outline','data-id="'+esc(selected.id)+'"'):'')+'</div></div>':'')+'</section>';
  }
  function backupActions(){
    return '<div class="fi-panel fi-backup"><h3>독립 웨이트 기록 백업</h3><p class="fi-note">웨이트 독립 저장소는 기존 캘린더 기록과 별개입니다. 각각 백업해야 합니다.</p>'+
      '<div class="fi-inline-actions">'+button('export','IRON MODE JSON 내보내기','outline')+
      '<label class="fi-import">백업 파일 가져오기<input id="fi-import-file" type="file" accept=".json,application/json"></label></div>'+
      '<p class="fi-note">기기에 저장된 기록은 상단 「기기 동기화」에서 다른 기기와 연결할 수 있습니다. JSON 파일은 별도로 보관할 수 있는 백업입니다.</p></div>';
  }
  function renderCalendar(){
    if(!calendar||!state)return;
    const selected=root.FormdayBridge?.getSelectedDay?.()||iso(new Date());
    const s=completed().filter(x=>x.date===selected);
    calendar.innerHTML=s.length?'<div class="fi-calendar-head"><b>IRON MODE · 확정 웨이트</b><small>'+s.length+'건</small></div>'+s.map(x=>recordCard(x,true)).join(''):'';
    calendar.hidden=!s.length;
  }
  function render(){
    renderCalendar();
    if(!host)return;
    if(document.body.dataset.fdScreen!=='independent')return;
    top();
    document.body.classList?.remove('fs-keyboard');
    document.body.dataset.fiSession=String(screen==='session'&&!!current()&&!blocked);
    if(blocked||!state){
      host.innerHTML=hubNav()+'<div class="fi-panel fi-alert" role="alert"><h3>운동 기록을 불러오지 못했습니다.</h3><p>'+esc(blocked||'알 수 없는 오류')+'</p>'+
      '<p>기록을 확인하기 전까지 새 운동 저장을 중단했습니다. 원본 데이터는 유지됩니다.</p>'+button('reload','기록 다시 확인','outline')+'</div>';
      return;
    }
    if(screen==='session'&&current()){
      host.innerHTML=sessionView();paintTimer();return;
    }
    host.innerHTML=hubNav()+'<div id="fi-banner" class="'+(error?'fi-msg-error':'')+'" '+(!message?'hidden':'')+' role="status">'+esc(message)+'</div>'+
      (revisionConflict?button('reload','다른 탭의 최신 기록 불러오기','outline'):'')+
      (screen==='home'?home():screen==='routines'?routines():screen==='builder'?builder():screen==='programs'?programs():screen==='programBuilder'?programBuilder():screen==='session'?sessionView():screen==='history'?historyView():home())+
      backupActions();
    if(screen==='session')paintTimer();
  }
  function readProgram(){
    if(!programDraft)return;
    const name=host.querySelector('#fi-program-name');
    if(name)programDraft.name=name.value;
    const selected=Array.from(host.querySelectorAll('[data-fi-program-routine]')).filter(x=>x.checked).map(x=>x.dataset.fiProgramRoutine);
    programDraft.selected=selected;
    host.querySelectorAll('[data-fi-weekday]').forEach(el=>{
      if(el.value)programDraft.weekdays[el.dataset.fiWeekday]=el.value;
      else delete programDraft.weekdays[el.dataset.fiWeekday];
    });
    const mode=host.querySelector('input[name=fi-mode]:checked')?.value;
    if(mode)programDraft.mode=mode;
  }
  function doStart(routineId=null,programId=null,exerciseNames=null,fromPicker=false){
    if(!fromPicker&&!beforeNavigate())return false;
    if(active()){setMessage('기존에 진행 중인 운동이 있습니다. 이어하기 또는 확정 후 새 운동을 시작하세요.',true);go('session');return false;}
    const result=changed(()=>M.start(state,{routineId,programId,exerciseNames}),'새 운동을 시작했습니다. 실제 세트 기록만 완료 처리하세요.');
    if(result){resetRest();backgroundStoppedAt=null;sessionDirty=false;sessionExerciseIndex=0;go('session');}
    return result;
  }
  function selectedNames(names,limit){
    if(!Array.isArray(names)||names.length<1||names.length>limit)throw Error('선택할 운동 종목 수를 확인해 주세요.');
    if(new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||!W.catalog.some(ex=>ex.name===name)))throw Error('운동 목록에서 종목을 다시 선택해 주세요.');
    return names;
  }
  function selectExercises({title,multiple=true,limit=30,onConfirm}){
    try{
      editable();
      if(limit<1)throw Error('종목은 최대 30개까지 추가할 수 있습니다.');
      const picker=root.FormdayExercisePicker;
      if(!picker||typeof picker.open!=='function')throw Error('종목 선택창을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
      if(pickerOpen||picker.isOpen?.())throw Error('이미 열려 있는 종목 선택창을 먼저 확인해 주세요.');
      if(screen==='builder')readDraft();
      pickerOpen=true;
      const opened=picker.open({title,multiple,limit,
        getFavorites:()=>state?.favoriteExercises||[],
        onFavoriteChange:(name,selected)=>{
          try{selectedNames([name],1);return changed(()=>M.toggleFavorite(state,name,selected),selected?'즐겨찾기에 저장했습니다.':'즐겨찾기에서 해제했습니다.',false);}
          catch(e){setMessage(e.message,true);paintMessage();return false;}
        },
        onConfirm:names=>{
          try{editable();return onConfirm(selectedNames(names,limit))===true;}
          catch(e){setMessage(e.message,true);paintMessage();return false;}
        },
        onClose:({reason}={})=>{pickerOpen=false;if(reason==='confirmed')render();else paintMessage();}
      });
      if(opened===false){pickerOpen=false;throw Error('종목 선택창을 열지 못했습니다. 다시 시도해 주세요.');}
      return true;
    }catch(e){pickerOpen=false;setMessage(e.message,true);paintMessage();return false;}
  }
  function pickRoutineExercises(replaceId=null){
    if(!draft||screen!=='builder')throw Error('먼저 루틴 편집 화면을 열어 주세요.');
    readDraft();
    const target=draft;
    return selectExercises({title:replaceId?'바꿀 운동 종목 선택':'루틴에 추가할 종목 선택',multiple:!replaceId,
      limit:replaceId?1:30-draft.exercises.length,
      onConfirm:names=>{
        if(draft!==target||screen!=='builder')throw Error('루틴 편집 상태가 바뀌었습니다. 선택창을 닫고 다시 확인해 주세요.');
        let exercises;
        if(replaceId){
          if(!draft.exercises.some(ex=>ex.id===replaceId))throw Error('교체할 운동 종목을 찾지 못했습니다.');
          exercises=draft.exercises.map(ex=>ex.id===replaceId?{...ex,name:names[0]}:ex);
        }else{
          if(draft.exercises.length+names.length>30)throw Error('루틴 종목은 최대 30개입니다.');
          exercises=[...draft.exercises,...names.map(name=>M.newExercise(name))];
        }
        draft={...draft,exercises};
        setMessage(replaceId?'종목을 바꿨습니다. 루틴 저장을 누르면 반영됩니다.':names.length+'개 종목을 추가했습니다. 루틴 저장을 누르면 반영됩니다.');
        render();return true;
      }
    });
  }
  function pickSessionExercises(){
    const session=current();
    if(!session||session.status!=='ACTIVE')throw Error('운동을 재개한 뒤 종목을 추가해 주세요.');
    if(!saveSessionInputs())return false;
    return selectExercises({title:'이번 운동에 추가할 종목 선택',limit:30-session.exercises.length,onConfirm:names=>{
      if(current()?.id!==session.id||current()?.status!=='ACTIVE')throw Error('운동 상태가 바뀌었습니다. 선택창을 닫고 운동을 재개해 주세요.');
      return changed(()=>M.addExercises(state,session.id,names),names.length+'개 운동 종목을 추가했습니다.',false);
    }});
  }
  function sessionNumber(row,selector,label,optional=false){
    const field=row.querySelector(selector);
    if(!field)return undefined;
    const text=String(field.value??'').trim();
    if(optional&&text==='')return null;
    if(text==='')throw Error(label+'을 입력해 주세요.');
    const value=Number(text);
    if(!Number.isFinite(value))throw Error(label+'은 숫자로 입력해 주세요.');
    return value;
  }
  function saveSessionInputs(overrides=[],success=''){
    const session=current();
    if(screen!=='session'||!session)return true;
    if(session.status!=='ACTIVE')return !sessionDirty;
    try{
      editable();
      const patch={},exercises=new Map();
      const note=host.querySelector('#fi-session-note');
      if(note&&note.value!==session.notes)patch.notes=note.value;
      const forExercise=id=>{
        if(!exercises.has(id))exercises.set(id,{id,sets:[]});
        return exercises.get(id);
      };
      host.querySelectorAll('[data-fi-ex-note]').forEach(field=>{
        const ex=session.exercises.find(ex=>ex.id===field.dataset.fiExNote);
        if(!ex)throw Error('메모를 저장할 종목을 찾지 못했습니다.');
        if(field.value!==ex.notes)forExercise(ex.id).notes=field.value;
      });
      host.querySelectorAll('[data-fi-set]').forEach(row=>{
        const ex=session.exercises.find(ex=>ex.id===row.dataset.fiExid);
        const previous=ex?.sets.find(set=>set.id===row.dataset.fiSet);
        if(!previous)throw Error('입력한 세트를 찾지 못했습니다.');
        const values={weight:sessionNumber(row,'[data-fi-kg]','중량'),reps:sessionNumber(row,'[data-fi-reps]','횟수'),
          rpe:sessionNumber(row,'[data-fi-rpe]','RPE',true),restSec:sessionNumber(row,'[data-fi-rest]','휴식 시간')};
        const updated={id:previous.id};
        for(const key of Object.keys(values))if(values[key]!==undefined&&values[key]!==previous[key])updated[key]=values[key];
        if(Object.keys(updated).length>1)forExercise(ex.id).sets.push(updated);
      });
      for(const {exid,setid,values} of overrides){
        const patchEx=forExercise(exid);
        let patchSet=patchEx.sets.find(set=>set.id===setid);
        if(!patchSet){patchSet={id:setid};patchEx.sets.push(patchSet);}
        Object.assign(patchSet,values);
      }
      if(exercises.size)patch.exercises=Array.from(exercises.values()).map(ex=>{
        if(!ex.sets.length)delete ex.sets;
        return ex;
      });
      const recovering=backgroundStoppedAt!==null;
      let base=state;
      if(recovering){
        base=M.changeState(base,session.id,'pause',new Date(backgroundStoppedAt)).next;
        base=M.changeState(base,session.id,'resume').next;
      }
      if(Object.keys(patch).length||recovering){
        if(!commit(M.updateSession(base,session.id,patch),success,false))return false;
      }
      if(recovering){backgroundStoppedAt=null;resumeRest();}
      sessionDirty=false;
      if(success)setMessage(success,false);else if(error)setMessage('입력한 기록을 저장했습니다.',false);
      paintMessage();paintSessionMetrics();return true;
    }catch(e){
      setMessage('저장하지 못했습니다. 입력값을 유지합니다. '+e.message,true);
      if(/다른 탭/.test(e.message))revisionConflict=true;
      paintMessage();return false;
    }
  }
  function startRest(seconds){
    timerSecs=seconds;timerVisible=seconds>0;timerEnd=seconds>0?Date.now()+seconds*1000:0;timerAutoPaused=false;
  }
  function pauseRest(){
    if(timerEnd){timerSecs=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));timerEnd=0;timerAutoPaused=timerSecs>0;}
  }
  function resumeRest(){
    if(timerVisible&&timerAutoPaused&&timerSecs>0)timerEnd=Date.now()+timerSecs*1000;
    timerAutoPaused=false;
  }
  function resetRest(){timerEnd=0;timerSecs=90;timerVisible=false;timerAutoPaused=false;}
  function sessionSet(button){
    const row=button.closest?.('[data-fi-set]'),session=current();
    if(!session||session.status!=='ACTIVE')return;
    const exid=row?.dataset.fiExid||button.dataset.ex,setid=row?.dataset.fiSet||button.dataset.id;
    const previous=session.exercises.find(ex=>ex.id===exid)?.sets.find(set=>set.id===setid);
    if(!previous)return;
    if(saveSessionInputs([{exid,setid,values:{done:!previous.done}}],previous.done?'세트 완료를 해제했습니다.':'세트를 완료했습니다.')){
      const saved=current().exercises.find(ex=>ex.id===exid).sets.find(set=>set.id===setid);
      if(saved.done)startRest(saved.restSec);
      render();
    }
  }
  function replaceSessionExercise(id){
    const session=current(),ex=session?.exercises.find(ex=>ex.id===id);
    if(!ex||session.status!=='ACTIVE'||ex.sets.some(set=>set.done))throw Error('완료 체크를 해제한 뒤 종목을 교체해 주세요.');
    if(!saveSessionInputs())return false;
    if(!root.confirm('이 종목을 바꾸면 현재 종목의 세트 입력과 메모가 새 종목의 기본값으로 바뀝니다. 교체할까요?'))return false;
    return selectExercises({title:'교체할 운동 종목 선택',multiple:false,limit:1,onConfirm:names=>{
      if(current()?.id!==session.id)throw Error('진행 중인 운동이 변경되었습니다.');
      return changed(()=>M.replaceExercise(state,session.id,id,names[0]),'종목을 교체했습니다.',false);
    }});
  }
  function finish(kind){
    if(!saveSessionInputs())return;
    const s=current();if(!s)return;
    const done=summary(s).completedSets;
    if(!done){setMessage('완료한 세트가 없습니다. 먼저 기록하거나 임시 보관해 주세요.',true);render();return;}
    if(!root.confirm((kind==='PARTIAL'?'부분 완료':'운동 완료')+'로 확정할까요? 완료한 '+done+'세트만 반영하며, 이후 같은 세션을 이어할 수 없습니다.'))return;
    if(changed(()=>M.finish(state,s.id,kind),'운동 기록을 확정했습니다. 캘린더에도 표시됩니다.')){
      resetRest();backgroundStoppedAt=null;sessionDirty=false;focusedSession=s.id;go('history');
      if(kind==='COMPLETED'&&root.confirm('이번 운동 구성을 새 루틴으로 저장할까요? (선택하지 않아도 운동 기록은 유지됩니다.)')){
        saveFromHistory(s.id);
      }
    }
  }
  function cancelSession(){
    const s=current();if(!s)return;
    const done=summary(s).completedSets;
    const detail=done?'이 운동에 저장한 완료 세트 '+done+'개를 포함해 미완료 운동 기록을 삭제합니다. 기록을 남기려면 「부분 완료」를 선택하세요.':
      '완료 세트가 없는 이 운동을 삭제하고 새 운동을 시작할 수 있습니다.';
    if(!root.confirm('현재 운동을 취소할까요? '+detail+' 저장된 루틴, 프로그램 순서, 이전 확정 기록은 유지됩니다.'))return;
    if(changed(()=>M.cancel(state,s.id),'진행 중이던 운동을 취소했습니다. 새 운동을 시작할 수 있습니다.')){
      resetRest();backgroundStoppedAt=null;sessionDirty=false;focusedSession=null;go('home');
    }
  }
  function routineFromSession(sessionId){
    const src=state.sessions.find(x=>x.id===sessionId&&['COMPLETED','PARTIAL'].includes(x.status));
    if(!src)throw Error('확정된 운동을 찾지 못했습니다.');
    return {src,exercises:src.exercises.map(ex=>({...ex,id:M.uid(),sets:ex.sets.map(s=>{
      const {done,...values}=s;return {...values,id:M.uid()};
    })}))};
  }
  function saveFromHistory(id){
    try{
      const {src,exercises}=routineFromSession(id);
      const name=root.prompt('새 루틴의 이름을 입력하세요.',src.label);
      if(name===null)return;
      changed(()=>M.createRoutine(state,name,exercises),'실제 운동을 기반으로 새 목표 루틴을 저장했습니다. 과거 기록은 유지됩니다.');
    }catch(e){setMessage(e.message,true);render();}
  }
  function applyFromHistory(id){
    try{
      const {src,exercises}=routineFromSession(id);
      const rid=host.querySelector('#fi-apply-routine')?.value;
      const target=state.routines.find(x=>x.id===rid);
      if(!target)return;
      if(!root.confirm('기존 루틴 「'+target.name+'」의 목표 구성을 이번 실제 기록으로 교체할까요? 과거 세션은 변경되지 않습니다.'))return;
      changed(()=>M.updateRoutine(state,rid,target.name,exercises),'향후 사용할 루틴 목표를 변경했습니다.');
    }catch(e){setMessage(e.message,true);render();}
  }
  function paintTimer(){
    if(screen!=='session')return;
    const ticker=host.querySelector('#fi-timer-number'),dur=host.querySelector('#fi-duration');
    if(timerEnd&&Date.now()>=timerEnd){timerSecs=0;timerEnd=0;}
    const remaining=timerEnd?Math.max(0,Math.ceil((timerEnd-Date.now())/1000)):timerSecs;
    if(ticker)ticker.textContent=restLabel(remaining);
    if(dur&&current())dur.textContent=timeLabel(duration(current()));
    const label=host.querySelector('#fi-timer-label'),toggle=host.querySelector('#fi-timer-toggle'),rest=host.querySelector('.fs-rest');
    if(label)label.textContent=remaining<=0?'휴식 완료':timerAutoPaused?'휴식 일시정지':'휴식';
    if(toggle){toggle.textContent=timerEnd?'Ⅱ':'▶';toggle.setAttribute?.('aria-label',timerEnd?'휴식 타이머 일시정지':'휴식 타이머 시작');}
    if(rest)rest.hidden=!timerVisible;
  }
  function paintSessionMetrics(){
    const s=current();if(screen!=='session'||!s)return;
    for(const [id,value] of [['fi-session-volume',fmt(summary(s).volume)],['fi-session-sets',mainSetCount(s)],['fi-session-exercises',finishedExerciseCount(s)]]){
      const el=host.querySelector('#'+id);if(el)el.textContent=String(value);
    }
  }
  function downloadBackup(){
    try{
      const payload={app:'formday-iron',version:M.VERSION,exportedAt:new Date().toISOString(),data:M.copy(state)};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const href=URL.createObjectURL(blob),a=document.createElement('a');
      const d=iso(new Date());
      a.href=href;a.download='FORMDAY-IRON-backup-'+d+'.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1000);
      setMessage('다운로드를 요청했습니다. iCloud Drive 또는 Google Drive에 저장된 파일을 확인하세요.');
      render();
    }catch(e){setMessage(e.message,true);render();}
  }
  async function importBackup(file){
    try{
      if(blocked||revisionConflict)throw Error('현재 기록 저장소 오류부터 해결해야 합니다.');
      if(file.size>24000000)throw Error('백업은 최대 24MB입니다.');
      const value=JSON.parse(await file.text());
      const incoming=M.parseBackup(value);
      if(!root.confirm('독립 웨이트 백업을 복원할까요? 기존 루틴 '+state.routines.length+'개·운동 '+state.sessions.length+'개와 미저장 제작 내용을 교체하며, 직전 저장 기록은 한 번 더 보관합니다.'))return;
      if(changed(()=>({next:incoming}),'독립 운동 기록 백업을 복원했습니다.')){clearDrafts();go('home');}
    }catch(e){setMessage('백업을 복원하지 않았습니다. '+e.message,true);render();}
  }
  function reload(){
    if(!root.confirm('현재 화면의 미저장 입력을 버리고 다른 탭의 최신 기록을 불러올까요?'))return;
    try{
      store=store||M.createStore(root.localStorage);
      const loaded=store.load();
      if(loaded.error){blocked=loaded.error;render();return;}
      // The user explicitly discarded this screen. Never flush old DOM values into the new revision.
      screen='home';sessionDirty=false;backgroundStoppedAt=null;previousCache.clear();resetRest();
      state=loaded.data;blocked='';revisionConflict=false;error=false;clearDrafts();setMessage('최신 운동 기록을 불러왔습니다.');
      root.dispatchEvent(new CustomEvent('formday:iron-changed'));go('home');
    }catch(e){blocked='운동 기록을 다시 불러오지 못했습니다. '+e.message;render();}
  }
  function onAction(button){
    const action=button.dataset.fiAction,id=button.dataset.id;
    if(screen==='session'&&['pause','stash','resume','minimize-session','toggle-session-view','session-prev','session-next','add-session-set','remove-session-set','load-previous','complete-exercise','rest-exercise'].includes(action)&&!saveSessionInputs())return;
    if(action==='minimize-session'){go('home');return;}
    if(action==='toggle-session-view'){sessionViewMode=sessionViewMode==='all'?'one':'all';render();return;}
    if(action==='session-prev'||action==='session-next'){
      const s=current();if(!s)return;
      sessionExerciseIndex=Math.max(0,Math.min(s.exercises.length-1,sessionExerciseIndex+(action==='session-next'?1:-1)));render();return;
    }
    if(action==='remove-session-set'){const s=current();if(s?.status==='ACTIVE')changed(()=>M.removeSet(state,s.id,id),'마지막 미완료 세트를 삭제했습니다.');return;}
    if(action==='replace-session-ex'){replaceSessionExercise(id);return;}
    if(action==='load-previous'){
      const s=current();if(!s||s.status!=='ACTIVE')return;
      if(!root.confirm('이 종목의 현재 입력을 가장 최근에 완료한 세트로 바꿀까요? 불러온 세트는 미완료 상태로 시작합니다.'))return;
      changed(()=>M.loadPreviousSets(state,s.id,id),'이전 세트를 불러왔습니다. 실제 수행한 뒤 완료 체크해 주세요.');return;
    }
    if(action==='complete-exercise'){
      const ex=current()?.exercises.find(ex=>ex.id===id);if(!ex||current().status!=='ACTIVE')return;
      const done=!ex.sets.every(set=>set.done);
      if(saveSessionInputs(ex.sets.map(set=>({exid:id,setid:set.id,values:{done}})),done?'이 종목의 모든 세트를 완료했습니다.':'이 종목의 완료를 해제했습니다.')){
        if(done)startRest(ex.sets.at(-1).restSec);render();
      }return;
    }
    if(action==='toggle-warmup'){
      const ex=current()?.exercises.find(ex=>ex.id===button.dataset.ex),set=ex?.sets.find(set=>set.id===id);
      if(!set||current().status!=='ACTIVE')return;
      if(saveSessionInputs([{exid:ex.id,setid:id,values:{warmup:!set.warmup}}],set.warmup?'본세트로 바꿨습니다.':'워밍업 세트로 바꿨습니다.'))render();return;
    }
    if(action==='rest-exercise'){
      const ex=current()?.exercises.find(ex=>ex.id===id);if(!ex||current().status!=='ACTIVE')return;
      startRest((ex.sets.find(set=>!set.done)||ex.sets.at(-1)).restSec);paintTimer();return;
    }
    if(action==='back-home'){go('home');return;}
    if(action==='start-free'){
      if(!beforeNavigate())return;
      if(current()){setMessage('진행 중인 운동을 이어가거나 확정한 뒤 새 운동을 시작하세요.',true);go('session');return;}
      selectExercises({title:'이번 운동의 종목 선택',onConfirm:names=>doStart(null,null,names,true)});return;
    }
    if(action==='choose-routine'||action==='routine-list'){go('routines');return;}
    if(action==='begin-routine'){
      if(!id||!state?.routines.some(r=>r.id===id))throw Error('선택한 루틴을 찾지 못했습니다. 루틴 목록을 다시 확인해 주세요.');
      doStart(id);return;
    }
    if(action==='begin-program-routine'){
      const p=state.programs.find(x=>x.id===id),rid=p&&programNext(p);
      if(!rid){setMessage('오늘의 루틴을 찾지 못했습니다.',true);render();return;}
      doStart(rid,id);return;
    }
    if(action==='new-routine'){editable();if(!beforeNavigate())return;resetDraft();go('builder');return;}
    if(action==='edit-routine'){editable();if(!beforeNavigate())return;if(!state.routines.some(r=>r.id===id))throw Error('편집할 루틴을 찾지 못했습니다.');resetDraft(id);go('builder');return;}
    if(action==='add-builder-set'){
      readDraft();const ex=draft.exercises.find(x=>x.id===id);
      if(ex){if(ex.sets.length<50){const last=ex.sets.at(-1);ex.sets.push({...last,id:M.uid()});}render();}return;
    }
    if(action==='remove-builder-set'){
      readDraft();const ex=draft.exercises.find(x=>x.id===button.dataset.ex);
      if(ex&&ex.sets.length>1){ex.sets=ex.sets.filter(x=>x.id!==id);render();}return;
    }
    if(action==='remove-ex'){
      readDraft();
      draft.exercises=draft.exercises.filter(x=>x.id!==id);render();return;
    }
    if(action==='add-builder-ex'){pickRoutineExercises();return;}
    if(action==='replace-builder-ex'){pickRoutineExercises(id);return;}
    if(action==='save-routine'){
      readDraft();
      const result=changed(()=>editingRoutine?M.updateRoutine(state,editingRoutine,draft.name,draft.exercises):
        M.createRoutine(state,draft.name,draft.exercises),'루틴 목표를 저장했습니다. 기존 실제 운동 기록은 유지됩니다.');
      if(result){clearDrafts();go('routines');}return;
    }
    if(action==='program-list'){go('programs');return;}
    if(action==='new-program'){
      if(!state.routines.length){setMessage('먼저 루틴을 하나 이상 만들어 주세요.',true);render();return;}
      if(!beforeNavigate())return;
      programDraft=null;go('programBuilder');return;
    }
    if(action==='save-program'){
      readProgram();
      if(changed(()=>M.createProgram(state,programDraft.name,programDraft.mode,programDraft.selected,programDraft.weekdays),
        '훈련 프로그램을 저장했습니다.')){clearDrafts();go('programs');}return;
    }
    if(action==='pause'||action==='stash'||action==='resume'){
      const s=current();if(!s)throw Error('진행 중인 운동이 없습니다. 운동을 먼저 시작해 주세요.');
      if(action==='resume'&&s.status==='ACTIVE'){go('session');return;}
      const trans=action==='resume'?(s.status==='SAVED'?'resumeSaved':'resume'):action==='stash'&&s.status==='PAUSED'?'stashPaused':action;
      if(changed(()=>M.changeState(state,s.id,trans),action==='resume'?'운동을 재개했습니다.':'운동 상태를 저장했습니다.',false)){
        if(action==='resume')resumeRest();else pauseRest();
        if(action==='stash')go('home');else go('session');
      }
      return;
    }
    if(action==='inspect-session'){go('session');return;}
    if(action==='add-session-set'){const s=current();if(s?.status==='ACTIVE')changed(()=>M.addSet(state,s.id,id),'세트를 추가했습니다.');return;}
    if(action==='add-session-ex'){pickSessionExercises();return;}
    if(action==='save-session-set'){sessionSet(button);return;}
    if(action==='finish'||action==='partial'){finish(action==='finish'?'COMPLETED':'PARTIAL');return;}
    if(action==='cancel-session'){cancelSession();return;}
    if(action==='show-history'){go('history');return;}
    if(action==='record-detail'){focusedSession=id;go('history');return;}
    if(action==='save-from-history'){saveFromHistory(id);return;}
    if(action==='apply-from-history'){applyFromHistory(id);return;}
    if(action==='timer90'||action==='timer120'){
      timerSecs=action==='timer90'?90:120;timerEnd=0;timerVisible=true;timerAutoPaused=false;paintTimer();return;
    }
    if(action==='timer-skip'){resetRest();paintTimer();return;}
    if(action==='timer-add'){
      if(current()?.status!=='ACTIVE')return;
      timerSecs=Math.min(600,(timerEnd?Math.max(0,Math.ceil((timerEnd-Date.now())/1000)):timerSecs)+15);
      if(timerEnd)timerEnd=Date.now()+timerSecs*1000;
      paintTimer();return;
    }
    if(action==='timer-toggle'){
      if(current()?.status!=='ACTIVE')return;
      if(timerEnd){timerSecs=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));timerEnd=0;}
      else {if(timerSecs<=0)timerSecs=90;timerEnd=Date.now()+timerSecs*1000;}
      timerVisible=true;timerAutoPaused=false;paintTimer();return;
    }
    if(action==='export'){downloadBackup();return;}
    if(action==='reload'){reload();return;}
  }
  const targetFor=(event,selector)=>(event.target?.closest?event.target:event.target?.parentElement)?.closest(selector);
  document.addEventListener('click',event=>{
    if(!targetFor(event,'[data-fd-route],[data-ind-nav],[data-go],[data-mobile],.mini-cal [data-mini]'))return;
    if(!beforeNavigate()){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('click',event=>{
    try{
      const nav=targetFor(event,'[data-ind-nav]');
      if(nav){event.preventDefault();open(({start:'home',routines:'routines',programs:'programs',history:'history'})[nav.dataset.indNav]||nav.dataset.indNav);return;}
      const subnav=targetFor(event,'[data-fi-nav]');
      if(subnav&&!subnav.disabled){event.preventDefault();go(subnav.dataset.fiNav);return;}
      const action=targetFor(event,'[data-fi-action]');
      if(action&&!action.disabled){event.preventDefault();onAction(action);return;}
      if(targetFor(event,'[data-day],[data-mini],[data-date],[data-mobile="calendar"]'))root.requestAnimationFrame?.(renderCalendar);
    }catch(e){setMessage('요청을 처리하지 못했습니다. '+e.message,true);if(screen==='session')paintMessage();else render();}
  });
  host.addEventListener('input',event=>{
    if(screen==='builder')readDraft();
    if(screen==='programBuilder')readProgram();
    if(screen==='session'&&event.target?.closest?.('input,textarea')){sessionDirty=true;paintMessage();}
  });
  host.addEventListener('change',event=>{
    if(screen==='builder')readDraft();
    if(screen==='programBuilder')readProgram();
    if(screen==='session'&&event.target.closest?.('input,textarea')){saveSessionInputs();return;}
    if(event.target.name==='fi-mode'){
      readProgram();programDraft.mode=event.target.value;render();return;
    }
    if(event.target.id==='fi-import-file'&&event.target.files?.[0]){
      importBackup(event.target.files[0]);event.target.value='';
    }
  });
  root.addEventListener('formday:changed',renderCalendar);
  root.addEventListener('storage',event=>{
    if(event.key!==M.KEY&&event.key!==null)return;
    revisionConflict=true;setMessage('다른 탭에서 독립 웨이트 기록을 변경했습니다. 충돌을 피하려면 최신 기록을 불러오세요.',true);
    if(screen==='session')paintMessage();else render();
  });
  document.addEventListener('visibilitychange',()=>{
    // A phone call or app switch must not count hidden time as exercise time.
    const s=current();
    if(document.hidden&&s?.status==='ACTIVE'&&(blocked||revisionConflict)){backgroundStoppedAt=backgroundStoppedAt??Date.now();pauseRest();return;}
    if(document.hidden&&s?.status==='ACTIVE'&&!blocked&&!revisionConflict){
      const stoppedAt=Date.now();
      if(!saveSessionInputs()){backgroundStoppedAt=backgroundStoppedAt??stoppedAt;pauseRest();return;}
      try{state=store.save(M.changeState(state,s.id,'pause',new Date(stoppedAt)).next,state.revision);backgroundStoppedAt=null;pauseRest();root.dispatchEvent(new CustomEvent('formday:iron-changed'));}
      catch(e){backgroundStoppedAt=backgroundStoppedAt??stoppedAt;pauseRest();setMessage('화면 전환 중 저장에 실패했습니다. '+e.message,true);paintMessage();}
    } else if(!document.hidden&&document.body.dataset.fdScreen==='independent'){
      if(sessionDirty)paintMessage();else render();
    }
  });
  root.addEventListener('pagehide',()=>{
    const s=current();
    if(s?.status==='ACTIVE'&&!blocked&&!revisionConflict){
      if(!saveSessionInputs()){backgroundStoppedAt=backgroundStoppedAt??Date.now();pauseRest();return;}
      try{state=store.save(M.changeState(state,s.id,'stash').next,state.revision);pauseRest();root.dispatchEvent(new CustomEvent('formday:iron-changed'));}catch(e){}
    }
  });
  root.addEventListener('beforeunload',event=>{
    if(hasUnsavedDraft()||sessionDirty){event.preventDefault();event.returnValue='';}
  });
  host.addEventListener('focusin',event=>{
    if(screen==='session'&&event.target.closest?.('input,textarea'))document.body.classList?.add('fs-keyboard');
  });
  host.addEventListener('focusout',event=>{
    if(!event.relatedTarget?.closest?.('input,textarea'))document.body.classList?.remove('fs-keyboard');
  });
  root.setInterval(()=>{clockTick=Date.now();paintTimer();},1000);
  root.FormdayIndependent=Object.freeze({open,renderCalendar,beforeNavigate,getSnapshot:()=>state?M.copy(state):null,
    canCloudApply:()=>!blocked&&!revisionConflict&&!draft&&!programDraft&&!current()&&!pickerOpen&&!root.FormdayExercisePicker?.isOpen?.(),
    cloudReload:()=>{
      if(blocked||revisionConflict||draft||programDraft||current()||pickerOpen||root.FormdayExercisePicker?.isOpen?.())return false;
      const latest=store.load();
      if(latest.error){blocked=latest.error;setMessage(blocked,true);render();return false;}
      state=latest.data;setMessage('다른 기기의 최신 웨이트 기록을 반영했습니다.');
      focusedSession=null;renderCalendar();render();root.dispatchEvent(new CustomEvent('formday:iron-changed'));return true;
    }
  });
  // Main IRON dashboard is still the landing page; independence is user-initiated.
  renderCalendar();
  root.dispatchEvent(new CustomEvent('formday:iron-changed'));
})(typeof window!=='undefined'?window:globalThis);
