/* FORMDAY IRON MODE · visual workout dashboard, directory and live sets
 * Works with existing FormdayBridge. No new cloud API or paid service.
 */
(function(root){
  'use strict';
  const node=document.getElementById('fd-iron-root');
  const bridge=root.FormdayBridge;
  const core=root.FormdayCore, workouts=root.FormdayWorkouts, D=root.FormdayIronData;
  if(!node||!bridge||!core||!workouts||!D)return;
  let screen='home',query='',muscle='전체',equipment='전체 장비',selectedName='벤치프레스';
  let pageSize=18,selectedWorkoutId=null,selectedExerciseIndex=0;
  let timerDuration=120,timerRemaining=120,timerDeadline=0,timerRunning=false;
  const $=s=>node.querySelector(s);
  const html=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const n=v=>Number(v||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const unit=(v,suffix='kg')=>v==null?'–':n(v)+' '+suffix;
  const img=(src,alt,cls='')=>'<img class="'+cls+'" loading="lazy" src="'+html(src)+'" alt="'+html(alt)+'" referrerpolicy="no-referrer" onerror="this.classList.add(\'fd-img-failed\')">';
  const trainingPhoto='운동 분위기를 표현한 이미지이며 해당 종목의 정확한 자세 시범은 아닙니다.';
  const media=root.FormdayExerciseMedia?.byName||{};
  const catalog=D.all(workouts.catalog).map(ex=>({...ex,equipment:media[ex.name]?.equipment||ex.equipment}));
  const equipmentOptions=['전체 장비',...new Set(catalog.map(ex=>ex.equipment))];
  function exerciseImage(ex){
    const entry=media[ex.name];
    return entry?img(entry.src,entry.alt,'fd-movement-image'):'<span class="fd-movement-missing">이미지 준비 중</span>';
  }
  function dataset(){
    const state=bridge.getState();
    const independent=root.FormdayIndependent?.getSnapshot?.();
    const a=D.analytics(core,workouts,state,new Date(),independent);
    return {state,a,independent};
  }
  function top(screenName){
    const labels={home:['TODAY','오늘의 기록'],session:['WORKOUT','오늘의 운동'],library:['LIBRARY','운동 도감'],analysis:['PERFORMANCE','훈련 성과'],progress:['PROGRESS','몸의 변화'],calendar:['CALENDAR','통합 캘린더']};
    const [eyebrow,title]=labels[screenName]||labels.home;
    const titleEl=document.querySelector('.page-title'),descEl=document.querySelector('.page-sub');
    if(titleEl)titleEl.textContent=title;
    if(descEl)descEl.textContent=screenName==='calendar'?'운동 · 식단 · 체중을 날짜별로 관리하세요.':screenName==='progress'?'체중과 기록한 섭취 열량을 기간별로 확인하세요.':'기록으로 확인하는 오늘의 훈련. 웨이트 중심 퍼포먼스 시스템.';
    const crumb=document.querySelector('.crumb');
    if(crumb)crumb.firstChild.textContent=eyebrow+'  ';
    document.body.dataset.fdScreen=screenName;
    document.querySelectorAll('[data-fd-route]').forEach(button=>{
      const isSelected=button.dataset.fdRoute===screenName;
      button.classList.toggle('fd-current',isSelected);
      button.setAttribute('aria-current',isSelected?'page':'false');
    });
    document.querySelectorAll('[data-ind-nav]').forEach(button=>{
      button.classList.remove('fd-current','active');button.setAttribute('aria-current','false');
    });
    const types=bridge.getVisibleTypes?.()||[];
    const activeFilter=types.length===1?types[0]:'calendar';
    document.querySelectorAll('[data-go]').forEach(button=>{
      const selected=screenName==='calendar'&&button.dataset.go===activeFilter;
      button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');
    });
    document.querySelectorAll('[data-mobile]').forEach(button=>{
      const selected=screenName==='calendar'&&button.dataset.mobile==='calendar';
      button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');
    });
  }
  function openWorkout(page,options){
    const notice=document.getElementById('fd-workout-error');
    try{
      if(typeof root.FormdayIndependent?.open!=='function')throw Error('운동 화면을 불러오지 못했습니다.');
      if(notice)notice.hidden=true;
      return root.FormdayIndependent.open(page,options);
    }catch(error){
      if(notice){notice.hidden=false;notice.innerHTML='<strong>운동 화면을 열지 못했습니다.</strong><p>저장된 기록을 지우지 말고 새로고침한 뒤 다시 시도해 주세요.</p><button type="button" class="fd-outline" data-fd-action="retry-workout">새로고침</button>';}
      return false;
    }
  }
  function setScreen(name){
    if(name==='session'){openWorkout('session');return;}
    if(!['home','library','analysis','progress','calendar'].includes(name))return;
    if(document.body.dataset.fdScreen==='independent'&&root.FormdayIndependent?.beforeNavigate?.()===false)return;
    screen=name;render(true);
    document.querySelector('#main-content')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function banner(title,value,sub,icon){
    return '<div class="fd-metric"><span class="fd-metric-kicker">'+icon+' '+html(title)+'</span><div class="fd-metric-val">'+value+'</div><p>'+sub+'</p></div>';
  }
  function progressByGroup(a){
    const groups=Object.entries(a.byGroup).sort((x,y)=>y[1]-x[1]);
    if(!groups.length)return '<p class="fd-hint">이번 주 완료한 웨이트 본세트를 기록하면 부위별 운동량이 표시됩니다.</p>';
    const max=groups[0][1]||1;
    return groups.map(([name,value])=>'<div class="fd-bar-row"><span>'+html(name)+'</span><div class="fd-bar-track"><i style="width:'+Math.max(3,Math.round(value/max*100))+'%"></i></div><strong>'+n(value)+' <small>kg</small></strong></div>').join('');
  }
  function home(){
    const {a,independent}=dataset();
    const dayList=a.currentWorkout;
    const strength=dayList[0]||null;
    const unfinished=independent?.sessions?.find(s=>['ACTIVE','PAUSED','SAVED'].includes(s.status));
    const routines=independent?.routines||[];
    let trainingTitle='오늘의 웨이트를 시작하세요',trainingNote='자유 운동을 시작하거나 사용할 루틴을 선택하세요.',trainingAction='resume-workout',trainingLabel='운동 시작';
    if(unfinished){
      trainingTitle=unfinished.label;
      trainingNote=unfinished.date+' · '+({ACTIVE:'운동 진행 중',PAUSED:'일시정지',SAVED:'임시 보관'})[unfinished.status]+' · 이어서 기록할 수 있습니다.';
      trainingLabel='운동 이어하기';
    }else if(routines.length){
      trainingTitle='저장한 루틴으로 시작';
      trainingNote=routines.length+'개 루틴 · '+routines.slice(0,2).map(r=>r.name).join(' · ');
      trainingAction='choose-routine';trainingLabel='루틴 선택';
    }else if(strength){
      trainingTitle=strength.title;
      trainingNote='오늘의 기존 웨이트 일정 · '+strength.detail.exercises.map(x=>x.name).slice(0,3).join(' · ');
      trainingAction='open-legacy';trainingLabel='기존 일정 열기';
    }
    const best=a.bestPR;
    const imageCredit='<a class="fd-photo-credit" target="_blank" rel="noopener noreferrer" href="https://unsplash.com/license">운동 분위기 사진 · Unsplash</a>';
    return '<section class="fd-hero fd-hero-photo" aria-label="오늘 운동 요약">'+img(D.PHOTOS.hero,'피트니스 운동 장면','fd-hero-image')+
      '<div class="fd-hero-shade"></div><div class="fd-hero-content"><span class="fd-overline"><i></i> FORMDAY / STRENGTH</span>'+
      '<h2>오늘도<br><em>기록 갱신하자.</em></h2>'+
      '<p>계획하고, 들어 올리고, 어제의 나를 넘어선다.</p>'+
      '<button class="fd-action-primary" data-fd-route="session">'+(unfinished?'운동 이어하기':'운동 시작')+' <span>↗</span></button></div>'+imageCredit+'</section>'+
      '<section class="fd-main-layout" aria-label="운동 대시보드">'+
      '<div class="fd-feature-card"><div class="fd-feature-icon">▤</div><div class="fd-feature-details"><span class="fd-overline">TODAY\'S TRAINING</span><h3>'+html(trainingTitle)+'</h3><p>'+html(trainingNote)+'</p></div>'+
      '<button class="fd-feature-go" data-fd-action="'+trainingAction+'" '+(strength?'data-fd-workout="'+html(strength.id)+'"':'')+' aria-label="'+trainingLabel+'">↗</button></div>'+
      '<div class="fd-metrics">'+banner('최근 체중',unit(a.weight),'<span>실제 완료된 측정 기록 기준</span>','⌁')+
      banner('이번 주 훈련',n(a.trainingDays)+' <small>일</small>','완료 본세트·유산소 완료 날짜 기준','▦')+
      banner('완료한 본세트',n(a.completedSets)+' <small>세트</small>','워밍업 제외 · 이번 주','◈')+
      banner('총 운동량',n(a.totalVolume)+' <small>kg</small>','완료한 웨이트 본세트만 합산','▰')+'</div>'+
      '<div class="fd-trend-link"><div><h3>체중과 섭취량의 변화</h3><p>몸무게 흐름과 기록한 칼로리를 기간별로 확인하세요.</p></div><button class="fd-outline" data-fd-route="progress">변화 그래프 보기 ↗</button></div>'+
      '<div class="fd-insight-grid"><div class="fd-panel fd-pr-panel"><div class="fd-panel-head"><span>◉</span><h3>PERFORMANCE · 추정 1RM</h3></div>'+
      (best?'<p class="fd-pr-name">'+html(best.name)+'</p><div class="fd-pr-number">'+n(best.oneRM)+' <small>kg</small></div><p class="fd-hint">'+html(best.date)+' 완료 세트 · '+n(best.weight)+'kg × '+best.reps+'회</p>':
      '<p class="fd-pr-empty">아직 추정 1RM 기록이 없습니다.</p><p class="fd-hint">완료한 1~10회 본세트가 쌓이면 Epley 공식을 사용해 추정합니다.</p>')+
      '<small class="fd-footnote">오늘까지의 전체 기록 중 최고 추정치입니다. 실제 1RM 또는 최대 시도 안전성을 보장하지 않습니다.</small></div>'+
      '<div class="fd-panel"><div class="fd-panel-head"><span>▥</span><h3>이번 주 부위별 볼륨</h3></div>'+progressByGroup(a)+
      '<button class="fd-text-link" data-fd-route="analysis">자세한 기록 분석 보기 →</button></div></div>'+
      '<div class="fd-photo-strip"><div>'+img(D.PHOTOS.equipment,'바벨과 웨이트가 있는 트레이닝 공간')+'<div class="fd-photo-strip-content"><span>EXERCISE LIBRARY</span><h3>운동 도감</h3><p>'+catalog.length+'개 종목 · 부위와 장비별 탐색</p><button data-fd-route="library">운동 찾아보기 ↗</button></div></div>'+
      '<div>'+img(D.PHOTOS.strength,'체력 훈련 이미지')+'<div class="fd-photo-strip-content"><span>WORKOUT LOG</span><h3>세트별 실행 기록</h3><p>중량 · 반복 · RPE · 휴식</p><button data-fd-route="session">오늘 운동 실행 ↗</button></div></div></div>'+
      '<p class="fd-home-notice">기기 동기화에서 계정 연결 상태를 확인하세요. 캘린더와 IRON MODE의 실제 운동 기록을 함께 집계하며, 체험용 샘플과 루틴 목표는 통계에 포함하지 않습니다.</p>'+
      '</section>';
  }
  function tiles(list){
    return list.map(ex=>'<button class="fd-exercise-tile '+(ex.name===selectedName?'is-active':'')+'" data-fd-exercise="'+html(ex.name)+'">'+
      '<div class="fd-exercise-photo fd-movement-photo">'+exerciseImage(ex)+'<span class="fd-muscle-label">'+html(ex.group)+'</span></div>'+
      '<div class="fd-exercise-info"><strong>'+html(ex.name)+'</strong><small>'+html(ex.equipment)+' / '+html(ex.group)+'</small></div><span class="fd-tile-arrow">↗</span></button>').join('');
  }
  function activeExercise(){
    return catalog.find(x=>x.name===selectedName)||catalog[0];
  }
  function detailMarkup(ex){
    if(!ex)return '';
    return '<div class="fd-exercise-detail"><div class="fd-detail-photo fd-movement-photo">'+exerciseImage(ex)+'</div>'+
      '<div class="fd-detail-body"><span class="fd-overline">EXERCISE GUIDE</span><h3>'+html(ex.name)+'</h3>'+
      '<div class="fd-exercise-tags"><span class="fd-tag-red">'+html(ex.group)+'</span><span>'+html(ex.equipment)+'</span></div>'+
      '<h4>기본 체크 포인트</h4><ul>'+ex.tips.map(t=>'<li>'+html(t)+'</li>').join('')+'</ul>'+
      '<button class="fd-action-primary fd-detail-add" data-fd-action="add-exercise" data-fd-name="'+html(ex.name)+'">＋ 이 종목으로 운동 시작</button>'+
      '<p class="fd-photo-note">종목을 구분하는 동작 삽화입니다. <a href="exercise-credits.html" target="_blank" rel="noopener noreferrer">운동 이미지 출처 ↗</a></p></div></div>';
  }
  function library(){
    return '<section class="fd-library-view"><div class="fd-section-heading"><div><span class="fd-overline">EXERCISE LIBRARY</span><h2>운동 도감 <em>'+catalog.length+' EXERCISES</em></h2><p>이름·부위·장비로 종목을 찾고 운동 기록에 추가하세요.</p></div></div>'+
      '<div class="fd-lib-search-box"><span>⌕</span><input id="fd-lib-search" type="search" autocomplete="off" placeholder="운동 이름 검색 · 벤치프레스, 풀업, 스쿼트..." value="'+html(query)+'" aria-label="운동 이름 검색"></div>'+
      '<div class="fd-filter-heading">운동 부위</div><div class="fd-filter-buttons">'+D.MUSCLES.map(g=>'<button data-fd-group="'+html(g)+'" class="'+(g===muscle?'active':'')+'">'+html(g)+'</button>').join('')+'</div>'+
      '<div class="fd-filter-heading">장비 종류</div><div class="fd-filter-buttons fd-equip-buttons">'+equipmentOptions.map(g=>'<button data-fd-equip="'+html(g)+'" class="'+(g===equipment?'active':'')+'">'+html(g)+'</button>').join('')+'</div>'+
      '<div class="fd-library-body"><div class="fd-library-list"><div class="fd-results-top"><h3>운동 종목</h3><small id="fd-lib-count"></small></div><div class="fd-exercise-grid" id="fd-lib-results"></div><button id="fd-lib-more" class="fd-outline-wide" hidden>운동 더 보기 ＋</button></div>'+
      '<aside id="fd-lib-detail" class="fd-detail-column"></aside></div>'+
      '<div class="fd-credits">운동 삽화: Bryl Lim · 일부 원저작물 Everkinetic / Greg Priday · CC BY-SA 4.0. <a href="exercise-credits.html" target="_blank" rel="noopener noreferrer">종목별 이미지 출처와 라이선스 ↗</a></div></section>';
  }
  function libraryResults(){
    if(screen!=='library')return;
    const normalized=query.trim().toLocaleLowerCase();
    const filtered=catalog.filter(e=>
      (muscle==='전체'||e.group===muscle) &&
      (equipment==='전체 장비'||e.equipment===equipment) &&
      (!normalized || e.name.toLocaleLowerCase().includes(normalized) || e.group.includes(normalized) || e.equipment.includes(normalized)));
    const list=$('#fd-lib-results'),counter=$('#fd-lib-count'),more=$('#fd-lib-more');
    if(!list)return;
    list.innerHTML=filtered.length?tiles(filtered.slice(0,pageSize)):'<div class="fd-no-exercise">검색 조건에 맞는 운동이 없습니다. 필터를 바꿔보세요.</div>';
    if(counter)counter.textContent=filtered.length+'개 결과';
    if(more){more.hidden=filtered.length<=pageSize;more.textContent='운동 더 보기 ('+(filtered.length-pageSize)+'개 남음) ＋';}
    if(!filtered.find(x=>x.name===selectedName))selectedName=filtered[0]?.name||'';
    const detail=$('#fd-lib-detail');
    if(detail)detail.innerHTML=detailMarkup(activeExercise() && filtered.find(x=>x.name===selectedName));
  }
  function strengthForToday(){
    const {state,a}=dataset();
    return {state,a,list:a.currentWorkout};
  }
  function session(){
    const {state,a,list}=strengthForToday();
    if(!list.length)return '<section class="fd-session-view"><div class="fd-section-heading"><div><span class="fd-overline">TRAINING SESSION</span><h2>오늘의 웨이트</h2></div></div>'+
      '<div class="fd-empty-workout"><div class="fd-empty-photo">'+img(D.PHOTOS.equipment,'트레이닝 기구 이미지')+'</div><h3>아직 오늘의 웨이트 일정이 없습니다.</h3>'+
      '<p>운동 도감에서 종목을 선택하거나 직접 루틴을 만들어 시작할 수 있습니다.</p><div class="fd-empty-actions"><button class="fd-action-primary" data-fd-action="new-strength">＋ 새 웨이트 등록</button><button class="fd-outline" data-fd-route="library">운동 도감 열기</button></div></div></section>';
    let record=list.find(x=>x.id===selectedWorkoutId)||list[0];
    selectedWorkoutId=record.id;
    const exs=record.detail.exercises||[];
    if(selectedExerciseIndex>=exs.length)selectedExerciseIndex=0;
    const ex=exs[selectedExerciseIndex];
    const allSets=workouts.summary(record.detail);
    const percentage=allSets.setCount?Math.round(allSets.completedSets/allSets.setCount*100):0;
    const past=D.records(core,state).filter(x=>x.type==='strength'&&x.date<a.today && x.detail.exercises.some(z=>z.name===ex.name))
      .sort((x,y)=>y.date.localeCompare(x.date))[0];
    const pastEx=past?.detail.exercises.find(z=>z.name===ex.name);
    const pastS=pastEx?.sets.filter(s=>s.done&&!s.warmup);
    const previous=pastS?.length?Math.max(...pastS.map(x=>x.weight))+'kg · '+pastS.length+'세트 수행':'이전 완료 기록 없음';
    const nameInfo=D.info(ex.name,workouts.catalog);
    return '<section class="fd-session-view"><div class="fd-session-head"><div><span class="fd-overline">LIVE WORKOUT · '+html(a.today)+'</span><h2>운동 진행</h2></div><button class="fd-outline" data-fd-action="edit-workout">전체 루틴 수정 ↗</button></div>'+
      '<div class="fd-workout-picker">'+list.map(e=>'<button data-fd-pick-workout="'+html(e.id)+'" class="'+(e.id===record.id?'selected':'')+'">'+html(e.title)+'</button>').join('')+'</div>'+
      '<div class="fd-session-progress"><div class="fd-session-progress-label"><b>'+html(record.title)+'</b><span>'+allSets.completedSets+' / '+allSets.setCount+' SETS · '+percentage+'%</span></div><div class="fd-progress-track"><i style="width:'+percentage+'%"></i></div></div>'+
      '<div class="fd-session-grid"><div class="fd-session-main"><div class="fd-workout-image">'+img(nameInfo.photo,nameInfo.group+' 웨이트 트레이닝 대표 이미지')+
      '<div class="fd-image-caption"><span>'+html(nameInfo.group)+'</span><strong>'+html(ex.name)+'</strong><small>'+html(nameInfo.equipment)+' · '+(selectedExerciseIndex+1)+' / '+exs.length+' 종목</small></div></div>'+
      '<div class="fd-prev-box"><div><span>◷ 이전 같은 종목</span><strong>'+html(previous)+'</strong></div><div><span>▣ 현재 세션 운동량</span><strong>'+n(allSets.volume)+' kg</strong></div></div>'+
      '<div class="fd-set-panel"><div class="fd-set-top"><h3>세트 기록</h3><small>중량 · 반복 · RPE를 확인 후 저장</small></div><div class="fd-set-head"><span>SET</span><span>중량 kg</span><span>횟수</span><span>RPE</span><span>완료</span><span>저장</span></div>'+
      ex.sets.map((s,i)=>'<div class="fd-set-row '+(s.done?'is-done':'')+'" data-fd-set="'+html(s.id)+'"><span class="fd-set-index">'+(i+1)+(s.warmup?'<small>W</small>':'')+'</span>'+
      '<input class="fd-set-weight" type="number" min="0" max="2000" step="0.5" value="'+s.weight+'" aria-label="'+(i+1)+'세트 중량">'+
      '<input class="fd-set-reps" type="number" min="1" max="1000" step="1" value="'+s.reps+'" aria-label="'+(i+1)+'세트 횟수">'+
      '<input class="fd-set-rpe" type="number" min="1" max="10" step="0.5" placeholder="–" value="'+(s.rpe??'')+'" aria-label="'+(i+1)+'세트 RPE">'+
      '<label class="fd-set-check"><input type="checkbox" '+(s.done?'checked':'')+' aria-label="'+(i+1)+'세트 완료"></label>'+
      '<button class="fd-set-save" data-fd-save-set="'+html(s.id)+'" data-fd-exercise-id="'+html(ex.id)+'">저장</button></div>').join('')+
      '<p class="fd-set-hint">W는 워밍업을 뜻하며 볼륨 분석에서 제외됩니다. 완료한 세트만 집계됩니다.</p></div>'+
      '<div class="fd-session-footer"><button class="fd-outline" data-fd-prev-exercise '+(selectedExerciseIndex===0?'disabled':'')+'>← 이전 종목</button><button class="fd-action-primary" data-fd-next-exercise '+(selectedExerciseIndex===exs.length-1?'disabled':'')+'>다음 종목 →</button></div></div>'+
      '<aside class="fd-session-side"><div class="fd-timer-card"><span class="fd-overline">REST TIMER</span><div class="fd-timer-ring"><strong id="fd-rest-clock">02:00</strong><small>휴식 타이머</small></div>'+
      '<div class="fd-timer-preset"><button data-fd-time="60">60초</button><button data-fd-time="90">90초</button><button data-fd-time="120">120초</button><button data-fd-time="180">180초</button></div>'+
      '<div class="fd-timer-buttons"><button data-fd-timer="toggle" class="fd-action-primary" id="fd-timer-toggle">시작</button><button data-fd-timer="reset" class="fd-outline">초기화</button></div><p>페이지를 닫거나 새로고침하면 타이머는 재설정됩니다.</p></div>'+
      '<div class="fd-panel fd-trainer-tips"><h3>운동 체크 포인트</h3><ul>'+nameInfo.tips.map(t=>'<li>'+html(t)+'</li>').join('')+'</ul><small>기본 안내이며 개인에게 맞는 정확한 자세 지도를 대체하지 않습니다.</small></div></aside></div></section>';
  }
  function analysis(){
    const {a}=dataset();
    const groups=Object.entries(a.byGroup).sort((x,y)=>y[1]-x[1]);
    const weights=[...a.prMap.values()].sort((x,y)=>y.oneRM-x.oneRM).slice(0,8);
    return '<section class="fd-analysis"><div class="fd-section-heading"><div><span class="fd-overline">TRAINING ANALYTICS</span><h2>숫자로 보는 성장</h2><p>이번 주 기록과 실제 완료한 운동만 집계했습니다.</p></div></div>'+
      '<div class="fd-metrics fd-analysis-metrics">'+banner('운동한 날짜',n(a.trainingDays)+' <small>일</small>','이번 주','▦')+
      banner('기록한 웨이트',n(a.strengthSessions)+' <small>회</small>','이번 주 완료 본세트가 있는 운동','◉')+
      banner('완료 본세트',n(a.completedSets)+' <small>세트</small>','워밍업 제외','▥')+
      banner('총 볼륨',n(a.totalVolume)+' <small>kg</small>','중량 × 횟수 합계','▰')+'</div>'+
      '<div class="fd-insight-grid"><div class="fd-panel"><h3>이번 주 부위별 웨이트 볼륨</h3>'+progressByGroup(a)+'</div><div class="fd-panel"><h3>종목별 추정 1RM · 전체 기록</h3>'+
      (weights.length?weights.map(x=>'<div class="fd-pr-line"><span>'+html(x.name)+'</span><strong>'+n(x.oneRM)+' kg</strong></div>').join(''):'<p class="fd-hint">완료한 본세트 기록이 쌓이면 표시됩니다.</p>')+
      '<p class="fd-footnote">오늘까지의 1~10회 완료 본세트 · Epley 추정식. 실제 최대 중량과 다를 수 있습니다.</p></div></div>'+
      '<button class="fd-outline" data-fd-route="calendar">캘린더에서 상세 기록 보기 →</button></section>';
  }
  function render(navigation=false){
    // Data refreshes must not steal the screen or unsaved inputs from IRON.
    if(!navigation&&document.body.dataset.fdScreen==='independent')return;
    top(screen);
    node.innerHTML=screen==='home'?home():screen==='library'?library():screen==='session'?session():screen==='analysis'?analysis():'';
    if(screen==='progress'&&navigation)root.FormdayProgress?.render?.();
    if(screen==='library')libraryResults();
    if(screen==='session')paintTimer();
  }
  function stamp(){
    const seconds=Math.ceil(timerRunning?Math.max(0,(timerDeadline-Date.now())/1000):timerRemaining);
    return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  }
  function paintTimer(){
    if(screen!=='session')return;
    if(timerRunning&&Date.now()>=timerDeadline){timerRunning=false;timerRemaining=0;}
    const display=$('#fd-rest-clock');if(display)display.textContent=stamp();
    const ring=$('.fd-timer-ring');
    if(ring)ring.style.setProperty('--fd-timer-angle',((1-(timerRunning?Math.max(0,(timerDeadline-Date.now())/1000):timerRemaining)/timerDuration)*360)+'deg');
    const toggle=$('#fd-timer-toggle');
    if(toggle)toggle.textContent=timerRunning?'일시정지':timerRemaining<=0?'다시 시작':'시작';
  }
  function startRest(){
    timerRemaining=timerDuration;timerDeadline=Date.now()+timerDuration*1000;timerRunning=true;paintTimer();
  }
  function changeTimer(action){
    if(action==='reset'){timerRemaining=timerDuration;timerRunning=false;}
    else if(timerRunning){timerRemaining=Math.max(0,(timerDeadline-Date.now())/1000);timerRunning=false;}
    else{if(timerRemaining<=0)timerRemaining=timerDuration;timerDeadline=Date.now()+timerRemaining*1000;timerRunning=true;}
    paintTimer();
  }
  function onClick(event){
    const button=event.target.closest('button');
    if(!button||button.disabled)return;
    if(button.dataset.fdRoute){event.preventDefault();setScreen(button.dataset.fdRoute);return;}
    if(button.dataset.fdGroup){muscle=button.dataset.fdGroup;pageSize=18;render();return;}
    if(button.dataset.fdEquip){equipment=button.dataset.fdEquip;pageSize=18;render();return;}
    if(button.dataset.fdExercise){selectedName=button.dataset.fdExercise;libraryResults();return;}
    if(button.id==='fd-lib-more'){pageSize+=18;libraryResults();return;}
    if(button.dataset.fdPickWorkout){selectedWorkoutId=button.dataset.fdPickWorkout;selectedExerciseIndex=0;render();return;}
    if(button.hasAttribute('data-fd-next-exercise')){selectedExerciseIndex++;render();return;}
    if(button.hasAttribute('data-fd-prev-exercise')){selectedExerciseIndex=Math.max(0,selectedExerciseIndex-1);render();return;}
    if(button.dataset.fdTimer) {changeTimer(button.dataset.fdTimer);return;}
    if(button.dataset.fdTime){timerDuration=Number(button.dataset.fdTime);timerRemaining=timerDuration;timerRunning=false;paintTimer();return;}
    const action=button.dataset.fdAction;
    if(action==='resume-workout'){openWorkout('session');return;}
    if(action==='choose-routine'){openWorkout('routines');return;}
    if(action==='retry-workout'){root.location.reload();return;}
    if(action==='open-legacy'){bridge.editStrength(button.dataset.fdWorkout,bridge.getToday());return;}
    if(action==='add-exercise'){openWorkout('start',{exercise:button.dataset.fdName});return;}
    if(action==='new-strength'){bridge.openStrength(null,bridge.getToday());return;}
    if(action==='start-workout'){selectedWorkoutId=button.dataset.fdWorkout||null;selectedExerciseIndex=0;setScreen('session');return;}
    if(action==='edit-workout'){const {a}=dataset();bridge.editStrength(selectedWorkoutId||a.currentWorkout[0]?.id,a.today);return;}
    if(button.dataset.fdSaveSet){
      const row=button.closest('[data-fd-set]');
      const before=dataset().a.currentWorkout.find(x=>x.id===selectedWorkoutId);
      const ex=before?.detail.exercises.find(x=>x.id===button.dataset.fdExerciseId);
      const previous=ex?.sets.find(s=>s.id===button.dataset.fdSaveSet);
      const done=row.querySelector('.fd-set-check input').checked;
      const ok=bridge.saveSet({
        eventId:selectedWorkoutId,date:bridge.getToday(),exerciseId:button.dataset.fdExerciseId,setId:button.dataset.fdSaveSet,
        weight:row.querySelector('.fd-set-weight').value,reps:row.querySelector('.fd-set-reps').value,
        rpe:row.querySelector('.fd-set-rpe').value,done
      });
      if(ok&&done&&!previous?.done)startRest();
    }
  }
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-ind-nav]')&&!root.FormdayIndependent){e.preventDefault();openWorkout('home');return;}
    const target=e.target.closest('[data-fd-route],[data-fd-action],[data-fd-group],[data-fd-equip],[data-fd-exercise],[data-fd-pick-workout],[data-fd-next-exercise],[data-fd-prev-exercise],[data-fd-save-set],[data-fd-timer],[data-fd-time],#fd-lib-more');
    if(target)onClick(e);
    // app.js may have replaced the mini-calendar DOM earlier in this click.
    // The date attribute survives on the original target; its ancestor does not.
    else if(e.target.closest('[data-go]')||e.target.closest('[data-mobile="calendar"]')||e.target.closest('[data-mini]')) {
      setScreen('calendar');
    }
  });
  node.addEventListener('input',e=>{
    if(e.target.id==='fd-lib-search'){query=e.target.value;pageSize=18;libraryResults();}
  });
  root.addEventListener('formday:changed',()=>render());
  root.addEventListener('formday:iron-changed',()=>render());
  root.addEventListener('focus',()=>{if(screen==='home'||screen==='analysis')render();});
  root.setInterval(paintTimer,1000);
  render();
})(typeof window!=='undefined'?window:globalThis);
