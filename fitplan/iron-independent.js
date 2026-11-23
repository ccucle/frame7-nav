/* FORMDAY IRON MODE routines & sessions.
   Separate from legacy calendar records, with validated local save and device sync. */
(function(root){
  'use strict';
  const M=root.FormdayIronStore,W=root.FormdayWorkouts;
  const host=document.getElementById('fd-ind-root'),calendar=document.getElementById('fd-iron-calendar');
  if(!host||!M||!W)return;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=x=>Number(x||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const iso=d=>new Date(d).toLocaleDateString('sv-SE');
  const weekdays=['일','월','화','수','목','금','토'];
  const TIME_LIMIT_MS=24*60*60*1000;
  let store,blocked='',state=null,screen='home',editingRoutine=null,draft=null,programDraft=null,
      draftBaseline='',programBaseline='',
      focusedSession=null,message='',error=false,revisionConflict=false,clockTick=Date.now(),timerSecs=90,timerEnd=0;
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
  function commit(result,success){
    if(blocked||revisionConflict){setMessage(blocked||'다른 탭에서 데이터가 변경되었습니다. 먼저 기록을 다시 불러와 주세요.',true);render();return false;}
    try{
      state=store.save(result.next,state.revision);
      root.dispatchEvent(new CustomEvent('formday:iron-changed'));
      if(success)setMessage(success,false);
      render();
      return true;
    }catch(e){
      setMessage(e.message,true);
      if(/다른 탭/.test(e.message))revisionConflict=true;
      render();
      return false;
    }
  }
  function changed(mutator,success){
    try{return commit(mutator(),success);}catch(e){setMessage(e.message,true);render();return false;}
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
    if(hasUnsavedDraft()&&!root.confirm('저장하지 않은 루틴 또는 프로그램 변경사항을 버리고 이동할까요? 계속 작성하려면 취소를 누르세요.'))return false;
    clearDrafts();
    return true;
  }
  function go(page){
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
    if(!beforeNavigate())return false;
    if(page==='start'&&extra?.exercise){
      if(current()){
        const s=current();
        if(s.status==='ACTIVE'&&extra.exercise){
          changed(()=>M.addExercise(state,s.id,extra.exercise),'기존 운동 세션에 종목을 추가했습니다.');
        }
        go('session');return;
      }
      const result=M.start(state,{label:'자유 운동'});
      const ex=M.newExercise(extra.exercise);
      result.session.exercises=[{...ex,sets:ex.sets.map(s=>({...s,done:false}))}];
      if(commit(result,'자유 운동을 시작했습니다.'))go('session');
      return;
    }
    if(page==='start')page=current()?'session':'home';
    go(page);
  }
  function top(){
    document.body.dataset.fdScreen='independent';
    const title=document.querySelector('.page-title');
    const sub=document.querySelector('.page-sub');
    const crumb=document.querySelector('.crumb');
    if(title)title.textContent=({home:'IRON MODE · 웨이트',builder:'루틴 제작',programs:'프로그램 관리',session:'운동 실행',history:'웨이트 기록',programBuilder:'프로그램 제작',choose:'루틴 선택'})[screen]||'IRON MODE';
    if(sub)sub.textContent='계획과 실제 운동은 따로 저장됩니다. 웨이트는 새 일정 등록 없이 실행하세요.';
    if(crumb?.firstChild)crumb.firstChild.textContent='INDEPENDENT STRENGTH  ';
    document.querySelectorAll('[data-ind-nav]').forEach(b=>{
      const selected=b.dataset.indNav===screen||(b.dataset.indNav==='start'&&screen==='session')||
         (b.dataset.indNav==='routines'&&(screen==='builder'||screen==='home'));
      b.classList.toggle('fd-current',selected);
      b.classList.toggle('active',selected);
      b.setAttribute('aria-current',selected?'page':'false');
    });
    document.querySelectorAll('[data-fd-route],[data-go],[data-mobile]').forEach(b=>{
      b.classList.remove('fd-current','active');b.setAttribute('aria-current','false');
    });
  }
  const button=(action,label,kind='primary',more='')=>'<button class="fi-btn fi-'+kind+'" type="button" data-fi-action="'+action+'" '+more+'>'+label+'</button>';
  function banner(){
    const s=current();
    if(!s)return '';
    const sum=summary(s);
    const stale=Date.now()-Date.parse(s.lastSavedAt)>=TIME_LIMIT_MS;
    return '<div class="fi-resume '+(stale?'fi-stale':'')+'"><span class="fi-kicker">'+(stale?'24시간 경과 · 삭제되지 않았습니다':'보관 또는 진행 중인 운동')+'</span>'+
      '<h3>'+esc(s.label)+'</h3><p>'+esc(s.date)+' · '+sum.completedSets+'세트 완료 · '+fmt(sum.volume)+'kg · '+s.status+'</p>'+
      '<div class="fi-inline-actions">'+button('resume','이어서 운동','primary')+button('inspect-session','기록 보기','outline')+'</div></div>';
  }
  function home(){
    const history=completed().slice().reverse();
    return '<section class="fi-view"><div class="fi-hero"><div><span class="fi-kicker">IRON MODE / INDEPENDENT</span><h2>계획은 계획대로.<br><em>기록은 기록대로.</em></h2><p>캘린더 등록 없이 바로 웨이트를 시작하세요.</p></div></div>'+
      banner()+'<div class="fi-stats"><div><span>저장된 루틴</span><strong>'+state.routines.length+'</strong></div><div><span>훈련 프로그램</span><strong>'+state.programs.length+'</strong></div><div><span>확정한 운동</span><strong>'+history.length+'</strong></div></div>'+
      '<div class="fi-action-grid">'+button('start-free','▶ 자유 운동 시작')+button('choose-routine','루틴으로 운동 시작','outline')+
      button('new-routine','＋ 새 루틴 제작','outline')+button('program-list','요일·순환 프로그램','outline')+'</div>'+
      '<div class="fi-panel"><div class="fi-section-head"><h3>내 루틴</h3><span>'+state.routines.length+'개</span></div>'+
      (!state.routines.length?'<p class="fi-empty">저장된 루틴이 없습니다. 운동 도감에서 종목을 선택해 첫 루틴을 만드세요.</p>':
       state.routines.map(r=>'<div class="fi-list-row"><div><b>'+esc(r.name)+'</b><small>'+r.exercises.length+'종목 · '+r.exercises.reduce((n,x)=>n+x.sets.length,0)+'세트</small></div>'+
       '<div class="fi-inline-actions">'+button('begin-routine','시작','primary','data-id="'+esc(r.id)+'"')+
       button('edit-routine','편집','outline','data-id="'+esc(r.id)+'"')+'</div></div>').join(''))+'</div>'+
      '<div class="fi-panel"><div class="fi-section-head"><h3>최근 운동</h3>'+button('show-history','기록 전체 →','subtle')+'</div>'+
      (!history.length?'<p class="fi-empty">아직 확정된 운동 기록이 없습니다.</p>':history.slice(0,4).map(s=>recordCard(s)).join(''))+'</div></section>';
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
  function chooseRoutine(){
    return '<div class="fi-panel"><div class="fi-section-head"><h3>저장된 루틴에서 운동 시작</h3></div>'+
      (state.routines.length?state.routines.map(r=>'<div class="fi-list-row"><div><b>'+esc(r.name)+'</b><small>'+r.exercises.map(e=>e.name).join(' · ').slice(0,160)+'</small></div>'+button('begin-routine','시작','primary','data-id="'+esc(r.id)+'"')+'</div>').join(''):
      '<p class="fi-empty">아직 루틴이 없습니다.</p>')+'</div>'+
      '<div class="fi-panel"><div class="fi-section-head"><h3>프로그램의 다음 차례</h3></div>'+
      (state.programs.length?state.programs.filter(p=>p.active).map(p=>{
        const rid=programNext(p),routine=state.routines.find(r=>r.id===rid);
        return '<div class="fi-list-row"><div><b>'+esc(p.name)+'</b><small>'+esc(p.mode==='cycle'?'순환형':'요일 고정형')+' · '+(routine?esc(routine.name):'오늘 지정된 루틴 없음')+'</small></div>'+
          (rid?button('begin-program-routine','시작','primary','data-id="'+esc(p.id)+'"'):'')+'</div>';
      }).join(''):'<p class="fi-empty">프로그램을 만들면 다음 순서의 루틴을 선택할 수 있습니다.</p>')+'</div>';
  }
  function builderRows(){
    return draft.exercises.map((ex,i)=>'<div class="fi-builder-ex" data-fi-ex="'+esc(ex.id)+'">'+
      '<div class="fi-builder-ex-title"><span>EXERCISE '+(i+1)+'</span><select data-fi-ex-name aria-label="운동 종목">'+
      W.catalog.map(c=>'<option value="'+esc(c.name)+'" '+(c.name===ex.name?'selected':'')+'>'+esc(c.group+' / '+c.name)+'</option>').join('')+
      (W.catalog.some(c=>c.name===ex.name)?'':'<option selected value="'+esc(ex.name)+'">'+esc(ex.name)+'</option>')+'</select>'+
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
      button('back-home','← 목록','outline')+'</div><div class="fi-panel"><label class="fi-label" for="fi-routine-name">루틴 이름</label>'+
      '<input class="fi-text-input" id="fi-routine-name" maxlength="100" placeholder="예: 가슴 · 삼두" value="'+esc(draft.name)+'">'+
      '<p class="fi-note">루틴은 목표 계획만 저장합니다. 과거 실제 운동 기록과 완료 여부는 변경하지 않습니다.</p></div>'+
      '<div class="fi-builder-exercises">'+builderRows()+'</div>'+
      '<div class="fi-panel"><div class="fi-inline-actions">'+
      '<select id="fi-library-add" aria-label="추가할 운동 종목">'+W.catalog.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.group+' / '+c.name)+'</option>').join('')+'</select>'+
      button('add-builder-ex','＋ 운동 종목 추가','outline')+'</div></div>'+
      '<div class="fi-sticky-actions">'+button('save-routine','루틴 저장')+button('back-home','취소','outline')+'</div></section>';
  }
  function resetDraft(id){
    const existing=id?state.routines.find(r=>r.id===id):null;
    editingRoutine=existing?.id||null;
    draft=existing?M.copy(existing):{name:'새 웨이트 루틴',exercises:[M.newExercise('벤치프레스')]};
    draftBaseline=JSON.stringify(draft);
  }
  function readDraft(){
    if(!draft)return;
    const name=host.querySelector('#fi-routine-name');
    if(name)draft.name=name.value;
    host.querySelectorAll('[data-fi-ex]').forEach(block=>{
      const ex=draft.exercises.find(x=>x.id===block.dataset.fiEx);
      if(!ex)return;
      ex.name=block.querySelector('[data-fi-ex-name]')?.value||ex.name;
      block.querySelectorAll('[data-fi-set]').forEach(row=>{
        const set=ex.sets.find(s=>s.id===row.dataset.fiSet);
        if(!set)return;
        set.weight=Number(row.querySelector('[data-fi-weight]')?.value);
        set.reps=Number(row.querySelector('[data-fi-reps]')?.value);
        set.restSec=Number(row.querySelector('[data-fi-rest]')?.value);
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
    const active=s.status==='ACTIVE'&&s.activeSince?Math.max(0,Date.now()-Date.parse(s.activeSince)):0;
    return Math.floor((s.activeMs+active)/1000);
  };
  const timeLabel=n=>String(Math.floor(n/3600)).padStart(2,'0')+':'+String(Math.floor((n%3600)/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  function sessionView(){
    const s=current();
    if(!s)return home();
    const result=summary(s);
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">ACTIVE WORKOUT / '+esc(s.date)+'</span><h2>'+esc(s.label)+'</h2></div>'+
      '<span class="fi-status">'+(s.status==='ACTIVE'?'운동 중':s.status==='SAVED'?'임시 보관':'일시정지')+'</span></div>'+
      (Date.now()-Date.parse(s.lastSavedAt)>=TIME_LIMIT_MS?'<div class="fi-alert">마지막 저장 이후 24시간이 지났습니다. 자동 종료나 삭제는 하지 않습니다.</div>':'')+
      '<div class="fi-stats"><div><span>운동 시간</span><strong id="fi-duration">'+timeLabel(duration(s))+'</strong></div><div><span>완료 세트</span><strong>'+result.completedSets+'</strong></div><div><span>운동량</span><strong>'+fmt(result.volume)+' <small>kg</small></strong></div></div>'+
      '<div class="fi-inline-actions fi-session-control">'+
      (s.status==='ACTIVE'?button('pause','Ⅱ 일시정지','outline')+button('stash','↧ 나중에 이어하기','outline'):
      button('resume','▶ 운동 재개','primary')+(s.status==='PAUSED'?button('stash','임시 보관','outline'):''))+
      button('cancel-session','운동 취소','danger')+'</div>'+
      '<div class="fi-session-exercises">'+s.exercises.map((ex,i)=>'<div class="fi-panel fi-session-ex" data-fi-ex="'+esc(ex.id)+'">'+
      '<div class="fi-section-head"><h3>'+(i+1)+'. '+esc(ex.name)+'</h3>'+button('add-session-set','＋ 세트','outline','data-id="'+esc(ex.id)+'" '+(s.status==='ACTIVE'?'':'disabled'))+'</div>'+
      '<div class="fi-set-grid fi-set-label"><span>세트</span><span>kg</span><span>횟수</span><span>RPE</span><span>완료</span><span>저장</span></div>'+
      ex.sets.map((set,j)=>'<div class="fi-set-grid fi-set-row" data-fi-set="'+esc(set.id)+'" data-fi-exid="'+esc(ex.id)+'">'+
      '<strong>'+(j+1)+(set.warmup?' W':'')+'</strong>'+
      '<input type="number" inputmode="decimal" data-fi-kg min="0" max="2000" step="0.5" value="'+set.weight+'" aria-label="'+(j+1)+'세트 중량" '+(s.status==='ACTIVE'?'':'disabled')+'>'+
      '<input type="number" inputmode="numeric" data-fi-reps min="1" max="1000" step="1" value="'+set.reps+'" aria-label="'+(j+1)+'세트 횟수" '+(s.status==='ACTIVE'?'':'disabled')+'>'+
      '<input type="number" inputmode="decimal" data-fi-rpe min="1" max="10" step="0.5" placeholder="–" value="'+(set.rpe??'')+'" aria-label="'+(j+1)+'세트 RPE" '+(s.status==='ACTIVE'?'':'disabled')+'>'+
      '<label><input type="checkbox" data-fi-done '+(set.done?'checked':'')+' '+(s.status==='ACTIVE'?'':'disabled')+' aria-label="'+(j+1)+'세트 완료"></label>'+
      button('save-session-set','저장',set.done?'done':'outline','data-ex="'+esc(ex.id)+'" data-id="'+esc(set.id)+'" '+(s.status==='ACTIVE'?'':'disabled'))+'</div>').join('')+'</div>').join('')+'</div>'+
      '<div class="fi-panel"><h3>운동 종목 추가</h3><div class="fi-inline-actions"><select id="fi-add-exercise">'+
      W.catalog.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.group+' / '+c.name)+'</option>').join('')+'</select>'+
      button('add-session-ex','종목 추가','outline',s.status==='ACTIVE'?'':'disabled')+'</div></div>'+
      '<div class="fi-panel fi-timer"><span class="fi-kicker">REST TIMER</span><div class="fi-timer-number" id="fi-timer-number">'+Math.ceil(timerSecs)+'초</div>'+
      '<div class="fi-inline-actions">'+button('timer90','90초','outline')+button('timer120','120초','outline')+button('timer-toggle',timerEnd?'일시정지':'타이머 시작','outline')+'</div></div>'+
      '<div class="fi-sticky-actions">'+button('finish','운동 완료 확정')+button('partial','여기까지 부분 완료','outline')+'</div>'+
      '<p class="fi-note">완료 세트만 운동량에 반영됩니다. 확정하지 않은 세션은 캘린더에 표시하지 않습니다.</p></section>';
  }
  function historyView(){
    const records=completed().slice().sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
    const selected=records.find(x=>x.id===focusedSession);
    return '<section class="fi-view"><div class="fi-section-head"><div><span class="fi-kicker">WORKOUT HISTORY</span><h2>확정된 운동 기록</h2></div>'+
      button('back-home','웨이트 홈','outline')+'</div>'+
      '<div class="fi-panel">'+(records.length?records.map(s=>recordCard(s)).join(''):'<p class="fi-empty">완료된 운동 세션이 없습니다.</p>')+'</div>'+
      (selected?'<div class="fi-panel"><div class="fi-section-head"><h3>'+esc(selected.label)+'</h3><span>'+ (selected.status==='PARTIAL'?'부분 완료':'정상 완료')+'</span></div>'+
      '<p class="fi-note">'+esc(selected.date)+' · 운동 '+timeLabel(Math.floor(selected.activeMs/1000))+'</p>'+
      selected.exercises.map(ex=>'<div class="fi-history-ex"><b>'+esc(ex.name)+'</b><small>'+(ex.sets.filter(s=>s.done).map(s=>fmt(s.weight)+'kg × '+s.reps+'회'+(s.warmup?' (워밍업)':'')).join(' · ')||'완료 세트 없음')+'</small></div>').join('')+
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
    if(blocked||!state){
      host.innerHTML='<div class="fi-panel fi-alert"><h3>독립 운동 저장소를 읽을 수 없습니다.</h3><p>'+esc(blocked||'알 수 없는 오류')+'</p>'+
      '<p>원본 데이터는 삭제하거나 초기화하지 않았습니다. 다른 기기의 기록으로 덮어쓰지 마세요.</p></div>';
      return;
    }
    host.innerHTML='<div id="fi-banner" class="'+(error?'fi-msg-error':'')+'" '+(!message?'hidden':'')+' role="status">'+esc(message)+'</div>'+
      (revisionConflict?button('reload','다른 탭의 최신 기록 불러오기','outline'):'')+
      (screen==='home'?home():screen==='builder'?builder():screen==='programs'?programs():screen==='programBuilder'?programBuilder():screen==='session'?sessionView():screen==='history'?historyView():screen==='choose'?'<section class="fi-view"><div class="fi-section-head"><h2>운동 시작</h2>'+button('back-home','웨이트 홈','outline')+'</div>'+chooseRoutine()+'</section>':home())+
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
  function doStart(routineId=null,programId=null,exercise=null){
    if(!beforeNavigate())return;
    if(active()){setMessage('기존에 진행 중인 운동이 있습니다. 이어하기 또는 확정 후 새 운동을 시작하세요.',true);go('session');return;}
    const result=changed(()=>{const x=M.start(state,{routineId,programId});
      if(exercise){const ex=M.newExercise(exercise);x.session.exercises=[{...ex,sets:ex.sets.map(s=>({...s,done:false}))}];}
      return x;},'새 운동을 시작했습니다. 실제 세트 기록만 완료 처리하세요.');
    if(result)go('session');
  }
  function sessionSet(button){
    const row=button.closest('[data-fi-set]'),session=current();
    if(!row||!session||session.status!=='ACTIVE')return;
    const exid=row.dataset.fiExid,setid=row.dataset.fiSet;
    const previous=session.exercises.find(x=>x.id===exid)?.sets.find(x=>x.id===setid);
    const wasDone=previous?.done;
    const vals={
      weight:Number(row.querySelector('[data-fi-kg]').value),
      reps:Number(row.querySelector('[data-fi-reps]').value),
      rpe:row.querySelector('[data-fi-rpe]').value===''?null:Number(row.querySelector('[data-fi-rpe]').value),
      done:row.querySelector('[data-fi-done]').checked
    };
    try{
      if(blocked||revisionConflict)throw Error('저장 오류 또는 다른 탭과의 기록 충돌이 있습니다. 먼저 확인해 주세요.');
      const result=M.setValue(state,session.id,exid,setid,vals);
      const saved=store.save(result.next,state.revision);
      state=saved;
      root.dispatchEvent(new CustomEvent('formday:iron-changed'));
      setMessage('세트 기록을 저장했습니다.');
      if(vals.done&&!wasDone){
        timerSecs=previous?.restSec??90;
        timerEnd=Date.now()+timerSecs*1000;
      }
      render();
    }catch(e){
      // Keep unsaved input visible for correction instead of rerendering it away.
      setMessage('저장하지 못했습니다. 입력값을 유지합니다. '+e.message,true);
      const banner=host.querySelector('#fi-banner');
      if(banner){banner.hidden=false;banner.classList.add('fi-msg-error');banner.textContent=message;}
      if(/다른 탭/.test(e.message))revisionConflict=true;
    }
  }
  function finish(kind){
    const s=current();if(!s)return;
    const done=summary(s).completedSets;
    if(!done){setMessage('완료한 세트가 없습니다. 먼저 기록하거나 임시 보관해 주세요.',true);render();return;}
    if(!root.confirm((kind==='PARTIAL'?'부분 완료':'운동 완료')+'로 확정할까요? 완료한 '+done+'세트만 반영하며, 이후 같은 세션을 이어할 수 없습니다.'))return;
    if(changed(()=>M.finish(state,s.id,kind),'운동 기록을 확정했습니다. 캘린더에도 표시됩니다.')){
      focusedSession=s.id;go('history');
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
      timerEnd=0;timerSecs=90;focusedSession=null;go('home');
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
    if(ticker)ticker.textContent=remaining+'초';
    if(dur&&current())dur.textContent=timeLabel(duration(current()));
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
    const loaded=store.load();
    if(loaded.error){blocked=loaded.error;render();return;}
    state=loaded.data;revisionConflict=false;error=false;clearDrafts();setMessage('최신 운동 기록을 불러왔습니다.');
    root.dispatchEvent(new CustomEvent('formday:iron-changed'));go('home');
  }
  function onAction(button){
    const action=button.dataset.fiAction,id=button.dataset.id;
    if(action==='back-home'){go('home');return;}
    if(action==='start-free'){
      const name=root.prompt('첫 운동 종목을 입력하세요. (운동 도감에 있는 이름을 사용할 수 있습니다.)','벤치프레스');
      if(name===null)return;
      if(!name.trim()){setMessage('운동 종목 이름을 입력해 주세요.',true);render();return;}
      doStart(null,null,name.trim());return;
    }
    if(action==='choose-routine'){go('choose');return;}
    if(action==='begin-routine'){doStart(id);return;}
    if(action==='begin-program-routine'){
      const p=state.programs.find(x=>x.id===id),rid=p&&programNext(p);
      if(!rid){setMessage('오늘의 루틴을 찾지 못했습니다.',true);render();return;}
      doStart(rid,id);return;
    }
    if(action==='new-routine'){if(!beforeNavigate())return;resetDraft();go('builder');return;}
    if(action==='edit-routine'){if(!beforeNavigate())return;resetDraft(id);go('builder');return;}
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
      if(draft.exercises.length>1){draft.exercises=draft.exercises.filter(x=>x.id!==id);render();}return;
    }
    if(action==='add-builder-ex'){
      readDraft();if(draft.exercises.length>=30)return;
      draft.exercises.push(M.newExercise(host.querySelector('#fi-library-add')?.value||'벤치프레스'));render();return;
    }
    if(action==='save-routine'){
      readDraft();
      const result=changed(()=>editingRoutine?M.updateRoutine(state,editingRoutine,draft.name,draft.exercises):
        M.createRoutine(state,draft.name,draft.exercises),'루틴 목표를 저장했습니다. 기존 실제 운동 기록은 유지됩니다.');
      if(result){clearDrafts();go('home');}return;
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
      const s=current();if(!s)return;
      const trans=action==='resume'?(s.status==='SAVED'?'resumeSaved':'resume'):action==='stash'&&s.status==='PAUSED'?'stashPaused':action;
      changed(()=>M.changeState(state,s.id,trans),action==='resume'?'운동을 재개했습니다.':'운동 상태를 저장했습니다.');
      return;
    }
    if(action==='inspect-session'){go('session');return;}
    if(action==='add-session-set'){const s=current();if(s?.status==='ACTIVE')changed(()=>M.addSet(state,s.id,id),'세트를 추가했습니다.');return;}
    if(action==='add-session-ex'){const s=current(),name=host.querySelector('#fi-add-exercise')?.value;
      if(s?.status==='ACTIVE'&&name)changed(()=>M.addExercise(state,s.id,name),'운동 종목을 추가했습니다.');return;
    }
    if(action==='save-session-set'){sessionSet(button);return;}
    if(action==='finish'||action==='partial'){finish(action==='finish'?'COMPLETED':'PARTIAL');return;}
    if(action==='cancel-session'){cancelSession();return;}
    if(action==='show-history'){go('history');return;}
    if(action==='record-detail'){focusedSession=id;go('history');return;}
    if(action==='save-from-history'){saveFromHistory(id);return;}
    if(action==='apply-from-history'){applyFromHistory(id);return;}
    if(action==='timer90'||action==='timer120'){
      timerSecs=action==='timer90'?90:120;timerEnd=0;paintTimer();return;
    }
    if(action==='timer-toggle'){
      if(timerEnd){timerSecs=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));timerEnd=0;}
      else {if(timerSecs<=0)timerSecs=90;timerEnd=Date.now()+timerSecs*1000;}
      paintTimer();return;
    }
    if(action==='export'){downloadBackup();return;}
    if(action==='reload'){reload();return;}
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('[data-fd-route],[data-ind-nav],[data-go],[data-mobile],.mini-cal [data-mini]'))return;
    if(!beforeNavigate()){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('click',event=>{
    const nav=event.target.closest('[data-ind-nav]');
    if(nav){event.preventDefault();open(({start:'start',routines:'home',programs:'programs',history:'history'})[nav.dataset.indNav]||nav.dataset.indNav);return;}
    const action=event.target.closest('[data-fi-action]');
    if(action){event.preventDefault();onAction(action);return;}
    if(event.target.closest('[data-day],[data-mini],[data-date],[data-mobile="calendar"]')){
      root.requestAnimationFrame?.(renderCalendar);
    }
  });
  host.addEventListener('input',()=>{
    if(screen==='builder')readDraft();
    if(screen==='programBuilder')readProgram();
  });
  host.addEventListener('change',event=>{
    if(screen==='builder')readDraft();
    if(screen==='programBuilder')readProgram();
    const row=event.target.closest?.('[data-fi-set]');
    if(row&&row.classList?.contains('fi-set-row')){
      const button=row.querySelector('[data-fi-action="save-session-set"]');
      if(button)sessionSet(button);
      return;
    }
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
    revisionConflict=true;setMessage('다른 탭에서 독립 웨이트 기록을 변경했습니다. 충돌을 피하려면 최신 기록을 불러오세요.',true);render();
  });
  document.addEventListener('visibilitychange',()=>{
    // A phone call or app switch must not count hidden time as exercise time.
    const s=current();
    if(document.hidden&&s?.status==='ACTIVE'&&!blocked&&!revisionConflict){
      try{state=store.save(M.changeState(state,s.id,'pause').next,state.revision);root.dispatchEvent(new CustomEvent('formday:iron-changed'));}
      catch(e){setMessage('화면 전환 중 저장에 실패했습니다. '+e.message,true);}
    } else if(!document.hidden&&document.body.dataset.fdScreen==='independent')render();
  });
  root.addEventListener('pagehide',()=>{
    const s=current();
    if(s?.status==='ACTIVE'&&!blocked&&!revisionConflict){
      try{state=store.save(M.changeState(state,s.id,'stash').next,state.revision);root.dispatchEvent(new CustomEvent('formday:iron-changed'));}catch(e){}
    }
  });
  root.addEventListener('beforeunload',event=>{
    if(hasUnsavedDraft()){event.preventDefault();event.returnValue='';}
  });
  root.setInterval(()=>{clockTick=Date.now();paintTimer();},1000);
  root.FormdayIndependent=Object.freeze({open,renderCalendar,beforeNavigate,getSnapshot:()=>state?M.copy(state):null,
    canCloudApply:()=>!blocked&&!revisionConflict&&!draft&&!programDraft&&!current(),
    cloudReload:()=>{
      if(blocked||revisionConflict||draft||programDraft||current())return false;
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
