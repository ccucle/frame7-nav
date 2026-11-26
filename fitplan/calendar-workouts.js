/* Calendar workout links are projections and validated edits to existing stores.
   This module never reads or writes storage, Firebase, or browser state. */
(function(root,factory){
  'use strict';
  const api=factory(()=>typeof module==='object'&&module.exports?require('./iron-store.js'):root.FormdayIronStore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayCalendarWorkouts=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(getIron){
  'use strict';
  const must=(condition,message)=>{if(!condition)throw Error(message);};
  const copy=value=>JSON.parse(JSON.stringify(value));
  const iron=()=>{const M=getIron();must(M&&typeof M.normalize==='function','운동 기록 모듈을 불러오지 못했습니다.');return M;};

  // Exact content comparison avoids treating a modified plan as the original.
  // Explicit field order makes equivalent normalized objects compare equally.
  function signature(event){
    must(event&&event.type==='strength'&&Array.isArray(event.detail?.exercises),'웨이트 일정 정보를 확인해 주세요.');
    return JSON.stringify({id:event.id,date:event.date,type:event.type,title:event.title,
      start:event.start,end:event.end,completed:event.completed===true,
      detail:{exercises:event.detail.exercises.map(ex=>({id:ex.id,name:ex.name,notes:ex.notes||'',
        sets:ex.sets.map(set=>({id:set.id,weight:set.weight,reps:set.reps,rpe:set.rpe??null,done:set.done===true,warmup:set.warmup===true}))})),notes:event.detail.notes||'',...(event.detail.freePlan===true?{freePlan:true}:{})}});
  }
  function effective(C,state,eventId,date){
    must(C.validDate(date),'올바른 운동 날짜를 선택해 주세요.');
    const normalized=C.normalizeState(state),event=normalized.events.find(item=>item.id===eventId);
    must(event&&event.type==='strength','연결할 웨이트 일정이 없거나 변경되었습니다. 캘린더를 확인해 주세요.');
    const actual=C.occurrence(event,date);
    must(actual,'이 날짜의 운동 일정이 삭제되거나 변경되었습니다. 캘린더를 확인해 주세요.');
    must(!actual.isSample,'체험용 일정은 운동으로 시작할 수 없습니다. 내 운동 일정을 먼저 등록해 주세요.');
    return {state:normalized,event,actual};
  }
  function prepareStart(C,state,eventId,date){
    const {actual}=effective(C,state,eventId,date);
    must(!actual.completed&&!actual.workoutSessionId,'이미 완료했거나 연결된 운동이 있는 일정입니다. 운동 기록을 확인해 주세요.');
    const exercises=copy(actual.detail.exercises).map(ex=>({...ex,sets:ex.sets.map(set=>({...set,restSec:set.restSec??90}))}));
    return {eventId:actual.id,date:actual.date,label:actual.title.trim().slice(0,100),exercises,
      notes:actual.detail.notes||'',baseline:signature(actual),...(actual.detail.freePlan===true?{freePlan:true}:{})};
  }
  // Explicit workout finish does not mean every planned set was performed.
  function completion(record){
    const sets=(record?.detail?.exercises||record?.exercises||[]).flatMap(ex=>ex.sets||[]);
    const done=sets.filter(s=>s.done===true).length,total=sets.length;
    const explicitlyFinished=record?.status==='COMPLETED'||(!!record?.workoutSessionId&&record.completed===true);
    const complete=record?.status!=='PARTIAL'&&(explicitlyFinished||(done===total&&record?.completed!==false));
    return {done,total,state:!done?'planned':complete?'complete':'partial'};
  }
  function calendarCompletion(event,session){
    const own=completion(event);
    if(!session||session.isSample||!['COMPLETED','PARTIAL'].includes(session.status))return own;
    const actual=completion(session);
    if(event.workoutSessionId===session.id){
      // The session supplies the explicit end state, while reflected calendar
      // set values remain intact, including any deliberate later corrections.
      return {...own,state:own.done>0?actual.state:'planned'};
    }
    // Pending reflection can be shown without pretending the calendar was saved.
    if(!event.workoutSessionId&&session.calendarSource?.eventId===event.id&&session.calendarSource.date===event.date){
      try{if(signature(event)===session.calendarSource.baseline)return {...actual,pending:true};}catch(e){}
    }
    return own;
  }
  function applySession(C,state,rawSession){
    const M=iron();
    const session=M.normalize({...M.empty(),sessions:[rawSession]}).sessions[0];
    must(['COMPLETED','PARTIAL'].includes(session.status)&&session.calendarSource,'확정한 캘린더 운동만 일정에 반영할 수 있습니다.');
    must(session.exercises.some(ex=>ex.sets.some(set=>set.done)),'완료한 세트가 없는 운동은 일정에 반영할 수 없습니다.');
    const {event,actual}=effective(C,state,session.calendarSource.eventId,session.calendarSource.date);
    if(actual.workoutSessionId===session.id)return {next:null,alreadyApplied:true};
    must(!actual.workoutSessionId,'이 일정에는 다른 운동 기록이 연결되어 있습니다. 기존 기록은 유지했습니다.');
    must(signature(actual)===session.calendarSource.baseline,'운동을 시작한 뒤 일정이 변경되었습니다. 완료한 운동은 보관되어 있으며, 변경된 일정은 덮어쓰지 않았습니다.');
    const detail={exercises:copy(session.exercises),notes:session.notes};
    const completed=session.status==='COMPLETED';
    const updated={...actual,detail,completed,workoutSessionId:session.id};
    const options=event.repeat==='none'?{scope:'single'}:{scope:'occurrence',occurrenceDate:actual.date};
    return {next:C.upsert(state,updated,options),alreadyApplied:false};
  }
  function replaceRoutine(C,state,ironState,eventId,date,routineId,expectedBaseline){
    const {event,actual}=effective(C,state,eventId,date),M=iron(),training=M.normalize(ironState);
    must(typeof expectedBaseline==='string'&&signature(actual)===expectedBaseline,'루틴을 선택하는 동안 일정이 변경되었습니다. 현재 일정을 확인한 뒤 다시 선택해 주세요.');
    must(!actual.completed&&!actual.workoutSessionId&&C.volume(actual.detail).completedSets===0,'이미 기록한 세트가 있는 운동은 루틴을 교체할 수 없습니다.');
    must(!training.sessions.some(session=>session.calendarSource?.eventId===eventId&&session.calendarSource.date===date),'이미 시작한 운동은 루틴을 교체할 수 없습니다. 진행 중인 운동이나 완료 기록을 확인해 주세요.');
    const routine=training.routines.find(item=>item.id===routineId);
    must(routine,'선택한 루틴이 삭제되거나 변경되었습니다. 루틴 목록을 다시 열어 주세요.');
    const detail={exercises:routine.exercises.map(ex=>({...copy(ex),id:C.uid(),sets:ex.sets.map(set=>({...copy(set),id:C.uid(),done:false}))})),notes:''};
    const updated={...actual,title:routine.name,detail,completed:false};
    const options=event.repeat==='none'?{scope:'single'}:{scope:'occurrence',occurrenceDate:date};
    return C.upsert(state,updated,options);
  }
  function validateRegistration(C,date,today,start,end){
    must(C.validDate(date)&&C.validDate(today),'올바른 날짜를 선택해 주세요.');
    must(date>=today,'과거 날짜에는 운동 일정을 등록할 수 없습니다.');
    must(C.validTime(start)&&C.validTime(end)&&end>start,'종료 시간은 시작 시간보다 늦어야 합니다.');
  }
  function newSchedule(C,state,date,today,start,end,title,detail,ignoreId=null){
    validateRegistration(C,date,today,start,end);
    must(typeof title==='string'&&title.trim()&&title.trim().length<=160,'일정 이름을 1~160자로 입력해 주세요.');
    const normalized=C.normalizeState(state),name=title.trim();
    must(!C.dayEvents(normalized,date).some(e=>e.id!==ignoreId&&!e.isSample&&e.type==='strength'&&e.title===name),'이 날짜에 같은 이름의 운동 일정이 이미 등록되어 있습니다.');
    let id=ignoreId||C.uid();
    if(!ignoreId)while(normalized.events.some(e=>e.id===id))id=C.uid();
    return C.upsert(normalized,{id,date,start,end,type:'strength',title:name,repeat:'none',repeatUntil:null,completed:false,isSample:false,detail});
  }
  function registerRoutine(C,state,ironState,routineId,date,today,start,end){
    const training=iron().normalize(ironState),routine=training.routines.find(r=>r.id===routineId);
    must(routine,'선택한 루틴이 없습니다. 루틴 목록을 다시 확인해 주세요.');
    const detail={notes:'',exercises:routine.exercises.map(ex=>({...copy(ex),id:C.uid(),sets:ex.sets.map(set=>({...copy(set),id:C.uid(),done:false}))}))};
    return newSchedule(C,state,date,today,start,end,routine.name,detail);
  }
  function registerFreePlan(C,state,date,today,start,end,title,notes='',eventId=null,expectedBaseline=null){
    if(eventId){
      const old=C.normalizeState(state).events.find(e=>e.id===eventId);
      must(old&&old.repeat==='none','수정할 자유운동 일정이 없습니다.');
      const {actual}=effective(C,state,eventId,old.date);
      must(actual.detail.freePlan===true&&!actual.completed&&!actual.workoutSessionId,'이미 시작하거나 종목을 구성한 운동은 이 방식으로 수정할 수 없습니다.');
      must(signature(actual)===expectedBaseline,'일정이 변경되었습니다. 다시 열어 주세요.');
    }
    return newSchedule(C,state,date,today,start,end,title,{exercises:[],notes,freePlan:true},eventId);
  }
  // One finite registration per selected cycle or one to twelve calendar weeks.
  // Pure projection: no storage writes, no changes to program progress.
  function previewProgram(C,state,ironState,programId,anchor,today,start='07:00',end='08:00',weeks=1){
    must(C.validDate(today)&&C.validDate(anchor),'올바른 날짜를 선택해 주세요.');
    must(anchor>=today,'과거 날짜에는 프로그램을 등록할 수 없습니다.');
    must(C.validTime(start)&&C.validTime(end)&&end>start,'종료 시간은 시작 시간보다 늦어야 합니다.');
    const training=iron().normalize(ironState),program=training.programs.find(p=>p.id===programId);
    must(program,'등록할 프로그램을 찾을 수 없습니다.');
    must(Number.isInteger(weeks)&&weeks>=1&&weeks<=12,'등록 주 수는 1~12주로 선택해 주세요.');
    must(program.mode==='fixed'||weeks===1,'순환형 프로그램은 한 번의 순환만 등록합니다.');
    const current=C.normalizeState(state);
    const first=program.mode==='fixed'?C.shiftDate(anchor,-C.dateOf(anchor).getDay()):anchor;
    const rows=Array.from({length:program.mode==='fixed'?7*weeks:program.routineIds.length},(_,i)=>{
      const date=C.shiftDate(first,i);
      const rid=program.mode==='fixed'?program.weekdays[String(C.dateOf(date).getDay())]:program.routineIds[i];
      const routine=training.routines.find(r=>r.id===rid);
      if(!routine)return {date,routineId:null,title:'휴식',status:'rest'};
      const row={date,routineId:rid,title:routine.name,status:'new'};
      if(date<today)return {...row,status:'past'};
      const same=C.dayEvents(current,date).find(e=>!e.isSample&&e.type==='strength'&&e.title===routine.name);
      if(same)return {...row,status:'duplicate',existingId:same.id};
      return row;
    });
    return {programId,programName:program.name,mode:program.mode,anchor,today,start,end,weeks,first,last:rows.at(-1).date,rows,
      count:rows.filter(r=>r.status==='new').length};
  }
  function registerProgram(C,state,ironState,programId,anchor,today,start,end,expectedPreview,weeks=1){
    const preview=previewProgram(C,state,ironState,programId,anchor,today,start,end,weeks);
    must(!expectedPreview||JSON.stringify(preview)===JSON.stringify(expectedPreview),'등록할 날짜 또는 일정이 변경되었습니다. 미리보기를 다시 확인해 주세요.');
    const training=iron().normalize(ironState),next=C.normalizeState(state);
    const ids=new Set(next.events.map(e=>e.id));
    for(const row of preview.rows.filter(r=>r.status==='new')){
      must(row.date>=today,'과거 날짜에는 프로그램을 등록할 수 없습니다.');
      const routine=training.routines.find(r=>r.id===row.routineId);
      let id=C.uid();while(ids.has(id))id=C.uid();ids.add(id);
      next.events.push({id,date:row.date,start,end,type:'strength',title:routine.name,repeat:'none',repeatUntil:null,completed:false,isSample:false,
        detail:{notes:'',exercises:routine.exercises.map(ex=>({...copy(ex),id:C.uid(),sets:ex.sets.map(set=>({...copy(set),id:C.uid(),done:false}))}))}});
    }
    if(!preview.count)return {next:null,preview,count:0};
    next.demo=false;
    return {next:C.normalizeState(next),preview,count:preview.count};
  }
  return Object.freeze({signature,prepareStart,applySession,completion,calendarCompletion,replaceRoutine,registerRoutine,registerFreePlan,previewProgram,registerProgram});
});
