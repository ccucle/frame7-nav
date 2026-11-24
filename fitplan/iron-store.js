/* FORMDAY IRON independent store v1.
   No dependencies, no remote writes, and never touches legacy calendar localStorage. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayIronStore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='formday_iron_independent_v1';
  const VERSION=1;
  const SESSION_STATES=['ACTIVE','PAUSED','SAVED','COMPLETED','PARTIAL'];
  const UNFINISHED=['ACTIVE','PAUSED','SAVED'];
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const uid=()=>typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?'i'+crypto.randomUUID().replace(/-/g,''):'i'+Date.now().toString(36)+Math.random().toString(36).slice(2,11);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const must=(ok,message)=>{if(!ok)throw Error(message);};
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const dateOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(new Date(x+'T12:00:00Z').getTime())&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
  const text=(x,max=100)=>{must(typeof x==='string'&&x.trim().length>0&&x.trim().length<=max,'이름은 1~'+max+'자로 입력해 주세요.');return x.trim();};
  const idOk=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
  const timeOk=x=>typeof x==='string'&&!Number.isNaN(Date.parse(x));
  const number=(x,min,max)=>{must(typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max,'숫자 입력 범위를 확인해 주세요.');return x;};
  const integer=(x,min,max)=>{number(x,min,max);must(Number.isInteger(x),'정수를 입력해 주세요.');return x;};
  function normalizeSet(raw,actual){
    must(obj(raw)&&idOk(raw.id),'세트 식별자가 올바르지 않습니다.');
    const a={id:raw.id,weight:number(raw.weight,0,2000),reps:integer(raw.reps,1,1000),
      rpe:raw.rpe==null?null:number(raw.rpe,1,10),restSec:integer(raw.restSec??90,0,600),
      warmup:raw.warmup===true};
    if(actual){must(typeof raw.done==='boolean','세트 완료 상태가 올바르지 않습니다.');a.done=raw.done;}
    return a;
  }
  function normalizeExercise(raw,actual){
    must(obj(raw)&&idOk(raw.id),'종목 식별자가 올바르지 않습니다.');
    must(Array.isArray(raw.sets)&&raw.sets.length>=1&&raw.sets.length<=50,'세트는 종목당 1~50개까지 가능합니다.');
    const ids=new Set(),sets=raw.sets.map(s=>normalizeSet(s,actual));
    for(const s of sets){must(!ids.has(s.id),'세트 ID가 중복되었습니다.');ids.add(s.id);}
    return {id:raw.id,name:text(raw.name,80),sets,notes:typeof raw.notes==='string'?raw.notes.slice(0,2000):''};
  }
  function normalizeRoutine(raw){
    must(obj(raw)&&idOk(raw.id),'루틴 식별자가 올바르지 않습니다.');
    must(Array.isArray(raw.exercises)&&raw.exercises.length>=1&&raw.exercises.length<=30,'운동 종목은 1~30개까지 가능합니다.');
    const exercises=raw.exercises.map(ex=>normalizeExercise(ex,false));
    const ids=new Set();for(const ex of exercises){must(!ids.has(ex.id),'루틴 운동 ID가 중복되었습니다.');ids.add(ex.id);}
    return {id:raw.id,name:text(raw.name,100),exercises,updatedAt:timeOk(raw.updatedAt)?raw.updatedAt:new Date(0).toISOString()};
  }
  function normalizeProgram(raw,routines){
    must(obj(raw)&&idOk(raw.id),'프로그램 식별자가 올바르지 않습니다.');
    must(raw.mode==='fixed'||raw.mode==='cycle','프로그램 운영 방식이 올바르지 않습니다.');
    must(Array.isArray(raw.routineIds)&&raw.routineIds.length>=1&&raw.routineIds.length<=14,'프로그램에 루틴 1~14개를 지정하세요.');
    for(const id of raw.routineIds)must(routines.has(id),'존재하지 않는 루틴을 참조합니다.');
    const fixed={};
    if(obj(raw.weekdays))for(const [day,id] of Object.entries(raw.weekdays)){
      must(/^[0-6]$/.test(day)&&raw.routineIds.includes(id),'요일별 루틴 설정을 확인해 주세요.');
      fixed[day]=id;
    }
    must(new Set(raw.routineIds).size===raw.routineIds.length,'프로그램에 같은 루틴이 중복되었습니다.');
    const nextIndex=integer(raw.nextIndex??0,0,raw.routineIds.length-1);
    return {id:raw.id,name:text(raw.name,100),mode:raw.mode,routineIds:[...new Set(raw.routineIds)],
      weekdays:fixed,nextIndex,active:raw.active!==false};
  }
  function normalizeCalendarSource(raw,date){
    must(obj(raw)&&typeof raw.eventId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(raw.eventId),'연결할 캘린더 일정이 올바르지 않습니다.');
    must(dateOk(raw.date)&&raw.date===date,'연결된 운동과 일정의 날짜가 다릅니다.');
    must(typeof raw.baseline==='string'&&raw.baseline.length>0&&raw.baseline.length<=1000000,'운동을 시작할 때의 일정 정보가 올바르지 않습니다.');
    let baseline;
    try{baseline=JSON.parse(raw.baseline);}catch(e){throw Error('운동을 시작할 때의 일정 정보가 올바르지 않습니다.');}
    must(obj(baseline)&&baseline.id===raw.eventId&&baseline.date===raw.date&&baseline.type==='strength'&&
      typeof baseline.completed==='boolean'&&obj(baseline.detail)&&Array.isArray(baseline.detail.exercises)&&
      JSON.stringify(baseline)===raw.baseline,'운동을 시작할 때의 일정 정보가 올바르지 않습니다.');
    return {eventId:raw.eventId,date:raw.date,baseline:raw.baseline};
  }
  function normalizeSession(raw){
    must(obj(raw)&&idOk(raw.id),'세션 식별자가 올바르지 않습니다.');
    must(SESSION_STATES.includes(raw.status),'운동 진행 상태를 확인해 주세요.');
    must(dateOk(raw.date)&&timeOk(raw.startedAt),'운동 날짜 또는 시작 시각이 올바르지 않습니다.');
    must(Array.isArray(raw.exercises)&&raw.exercises.length>=1&&raw.exercises.length<=30,'운동 종목을 먼저 추가해 주세요.');
    const exercises=raw.exercises.map(x=>normalizeExercise(x,true));
    const exIds=new Set();for(const ex of exercises){must(!exIds.has(ex.id),'세션 내 운동 종목 ID가 중복되었습니다.');exIds.add(ex.id);}
    const activeMs=integer(raw.activeMs??0,0,2592000000);
    if(raw.status==='ACTIVE')must(timeOk(raw.activeSince),'진행 중 운동의 마지막 시작 시각이 없습니다.');
    const activeSince=raw.status==='ACTIVE'&&timeOk(raw.activeSince)?raw.activeSince:null;
    const finished=raw.status==='COMPLETED'||raw.status==='PARTIAL';
    if(finished)must(timeOk(raw.endedAt),'확정된 운동의 종료 시각이 없습니다.');
    const lastSavedAt=timeOk(raw.lastSavedAt)?raw.lastSavedAt:raw.startedAt;
    return {id:raw.id,programId:raw.programId??null,routineId:raw.routineId??null,
      label:text(raw.label,100),status:raw.status,date:raw.date,startedAt:raw.startedAt,
      activeSince,activeMs,lastSavedAt,endedAt:finished?raw.endedAt:null,
      exercises,notes:typeof raw.notes==='string'?raw.notes.slice(0,4000):'',
      ...(raw.calendarSource===undefined?{}:{calendarSource:normalizeCalendarSource(raw.calendarSource,raw.date)})};
  }
  function normalize(raw){
    must(obj(raw)&&raw.version===VERSION,'지원하지 않는 IRON MODE 기록 형식입니다.');
    must(Array.isArray(raw.routines)&&raw.routines.length<=1000,'루틴 보관함 형식이 올바르지 않습니다.');
    must(Array.isArray(raw.programs)&&raw.programs.length<=100,'프로그램 보관함 형식이 올바르지 않습니다.');
    must(Array.isArray(raw.sessions)&&raw.sessions.length<=15000,'운동 기록 수가 지원 범위를 넘었습니다.');
    const routines=raw.routines.map(normalizeRoutine),ids=new Set();
    for(const item of routines){must(!ids.has(item.id),'루틴 ID 중복입니다.');ids.add(item.id);}
    const programs=raw.programs.map(x=>normalizeProgram(x,ids));
    ids.clear();for(const item of programs){must(!ids.has(item.id),'프로그램 ID 중복입니다.');ids.add(item.id);}
    const sessions=raw.sessions.map(normalizeSession);
    ids.clear();for(const item of sessions){must(!ids.has(item.id),'세션 ID 중복입니다.');ids.add(item.id);}
    must(sessions.filter(s=>UNFINISHED.includes(s.status)).length<=1,'진행 중인 운동은 최대 1개입니다.');
    const favorites=raw.favoriteExercises===undefined?[]:raw.favoriteExercises;
    must(Array.isArray(favorites)&&favorites.length<=500,'즐겨찾기는 최대 500개까지 저장할 수 있습니다.');
    const favoriteExercises=favorites.map(name=>text(name,80));
    must(new Set(favoriteExercises).size===favoriteExercises.length,'즐겨찾기 운동 이름이 중복되었습니다.');
    const revision=typeof raw.revision==='string'&&idOk(raw.revision)?raw.revision:'';
    return {version:VERSION,revision,programs,routines,sessions,favoriteExercises};
  }
  function empty(){return {version:VERSION,revision:'',programs:[],routines:[],sessions:[],favoriteExercises:[]};}
  function toggleFavorite(data,name,selected){
    must(typeof selected==='boolean','즐겨찾기 상태를 확인해 주세요.');
    const next=normalize(data),value=text(name,80);
    if(selected&&!next.favoriteExercises.includes(value)){
      must(next.favoriteExercises.length<500,'즐겨찾기는 최대 500개까지 저장할 수 있습니다.');
      next.favoriteExercises.push(value);
    }else if(!selected)next.favoriteExercises=next.favoriteExercises.filter(x=>x!==value);
    return {next};
  }
  function parseBackup(value){
    must(obj(value),'IRON MODE 백업 파일이 아닙니다.');
    const standard=value.app==='formday-iron'&&value.version===VERSION;
    const cloud=value.app==='FORMDAY-cloud-manual-backup'&&value.kind==='iron';
    must(standard||cloud,'IRON MODE 백업 파일이 아닙니다.');
    return normalize(value.data);
  }
  function createStore(storage){
    const backupKey=KEY+'_previous';
    function load(){
      try{
        const raw=storage.getItem(KEY);
        if(raw==null)return {data:empty(),error:null,raw:null};
        must(raw.length<=24000000,'기록 파일이 너무 큽니다.');
        return {data:normalize(JSON.parse(raw)),error:null,raw};
      }catch(err){return {data:null,error:'기록을 읽지 못했습니다. 원본은 변경하지 않았습니다. '+err.message,raw:null};}
    }
    function save(next,expectedRevision){
      const validated=normalize(next);
      const old=load();
      must(!old.error,'기존 기록이 손상돼 덮어쓰지 않았습니다. '+old.error);
      must(old.data.revision===expectedRevision,'다른 탭에서 운동 기록이 변경됐습니다. 새로고침 후 다시 시도해 주세요.');
      const draft={...validated,revision:uid()};
      const serialized=JSON.stringify(draft);
      try{
        if(old.raw!==null)storage.setItem(backupKey,old.raw);
        must(storage.getItem(KEY)===old.raw,'운동 기록이 다른 탭에서 변경됐습니다.');
        storage.setItem(KEY,serialized);
      }catch(e){throw Error('운동 기록 저장 실패. 입력값을 확인하고 저장 공간을 점검해 주세요. '+e.message);}
      return draft;
    }
    return {load,save,backupKey};
  }
  const nowIso=clock=>(clock||new Date()).toISOString();
  const newSet=(weight=0,reps=10)=>({id:uid(),weight,reps,rpe:null,restSec:90,warmup:false});
  const newExercise=name=>({id:uid(),name,notes:'',sets:[newSet(),newSet(),newSet()]});
  function createRoutine(data,name,exercises,date=new Date()){
    const next=normalize(data),r={id:uid(),name:text(name,100),exercises:copy(exercises),updatedAt:nowIso(date)};
    const valid=normalizeRoutine(r);next.routines.push(valid);
    return {next,routine:valid};
  }
  function createProgram(data,name,mode,routineIds,weekdays={}){
    const next=normalize(data);
    const pr=normalizeProgram({id:uid(),name,mode,routineIds,weekdays,nextIndex:0},new Set(next.routines.map(r=>r.id)));
    next.programs.push(pr);return {next,program:pr};
  }

  function updateRoutine(data,routineId,name,exercises,date=new Date()){
    const next=normalize(data),index=next.routines.findIndex(r=>r.id===routineId);
    must(index>=0,'변경할 루틴을 찾을 수 없습니다.');
    next.routines[index]=normalizeRoutine({id:routineId,name,exercises,updatedAt:nowIso(date)});
    return {next,routine:next.routines[index]};
  }
  function cloneRoutine(data,routineId,date=new Date()){
    const source=normalize(data).routines.find(x=>x.id===routineId);
    must(!!source,'복제할 루틴을 찾을 수 없습니다.');
    const exercises=source.exercises.map(x=>({...x,id:uid(),sets:x.sets.map(s=>({...s,id:uid()}))}));
    return createRoutine(data,source.name+' 복사본',exercises,date);
  }
  function getUnfinished(data){return data.sessions.find(s=>UNFINISHED.includes(s.status))||null;}
  function start(data,{routineId=null,programId=null,label=null,exerciseNames=null},date=new Date()){
    const next=normalize(data);
    must(!getUnfinished(next),'먼저 진행 중인 운동을 처리해 주세요.');
    const routine=next.routines.find(x=>x.id===routineId);
    if(routineId)must(!!routine,'선택한 루틴을 찾을 수 없습니다.');
    const program=next.programs.find(x=>x.id===programId);
    if(programId)must(!!program && !!routine && program.routineIds.includes(routineId),'프로그램 루틴이 올바르지 않습니다.');
    if(exerciseNames!==null)must(!routineId&&Array.isArray(exerciseNames)&&exerciseNames.length>=1&&exerciseNames.length<=30,'자유 운동 종목은 1~30개를 선택하세요.');
    const exercises=routine?copy(routine.exercises):(exerciseNames||['벤치프레스']).map(name=>newExercise(text(name,80)));
    const session={id:uid(),routineId:routine?.id||null,programId:program?.id||null,
      label:label?text(label,100):(routine?.name||'자유 운동'),status:'ACTIVE',
      date:date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),
      startedAt:nowIso(date),activeSince:nowIso(date),lastSavedAt:nowIso(date),activeMs:0,endedAt:null,
      exercises:exercises.map(ex=>({...ex,sets:ex.sets.map(s=>({...s,done:false}))})),notes:''};
    // First free-session exercise is an editable placeholder, not a completed set.
    const valid=normalizeSession(session);next.sessions.push(valid);
    return {next,session:valid};
  }
  function startCalendar(data,plan,date=new Date()){
    const next=normalize(data);
    must(!getUnfinished(next),'먼저 진행 중인 운동을 처리해 주세요.');
    must(obj(plan),'캘린더 운동 계획을 먼저 불러와 주세요.');
    const calendarSource=normalizeCalendarSource({eventId:plan.eventId,date:plan.date,baseline:plan.baseline},plan.date);
    must(!next.sessions.some(s=>s.calendarSource?.eventId===calendarSource.eventId&&s.calendarSource.date===calendarSource.date),'이 일정에서 이미 시작한 운동이 있습니다. 기존 운동 기록을 확인해 주세요.');
    const label=text(plan.label,300).slice(0,100);
    const session=normalizeSession({id:uid(),routineId:null,programId:null,label,status:'ACTIVE',date:plan.date,
      startedAt:nowIso(date),activeSince:nowIso(date),lastSavedAt:nowIso(date),activeMs:0,endedAt:null,
      exercises:copy(plan.exercises),notes:plan.notes,calendarSource});
    next.sessions.push(session);
    return {next,session};
  }
  function modify(data,sessionId,apply,date=new Date()){
    const next=normalize(data),session=next.sessions.find(x=>x.id===sessionId);
    must(!!session&&UNFINISHED.includes(session.status),'수정할 진행 중 세션이 없습니다.');
    if(session.status==='ACTIVE'&&session.activeSince){
      const delta=Math.max(0,Math.min(3600000,date.getTime()-new Date(session.activeSince).getTime()));
      session.activeMs+=Math.round(delta);
      session.activeSince=nowIso(date);
    }
    apply(session);
    session.lastSavedAt=nowIso(date);
    return {next,session};
  }
  function setValue(data,sessionId,exerciseId,setId,values,date=new Date()){
    return modify(data,sessionId,session=>{
      const ex=session.exercises.find(x=>x.id===exerciseId),set=ex?.sets.find(x=>x.id===setId);
      must(!!set,'기록할 세트를 찾지 못했습니다.');
      const candidate=normalizeSet({...set,...values},true);
      Object.assign(set,candidate);
    },date);
  }
  function addExercises(data,sessionId,names,date=new Date()){
    must(Array.isArray(names)&&names.length>=1&&names.length<=30,'추가할 운동 종목을 1~30개 선택하세요.');
    const selected=names.map(name=>text(name,80));
    return modify(data,sessionId,s=>{
      must(s.exercises.length+selected.length<=30,'한 세션에서 종목은 최대 30개입니다.');
      const exercises=selected.map(name=>newExercise(name)).map(ex=>({...ex,sets:ex.sets.map(set=>({...set,done:false}))}));
      s.exercises.push(...exercises);
    },date);
  }
  function addExercise(data,sessionId,name,date=new Date()){return addExercises(data,sessionId,[name],date);}
  function addSet(data,sessionId,exerciseId,date=new Date()){
    return modify(data,sessionId,s=>{
      const ex=s.exercises.find(x=>x.id===exerciseId);must(!!ex&&ex.sets.length<50,'종목 또는 세트 수를 확인해 주세요.');
      const last=ex.sets.at(-1);
      ex.sets.push({...last,id:uid(),done:false});
    },date);
  }
  function modifyActive(data,sessionId,apply,date){
    const result=modify(data,sessionId,session=>{
      must(session.status==='ACTIVE','운동을 재개한 뒤 기록을 변경해 주세요.');
      apply(session);
    },date);
    // Validate the entire candidate before returning an atomic, independently owned snapshot.
    const next=normalize(result.next);
    return {next,session:next.sessions.find(session=>session.id===sessionId)};
  }
  function patchKeys(value,allowed,message){
    must(obj(value)&&Object.keys(value).every(key=>allowed.includes(key)),message);
  }
  function updateSession(data,sessionId,patch,date=new Date()){
    patchKeys(patch,['notes','exercises'],'운동 입력 항목을 확인해 주세요.');
    if(own(patch,'notes'))must(typeof patch.notes==='string','운동 메모는 글자로 입력해 주세요.');
    if(own(patch,'exercises'))must(Array.isArray(patch.exercises),'종목 입력 형식을 확인해 주세요.');
    return modifyActive(data,sessionId,session=>{
      if(own(patch,'notes'))session.notes=patch.notes.slice(0,4000);
      const exerciseIds=new Set();
      for(const change of patch.exercises||[]){
        patchKeys(change,['id','notes','sets'],'종목 입력 항목을 확인해 주세요.');
        must(idOk(change.id)&&!exerciseIds.has(change.id),'종목 식별자가 없거나 중복되었습니다.');
        exerciseIds.add(change.id);
        const exercise=session.exercises.find(item=>item.id===change.id);
        must(!!exercise,'기록할 운동 종목을 찾지 못했습니다.');
        if(own(change,'notes')){
          must(typeof change.notes==='string','종목 메모는 글자로 입력해 주세요.');
          exercise.notes=change.notes.slice(0,2000);
        }
        if(own(change,'sets'))must(Array.isArray(change.sets),'세트 입력 형식을 확인해 주세요.');
        const setIds=new Set();
        for(const values of change.sets||[]){
          patchKeys(values,['id','weight','reps','rpe','restSec','warmup','done'],'세트 입력 항목을 확인해 주세요.');
          must(idOk(values.id)&&!setIds.has(values.id),'세트 식별자가 없거나 중복되었습니다.');
          setIds.add(values.id);
          const set=exercise.sets.find(item=>item.id===values.id);
          must(!!set,'기록할 세트를 찾지 못했습니다.');
          if(own(values,'warmup'))must(typeof values.warmup==='boolean','워밍업 상태를 확인해 주세요.');
          if(own(values,'restSec'))integer(values.restSec,0,600);
          Object.assign(set,normalizeSet({...set,...values},true));
        }
      }
    },date);
  }
  function removeSet(data,sessionId,exerciseId,date=new Date()){
    return modifyActive(data,sessionId,session=>{
      const exercise=session.exercises.find(item=>item.id===exerciseId);
      must(!!exercise,'변경할 운동 종목을 찾지 못했습니다.');
      must(exercise.sets.length>1,'종목마다 세트가 최소 1개 필요합니다.');
      must(!exercise.sets.at(-1).done,'완료한 마지막 세트는 먼저 완료 체크를 해제해 주세요.');
      exercise.sets.pop();
    },date);
  }
  function replaceExercise(data,sessionId,exerciseId,name,date=new Date()){
    const selected=text(name,80);
    return modifyActive(data,sessionId,session=>{
      const exercise=session.exercises.find(item=>item.id===exerciseId);
      must(!!exercise,'교체할 운동 종목을 찾지 못했습니다.');
      must(!exercise.sets.some(set=>set.done),'완료한 세트가 있는 종목은 교체할 수 없습니다. 새 종목으로 추가해 주세요.');
      const replacement=newExercise(selected);
      exercise.name=replacement.name;
      exercise.notes='';
      exercise.sets=replacement.sets.map(set=>({...set,done:false}));
    },date);
  }
  function getPreviousExercise(data,name,beforeSessionId=null){
    const snapshot=normalize(data),selected=text(name,80);
    const current=beforeSessionId===null?null:snapshot.sessions.find(session=>session.id===beforeSessionId);
    if(beforeSessionId!==null)must(!!current,'현재 운동 세션을 찾지 못했습니다.');
    const cutoff=current?Date.parse(current.startedAt):Infinity;
    const sessions=snapshot.sessions.filter(session=>session.id!==beforeSessionId&&
      (session.status==='COMPLETED'||session.status==='PARTIAL')&&Date.parse(session.endedAt)<=cutoff)
      .sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt)||Date.parse(b.startedAt)-Date.parse(a.startedAt));
    for(const session of sessions){
      const exercise=session.exercises.find(item=>item.name===selected&&item.sets.some(set=>set.done));
      if(exercise)return {sessionId:session.id,date:session.date,label:session.label,endedAt:session.endedAt,exercise};
    }
    return null;
  }
  function loadPreviousSets(data,sessionId,exerciseId,date=new Date()){
    let previous=null;
    const result=modifyActive(data,sessionId,session=>{
      const exercise=session.exercises.find(item=>item.id===exerciseId);
      must(!!exercise,'기록을 불러올 운동 종목을 찾지 못했습니다.');
      must(!exercise.sets.some(set=>set.done),'완료한 세트가 있는 종목에는 이전 기록을 덮어쓸 수 없습니다.');
      previous=getPreviousExercise(data,exercise.name,sessionId);
      must(!!previous,'이 종목의 이전 완료 기록이 없습니다.');
      exercise.sets=previous.exercise.sets.filter(set=>set.done).map(set=>({...set,id:uid(),done:false}));
    },date);
    return {...result,previous};
  }
  function changeState(data,sessionId,action,date=new Date()){
    return modify(data,sessionId,s=>{
      const transitions={pause:['ACTIVE','PAUSED'],stash:['ACTIVE','SAVED'],resume:['PAUSED','ACTIVE'],resumeSaved:['SAVED','ACTIVE'],stashPaused:['PAUSED','SAVED']};
      const tr=transitions[action];must(!!tr&&s.status===tr[0],'현재 운동 상태에서는 이 작업을 수행할 수 없습니다.');
      s.status=tr[1];s.activeSince=tr[1]==='ACTIVE'?nowIso(date):null;
    },date);
  }
  function finish(data,sessionId,kind,date=new Date()){
    must(kind==='COMPLETED'||kind==='PARTIAL','확정 종류가 올바르지 않습니다.');
    const result=modify(data,sessionId,s=>{
      const done=s.exercises.reduce((sum,e)=>sum+e.sets.filter(x=>x.done).length,0);
      must(done>0,'완료한 세트가 없어 운동을 확정할 수 없습니다.');
      s.status=kind;s.endedAt=nowIso(date);s.activeSince=null;
    },date);
    const session=result.session;
    if(kind==='COMPLETED'&&session.programId&&session.routineId){
      const program=result.next.programs.find(x=>x.id===session.programId);
      if(program&&program.mode==='cycle'){
        const current=program.routineIds[program.nextIndex];
        if(current===session.routineId)program.nextIndex=(program.nextIndex+1)%program.routineIds.length;
      }
    }
    return result;
  }
  function cancel(data,sessionId){
    const next=normalize(data),session=next.sessions.find(x=>x.id===sessionId);
    must(!!session&&UNFINISHED.includes(session.status),'취소할 진행 중 세션이 없습니다.');
    next.sessions=next.sessions.filter(x=>x.id!==sessionId);
    return {next,session};
  }
  function resumeAfterReload(data,date=new Date()){
    const next=normalize(data),s=getUnfinished(next);
    if(s&&s.status==='ACTIVE'){s.status='SAVED';s.activeSince=null;s.lastSavedAt=nowIso(date);}
    return next;
  }
  function recordSummary(s){
    let completedSets=0,volume=0,exercises=0;
    for(const ex of s.exercises){
      let done=false;
      for(const set of ex.sets)if(set.done){
        completedSets++;done=true;
        if(!set.warmup)volume+=set.weight*set.reps;
      }
      if(done)exercises++;
    }
    return {completedSets,volume:Math.round(volume*100)/100,exercises,minutes:Math.round(s.activeMs/60000)};
  }
  return Object.freeze({KEY,VERSION,SESSION_STATES,UNFINISHED,uid,empty,copy,normalize,parseBackup,toggleFavorite,createStore,newSet,newExercise,createRoutine,updateRoutine,cloneRoutine,createProgram,getUnfinished,start,startCalendar,modify,setValue,addExercise,addExercises,addSet,updateSession,removeSet,replaceExercise,getPreviousExercise,loadPreviousSets,changeState,finish,cancel,resumeAfterReload,recordSummary});
});
