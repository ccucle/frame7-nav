(function () {
  'use strict';
  const C = globalThis.FormdayCore, W = globalThis.FormdayWorkouts, N = globalThis.FormdayNutrition, M = globalThis.FormdayMeals, A = globalThis.FormdayIronData, K = globalThis.FormdayCalendarWorkouts;
  const { TYPES, DAYS } = globalThis.FormdayData;
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const z = n => String(n).padStart(2, '0'), iso = C.iso, dateOf = C.dateOf, moveDay = C.shiftDate, uid = C.uid;
  const defaults = C.defaults || { protein: 150, carbs: 200, fat: 50 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (n, digits = 0) => (Number(n) || 0).toLocaleString('ko-KR', {maximumFractionDigits: digits});
  const styl = type => { const t = TYPES[type]; return `--c:${t.color};--soft:${t.soft};--txt:${t.text}`; };
  let now = new Date(), today = iso(now), toastTimer, undoState = null, modalController = null, modalDirty = false, priorFocus = null;
  let storageAccessError = '';
  let persistence;
  try { persistence = C.makeStore(window.localStorage); }
  catch (error) { storageAccessError = '이 브라우저의 저장 공간에 접근할 수 없습니다.'; persistence = C.makeStore({getItem(){throw error;}, setItem(){throw error;}}); }
  const loaded = persistence.load();
  let blockedLoad = loaded.error || storageAccessError, corruptRaw = loaded.raw;
  let data = loaded.data || C.normalizeState({events: blockedLoad ? [] : buildSample(), settings: {...defaults}, demo: !blockedLoad});
  let view = 'month', cursor = dateOf(today), selected = today, visibleTypes = new Set(Object.keys(TYPES)), searchTerm = '';
  let externalChange = false;
  let catalogPromise = null;
  // Presentation state only. Both views use the same detail DOM and existing stores.
  let daySheetDate = null, daySheetSuspended = false, daySheetPriorFocus = null, daySheetScroll = 0;
  const detailDay = () => daySheetDate || today;

  function showDaySheet() {
    const sheet = $('#fd-day-sheet'), panel = $('#fd-day-detail');
    if (panel.parentElement !== sheet) sheet.appendChild(panel);
    if (!sheet.open) sheet.showModal();
    document.body.classList.add('fd-day-sheet-open');
  }
  function closeDayDetail({restoreFocus = true, refresh = true} = {}) {
    const sheet = $('#fd-day-sheet'), panel = $('#fd-day-detail');
    const focus = daySheetPriorFocus;
    daySheetDate = null; daySheetSuspended = false; daySheetPriorFocus = null;
    if (sheet.open) sheet.close();
    $('#fd-day-inline').appendChild(panel);
    document.body.classList.remove('fd-day-sheet-open');
    if (refresh) { renderStats(); renderRight(); window.FormdayIndependent?.renderCalendar?.(); }
    if (restoreFocus) {
      const target = focus?.isConnected ? focus : document.querySelector('[data-day="' + selected + '"]');
      target?.focus?.({preventScroll:true});
    }
  }
  function openDayDetail(day) {
    if (!C.validDate(day) || $('#modal-root').children.length) return false;
    const focus = document.activeElement;
    selected = day; cursor = dateOf(day);
    if (day === today) closeDayDetail({restoreFocus:false, refresh:false});
    else {
      if (!daySheetDate) daySheetPriorFocus = focus;
      daySheetDate = day; daySheetSuspended = false;
    }
    render();
    if (day === today) {
      requestAnimationFrame(() => {
        if ($('#modal-root').children.length || daySheetDate) return;
        $('#right-date').focus({preventScroll:true});
        $('#fd-day-detail').scrollIntoView({block:'start', behavior:'smooth'});
      });
    } else {
      showDaySheet(); $('#fd-day-sheet').scrollTop = 0;
      $('#right-date').focus({preventScroll:true});
    }
    return true;
  }
  function suspendDaySheet() {
    const sheet = $('#fd-day-sheet');
    if (!sheet.open) return;
    daySheetScroll = sheet.scrollTop; daySheetSuspended = true;
    sheet.close(); document.body.classList.remove('fd-day-sheet-open');
  }
  function resumeDaySheet() {
    if (!daySheetSuspended) return;
    daySheetSuspended = false;
    if (daySheetDate === today) { closeDayDetail({restoreFocus:false}); return; }
    if (daySheetDate) { showDaySheet(); $('#fd-day-sheet').scrollTop = daySheetScroll; }
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = (async () => {
        const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),20000);
        try {
          const response = await fetch('food-catalog.json?v=0.3.0',{signal:controller.signal});
          if(!response.ok) throw new Error('식품 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
          const catalog = await response.json();
          if(!catalog.meta || !Array.isArray(catalog.foods) || !catalog.foods.length) throw new Error('식품 목록 형식을 확인할 수 없습니다.');
          return catalog;
        } finally {clearTimeout(timeout);}
      })().catch(error=>{catalogPromise=null;throw new Error(error.name==='AbortError'?'식품 목록 연결 시간이 초과되었습니다. 내 식품과 기존 기록은 계속 사용할 수 있습니다.':error.message);});
    }
    return catalogPromise;
  }

  function saveCustomFood(food) {
    const validated = N.validateFood(food);
    if(!commit(N.upsertCustomFood(data,validated),'내 식품에 저장했습니다. 기존 식단 기록의 영양성분은 유지됩니다.'))return null;
    return C.clone(data.customFoods.find(x=>x.id===validated.id));
  }
  function deleteCustomFood(id) {
    return commit(N.removeCustomFood(data,id),'내 식품에서 삭제했습니다. 이미 기록한 식단은 유지됩니다.');
  }
  function toggleFavoriteFood(id) {
    return commit(N.toggleFavorite(data,id),'즐겨찾기를 저장했습니다.');
  }

  function buildSample() {
    const monday = moveDay(today, -((now.getDay() + 6) % 7));
    const list = [];
    for (let i = 0; i < 7; i++) {
      const day = moveDay(monday, i), wd = dateOf(day).getDay();
      if ([1,3,5].includes(wd)) list.push({id:uid(),date:day,start:'07:00',end:'08:15',type:'strength',title:wd===3?'하체 집중 루틴':'상체 웨이트 루틴',repeat:'none',completed:false,detail:{exercise:wd===3?'스쿼트':'벤치프레스',sets:4,weight:40,reps:10,notes:'체험용 예시입니다.'}});
      if ([2,6].includes(wd)) list.push({id:uid(),date:day,start:'07:30',end:'08:05',type:'cardio',title:'가벼운 러닝',repeat:'none',completed:false,detail:{cardio:'러닝',minutes:35,distance:5,intensity:'보통'}});
    }
    list.push({id:uid(),date:today,start:'08:30',end:'08:45',type:'meal',title:'그릭요거트 200g',repeat:'none',completed:true,detail:{food:'그릭요거트(무지방)',grams:200}});
    list.push({id:uid(),date:today,start:'12:30',end:'13:00',type:'meal',title:'닭가슴살 150g',repeat:'none',completed:true,detail:{food:'닭가슴살(조리)',grams:150}});
    for (let i=0; i<3; i++) list.push({id:uid(),date:moveDay(today,-i*3),start:'06:40',end:'06:45',type:'weight',title:'체중 측정 예시',repeat:'none',completed:true,detail:{weight:80+i*.2,bodyfat:null}});
    return list.map(event => ({...event,isSample:true}));
  }

  function commit(next, message, options) {
    try {
      if (blockedLoad && !options?.recovery) throw new Error('기존 기록을 읽지 못했습니다. 원본을 내보내거나 정상 백업을 가져와 주세요.');
      const before = C.clone(data);
      const saved = persistence.save(next, data.revision || '', options?.recovery ? {expectedRaw:corruptRaw} : undefined);
      data = saved; undoState = options?.recovery ? null : before;
      blockedLoad = ''; externalChange = false; corruptRaw = null;
      render(); window.dispatchEvent(new CustomEvent('formday:changed')); if (message) toast(message); return true;
    } catch (error) {
      if (error.code === 'STORAGE_CONFLICT') externalChange = true;
      showStorageState(error.message || '저장하지 못했습니다. 입력 내용은 이 창에 유지됩니다.', true);
      toast(error.message || '저장하지 못했습니다. 입력 내용을 확인해 주세요.', true); return false;
    }
  }
  function showStorageState(message, error) {
    const node = $('#storage-status');
    node.classList.toggle('storage-error', !!error);
    node.innerHTML = `<span>${esc(message || '이 기기에 저장됩니다 · 기기 동기화에서 연결 상태를 확인하세요.')}</span>${blockedLoad?'<button class="btn btn-small btn-outline" id="export-raw">원본 내보내기</button>':''}${externalChange?'<button class="btn btn-small btn-outline" id="reload-records">최신 기록 불러오기</button>':''}`;
    const dayStatus=$('#fd-day-status');
    dayStatus.hidden=!error;dayStatus.dataset.error=String(!!error);
    dayStatus.textContent=error?message:'';
    $('#export-raw')?.addEventListener('click',()=>downloadText(corruptRaw || '', 'formday-original-backup.txt', 'text/plain'));
    $('#reload-records')?.addEventListener('click',loadLatest);
  }
  function loadLatest() {
    if (modalDirty && !confirm('입력 중인 변경을 취소하고 다른 탭의 최신 기록을 불러올까요?')) return;
    const fresh = persistence.load();
    if (fresh.error) { blockedLoad=fresh.error;corruptRaw=fresh.raw;showStorageState(fresh.error,true); return; }
    if (fresh.data) data=fresh.data;
    else data=C.normalizeState({events:[],settings:{...defaults}});
    blockedLoad='';corruptRaw=null;externalChange=false; undoState=null; closeModal(true); render();
    window.dispatchEvent(new CustomEvent('formday:changed'));toast('최신 기록을 불러왔습니다.');
  }
  function trainingIndex(){
    const map=new Map();
    for(const s of window.FormdayIndependent?.getSnapshot?.()?.sessions||[]){
      const source=s.calendarSource;
      if(source)map.set(source.eventId+':'+source.date,s);
    }
    return map;
  }
  function getDay(day,filtered=true,training=trainingIndex()) {
    return C.dayEvents(data,day).filter(e=>!filtered || (visibleTypes.has(e.type) && (!searchTerm || `${e.title} ${details(e)} ${(e.detail.exercises||[]).map(x=>x.name).join(' ')} ${(e.detail.items||[]).map(x=>[x.food.name,x.food.nameEn,x.food.brand].join(' ')).join(' ')}`.toLocaleLowerCase().includes(searchTerm)))).map(event=>{
      const session=event.type==='strength'?training.get(event.id+':'+day):null;
      return {event:event.type==='strength'?{...event,trainingCompletion:K.calendarCompletion(event,session),trainingLinked:!!(session||event.workoutSessionId)}:event,date:day};
    });
  }
  const completionOf=event=>event.trainingCompletion||K.completion(event);
  const isDone=event=>event.type==='strength'?completionOf(event).state==='complete':!!event.completed;
  const isPartial=event=>event.type==='strength'&&completionOf(event).state==='partial';
  const isShortComplete=event=>event.type==='strength'&&isDone(event)&&completionOf(event).done<completionOf(event).total;
  const stateText=event=>isPartial(event)?'부분 완료':isDone(event)?'운동 완료':'예정';
  function strengthCompleted(detail,event,day){
    const sum=W.summary(detail);
    if(!sum.completedSets)return false;
    if(event.workoutSessionId){
      const linked=trainingIndex().get(event.id+':'+day);
      if(linked?.id===event.workoutSessionId&&['COMPLETED','PARTIAL'].includes(linked.status))return linked.status==='COMPLETED';
      return event.completed===true;
    }
    return sum.setCount>0&&sum.completedSets===sum.setCount;
  }
  const getWeightRecords = until => C.weightRecords(data,until>today?today:until);
  function nutritionFor(day) {
    const totals={kcal:0,protein:0,carbs:0,fat:0,unsat:0,itemCount:0,legacyCount:0,missing:{kcal:0,protein:0,carbs:0,fat:0,unsat:0}};
    for (const {event} of getDay(day,false)) {
      if (event.type!=='meal' || !event.completed || event.isSample || day>today) continue;
      const values=N.calculateMeal(event.detail);
      for(const key of ['kcal','protein','carbs','fat','unsat']) {totals[key]+=values[key];totals.missing[key]+=values.missing[key];}
      totals.itemCount+=values.itemCount;totals.legacyCount+=values.legacyCount;
    }
    return totals;
  }
  function nutrientText(totals,key) {
    if(totals.itemCount && totals.missing[key]===totals.itemCount)return '미확인';
    return fmt(totals[key],1)+(totals.missing[key]?' +':'');
  }
  function renderNutrition() {
    const n=nutritionFor(detailDay()),g=data.settings,kgoal=g.protein*4+g.carbs*4+g.fat*9;
    const labels={kcal:'칼로리',protein:'단백질',carbs:'탄수화물',fat:'총 지방',unsat:'불포화지방'};
    const macro=(key,color)=>`<div class="macro-row"><div class="macro-caption"><span>${labels[key]}</span><span>${nutrientText(n,key)} / ${fmt(g[key])}g</span></div><div class="macro-track"><div class="macro-fill" style="width:${Math.min(100,n[key]/Math.max(g[key],.001)*100)}%;background:${color}"></div></div></div>`;
    $('#nutrition').innerHTML=`<div class="calories-header"><span class="nutrition-caption">섭취한 칼로리</span><span class="kcal-amount">${nutrientText(n,'kcal')} <small>/ ${fmt(kgoal)}kcal</small></span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,n.kcal/kgoal*100)}%"></div></div>${macro('protein','#23836a')}${macro('carbs','#d38944')}${macro('fat','#3877c9')}<div class="unsat-total"><span>그중 불포화지방</span><strong>${nutrientText(n,'unsat')}${n.itemCount&&n.missing.unsat===n.itemCount?'':'g'}</strong></div>`;
    const missing=Object.keys(labels).filter(key=>n.missing[key]);
    if(missing.length)$('#nutrition').insertAdjacentHTML('beforeend',`<p class="helper missing-info">${missing.map(key=>labels[key]+' '+n.missing[key]+'개 식품').join(' · ')} 미확인.<br>+ 표시는 확인된 값만 더한 부분 합계입니다. 미확인 값을 0으로 간주하지 않습니다.</p>`);
    if(n.legacyCount)$('#nutrition').insertAdjacentHTML('beforeend',`<p class="helper legacy-info">기존 샘플 영양정보 ${n.legacyCount}개 포함 · 저장 당시 수치를 유지합니다.</p>`);
    $('#nutrition-source-note').textContent='오늘까지의 실제 식사 완료 기록만 합산하며 체험용 샘플은 제외합니다. 식품별 출처와 기준량은 편집창에서 확인하세요. 불포화지방은 총 지방에 포함됩니다.';
  }
  function details(event) {
    const d=event.detail;
    if(event.type==='strength') return W.describe(d);
    if(event.type==='cardio') return `${d.cardio} · ${d.minutes}분${d.distance?' · '+d.distance+'km':''} · ${d.intensity||'보통'}`;
    if(event.type==='meal') return N.describeMeal(d);
    return d.weight==null?'측정 전':`${fmt(d.weight,1)}kg${d.bodyfat==null?'':' · 체지방 '+fmt(d.bodyfat,1)+'%'}`;
  }
  function dayLabel(day) {const d=dateOf(day);return `${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;}
  function prettyHeading() {
    if(view==='month')return `${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`;
    if(view==='day')return `${cursor.getFullYear()}년 ${cursor.getMonth()+1}월 ${cursor.getDate()}일`;
    const start=dateOf(moveDay(iso(cursor),-cursor.getDay())),end=dateOf(moveDay(iso(start),6));
    return `${start.getFullYear()}년 ${start.getMonth()+1}월 ${start.getDate()}일–${end.getMonth()+1}월 ${end.getDate()}일`;
  }

  function renderStats() {
    const day=detailDay();
    const sum=A.daySummary(C,data,window.FormdayIndependent?.getSnapshot?.(),day,new Date());
    const n=nutritionFor(day),g=data.settings,weights=getWeightRecords(day);
    $('#stat-workout').textContent=`${sum.completedWorkouts} / ${sum.workoutCount}`;
    $('#stat-workout-note').textContent=(sum.partialWorkouts?'부분 완료 '+sum.partialWorkouts+'회 · ':'')+'운동 완료 / 등록 운동';
    $('#stat-kcal').innerHTML=`${nutrientText(n,'kcal')} <small>kcal</small>`;
    $('#stat-kcal-note').textContent=`목표 ${fmt(g.protein*4+g.carbs*4+g.fat*9)} kcal · 완료 식단${n.missing.kcal?' · 일부 미확인':''}`;
    $('#stat-protein').innerHTML=`${nutrientText(n,'protein')} <small>g</small>`;
    $('#stat-protein-note').textContent=n.missing.protein?`단백질 미확인 식품 ${n.missing.protein}개 · 입력된 값만 합산`:(g.protein>0?`목표 ${g.protein}g 중 ${Math.round(n.protein/g.protein*100)}%`:'단백질 목표가 0g으로 설정되어 있습니다');
    $('#stat-weight').innerHTML=weights.length?`${fmt(weights.at(-1).detail.weight,1)} <small>kg</small>`:'—';
    $('#stat-weight-note').textContent=weights.length?`${weights.at(-1).date} ${weights.at(-1).start} 측정`:'완료한 측정 기록이 없습니다';
    $('#workout-progress').innerHTML=`<div><span>완료 본세트</span><strong>${sum.completedSets}<small> / ${sum.setCount}</small></strong></div><div><span>완료 운동량</span><strong>${fmt(sum.volume,1)}<small> kg</small></strong></div><p>실제 완료 본세트의 중량 × 횟수 · 워밍업·샘플 제외${sum.partialWorkouts?' · 부분 완료 '+sum.partialWorkouts+'회':''}</p>`;
  }
  function timeTop(value) {const [h,m]=value.split(':').map(Number);return (h+m/60)*55;}
  function layoutIntervals(events) {
    const items=events.map(e=>({event:e,top:timeTop(e.start),bottom:Math.max(timeTop(e.start)+28,timeTop(e.end))})).sort((a,b)=>a.top-b.top||a.bottom-b.bottom);
    let group=[],ends=[],maxEnd=-1;
    function flush(){const count=ends.length;group.forEach(item=>item.columns=count);group=[];ends=[];}
    for(const item of items){
      if(item.top>=maxEnd){flush();maxEnd=-1;}
      let col=ends.findIndex(end=>end<=item.top);if(col<0)col=ends.length;
      ends[col]=item.bottom;item.column=col;group.push(item);maxEnd=Math.max(maxEnd,item.bottom);
    }
    flush();return items;
  }
  function renderTime() {
    const dates=view==='day'?[iso(cursor)]:Array.from({length:7},(_,i)=>moveDay(iso(cursor),i-cursor.getDay()));
    const head='<div class="week-top"><span></span>'+dates.map(day=>{const d=dateOf(day);return `<button class="wt ${day===today?'today':''}" data-day="${day}">${DAYS[d.getDay()]}<strong>${d.getDate()}</strong></button>`;}).join('')+'</div>';
    let labels='<div class="time-labels">';for(let h=1;h<24;h++)labels+=`<div style="top:${h*55}px">${z(h)}:00</div>`;labels+='</div>';
    const training=trainingIndex();
    const lanes=dates.map(day=>`<div class="day-lane ${day===today?'today':''}" data-lane="${day}" aria-label="${dayLabel(day)}">${layoutIntervals(getDay(day,true,training).map(x=>x.event)).map(({event:e,top,bottom,column,columns})=>`<button class="time-event ${isDone(e)?'done':isPartial(e)?'partial':''} ${isShortComplete(e)?'ended-short':''}" data-edit="${esc(e.id)}" data-occdate="${day}" style="${styl(e.type)};top:${top+2}px;height:${Math.max(26,bottom-top-4)}px;left:calc(${column/columns*100}% + 2px);width:calc(${100/columns}% - 4px);right:auto" aria-label="${esc(e.title)} ${e.start}–${e.end}"><strong>${esc(e.title)}</strong><small>${e.start}–${e.end}${isShortComplete(e)?' · 완료 '+completionOf(e).done+'/'+completionOf(e).total+'세트':isDone(e)?' ✓':isPartial(e)?' · 부분 완료':''}</small></button>`).join('')}</div>`).join('');
    return `<div class="time-view-wrap ${view==='day'?'daymode':''}" id="time-view"><div class="time-scroll">${head}<div class="time-body">${labels}${lanes}</div></div></div>`;
  }
  let lastCalendarKey='';
  function render() {
    const key=view+iso(cursor),oldScroll=key===lastCalendarKey?$('#time-view')?.scrollTop:null;
    renderFilters();renderMini();$('#date-heading').textContent=prettyHeading();
    $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
    $('#calendar').innerHTML=view==='month'?renderMonth():renderTime();
    renderStats();renderRight();$('#demo-banner').classList.toggle('hide',!data.events.some(e=>e.isSample));
    $('#undo-btn').disabled=!undoState || !!blockedLoad || externalChange;
    if(blockedLoad) showStorageState('저장된 기록을 읽지 못했습니다. 원본을 보존했습니다. 백업 복원이 필요합니다.',true);
    else if(externalChange) showStorageState('다른 탭에서 기록이 변경됐습니다. 최신 기록을 불러온 후 저장해 주세요.',true);
    else showStorageState();
    if(view!=='month')requestAnimationFrame(()=>{if($('#time-view'))$('#time-view').scrollTop=oldScroll??310;});
    lastCalendarKey=key;
    window.FormdayIndependent?.renderCalendar?.();
  }
  function toast(message,error=false) {
    $('#toast-root').innerHTML=`<div class="toast ${error?'toast-error':''}">${esc(message)}</div>`;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast-root').innerHTML='',error?6500:3200);
    if($('#fd-day-sheet').open){
      const status=$('#fd-day-status');status.textContent=message;
      status.dataset.error=String(error);status.hidden=false;
      if(error)status.scrollIntoView({block:'nearest'});
    }
  }
  function chooseDay(day) {selected=day;cursor=dateOf(day);render();}
  function navigate(direction) {
    if(view==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()+direction,1);
    else cursor=dateOf(moveDay(iso(cursor),direction*(view==='week'?7:1)));
    selected=iso(cursor);render();
  }

  function closeModal(force=false) {
    if(!force && modalDirty && !confirm('저장하지 않은 변경을 취소할까요?'))return false;
    modalController?.destroy();modalController=null;modalDirty=false;
    $('#modal-root').innerHTML='';$('.app').inert=false;$('.mobile-nav').inert=false;
    resumeDaySheet();
    if(priorFocus?.isConnected)priorFocus.focus({preventScroll:true});priorFocus=null;return true;
  }
  function modal(title,body,actions,note='',wide=false) {
    if($('#modal-root').children.length)closeModal(true);
    priorFocus=document.activeElement;
    suspendDaySheet();
    $('#modal-root').innerHTML=`<div class="modal-overlay" id="overlay"><section class="modal ${wide?'modal-workout':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="circle-button" id="modal-close" aria-label="닫기">×</button></div><div class="modal-body">${body}<p id="form-error" class="form-error hide" role="alert"></p></div><div class="modal-actions">${actions}</div>${note?`<p class="modal-note">${esc(note)}</p>`:''}</section></div>`;
    $('.app').inert=true;$('.mobile-nav').inert=true;
    $('#modal-close').onclick=()=>closeModal();
    $('#overlay').onclick=e=>{if(e.target.id==='overlay')closeModal();};
    const trackInput=e=>{if(e.target?.id!=='f-scope'&&!e.target?.closest?.('[data-meal-ui-only]'))modalDirty=true;};
    $('#modal-root').oninput=trackInput;
    $('#modal-root').onchange=trackInput;
    $('#modal-close').focus();
  }
  function formError(error) {
    const message=error.message||String(error),node=$('#form-error');
    if(node){node.textContent=message;node.classList.remove('hide');node.scrollIntoView({block:'nearest'});}else toast(message,true);
  }
  function field(label,id,type='text',value='',extra='') {
    return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value??'')}" ${extra}></div>`;
  }
  function selectField(label,id,options,value,extra='') {
    return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}" ${extra}>${options.map(([k,v])=>`<option value="${esc(k)}" ${String(k)===String(value)?'selected':''}>${esc(v)}</option>`).join('')}</select></div>`;
  }
  function detailMarkup(type,d={}) {
    if(type==='strength')return '<div id="workout-editor"></div>';
    if(type==='cardio')return `<div class="fields">${selectField('유산소 종목','f-cardio',Array.from(new Set([d.cardio,'러닝','걷기','자전거','실내 사이클','계단오르기','로잉','수영','트레드밀 인터벌','하이킹'])).filter(Boolean).map(x=>[x,x]),d.cardio||'러닝')}${field('운동 시간 (분)','f-minutes','number',d.minutes??30,'min="0" max="1440" step="1" inputmode="decimal"')}${field('거리 (km)','f-distance','number',d.distance??0,'min="0" max="10000" step="0.1" inputmode="decimal"')}${selectField('운동 강도','f-intensity',['가벼움','보통','높음'].map(x=>[x,x]),d.intensity||'보통')}</div>`;
    if(type==='meal')return '<div id="meal-editor"></div>';
    return `<div class="fields">${field('체중 (kg)','f-bodyweight','number',d.weight??'','min="1" max="500" step="0.1" inputmode="decimal" placeholder="측정 후 입력"')}${field('체지방률 (%) · 선택','f-bodyfat','number',d.bodyfat??'','min="0" max="100" step="0.1" inputmode="decimal"')}</div><p class="helper">측정 완료로 체크한 기록만 그래프에 반영됩니다. 반복 계획에는 매번 새로 측정한 값을 입력하세요.</p>`;
  }
  function readDetail(type) {
    const v=id=>$('#'+id).value,n=id=>v(id).trim()===''?NaN:Number(v(id));
    if(type==='strength')return modalController.read();
    if(type==='cardio')return {cardio:v('f-cardio'),minutes:n('f-minutes'),distance:n('f-distance'),intensity:v('f-intensity')};
    if(type==='meal')return modalController.read();
    return {weight:v('f-bodyweight')===''?null:n('f-bodyweight'),bodyfat:v('f-bodyfat')===''?null:n('f-bodyfat')};
  }
  function mountDetails(type,detail,eventDate,scope) {
    modalController?.destroy();modalController=null;
    $('#dynamic-details').innerHTML=detailMarkup(type,detail);
    $('.modal').classList.toggle('modal-workout',type==='strength');
    $('.modal').classList.toggle('modal-meal',type==='meal');
    if(type==='strength'){
      modalController=W.mount($('#workout-editor'),W.normalize(detail),{history:C.history(data,'strength',eventDate),planOnly:scope==='series',onChange(draft,sum){
        modalDirty=true;
        if(scope!=='series'&&!$('#f-completed').disabled)$('#f-completed').checked=sum.setCount>0&&sum.completedSets===sum.setCount;
      }});
      if(scope==='series')$('#workout-editor').classList.add('plan-editor');
    }
    if(type==='meal')modalController=M.mount($('#meal-editor'),detail,{loadCatalog,customFoods:C.clone(data.customFoods),favoriteFoodIds:[...data.favoriteFoodIds],onSaveFood:saveCustomFood,onDeleteFood:deleteCustomFood,onToggleFavorite:toggleFavoriteFood,onChange(){modalDirty=true;}});
    if(type==='weight'&&scope==='series'){
      $('#f-bodyweight').disabled=true;$('#f-bodyfat').disabled=true;
      $('#dynamic-details .helper').textContent='이 화면에서는 반복 측정 일정을 설정합니다. 체중과 체지방률은 적용 범위를 “이 날짜만”으로 선택한 뒤 입력하세요.';
    }
  }

  function openEvent({event=null,date=selected,start='07:00',type=null,scope='occurrence',initialDetail=null,fromDayDetail=false}={}) {
    if(blockedLoad){toast('먼저 기록 백업을 복원해 주세요.',true);return;}
    const edit=!!event,recurring=edit&&event.repeat!=='none',returnToDay=fromDayDetail||daySheetDate!==null;
    const effective=recurring&&scope==='occurrence'?C.occurrence(event,date):event;
    if(recurring&&!effective){toast('이 날짜의 일정이 없습니다.',true);return;}
    const [hour,minute]=start.split(':').map(Number),endMinute=Math.min(1439,hour*60+minute+60);
    const item=effective?C.clone(effective):{id:uid(),date,start,end:`${z(Math.floor(endMinute/60))}:${z(endMinute%60)}`,type:type||'cardio',title:'',repeat:'none',repeatUntil:null,completed:false,detail:initialDetail||{},isSample:false};
    let currentType=item.type;
    if(currentType==='strength')item.detail=W.normalize(item.detail,item.completed);
    const titleLabel=recurring?(scope==='series'?'반복 기본 계획 수정':'이 날짜 기록 수정'):(edit?'일정 수정':'새 일정 등록');
    const repeatNote=recurring?'이 날짜 기록은 다른 날짜와 별도로 저장됩니다. 반복 기본 계획을 수정해도 이미 저장된 날짜별 기록은 유지됩니다.':'';
    const linkedTraining=!!(item.workoutSessionId||item.type==='strength'&&trainingIndex().has(item.id+':'+date));
    const completionLabel=()=>currentType==='strength'?(linkedTraining?'운동 종료 상태 · 실제 수행 기록 기준':'모든 세트 완료'):currentType==='meal'?'식사 완료':currentType==='weight'?'측정 완료':'운동 완료';
    const routines=edit?[]:(window.FormdayIndependent?.getSnapshot?.()?.routines||[]);
    const routinePicker=routines.length?`<div id="f-routine-field" class="field full ${currentType==='strength'?'':'hide'}">${selectField('저장한 루틴 불러오기','f-routine',[['','직접 구성'],...routines.map(r=>[r.id,r.name])],'')}<p class="helper">선택한 날짜의 운동 계획으로 가져옵니다. 원래 루틴은 유지됩니다.</p></div>`:'';
    const controls=`${recurring?`<div class="repeat-scope">${selectField('적용 범위','f-scope',[['occurrence','이 날짜만'],['series','반복 기본 계획']],scope)}<p>${esc(repeatNote)}</p></div>`:''}<div class="type-choices" id="type-choices">${Object.entries(TYPES).map(([key,t])=>`<button class="type-choice ${key===currentType?'active':''}" style="${styl(key)}" data-pick="${key}" ${recurring?'disabled':''}><b>${t.emoji}</b>${t.name}</button>`).join('')}</div>${routinePicker}<div class="fields fd-event-fields"><div id="f-title-field" class="field full ${currentType==='strength'?'':'hide'}"><label for="f-title">일정 제목</label><input id="f-title" value="${esc(item.type==='strength'?item.title:'')}" placeholder="예: 상체 운동" maxlength="160"></div>${field(recurring?(scope==='series'?'반복 시작일':'기록 날짜'):'날짜','f-date','date',recurring&&scope==='series'?event.date:date,recurring?'disabled':'required')}${selectField('반복 일정','f-repeat',[['none','반복 안 함'],['daily','매일'],['weekly','매주 같은 요일']],item.repeat,recurring?'disabled':'')}${field('시작 시간','f-start','time',item.start,'required')}${field('종료 시간','f-end','time',item.end,'required')}<div id="until-field" class="field full ${item.repeat==='none'?'hide':''}"><label for="f-until">반복 종료일 · 선택</label><input id="f-until" type="date" value="${esc(event?.repeatUntil||'')}" ${recurring&&scope==='occurrence'?'disabled':''}></div></div><div class="separator"></div><div id="dynamic-details"></div><div class="separator"></div><label class="checkline ${recurring&&scope==='series'?'hide':''}"><input type="checkbox" id="f-completed" ${item.completed?'checked':''}><span id="completion-label">${completionLabel()}</span></label>${recurring&&scope==='series'?'<p class="helper">반복 기본 계획은 아직 기록하지 않은 날짜에 적용됩니다. 실제 수행·섭취·측정은 “이 날짜만”에서 기록하세요.</p>':''}`;
    modal(titleLabel,controls,`<div>${edit?`<button class="danger" id="delete-event">${recurring?(scope==='series'?'반복 전체 삭제':'이 날짜 삭제'):'일정 삭제'}</button>`:''}</div><div class="mini-buttons"><button class="btn btn-outline" id="cancel-event">취소</button><button class="btn btn-primary" id="save-event">${edit?'변경 저장':'일정 등록'}</button></div>`,recurring?repeatNote:'',currentType==='strength');
    $('.modal').classList.add('fd-event-form');
    $('#modal-title').setAttribute('tabindex','-1');
    mountDetails(currentType,item.detail,date,recurring?scope:'single');
    modalDirty=false;
    $('#f-completed').disabled=linkedTraining&&currentType==='strength';
    if(linkedTraining&&currentType==='strength')$('#f-completed').checked=K.calendarCompletion(item,trainingIndex().get(item.id+':'+date)).state==='complete';
    const drafts={[currentType]:item.detail};
    if($('#f-routine'))$('#f-routine').onchange=()=>{
      const routine=routines.find(r=>r.id===$('#f-routine').value);
      if(!routine||currentType!=='strength')return;
      const detail=W.normalize({exercises:routine.exercises.map(ex=>({id:uid(),name:ex.name,notes:'',
        sets:ex.sets.map(set=>({id:uid(),weight:set.weight,reps:set.reps,rpe:null,warmup:set.warmup===true,done:false}))})),notes:''},false);
      drafts.strength=detail;mountDetails('strength',detail,date,'single');
      $('#f-title').value=routine.name;$('#f-completed').checked=false;modalDirty=true;
    };
    $$('[data-pick]').forEach(button=>button.onclick=()=>{
      if(button.dataset.pick===currentType)return;
      try{drafts[currentType]=modalController?.draft?modalController.draft():readDetail(currentType);}catch(error){formError(error);return;}
      currentType=button.dataset.pick;
      $('.modal').classList.toggle('modal-workout',currentType==='strength');
      $('#f-routine-field')?.classList.toggle('hide',currentType!=='strength');
      $('#f-title-field').classList.toggle('hide',currentType!=='strength');
      $$('[data-pick]').forEach(b=>b.classList.toggle('active',b===button));
      mountDetails(currentType,drafts[currentType]||{},date,'single');
      $('#f-completed').checked=false;$('#f-completed').disabled=linkedTraining&&currentType==='strength';$('#completion-label').textContent=completionLabel();modalDirty=true;
    });
    $('#f-repeat').onchange=()=>{$('#until-field').classList.toggle('hide',$('#f-repeat').value==='none');modalDirty=true;};
    if(recurring)$('#f-scope').onchange=()=>{
      const nextScope=$('#f-scope').value;
      if(modalDirty && !confirm('범위를 바꾸면 현재 입력 중인 변경을 취소합니다. 범위를 바꿀까요?')){$('#f-scope').value=scope;return;}
      closeModal(true);openEvent({event,date,scope:nextScope});
    };
    $('#f-completed').onchange=()=>{
      if(currentType==='strength'){
        const checkbox=$('#f-completed');
        if(linkedTraining){checkbox.checked=K.calendarCompletion(item,trainingIndex().get(item.id+':'+date)).state==='complete';return;}
        if(checkbox.checked&&!confirm('모든 세트를 실제로 수행했나요?')){
          const sum=W.summary(modalController.draft());
          checkbox.checked=sum.setCount>0&&sum.completedSets===sum.setCount;return;
        }
        modalController.markAllDone(checkbox.checked);
      }
      modalDirty=true;
    };
    $('#cancel-event').onclick=()=>closeModal();
    if(edit)$('#delete-event').onclick=()=>{
      const prompt=recurring?(scope==='series'?'이 반복 계획과 모든 날짜의 기록을 삭제할까요?':'이 날짜의 일정만 삭제할까요?'):'이 일정을 삭제할까요?';
      if(!confirm(prompt+' 마지막 변경 되돌리기로 복구할 수 있습니다.'))return;
      try {if(commit(C.remove(data,event.id,date,recurring?scope:'series'),'일정을 삭제했습니다. 되돌리기로 복구할 수 있습니다.'))closeModal(true);}catch(error){formError(error);}
    };
    $('#save-event').onclick=()=>{
      try {
        const detail=readDetail(currentType),dateValue=recurring?item.date:$('#f-date').value;
        const startValue=$('#f-start').value,endValue=$('#f-end').value;
        if(!C.validDate(dateValue))throw new Error('올바른 날짜를 입력해 주세요.');
        if(!C.validTime(startValue)||!C.validTime(endValue)||endValue<=startValue)throw new Error('종료 시간은 같은 날짜의 시작 시간보다 늦어야 합니다.');
        const mealName=detail.items?.length?(detail.items[0].food.name+(detail.items.length>1?` 외 ${detail.items.length-1}가지`:'')):'식단 기록';
        const automaticTitle={strength:'웨이트 트레이닝',cardio:(detail.cardio||'유산소 운동').slice(0,160),meal:mealName.slice(0,160),weight:'체중 측정'}[currentType];
        // Preserve existing date-specific titles; hidden strength drafts never name another record type.
        const title=currentType==='strength'?($('#f-title').value.trim()||automaticTitle):(edit&&currentType===item.type?item.title:automaticTitle);
        const completed=currentType==='strength'?strengthCompleted(detail,item,date):$('#f-completed').checked;
        if(item.workoutSessionId && (currentType!=='strength'||dateValue!==item.date))throw new Error('완료한 운동과 연결된 일정은 날짜와 종류를 바꿀 수 없습니다. 다른 날짜에는 새 일정을 등록해 주세요.');
        if(currentType==='strength'&&(recurring?date:dateValue)>iso(new Date())&&detail.exercises.some(ex=>ex.sets.some(s=>s.done===true)))throw new Error('미래 날짜의 운동에는 완료 세트를 저장할 수 없습니다.');
        const update={...item,id:edit?event.id:item.id,type:currentType,date:dateValue,start:startValue,end:endValue,title,repeat:recurring?event.repeat:$('#f-repeat').value,repeatUntil:$('#f-until').value||null,completed,detail,isSample:false};
        const next=C.upsert(data,update,{occurrenceDate:recurring?date:null,scope:recurring?scope:'single'});
        if(commit(next,edit?'일정과 기록을 저장했습니다.':'새 일정을 등록했습니다.')){
          selected=recurring?date:dateValue;cursor=dateOf(selected);
          if(returnToDay){daySheetDate=selected;daySheetSuspended=true;}
          closeModal(true);render();
        }
      }catch(error){formError(error);}
    };
    (currentType==='strength'?$('#f-title'):$('#modal-title')).focus({preventScroll:true});
  }

  function getScheduledWorkouts(day) {
    if(!C.validDate(day))return [];
    const training=trainingIndex();
    return C.dayEvents(data,day).filter(event=>event.type==='strength'&&!event.isSample).map(event=>{
      const session=training.get(event.id+':'+day)||null;
      return {event,session,canReplace:!session&&!event.workoutSessionId&&!event.completed&&!C.volume(event.detail).completedSets};
    });
  }
  function calendarWorkoutActions(event,date) {
    if(event.type!=='strength'||event.isSample)return '';
    const item=getScheduledWorkouts(date).find(x=>x.event.id===event.id);
    if(!item)return '';
    const final=item.session&&['COMPLETED','PARTIAL'].includes(item.session.status);
    const future=date>iso(new Date()),disabled=(future&&!final)||(!item.session&&(event.completed||!!event.workoutSessionId));
    const status=K.calendarCompletion(event,item.session);
    const label=final?'운동 기록':item.session?'이어하기':'운동 시작';
    const swap='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>';
    return `<div class="fd-agenda-workout-actions"><button class="fd-plan-swap" type="button" data-calendar-swap="${esc(event.id)}" data-occdate="${date}" aria-label="${esc(event.title)} 루틴 교체" title="${item.canReplace?'이 날짜의 루틴 교체':'시작하거나 기록한 운동은 교체할 수 없습니다'}" ${item.canReplace?'':'disabled'}>${swap}</button><button class="btn btn-small btn-outline" type="button" data-calendar-start="${esc(event.id)}" data-occdate="${date}" ${disabled?'disabled':''}>${future&&!final?'예정':disabled?(status.state==='partial'?'부분 완료':'완료됨'):label}</button></div>`;
  }
  function openRoutineSwap(eventId,date) {
    try {
      if(blockedLoad||externalChange)throw new Error('최신 캘린더 기록을 불러온 뒤 교체해 주세요.');
      if(!K)throw new Error('루틴 연결 기능을 불러오지 못했습니다. 새로고침해 주세요.');
      const snapshot=window.FormdayIndependent?.getCalendarSnapshot?.();
      if(!snapshot)throw new Error('운동 기록을 먼저 불러온 뒤 다시 선택해 주세요.');
      const item=getScheduledWorkouts(date).find(x=>x.event.id===eventId);
      if(!item?.canReplace)throw new Error('이미 시작하거나 기록한 운동은 루틴을 교체할 수 없습니다.');
      const routines=snapshot.routines||[];
      const baseline=K.signature(item.event);
      let chosen='';
      const options=routines.map(r=>`<button type="button" class="fd-routine-choice" data-routine-choice="${esc(r.id)}" aria-pressed="false"><span class="fd-routine-choice-copy"><strong>${esc(r.name)}</strong><small>${r.exercises.length}종목 · ${r.exercises.reduce((n,e)=>n+e.sets.length,0)}세트</small><span>${esc(r.exercises.map(e=>e.name).join(' · '))}</span></span><span class="fd-routine-choice-check" aria-hidden="true">✓</span></button>`).join('');
      modal('루틴 교체',`<p class="fd-routine-swap-context"><b>${esc(dayLabel(date))}</b><span>현재 · ${esc(item.event.title)}</span></p><div class="fd-routine-choices">${options||'<p class="empty-note">저장된 루틴이 없습니다.<br>운동 탭의 루틴 메뉴에서 먼저 루틴을 만들어 주세요.</p>'}</div>`,`<button class="btn btn-outline" id="cancel-routine-swap">취소</button><button class="btn btn-primary" id="apply-routine-swap" disabled>이 날짜에 적용</button>`,'선택한 날짜의 종목과 세트를 교체합니다. 다른 날짜와 원래 루틴은 유지됩니다.');
      $('.modal').classList.add('fd-routine-swap');
      $('#modal-title').setAttribute('tabindex','-1');$('#modal-title').focus({preventScroll:true});
      modalDirty=false;
      $$('[data-routine-choice]').forEach(button=>button.onclick=()=>{
        chosen=button.dataset.routineChoice;
        $$('[data-routine-choice]').forEach(row=>row.setAttribute('aria-pressed',String(row===button)));
        $('#apply-routine-swap').disabled=false;
      });
      $('#cancel-routine-swap').onclick=()=>closeModal(true);
      $('#apply-routine-swap').onclick=()=>{
        try {
          if(!chosen)return;
          const iron=window.FormdayIndependent?.getCalendarSnapshot?.();
          if(!iron)throw new Error('운동 기록을 먼저 불러온 뒤 다시 선택해 주세요.');
          if(JSON.stringify(iron.routines.find(r=>r.id===chosen))!==JSON.stringify(routines.find(r=>r.id===chosen)))throw new Error('선택한 루틴 구성이 변경됐습니다. 창을 닫고 최신 루틴을 다시 선택해 주세요.');
          const next=K.replaceRoutine(C,data,iron,eventId,date,chosen,baseline);
          if(commit(next,'이 날짜의 루틴을 교체했습니다. 운동 탭에도 반영됐습니다.'))closeModal(true);
        }catch(error){formError(error);}
      };
      return true;
    }catch(error){toast(error.message,true);return false;}
  }
  function openProgramRegistration(programId) {
    try {
      if(blockedLoad||externalChange||$('#modal-root').children.length)throw new Error('최신 캘린더 기록을 확인한 뒤 프로그램을 등록해 주세요.');
      if(!K?.previewProgram)throw new Error('프로그램 연결 기능을 불러오지 못했습니다. 새로고침해 주세요.');
      const snapshot=window.FormdayIndependent?.getCalendarSnapshot?.();
      const program=snapshot?.programs.find(p=>p.id===programId);
      if(!program)throw new Error('등록할 프로그램을 찾을 수 없습니다.');
      const fixed=program.mode==='fixed',initialToday=iso(new Date());
      const signature=training=>JSON.stringify({program:training.programs.find(p=>p.id===programId),routines:training.routines.filter(r=>program.routineIds.includes(r.id))});
      const initialSignature=signature(snapshot);
      let preview=null;
      modal('캘린더에 프로그램 등록',
        '<div class="fd-program-register-heading"><strong>'+esc(program.name)+'</strong><span>'+(fixed?'요일 고정형 · 해당 주 1회':'순환형 · 루틴 순서대로 1회')+'</span></div>'+
        '<p class="fd-program-today" id="fd-program-today"></p>'+
        field(fixed?'등록할 주의 기준 날짜':'시작 날짜','fd-program-date','date',initialToday,'min="'+initialToday+'" required')+
        '<div class="fd-program-date-actions"><button type="button" class="btn btn-outline btn-small" id="fd-program-this">'+(fixed?'이번 주':'오늘')+'</button><button type="button" class="btn btn-outline btn-small" id="fd-program-next">'+(fixed?'다음 주':'내일')+'</button></div>'+
        '<div class="fields fd-program-time">'+field('시작 시간','fd-program-start','time','07:00','required')+field('종료 시간','fd-program-end','time','08:00','required')+'</div>'+
        '<div id="fd-program-preview" aria-live="polite"></div>',
        '<button type="button" class="btn btn-outline" id="fd-program-cancel">취소</button><button type="button" class="btn btn-primary" id="fd-program-apply" disabled>캘린더 등록</button>',
        '오늘 이전 날짜와 이미 같은 루틴이 있는 날짜는 건너뜁니다. 기존 일정과 프로그램 원본은 변경하지 않습니다.');
      $('.modal').classList.add('fd-routine-swap','fd-program-register');
      function refreshPreview(){
        const todayNow=iso(new Date()),dateInput=$('#fd-program-date'),apply=$('#fd-program-apply');
        dateInput.min=todayNow;
        $('#fd-program-today').textContent='오늘 · '+dayLabel(todayNow);
        try{
          preview=K.previewProgram(C,data,snapshot,programId,dateInput.value,todayNow,$('#fd-program-start').value,$('#fd-program-end').value);
          const labels={new:'등록 예정',duplicate:'이미 등록',past:'지난 날짜 · 제외',rest:'휴식'};
          $('#fd-program-preview').innerHTML='<div class="fd-program-preview-head"><b>'+esc(dayLabel(preview.first))+' ~ '+esc(dayLabel(preview.last))+'</b><span>'+preview.count+'개 등록 예정</span></div>'+
            preview.rows.map(row=>'<div class="fd-program-preview-row" data-status="'+row.status+'"><span>'+esc(dayLabel(row.date))+'</span><strong>'+esc(row.title)+'</strong><small>'+labels[row.status]+'</small></div>').join('');
          $('#form-error').classList.add('hide');
          apply.disabled=!preview.count;
          apply.textContent=preview.count?preview.count+'개 일정 등록':'등록할 일정 없음';
        }catch(error){
          preview=null;apply.disabled=true;apply.textContent='캘린더 등록';
          $('#fd-program-preview').innerHTML='';formError(error);
        }
      }
      const setDate=day=>{$('#fd-program-date').value=day;modalDirty=true;refreshPreview();};
      $('#fd-program-this').onclick=()=>setDate(iso(new Date()));
      $('#fd-program-next').onclick=()=>{const day=iso(new Date());setDate(moveDay(day,fixed?7-dateOf(day).getDay():1));};
      for(const id of ['fd-program-date','fd-program-start','fd-program-end'])$('#'+id).onchange=refreshPreview;
      $('#fd-program-cancel').onclick=()=>closeModal(true);
      $('#fd-program-apply').onclick=()=>{
        try{
          if(!preview)return;
          if(blockedLoad||externalChange)throw new Error('다른 기기에서 기록이 변경됐습니다. 최신 기록을 불러온 뒤 다시 등록해 주세요.');
          const iron=window.FormdayIndependent?.getCalendarSnapshot?.();
          if(!iron||signature(iron)!==initialSignature)throw new Error('프로그램 또는 루틴이 변경됐습니다. 등록 창을 닫고 다시 열어 주세요.');
          const result=K.registerProgram(C,data,iron,programId,$('#fd-program-date').value,iso(new Date()),$('#fd-program-start').value,$('#fd-program-end').value,preview);
          if(!result.count){refreshPreview();return;}
          if(commit(result.next,result.count+'개 운동 일정을 캘린더에 등록했습니다.'))closeModal(true);
          else formError(new Error('저장하지 못했습니다. 기존 일정은 유지되었습니다. 연결 상태를 확인한 후 다시 시도해 주세요.'));
        }catch(error){formError(error);}
      };
      refreshPreview();modalDirty=false;
      $('#modal-title').setAttribute('tabindex','-1');$('#modal-title').focus({preventScroll:true});
      return true;
    }catch(error){toast(error.message,true);return false;}
  }
  function getWorkoutReflection(session) {
    const source=session?.calendarSource;
    if(!source)return {applied:false,message:''};
    const base=data.events.find(e=>e.id===source.eventId),event=base&&C.occurrence(base,source.date);
    if(event?.type==='strength'&&event.workoutSessionId===session.id)return {applied:true,message:'캘린더에 반영됨'};
    if(!event||event.type!=='strength')return {applied:false,message:'연결된 일정이 없습니다. 완료한 운동 기록은 보관되어 있습니다.'};
    if(event.workoutSessionId||K?.signature(event)!==source.baseline)return {applied:false,message:'시작 후 일정이 변경되어 자동 반영하지 않았습니다. 캘린더와 운동 기록을 확인해 주세요.'};
    return {applied:false,message:'운동 기록은 저장됐습니다. 캘린더 반영을 다시 시도해 주세요.'};
  }
  function reflectWorkoutSession(session) {
    try {
      if(blockedLoad||externalChange||$('#modal-root').children.length)throw new Error('캘린더 기록을 확인한 뒤 다시 반영해 주세요.');
      if(!K)throw new Error('캘린더 연결 기능을 불러오지 못했습니다.');
      const result=K.applySession(C,data,session);
      if(result.alreadyApplied)return {ok:true,alreadyApplied:true};
      if(!commit(result.next,''))return {ok:false,error:'운동 기록은 저장됐지만 캘린더 저장에 실패했습니다. 다시 반영할 수 있습니다.'};
      return {ok:true,alreadyApplied:false};
    }catch(error){return {ok:false,error:error.message};}
  }

function renderFilters(){let html='<button class="filter-chip active" id="all-filter">전체</button>';for(let [type,t] of Object.entries(TYPES))html+=`<button class="filter-chip ${visibleTypes.has(type)?'active':''}" data-filter="${type}"><span class="color-dot" style="--c:${t.color}"></span>${t.name}</button>`;$('#filters').innerHTML=html;$('#all-filter').classList.toggle('active',visibleTypes.size===4)}

function renderMini(){const d=dateOf(iso(cursor)),y=d.getFullYear(),m=d.getMonth();$('#mini-title').textContent=`${y}년 ${m+1}월`;let x=`<div class="mini-grid">${DAYS.map(s=>`<span>${s}</span>`).join('')}`;for(let i=0;i<new Date(y,m,1).getDay();i++)x+='<span></span>';const days=new Date(y,m+1,0).getDate();for(let i=1;i<=days;i++){let ds=iso(new Date(y,m,i));x+=`<button class="${ds===today?'today':''} ${ds===selected?'selected':''} ${getDay(ds).length?'has-event':''}" data-mini="${ds}">${i}</button>`}$('#mini-cal').innerHTML=x+'</div>'}

function renderMonth(){const training=trainingIndex(),y=cursor.getFullYear(),m=cursor.getMonth();const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());let html='<div class="week-labels">'+DAYS.map(s=>`<span class="week-label">${s}요일</span>`).join('')+'</div><div class="month-grid">';for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const ds=iso(d),events=getDay(ds,true,training);html+=`<div class="month-cell ${d.getMonth()!==m?'other':''} ${ds===selected?'selected':''}" data-date="${ds}" title="${dayLabel(ds)}"><div class="cell-top"><button class="day-num ${ds===today?'today':''}" data-day="${ds}" aria-label="${dayLabel(ds)} 상세보기">${d.getDate()}</button><button class="cell-add" data-add="${ds}" aria-label="일정 추가">＋</button></div>`;for(const {event:e} of events.slice(0,3)){html+=`<button draggable="${e.repeat==='none'&&!e.workoutSessionId}" class="month-event ${isDone(e)?'done':isPartial(e)?'partial':''} ${isShortComplete(e)?'ended-short':''}" style="${styl(e.type)}" data-edit="${e.id}" data-occdate="${ds}" title="${esc(e.title)} — 클릭하여 수정 · 드래그하여 이동"><span class="event-time">${e.start}</span><span class="event-text">${isPartial(e)?'◐ ':isShortComplete(e)?'✓ ':''}${esc(e.title)}${isShortComplete(e)?' · '+completionOf(e).done+'/'+completionOf(e).total:''}</span></button>`}if(events.length>3)html+=`<button class="more-events" data-day="${ds}">+ ${events.length-3}개 더 보기</button>`;html+='</div>'}return html+'</div>'}

function renderRight(){const day=detailDay(),d=dateOf(day),l=getDay(day,false);$('#right-badge').textContent=day===today?'TODAY / 오늘 상세':'DAY / 날짜 상세';$('#right-date').textContent=dayLabel(day);$('#right-sub').textContent=`${d.getFullYear()}년 · ${l.length}개 일정${day>today?' · 예정된 기록':''}`;const partialCount=l.filter(({event})=>isPartial(event)).length;$('#agenda-count').textContent=`${l.filter(({event})=>isDone(event)).length}/${l.length} 완료${partialCount?' · 부분 '+partialCount:''}`;$('#agenda').innerHTML=l.length?l.map(({event:e,date})=>`<div class="agenda-item"><span class="agenda-time">${e.start}</span><div class="agenda-card ${isDone(e)?'done':isPartial(e)?'partial':''} ${isShortComplete(e)?'ended-short':''}" style="${styl(e.type)}"><button class="checkbox-btn ${isDone(e)?'checked':isPartial(e)?'partial':''}" data-toggle="${e.id}" data-occdate="${date}" aria-label="${esc(e.title)} ${e.trainingLinked?stateText(e):'완료 전환'}" ${e.trainingLinked?'disabled':''}>${isDone(e)?'✓':isPartial(e)?'−':''}</button><button style="text-align:left;background:transparent;color:inherit;padding:0;flex:1;min-width:0" data-edit="${e.id}" data-occdate="${date}"><span class="agenda-name">${TYPES[e.type].emoji} ${esc(e.title)} ${e.repeat!=='none'?'↻':''}${e.isSample?'<small class="fd-day-sample">샘플</small>':''}${isPartial(e)?'<small class="fd-day-partial">부분 완료</small>':isShortComplete(e)?'<small class="fd-day-ended">운동 완료</small>':''}</span><span class="agenda-desc">${esc(details(e))}</span>${isShortComplete(e)?'<span class="agenda-desc fd-ended-count">실제 '+completionOf(e).done+'/'+completionOf(e).total+'세트 수행 · 미수행 '+(completionOf(e).total-completionOf(e).done)+'세트</span>':''}${e.trainingCompletion?.pending?'<span class="agenda-desc">'+completionOf(e).done+'/'+completionOf(e).total+'세트 수행 · 캘린더 반영 대기</span>':''}</button>${calendarWorkoutActions(e,date)}</div></div>`).join(''):'<div class="empty-note">등록된 일정이 없습니다.<br>위의 등록 버튼으로 이 날짜의 기록을 추가하세요.</div>';
  renderNutrition();
  const w=getWeightRecords(day).slice(-7);if(!w.length){$('#weight-trend').innerHTML='<div class="empty-note">아직 체중 기록이 없습니다.</div>';return}const latest=w[w.length-1],diff=w.length>1?latest.detail.weight-w[0].detail.weight:0;let values=w.map(x=>Number(x.detail.weight)),min=Math.min(...values)-.5,max=Math.max(...values)+.5,pts=values.map((v,i)=>`${15+(i/Math.max(1,values.length-1))*230},${46-((v-min)/(max-min))*38}`).join(' ');$('#weight-trend').innerHTML=`<div class="weight-sub">${latest.date} 기준</div><div class="weight-val">${fmt(latest.detail.weight,1)} <small style="font-weight:500;font-size:12px;color:#9aabaa">kg</small> <span style="font-size:10px;color:${diff<=0?'#21816a':'#bd7045'}">${w.length>1?(diff>0?'+':'')+fmt(diff,1)+'kg':''}</span></div><svg class="sparkline" viewBox="0 0 260 54" role="img" aria-label="최근 체중 변화 그래프"><polyline points="${pts}" fill="none" stroke="#2c9874" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${values.map((v,i)=>`<circle cx="${15+(i/Math.max(1,values.length-1))*230}" cy="${46-((v-min)/(max-min))*38}" r="3" fill="#2c9874"/>`).join('')}</svg>`;
}

  function openSettings() {
    const g=data.settings;
    modal('체중·일일 영양 목표',`<div class="fields">${field('목표 체중 (kg, 선택)','s-target-weight','number',g.targetWeight??'','min="0.1" max="500" step="0.1" inputmode="decimal" placeholder="미설정"')}${field('단백질 (g)','s-protein','number',g.protein,'min="0" max="1000" step="1" inputmode="numeric"')}${field('탄수화물 (g)','s-carbs','number',g.carbs,'min="0" max="1000" step="1" inputmode="numeric"')}${field('총 지방 (g)','s-fat','number',g.fat,'min="0" max="1000" step="1" inputmode="numeric"')}</div><div class="hint-box target-hint">목표 열량: 단백질 × 4 + 탄수화물 × 4 + 총 지방 × 9 = <strong id="target-kcal"></strong> kcal<br>불포화지방은 총 지방의 일부이며, 열량을 중복 합산하지 않습니다. 목표 체중을 입력하면 변화 그래프에 목표선이 표시됩니다.</div>`,`<span></span><div class="mini-buttons"><button class="btn btn-outline" id="cancel-settings">취소</button><button class="btn btn-primary" id="save-settings">목표 저장</button></div>`,'직접 정한 목표를 기록합니다. 초기 목표값은 개인 맞춤 권장량이 아닙니다.');
    const inputs=['protein','carbs','fat'];
    const values=()=>({...Object.fromEntries(inputs.map(k=>[k,$('#s-'+k).value.trim()===''?NaN:Number($('#s-'+k).value)])),targetWeight:$('#s-target-weight').value.trim()===''?null:Number($('#s-target-weight').value)});
    const update=()=>{const n=values(),total=n.protein*4+n.carbs*4+n.fat*9;$('#target-kcal').textContent=Number.isFinite(total)?fmt(total,1):'—';};
    inputs.forEach(k=>$('#s-'+k).oninput=update);update();modalDirty=false;
    $('#cancel-settings').onclick=()=>closeModal();
    $('#save-settings').onclick=()=>{try{const next=C.normalizeState({...data,settings:values()});if(commit(next,'체중·영양 목표를 저장했습니다.'))closeModal(true);}catch(error){formError(error);}};
  }
  function infoAI() {
    modal('AI 코치 · 다음 확장',`<div class="hint-box"><strong>AI는 아직 연결되어 있지 않습니다.</strong><br>현재는 입력한 기록과 목표를 계산하고 보여줍니다.</div><div class="ai-plan"><p>다음 단계에서는 세트별 기록과 식단, 체중 추이를 바탕으로 주간 요약과 조정안을 제안하도록 연결합니다.</p><p>제안한 일정은 사용자가 확인한 뒤 반영하고, 기존 실제 기록은 유지하는 방식으로 개발할 예정입니다.</p></div>`,`<span></span><button class="btn btn-primary" id="ai-ok">확인</button>`);
    modalDirty=false;$('#ai-ok').onclick=()=>closeModal(true);
  }
  function downloadText(text,name,type='application/json') {
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportData() {
    if(blockedLoad){downloadText(corruptRaw||'','formday-original-backup.txt','text/plain');return;}
    const backup={app:'formday',version:C.VERSION,exportedAt:new Date().toISOString(),...C.clone(data)};
    downloadText(JSON.stringify(backup,null,2),`formday-backup-${today}.json`);toast('기록 백업 파일 다운로드를 시작했습니다.');
  }
  async function importData(file) {
    try {
      if(file.size>16000000)throw new Error('백업 파일은 16MB 이하만 지원합니다.');
      const next=C.normalizeState(JSON.parse(await file.text()));
      if(!confirm(`백업의 일정 ${next.events.length}개, 내 식품 ${next.customFoods.length}개와 목표를 가져올까요? 현재 기록을 대체하며, 이전 원본은 이 브라우저에 한 번 더 보관합니다.`))return;
      commit(next,'백업 기록을 복원했습니다.',{recovery:!!blockedLoad});
    }catch(error){toast('백업을 가져오지 않았습니다. '+(error.message||'파일 형식을 확인해 주세요.'),true);}
    finally{$('#import-file').value='';}
  }
  function toggleDone(id,day) {
    const event=data.events.find(e=>e.id===id),actual=event&&C.occurrence(event,day);
    if(actual?.type==='strength'&&(actual.workoutSessionId||trainingIndex().has(id+':'+day))){
      toast('연결된 운동의 전체 완료 상태는 실제 세트 기록으로 판단합니다. 운동 기록에서 확인해 주세요.',true);return;
    }
    if(actual?.type==='strength'&&!actual.completed){
      if(actual.isSample){toast('체험용 운동은 실제 기록으로 완료할 수 없습니다. 내 운동을 먼저 등록해 주세요.',true);return;}
      if(day>iso(new Date())){toast('미래 날짜의 운동은 완료할 수 없습니다.',true);return;}
      if(!confirm('이 일정의 모든 세트를 실제로 완료했나요? 계획 중량과 횟수가 모두 완료 기록으로 저장됩니다.'))return;
    }
    if(actual?.type==='weight' && actual.detail.weight==null){openEvent({event,date:day});toast('측정값을 입력한 뒤 측정 완료를 체크해 주세요.');return;}
    try {commit(C.toggleComplete(data,id,day),'완료 상태를 저장했습니다.');}catch(error){toast(error.message,true);}
  }
  function refreshToday() {
    const next=iso(new Date());if(next===today)return;
    const wasToday=selected===today;today=next;now=new Date();
    if(wasToday){selected=today;cursor=dateOf(today);}render();
  }
  function attach() {
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b||b.disabled)return;const ds=b.dataset;
      if(ds.view){view=ds.view;cursor=dateOf(selected);render();}
      if(ds.day)openDayDetail(ds.day);
      if(ds.mini)openDayDetail(ds.mini);
      if(ds.add){openDayDetail(ds.add);openEvent({date:ds.add});}
      if(ds.dayCreate){openEvent({date:detailDay(),type:ds.dayCreate,fromDayDetail:true});}
      if(ds.edit){const event=data.events.find(x=>x.id===ds.edit);if(event){const day=ds.occdate||event.date;if(e.target.closest('#calendar'))openDayDetail(day);openEvent({event,date:day,fromDayDetail:!!e.target.closest('#fd-day-detail')});}}
      if(ds.toggle)toggleDone(ds.toggle,ds.occdate||detailDay());
      if(ds.calendarSwap)openRoutineSwap(ds.calendarSwap,ds.occdate||detailDay());
      if(ds.calendarStart){closeDayDetail({restoreFocus:false});window.FormdayIndependent?.open('calendar',{eventId:ds.calendarStart,date:ds.occdate||today});}
      if(ds.filter){visibleTypes.has(ds.filter)?visibleTypes.delete(ds.filter):visibleTypes.add(ds.filter);render();}
      if(b.id==='all-filter'){visibleTypes=new Set(Object.keys(TYPES));render();}
      if(ds.go){
        visibleTypes=new Set(ds.go==='calendar'?Object.keys(TYPES):[ds.go]);
        $$('.nav-button').forEach(x=>x.classList.toggle('active',x===b));render();
        $('#calendar-card').scrollIntoView({block:'start',behavior:'smooth'});
      }
      if(ds.mobile){
        $$('[data-mobile]').forEach(x=>x.classList.toggle('active',x===b));
        if(ds.mobile==='add')openEvent();
        else (ds.mobile==='detail'?$('.rightbar'):$('#calendar-card')).scrollIntoView({block:'start',behavior:'smooth'});
      }
    });
    $('#new-event').onclick=()=>openEvent({date:today});$('#new-meal').onclick=()=>openEvent({date:today,type:'meal'});$('#prev').onclick=()=>navigate(-1);$('#next').onclick=()=>navigate(1);
    $('#today').onclick=()=>{refreshToday();openDayDetail(today);};
    $('#mini-prev').onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render();};
    $('#mini-next').onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render();};
    $('#settings-btn').onclick=openSettings;$('#ai-btn').onclick=infoAI;
    $('#fd-day-close').onclick=()=>closeDayDetail();
    $('#fd-day-handle').onclick=()=>closeDayDetail();
    $('#fd-day-back-today').onclick=()=>{refreshToday();openDayDetail(today);};
    $('#fd-day-prev').onclick=()=>openDayDetail(moveDay(detailDay(),-1));
    $('#fd-day-next').onclick=()=>openDayDetail(moveDay(detailDay(),1));
    $('#fd-day-sheet').addEventListener('cancel',e=>{e.preventDefault();closeDayDetail();});
    $('#fd-day-sheet').addEventListener('click',e=>{if(e.target===$('#fd-day-sheet'))closeDayDetail();});
    $('#export-btn').onclick=exportData;$('#import-btn').onclick=()=>$('#import-file').click();
    $('#import-file').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);};
    $('#undo-btn').onclick=()=>{if(undoState&&commit(C.clone(undoState),'마지막 변경을 되돌렸습니다.')){undoState=null;$('#undo-btn').disabled=true;}};
    $('#clear-demo').onclick=()=>{
      if(!confirm('체험용 샘플 일정만 지울까요? 직접 등록하거나 수정한 일정은 유지됩니다.'))return;
      commit({...C.clone(data),events:data.events.filter(e=>!e.isSample),demo:false},'샘플을 지웠습니다. 마지막 변경 되돌리기로 복구할 수 있습니다.');
    };
    $('#calendar-search').oninput=e=>{searchTerm=e.target.value.trim().toLocaleLowerCase();render();};
    $('#calendar').addEventListener('click',e=>{
      if(e.target.closest('button'))return;
      const lane=e.target.closest('[data-lane]');
      if(lane){openDayDetail(lane.dataset.lane);return;}
      const cell=e.target.closest('[data-date]');
      if(cell)openDayDetail(cell.dataset.date);
    });
    let dragId=null;
    $('#calendar').addEventListener('dragstart',e=>{const b=e.target.closest('[data-edit]');if(!b||b.getAttribute('draggable')!=='true')return;dragId=b.dataset.edit;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);});
    $('#calendar').addEventListener('dragover',e=>{if(dragId&&e.target.closest('.month-cell'))e.preventDefault();});
    $('#calendar').addEventListener('drop',e=>{
      const cell=e.target.closest('.month-cell'),event=data.events.find(x=>x.id===dragId);dragId=null;if(!cell||!event||event.repeat!=='none')return;e.preventDefault();
      try{if(commit(C.upsert(data,{...event,date:cell.dataset.date,isSample:false}),'일정 날짜를 옮겼습니다.'))chooseDay(cell.dataset.date);}catch(error){toast(error.message,true);}
    });
    $('#calendar').addEventListener('dragend',()=>{dragId=null;});
    document.addEventListener('keydown',e=>{
      // Native confirmation dialog owns focus and Escape; never open a
      // background calendar editor while a deletion is awaiting confirmation.
      if(document.getElementById('fi-program-delete-dialog')?.open)return;
      if($('#modal-root').children.length){
        if(e.key==='Escape'){e.preventDefault();closeModal();return;}
        if(e.key==='Tab'){
          const focusable=$$('#modal-root button:not([disabled]), #modal-root input:not([disabled]), #modal-root select:not([disabled]), #modal-root textarea:not([disabled])').filter(x=>x.getClientRects().length);
          const first=focusable[0],last=focusable.at(-1);if(!first)return;
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        }return;
      }
      if(e.target.matches('input,textarea,select,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key.toLowerCase()==='n'){e.preventDefault();openEvent({date:detailDay()});}
      if(e.key.toLowerCase()==='t'){e.preventDefault();refreshToday();openDayDetail(today);}
    });
    window.addEventListener('storage',e=>{
      if(e.key!==C.STORE&&e.key!==null)return;externalChange=true;
      showStorageState('다른 탭에서 기록이 변경됐습니다. 현재 입력을 확인한 뒤 최신 기록을 불러와 주세요.',true);
      $('#undo-btn').disabled=true;
    });
    window.addEventListener('focus',refreshToday);
    let lastFinalLinks='';
    window.addEventListener('formday:iron-changed',()=>{
      const links=JSON.stringify([...trainingIndex()].filter(([,s])=>['COMPLETED','PARTIAL'].includes(s.status)).map(([key,s])=>[key,s.id,s.status]));
      if(links!==lastFinalLinks){lastFinalLinks=links;render();}
      else {renderStats();renderRight();window.FormdayIndependent?.renderCalendar?.();}
    });
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshToday();});
  }

  // Lightweight integration boundary for FORMDAY IRON MODE.
  // All writes continue through the original validated, revision-checked commit().
  // Existing records are never migrated or uploaded by this bridge.
  window.FormdayBridge = Object.freeze({
    getState: () => C.clone(data),
    canCloudApply: () => !blockedLoad && !externalChange && !modalDirty && modalController===null && !$('.fd-routine-swap'),
    cloudReload: () => {if(!blockedLoad && !externalChange && !modalDirty && modalController===null && !$('.fd-routine-swap')){loadLatest();return true;}return false;},
    isRoutineSwapOpen: () => !!$('.fd-routine-swap'),
    getToday: () => today,
    getSelectedDay: () => selected,
    getDetailDay: detailDay,
    openDayDetail,
    closeDayDetail,
    getVisibleTypes: () => [...visibleTypes],
    getScheduledWorkouts, openRoutineSwap, openProgramRegistration, getWorkoutReflection, reflectWorkoutSession,
    prepareScheduledWorkout: (eventId,date) => {
      if(blockedLoad||externalChange)throw new Error('최신 캘린더 기록을 불러온 뒤 운동을 시작해 주세요.');
      if(!K)throw new Error('캘린더 연결 기능을 불러오지 못했습니다.');
      return K.prepareStart(C,data,eventId,date);
    },
    openStrength: (name) => {
      const cleanName=String(name||'').trim().slice(0,80);
      if(window.FormdayIndependent)window.FormdayIndependent.open('start',cleanName?{exercise:cleanName}:undefined);
      else toast('웨이트 독립 시스템을 불러오지 못했습니다. 다시 접속해 주세요.',true);
    },
    editStrength: (id,date) => {
      const event = data.events.find(x=>x.id===id && x.type==='strength');
      if(!event)return false;
      openEvent({event,date:C.validDate(date)?date:event.date});
      return true;
    },
    saveSet: ({eventId,date,exerciseId,setId,weight,reps,rpe,done}) => {
      if(blockedLoad)return false;
      const event = data.events.find(x=>x.id===eventId && x.type==='strength');
      if(!event || !C.validDate(date))return false;
      const actual=C.occurrence(event,date);
      if(!actual)return false;
      try {
        const detail=W.normalize(actual.detail,actual.completed);
        const ex=detail.exercises.find(x=>x.id===exerciseId);
        const set=ex?.sets.find(x=>x.id===setId);
        if(!set)throw new Error('수정할 세트를 찾지 못했습니다. 기록을 새로 불러오세요.');
        const kg=Number(weight),count=Number(reps);
        const effort=rpe==null||rpe===''?null:Number(rpe);
        if(!Number.isFinite(kg)||kg<0||kg>2000||!Number.isInteger(count)||count<1||count>1000||
           (effort!==null&&(!Number.isFinite(effort)||effort<1||effort>10))||typeof done!=='boolean')
          throw new Error('중량·횟수·RPE 입력값을 확인해 주세요.');
        if(done&&date>iso(new Date()))throw new Error('미래 날짜의 운동은 완료할 수 없습니다.');
        if(done&&actual.isSample)throw new Error('체험용 운동은 실제 완료 기록으로 저장할 수 없습니다.');
        set.weight=kg;set.reps=count;set.rpe=effort;set.done=done;
        W.validate(detail);
        const updated={...actual,detail,completed:strengthCompleted(detail,actual,date),isSample:false};
        const options=event.repeat==='none'?{scope:'single'}:{scope:'occurrence',occurrenceDate:date};
        return commit(C.upsert(data,updated,options),done?'운동 세트를 저장했습니다.':'세트 변경을 저장했습니다.');
      } catch(error) {
        toast(error.message||'세트를 저장하지 못했습니다.',true);
        return false;
      }
    }
  });
  attach();render();
})();
