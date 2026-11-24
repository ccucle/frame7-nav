'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../fitplan/iron-store.js');
const base=new Date('2026-11-24T00:00:00.000Z');
const at=minutes=>new Date(base.getTime()+minutes*60000);
const begin=(data=M.empty(),minutes=0,names=['벤치프레스','랫풀다운'])=>M.start(data,{exerciseNames:names},at(minutes));
function rejectsUnchanged(data,operation,pattern){
  const before=JSON.stringify(data);
  assert.throws(operation,pattern);
  assert.equal(JSON.stringify(data),before);
}
function record(data,name,minute,kind='COMPLETED',values={}){
  const started=begin(data,minute,[name]),exercise=started.session.exercises[0];
  const updated=M.updateSession(started.next,started.session.id,{exercises:[{id:exercise.id,sets:[
    {id:exercise.sets[0].id,weight:50,reps:8,done:true,...values}
  ]}]},at(minute+1));
  return M.finish(updated.next,started.session.id,kind,at(minute+2));
}

test('atomic session input persists notes and multiple set edits without changing its input',()=>{
  const initial=begin(),s=initial.session,[a,b]=s.exercises;
  const before=JSON.stringify(initial.next);
  const updated=M.updateSession(initial.next,s.id,{notes:'오늘의 운동 메모',exercises:[
    {id:a.id,notes:'벤치 각도 확인',sets:[
      {id:a.sets[0].id,weight:25.5,reps:12,rpe:7.5,restSec:60,warmup:true,done:true},
      {id:a.sets[1].id,weight:40,reps:10,done:true}
    ]},
    {id:b.id,sets:[{id:b.sets[0].id,weight:35,reps:11}]}
  ]},at(2));
  assert.equal(JSON.stringify(initial.next),before);
  assert.equal(updated.session,updated.next.sessions[0]);
  assert.equal(updated.session.notes,'오늘의 운동 메모');
  assert.equal(updated.session.exercises[0].notes,'벤치 각도 확인');
  assert.equal(updated.session.exercises[0].sets[0].rpe,7.5);
  assert.equal(updated.session.exercises[1].sets[0].weight,35);
  assert.equal(updated.session.activeMs,120000);
  assert.equal(updated.session.activeSince,at(2).toISOString());
  assert.deepEqual(M.recordSummary(updated.session),{completedSets:2,volume:400,exercises:1,minutes:2});
  assert.deepEqual(M.normalize(updated.next),updated.next);
});

test('session and exercise note limits remain compatible with v1 backups',()=>{
  const {next,session}=begin(),ex=session.exercises[0];
  const saved=M.updateSession(next,session.id,{notes:'가'.repeat(4100),exercises:[{id:ex.id,notes:'나'.repeat(2100)}]},at(1));
  assert.equal(saved.session.notes.length,4000);
  assert.equal(saved.session.exercises[0].notes.length,2000);
  assert.equal(saved.next.version,1);
  assert.equal(M.KEY,'formday_iron_independent_v1');
  assert.deepEqual(M.parseBackup({app:'formday-iron',version:1,data:saved.next}),saved.next);
});

test('an invalid later input cannot partially save earlier notes or sets',()=>{
  const {next,session}=begin(),[a,b]=session.exercises;
  rejectsUnchanged(next,()=>M.updateSession(next,session.id,{notes:'저장되면 안 됨',exercises:[
    {id:a.id,notes:'부분 변경 금지',sets:[{id:a.sets[0].id,weight:100,done:true}]},
    {id:b.id,sets:[{id:b.sets[0].id,reps:0}]}
  ]},at(3)),/범위/);
});

test('atomic patches reject malformed shapes, duplicate IDs and unknown fields',()=>{
  const {next,session}=begin(),ex=session.exercises[0],id=ex.sets[0].id;
  const invalid=[null,[],{status:'COMPLETED'},{label:'덮어쓰기'},{notes:2},{exercises:{}},
    {exercises:[null]},{exercises:[{id:ex.id,name:'바꿔치기'}]},
    {exercises:[{id:'missing'}]},{exercises:[{id:ex.id},{id:ex.id}]},
    {exercises:[{id:ex.id,notes:false}]},{exercises:[{id:ex.id,sets:{}}]},
    {exercises:[{id:ex.id,sets:[null]}]},
    {exercises:[{id:ex.id,sets:[{id:'missing'}]}]},
    {exercises:[{id:ex.id,sets:[{id},{id}]}]},
    {exercises:[{id:ex.id,sets:[{id,label:'잘못된 필드'}]}]},
    {exercises:[{id:ex.id,sets:[{id,weight:'30'}]}]},
    {exercises:[{id:ex.id,sets:[{id,reps:2.5}]}]},
    {exercises:[{id:ex.id,sets:[{id,rpe:11}]}]},
    {exercises:[{id:ex.id,sets:[{id,restSec:null}]}]},
    {exercises:[{id:ex.id,sets:[{id,warmup:'true'}]}]},
    {exercises:[{id:ex.id,sets:[{id,done:1}]}]}
  ];
  for(const patch of invalid)rejectsUnchanged(next,()=>M.updateSession(next,session.id,patch,at(1)));
});

test('all new session mutations reject paused and saved sessions without changing time or data',()=>{
  for(const action of ['pause','stash']){
    const started=begin(),paused=M.changeState(started.next,started.session.id,action,at(1));
    const id=paused.session.id,ex=paused.session.exercises[0];
    for(const operation of [
      ()=>M.updateSession(paused.next,id,{notes:'변경'},at(2)),
      ()=>M.removeSet(paused.next,id,ex.id,at(2)),
      ()=>M.replaceExercise(paused.next,id,ex.id,'스쿼트',at(2)),
      ()=>M.loadPreviousSets(paused.next,id,ex.id,at(2))
    ])rejectsUnchanged(paused.next,operation,/재개/);
  }
});

test('new session mutations cannot edit finalized records or missing sessions',()=>{
  const completed=record(M.empty(),'벤치프레스',0),s=completed.session,ex=s.exercises[0];
  for(const id of [s.id,'missing'])for(const operation of [
    ()=>M.updateSession(completed.next,id,{notes:'변경'},at(3)),
    ()=>M.removeSet(completed.next,id,ex.id,at(3)),
    ()=>M.replaceExercise(completed.next,id,ex.id,'스쿼트',at(3)),
    ()=>M.loadPreviousSets(completed.next,id,ex.id,at(3))
  ])rejectsUnchanged(completed.next,operation,/진행 중 세션/);
});

test('removeSet removes only an unfinished last set and preserves at least one set',()=>{
  const started=begin(),s=started.session,ex=s.exercises[0];
  let result=M.removeSet(started.next,s.id,ex.id,at(1));
  assert.deepEqual(result.session.exercises[0].sets,ex.sets.slice(0,2));
  result=M.removeSet(result.next,s.id,ex.id,at(2));
  assert.deepEqual(result.session.exercises[0].sets,ex.sets.slice(0,1));
  rejectsUnchanged(result.next,()=>M.removeSet(result.next,s.id,ex.id,at(3)),/최소 1개/);
  rejectsUnchanged(started.next,()=>M.removeSet(started.next,s.id,'missing',at(3)),/찾지 못/);
});

test('removing a completed tail requires undoing its completion first',()=>{
  const started=begin(),s=started.session,ex=s.exercises[0],tail=ex.sets.at(-1);
  const done=M.updateSession(started.next,s.id,{exercises:[{id:ex.id,sets:[{id:tail.id,done:true}]}]},at(1));
  rejectsUnchanged(done.next,()=>M.removeSet(done.next,s.id,ex.id,at(2)),/완료 체크/);
  const undo=M.updateSession(done.next,s.id,{exercises:[{id:ex.id,sets:[{id:tail.id,done:false}]}]},at(3));
  assert.equal(M.removeSet(undo.next,s.id,ex.id,at(4)).session.exercises[0].sets.length,2);
});

test('replacing an untouched exercise keeps its location and ID but creates fresh default sets',()=>{
  const started=begin(),s=started.session,ex=s.exercises[0],other=JSON.stringify(s.exercises[1]);
  const edited=M.updateSession(started.next,s.id,{exercises:[{id:ex.id,notes:'기존 종목 메모',sets:[{id:ex.sets[0].id,weight:55}]}]},at(1));
  const before=JSON.stringify(edited.next),changed=M.replaceExercise(edited.next,s.id,ex.id,' 스쿼트 ',at(2));
  const replaced=changed.session.exercises[0];
  assert.equal(JSON.stringify(edited.next),before);
  assert.equal(replaced.id,ex.id);
  assert.equal(replaced.name,'스쿼트');
  assert.equal(replaced.notes,'');
  assert.equal(replaced.sets.length,3);
  assert.ok(replaced.sets.every(set=>!ex.sets.some(old=>old.id===set.id)&&!set.done&&set.weight===0&&set.reps===10));
  assert.equal(JSON.stringify(changed.session.exercises[1]),other);
});

test('replacement refuses to discard completed sets',()=>{
  const started=begin(),s=started.session,ex=s.exercises[0];
  const done=M.updateSession(started.next,s.id,{exercises:[{id:ex.id,sets:[{id:ex.sets[0].id,done:true}]}]},at(1));
  rejectsUnchanged(done.next,()=>M.replaceExercise(done.next,s.id,ex.id,'스쿼트',at(2)),/완료한 세트/);
  rejectsUnchanged(started.next,()=>M.replaceExercise(started.next,s.id,'missing','스쿼트',at(2)),/찾지 못/);
});

test('previous lookup uses latest finalized matching exercise and returns an isolated snapshot',()=>{
  const first=record(M.empty(),'벤치프레스',0),second=record(first.next,'벤치프레스',10,'PARTIAL',{weight:60});
  const other=record(second.next,'덤벨 벤치프레스',20),active=begin(other.next,30);
  const shuffled={...active.next,sessions:[active.session,second.session,first.session,other.session]};
  const previous=M.getPreviousExercise(shuffled,'벤치프레스',active.session.id);
  assert.equal(previous.sessionId,second.session.id);
  assert.equal(previous.date,second.session.date);
  assert.equal(previous.label,second.session.label);
  assert.equal(previous.endedAt,second.session.endedAt);
  assert.equal(previous.exercise.sets[0].weight,60);
  previous.exercise.sets[0].weight=199;
  assert.equal(second.session.exercises[0].sets[0].weight,60);
  assert.equal(M.getPreviousExercise(shuffled,'스쿼트',active.session.id),null);
});

test('previous lookup ignores later-dated records and matching exercises with no done sets',()=>{
  const first=record(M.empty(),'벤치프레스',0),later=record(first.next,'벤치프레스',50);
  const active=begin(later.next,10);
  assert.equal(M.getPreviousExercise(active.next,'벤치프레스',active.session.id).sessionId,first.session.id);
  assert.equal(M.getPreviousExercise(active.next,'벤치프레스').sessionId,later.session.id);
  const emptyMatching=M.copy(first.next);
  emptyMatching.sessions[0].exercises[0].sets.forEach(set=>{set.done=false;});
  assert.equal(M.getPreviousExercise(emptyMatching,'벤치프레스'),null);
  assert.throws(()=>M.getPreviousExercise(active.next,'벤치프레스','missing'),/현재 운동 세션/);
});

test('previous-set loading copies only performed sets with fresh IDs and reset completion',()=>{
  const started=begin(),old=started.session,oldEx=old.exercises[0];
  const performed=M.updateSession(started.next,old.id,{exercises:[{id:oldEx.id,sets:[
    {id:oldEx.sets[0].id,weight:20,reps:12,rpe:5,restSec:30,warmup:true,done:true},
    {id:oldEx.sets[1].id,weight:50,reps:8,rpe:8,restSec:120,done:true},
    {id:oldEx.sets[2].id,weight:90,reps:8,done:false}
  ]}]},at(1));
  const finished=M.finish(performed.next,old.id,'COMPLETED',at(2));
  const history=JSON.stringify(finished.session),fresh=begin(finished.next,10),ex=fresh.session.exercises[0];
  const noted=M.updateSession(fresh.next,fresh.session.id,{notes:'오늘 메모',exercises:[{id:ex.id,notes:'새 메모'}]},at(11));
  const before=JSON.stringify(noted.next),loaded=M.loadPreviousSets(noted.next,fresh.session.id,ex.id,at(12));
  const imported=loaded.session.exercises[0];
  assert.equal(JSON.stringify(noted.next),before);
  assert.equal(JSON.stringify(loaded.next.sessions[0]),history);
  assert.equal(loaded.previous.sessionId,old.id);
  assert.equal(imported.id,ex.id);
  assert.equal(imported.notes,'새 메모');
  assert.equal(loaded.session.notes,'오늘 메모');
  assert.equal(imported.sets.length,2);
  assert.deepEqual(imported.sets.map(({id,...set})=>set),[
    {weight:20,reps:12,rpe:5,restSec:30,warmup:true,done:false},
    {weight:50,reps:8,rpe:8,restSec:120,warmup:false,done:false}
  ]);
  const oldIds=new Set([...oldEx.sets,...ex.sets].map(set=>set.id));
  assert.ok(imported.sets.every(set=>!oldIds.has(set.id)));
  assert.equal(new Set(imported.sets.map(set=>set.id)).size,2);
  assert.equal(M.recordSummary(loaded.session).completedSets,0);
});

test('previous loading cannot overwrite performed current sets and fails cleanly without history',()=>{
  const past=record(M.empty(),'벤치프레스',0),started=begin(past.next,10),s=started.session,ex=s.exercises[0];
  const done=M.updateSession(started.next,s.id,{exercises:[{id:ex.id,sets:[{id:ex.sets[0].id,done:true}]}]},at(11));
  rejectsUnchanged(done.next,()=>M.loadPreviousSets(done.next,s.id,ex.id,at(12)),/덮어쓸 수 없습니다/);
  const missing=s.exercises[1];
  rejectsUnchanged(started.next,()=>M.loadPreviousSets(started.next,s.id,missing.id,at(12)),/이전 완료 기록이 없습니다/);
  rejectsUnchanged(started.next,()=>M.loadPreviousSets(started.next,s.id,'missing',at(12)),/찾지 못/);
});
