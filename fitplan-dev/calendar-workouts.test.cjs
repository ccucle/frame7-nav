'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../fitplan/core.js');
const M=require('../fitplan/iron-store.js');
const K=require('../fitplan/calendar-workouts.js');
const P=require('../fitplan/sync-policy.js');
const date='2026-11-24',clock=new Date('2026-11-24T07:00:00.000Z');
const clone=value=>JSON.parse(JSON.stringify(value));
const set=(id,weight,reps,extra={})=>({id,weight,reps,rpe:null,done:false,warmup:false,...extra});
const event=(extra={})=>({id:'plan1',date,start:'18:30',end:'19:30',type:'strength',title:'가슴 루틴',repeat:'none',completed:false,isSample:false,
  detail:{exercises:[{id:'chest1',name:'벤치프레스',notes:'기존 종목 메모',sets:[set('warmup1',20,15,{warmup:true}),set('work1',62.5,8,{rpe:7.5}),set('work2',65,6)]},
    {id:'chest2',name:'덤벨 플라이',notes:'',sets:[set('fly1',10,12)]}],notes:'기존 일정 메모'},...extra});
const calendar=(...events)=>C.normalizeState({events,settings:{...C.defaults},demo:false});
function begin(cal=calendar(event()),training=M.empty(),day=date){
  return M.startCalendar(training,K.prepareStart(C,cal,'plan1',day),clock);
}
function finish(cal,all=false,day=date){
  const started=begin(cal,M.empty(),day),id=started.session.id;
  let next=started.next;
  for(const ex of started.session.exercises)for(const s of ex.sets){
    if(all||s.id==='work1')next=M.setValue(next,id,ex.id,s.id,{done:true},clock).next;
  }
  return M.finish(next,id,all?'COMPLETED':'PARTIAL',new Date(clock.getTime()+600000));
}
function routines(){return M.createRoutine(M.empty(),'하체 루틴',[
  {id:'routine-ex',name:'스쿼트',notes:'루틴의 종목 메모',sets:[{id:'routine-warmup',weight:20,reps:15,rpe:null,restSec:60,warmup:true},{id:'routine-set',weight:90,reps:6,rpe:8,restSec:120,warmup:false}]}
],clock).next;}
function memory(initial={}){
  const db=new Map(Object.entries(initial));let failKey=null;
  return {db,getItem:key=>db.get(key)??null,setItem(key,value){if(key===failKey)throw Error('simulated quota');db.set(key,value);},fail(key){failKey=key;}};
}

test('old calendar and independent records remain free of optional link fields',()=>{
  const cal=calendar(event()),free=M.start(M.empty(),{},clock).next;
  assert.equal(Object.hasOwn(cal.events[0],'workoutSessionId'),false);
  assert.equal(Object.hasOwn(C.occurrence(cal.events[0],date),'workoutSessionId'),false);
  assert.equal(Object.hasOwn(free.sessions[0],'calendarSource'),false);
  assert.deepEqual(C.normalizeState(clone(cal)),cal);assert.deepEqual(M.normalize(clone(free)),free);
});

test('calendar start preserves exact ordered sets, prior done values, warmups, RPE, notes, and occurrence date',()=>{
  const planned=event();planned.detail.exercises[0].sets[0].done=true;
  const cal=calendar(planned),training=routines(),before=clone({cal,training});
  const plan=K.prepareStart(C,cal,'plan1',date),started=M.startCalendar(training,plan,new Date('2026-11-25T01:00:00Z'));
  assert.equal(started.session.date,date);assert.equal(started.session.startedAt,'2026-11-25T01:00:00.000Z');
  assert.equal(started.session.label,'가슴 루틴');assert.equal(started.session.routineId,null);assert.equal(started.session.programId,null);
  assert.deepEqual(started.session.exercises.map(ex=>({...ex,sets:ex.sets.map(({restSec,...s})=>s)})),cal.events[0].detail.exercises);
  assert.ok(started.session.exercises.every(ex=>ex.sets.every(s=>s.restSec===90)));
  assert.equal(started.session.notes,planned.detail.notes);
  assert.deepEqual(started.session.calendarSource,{eventId:'plan1',date,baseline:K.signature(C.occurrence(cal.events[0],date))});
  assert.deepEqual({cal,training},before);
});

test('one existing linked session prevents duplicate starts; a cancelled zero-history attempt can start again',()=>{
  const cal=calendar(event()),started=begin(cal);
  assert.throws(()=>begin(cal,started.next),/진행 중/);
  let next=M.setValue(started.next,started.session.id,'chest1','work1',{done:true},clock).next;
  next=M.finish(next,started.session.id,'PARTIAL',clock).next;
  assert.throws(()=>begin(cal,next),/이미 시작/);
  const canceled=M.cancel(started.next,started.session.id).next;
  assert.equal(begin(cal,canceled).next.sessions.length,1);
});

test('partial completion applies only actual flags and values and keeps event metadata',()=>{
  const cal=calendar(event({title:'원래 일정 제목'})),ended=finish(cal),before=clone({cal,session:ended.session});
  const result=K.applySession(C,cal,ended.session),actual=C.occurrence(result.next.events[0],date);
  assert.equal(result.alreadyApplied,false);assert.equal(actual.completed,false);
  assert.equal(actual.workoutSessionId,ended.session.id);assert.equal(actual.title,'원래 일정 제목');
  assert.equal(actual.start,'18:30');assert.equal(actual.end,'19:30');
  assert.equal(C.volume(actual.detail).completedSets,1);assert.equal(C.volume(actual.detail).volume,500);
  assert.deepEqual(actual.detail.exercises.map(ex=>ex.sets.map(s=>s.done)),[[false,true,false],[false]]);
  assert.deepEqual({cal,session:ended.session},before);
  assert.deepEqual(K.applySession(C,result.next,ended.session),{next:null,alreadyApplied:true});
});

test('all completed sets mark only the selected repeating occurrence complete',()=>{
  const cal=calendar(event({date:'2026-11-17',repeat:'weekly'})),before=clone(cal),ended=finish(cal,true);
  const linked=K.applySession(C,cal,ended.session).next;
  assert.equal(C.occurrence(linked.events[0],date).completed,true);
  assert.equal(C.occurrence(linked.events[0],date).workoutSessionId,ended.session.id);
  assert.equal(Object.hasOwn(linked.events[0],'workoutSessionId'),false);
  assert.deepEqual(C.occurrence(linked.events[0],'2026-11-17'),C.occurrence(before.events[0],'2026-11-17'));
  assert.deepEqual(C.occurrence(linked.events[0],'2026-12-01'),C.occurrence(before.events[0],'2026-12-01'));
  assert.deepEqual(linked.events[0].detail,before.events[0].detail);
});

test('retry after successful application is a no-op even when calendar actual values were edited later',()=>{
  const cal=calendar(event()),ended=finish(cal),linked=K.applySession(C,cal,ended.session).next;
  const actual=C.occurrence(linked.events[0],date);actual.detail.exercises[0].sets[1].weight=70;
  const edited=C.upsert(linked,actual),before=clone(edited);
  assert.equal(edited.events[0].workoutSessionId,ended.session.id);
  assert.deepEqual(K.applySession(C,edited,ended.session),{next:null,alreadyApplied:true});
  assert.deepEqual(edited,before);
});

test('changed, deleted, rescheduled, converted, or differently linked source is never overwritten',()=>{
  const cal=calendar(event()),ended=finish(cal);
  const scenarios=[
    source=>{source.events[0].title='수정한 제목';},
    source=>{source.events[0].start='18:00';},
    source=>{source.events[0].detail.exercises[0].sets[1].weight=75;},
    source=>{source.events=[];},
    source=>{source.events[0].date='2026-11-25';},
    source=>{Object.assign(source.events[0],{type:'cardio',detail:{cardio:'러닝',minutes:20,distance:3,intensity:'보통'}});},
    source=>{source.events[0].workoutSessionId='another-session';}
  ];
  for(const change of scenarios){const changed=clone(cal);change(changed);const before=clone(changed);
    assert.throws(()=>K.applySession(C,changed,ended.session),/변경|삭제|다른 운동/);assert.deepEqual(changed,before);}
  assert.equal(ended.session.status,'PARTIAL');assert.equal(ended.session.exercises[0].sets[1].done,true);
});

test('newly changed repeating template conflicts but an existing occurrence keeps its own baseline',()=>{
  const cal=calendar(event({date:'2026-11-17',repeat:'weekly'})),ended=finish(cal);
  const altered=C.upsert(cal,{...cal.events[0],title:'변경한 주간 계획'},{scope:'series'});
  assert.throws(()=>K.applySession(C,altered,ended.session),/시작한 뒤 일정이 변경/);
  const occurrence=C.occurrence(cal.events[0],date),snap=C.upsert(cal,occurrence,{scope:'occurrence',occurrenceDate:date});
  const planned=finish(snap),newTemplate=C.upsert(snap,{...snap.events[0],title:'새 반복 기본값'},{scope:'series'});
  assert.equal(K.applySession(C,newTemplate,planned.session).next.events[0].occurrences[date].workoutSessionId,planned.session.id);
});

test('long calendar titles fit session labels without truncating calendar titles on completion',()=>{
  const title='아주 긴 운동 계획 '.repeat(18),cal=calendar(event({title})),ended=finish(cal);
  assert.equal(ended.session.label.length,100);
  assert.equal(K.applySession(C,cal,ended.session).next.events[0].title,title);
});

test('routine replacement copies new targets and IDs without altering original routine or calendar input',()=>{
  const cal=calendar(event()),training=routines(),routine=training.routines[0],before=clone({cal,training});
  const updated=K.replaceRoutine(C,cal,training,'plan1',date,routine.id,K.signature(C.occurrence(cal.events[0],date)));
  const actual=C.occurrence(updated.events[0],date),ex=actual.detail.exercises[0];
  assert.equal(actual.title,'하체 루틴');assert.equal(actual.start,'18:30');assert.equal(actual.end,'19:30');assert.equal(actual.completed,false);
  assert.equal(ex.name,'스쿼트');assert.equal(ex.notes,'루틴의 종목 메모');assert.notEqual(ex.id,routine.exercises[0].id);
  assert.deepEqual(ex.sets.map(({id,...s})=>s),[{weight:20,reps:15,rpe:null,done:false,warmup:true},{weight:90,reps:6,rpe:8,done:false,warmup:false}]);
  assert.ok(ex.sets.every(s=>!routine.exercises[0].sets.some(source=>source.id===s.id)));
  assert.deepEqual({cal,training},before);
  assert.deepEqual(K.prepareStart(C,updated,'plan1',date).exercises[0].sets.map(s=>[s.weight,s.reps]),[[20,15],[90,6]]);
});

test('routine replacement affects one repeating date while preserving existing history and future template',()=>{
  let cal=calendar(event({date:'2026-11-17',repeat:'weekly'}));
  cal=C.toggleComplete(cal,'plan1','2026-11-17');
  const training=routines(),before=clone(cal),updated=K.replaceRoutine(C,cal,training,'plan1',date,training.routines[0].id,K.signature(C.occurrence(cal.events[0],date)));
  assert.equal(C.occurrence(updated.events[0],date).title,'하체 루틴');
  assert.deepEqual(C.occurrence(updated.events[0],'2026-11-17'),C.occurrence(before.events[0],'2026-11-17'));
  assert.deepEqual(C.occurrence(updated.events[0],'2026-12-01'),C.occurrence(before.events[0],'2026-12-01'));
  assert.deepEqual(updated.events[0].detail,before.events[0].detail);
});

test('replacement blocks actual records, linked sessions, stale selection, deleted routine and missing source',()=>{
  const cal=calendar(event()),training=routines(),rid=training.routines[0].id,baseline=K.signature(C.occurrence(cal.events[0],date));
  const actual=clone(cal);actual.events[0].detail.exercises[0].sets[0].done=true;
  assert.throws(()=>K.replaceRoutine(C,actual,training,'plan1',date,rid,K.signature(C.occurrence(actual.events[0],date))),/기록한 세트/);
  const done=C.toggleComplete(cal,'plan1',date);
  assert.throws(()=>K.replaceRoutine(C,done,training,'plan1',date,rid,K.signature(C.occurrence(done.events[0],date))),/기록한 세트/);
  const marker=clone(cal);marker.events[0].workoutSessionId='linked';
  assert.throws(()=>K.replaceRoutine(C,marker,training,'plan1',date,rid,baseline),/기록한 세트/);
  const active=begin(cal,training);
  assert.throws(()=>K.replaceRoutine(C,cal,active.next,'plan1',date,rid,baseline),/이미 시작/);
  const final=finish(cal);
  assert.throws(()=>K.replaceRoutine(C,cal,{...training,sessions:final.next.sessions},'plan1',date,rid,baseline),/이미 시작/);
  assert.throws(()=>K.replaceRoutine(C,cal,training,'plan1',date,rid,baseline+' '),/선택하는 동안/);
  assert.throws(()=>K.replaceRoutine(C,cal,training,'plan1',date,'missing',baseline),/루틴이 삭제/);
  assert.throws(()=>K.replaceRoutine(C,calendar(),training,'plan1',date,rid,baseline),/일정이 없/);
});

test('link fields survive normalization, both backup formats, cloud payloads and ordinary calendar saves',()=>{
  const cal=calendar(event({repeat:'weekly'})),ended=finish(cal),linked=K.applySession(C,cal,ended.session).next;
  const restoredCalendar=C.normalizeState(P.backupPayload('calendar',linked,C,M));
  const restoredIron=M.parseBackup(P.backupPayload('iron',ended.next,C,M));
  assert.equal(C.occurrence(restoredCalendar.events[0],date).workoutSessionId,ended.session.id);
  assert.deepEqual(restoredIron.sessions[0].calendarSource,ended.session.calendarSource);
  assert.equal(C.occurrence(JSON.parse(P.safePayload('calendar',linked,C,M).payload).events[0],date).workoutSessionId,ended.session.id);
  assert.deepEqual(JSON.parse(P.safePayload('iron',ended.next,C,M).payload).sessions[0].calendarSource,ended.session.calendarSource);
  const update=C.occurrence(restoredCalendar.events[0],date);update.title='완료 후 바꾼 제목';
  const saved=C.upsert(restoredCalendar,update,{scope:'occurrence',occurrenceDate:date});
  assert.equal(C.occurrence(saved.events[0],date).workoutSessionId,ended.session.id);
  assert.equal(Object.hasOwn(C.occurrence(saved.events[0],'2026-12-01'),'workoutSessionId'),false);
});

test('calendar storage failure leaves finalized IRON record available for explicit retry',()=>{
  const storage=memory(),calendarStore=C.makeStore(storage),ironStore=M.createStore(storage);
  const cal=calendarStore.save(calendar(event()),''),ended=finish(cal),savedIron=ironStore.save(ended.next,'');
  storage.fail(C.STORE);
  const pending=K.applySession(C,cal,savedIron.sessions[0]);
  assert.throws(()=>calendarStore.save(pending.next,cal.revision),/저장하지 못/);
  assert.equal(ironStore.load().data.sessions[0].status,'PARTIAL');
  assert.equal(calendarStore.load().data.events[0].workoutSessionId,undefined);
  storage.fail(null);
  const current=calendarStore.load().data,retry=K.applySession(C,current,ironStore.load().data.sessions[0]);
  const applied=calendarStore.save(retry.next,current.revision);
  assert.equal(applied.events[0].workoutSessionId,savedIron.sessions[0].id);
  assert.deepEqual(K.applySession(C,applied,savedIron.sessions[0]),{next:null,alreadyApplied:true});
});

test('invalid source metadata and calendar marker types are rejected rather than dropped',()=>{
  const started=begin();
  for(const source of [null,{}, {...started.session.calendarSource,eventId:'../bad'}, {...started.session.calendarSource,date:'2026-11-25'},
    {...started.session.calendarSource,baseline:''},{...started.session.calendarSource,baseline:'not-json'},
    {...started.session.calendarSource,baseline:'x'.repeat(1000001)},
    {...started.session.calendarSource,baseline:started.session.calendarSource.baseline+' '}]){
    assert.throws(()=>M.normalize({...started.next,sessions:[{...started.session,calendarSource:source}]}),/연결|일정 정보/);
  }
  for(const value of [null,'','../bad',123])assert.throws(()=>calendar(event({workoutSessionId:value})),/식별자/);
  assert.throws(()=>calendar(event({type:'cardio',detail:{cardio:'러닝',minutes:20,distance:3},workoutSessionId:'linked'})),/웨이트 일정/);
});

test('sample, completed, differently typed or missing plans cannot create execution sessions',()=>{
  assert.throws(()=>K.prepareStart(C,calendar(event({isSample:true})),'plan1',date),/체험용/);
  assert.throws(()=>K.prepareStart(C,calendar(event({completed:true})),'plan1',date),/이미 완료/);
  assert.throws(()=>K.prepareStart(C,calendar(event({workoutSessionId:'linked'})),'plan1',date),/연결된 운동/);
  assert.throws(()=>K.prepareStart(C,calendar(),'plan1',date),/일정이 없/);
  assert.throws(()=>K.prepareStart(C,calendar(event()),'plan1','2026-02-30'),/날짜/);
});

test('signature excludes marker and property order while tracking meaningful planned values',()=>{
  const actual=C.occurrence(calendar(event()).events[0],date),baseline=K.signature(actual);
  const shuffled=Object.fromEntries(Object.entries(actual).reverse());shuffled.workoutSessionId='linked';
  shuffled.detail.exercises[0]=Object.fromEntries(Object.entries(shuffled.detail.exercises[0]).reverse());
  assert.equal(K.signature(shuffled),baseline);
  const altered=clone(actual);altered.detail.exercises[0].sets[0].warmup=false;
  assert.notEqual(K.signature(altered),baseline);
  assert.deepEqual(JSON.parse(baseline).detail,actual.detail);
});

function programFixture(mode){
  let iron=M.empty();const ids=[];
  for(const name of ['가슴 루틴','등 루틴','하체 루틴']){
    const r=M.createRoutine(iron,name,[M.newExercise('벤치프레스')]);iron=r.next;ids.push(r.routine.id);
  }
  const p=M.createProgram(iron,'테스트 프로그램',mode,ids,mode==='fixed'?{'1':ids[0],'2':ids[1],'4':ids[0],'6':ids[2]}:{});
  return {iron:p.next,id:p.program.id,ids};
}
const programCalendar=()=>C.normalizeState({events:[],settings:{...C.defaults},demo:false});
test('cycle program registration creates one finite ordered workout per day',()=>{
  const {iron,id}=programFixture('cycle'),calendar=programCalendar(),before=JSON.stringify(iron);
  const preview=K.previewProgram(C,calendar,iron,id,'2026-11-24','2026-11-24','09:00','10:00');
  assert.deepEqual(preview.rows.map(x=>x.date),['2026-11-24','2026-11-25','2026-11-26']);
  const result=K.registerProgram(C,calendar,iron,id,preview.anchor,preview.today,preview.start,preview.end,preview);
  assert.equal(result.count,3);
  assert.deepEqual(result.next.events.map(e=>e.title),['가슴 루틴','등 루틴','하체 루틴']);
  assert.ok(result.next.events.every(e=>e.repeat==='none'&&!e.completed&&e.detail.exercises.every(ex=>ex.sets.every(s=>!s.done))));
  assert.equal(JSON.stringify(iron),before);assert.equal(calendar.events.length,0);
  assert.equal(K.prepareStart(C,result.next,result.next.events[0].id,'2026-11-24').label,'가슴 루틴');
});
test('fixed program respects selected Sunday-Saturday week, excludes past days and rest, permits repeated routine days',()=>{
  const {iron,id}=programFixture('fixed'),calendar=programCalendar();
  const p=K.previewProgram(C,calendar,iron,id,'2026-11-24','2026-11-24');
  assert.equal(p.first,'2026-11-22');assert.equal(p.last,'2026-11-28');
  assert.deepEqual(p.rows.map(r=>r.status),['rest','past','new','rest','new','rest','new']);
  const result=K.registerProgram(C,calendar,iron,id,p.anchor,p.today,p.start,p.end,p);
  assert.deepEqual(result.next.events.map(e=>e.date),['2026-11-24','2026-11-26','2026-11-28']);
  const next=K.previewProgram(C,result.next,iron,id,'2026-11-29','2026-11-24');
  assert.equal(next.count,4);assert.equal(next.first,'2026-11-29');assert.equal(next.last,'2026-12-05');
});
test('past dates are rejected at preview and registration, including when midnight passes',()=>{
  const {iron,id}=programFixture('cycle'),calendar=programCalendar();
  assert.throws(()=>K.previewProgram(C,calendar,iron,id,'2026-11-23','2026-11-24'),/과거 날짜/);
  const preview=K.previewProgram(C,calendar,iron,id,'2026-11-24','2026-11-24');
  assert.throws(()=>K.registerProgram(C,calendar,iron,id,preview.anchor,'2026-11-25',preview.start,preview.end,preview),/과거 날짜/);
  assert.throws(()=>K.previewProgram(C,calendar,iron,id,'2026-11-24','2026-11-24','10:00','09:00'),/종료 시간/);
  assert.equal(calendar.events.length,0);
});
test('duplicate registration skips existing routine dates without overwriting or changing program',()=>{
  const {iron,id}=programFixture('cycle'),calendar=programCalendar();
  const p=K.previewProgram(C,calendar,iron,id,'2026-11-24','2026-11-24');
  const first=K.registerProgram(C,calendar,iron,id,p.anchor,p.today,p.start,p.end,p);
  const retry=K.previewProgram(C,first.next,iron,id,p.anchor,p.today);
  assert.equal(retry.count,0);assert.ok(retry.rows.every(r=>r.status==='duplicate'));
  assert.equal(K.registerProgram(C,first.next,iron,id,retry.anchor,retry.today,retry.start,retry.end,retry).next,null);
  assert.throws(()=>K.registerProgram(C,first.next,iron,id,p.anchor,p.today,p.start,p.end,p),/미리보기/);
});
test('fixed preview with only elapsed workout days creates no events',()=>{
  const {iron,id}=programFixture('fixed'),calendar=programCalendar();
  const p=K.previewProgram(C,calendar,iron,id,'2026-11-28','2026-11-28');
  assert.equal(p.count,1);
  const empty=M.updateProgram(iron,id,'월요일','fixed',[iron.routines[0].id],{'1':iron.routines[0].id}).next;
  const e=K.previewProgram(C,calendar,empty,id,'2026-11-28','2026-11-28');
  assert.equal(e.count,0);assert.equal(K.registerProgram(C,calendar,empty,id,e.anchor,e.today,e.start,e.end,e).next,null);
});
