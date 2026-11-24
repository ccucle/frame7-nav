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
        sets:ex.sets.map(set=>({id:set.id,weight:set.weight,reps:set.reps,rpe:set.rpe??null,done:set.done===true,warmup:set.warmup===true}))})),notes:event.detail.notes||''}});
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
      notes:actual.detail.notes||'',baseline:signature(actual)};
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
    const completed=detail.exercises.every(ex=>ex.sets.every(set=>set.done));
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
  return Object.freeze({signature,prepareStart,applySession,replaceRoutine});
});
