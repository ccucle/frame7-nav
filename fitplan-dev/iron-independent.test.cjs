'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../fitplan/iron-store.js');
const clock=new Date('2026-11-23T06:00:00.000Z');
const advance=mins=>new Date(clock.getTime()+mins*60000);
function storage(){
  const db=new Map();
  const obj={getItem:k=>db.has(k)?db.get(k):null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)};
  return {db,obj,store:M.createStore(obj)};
}
const save=(store,data,op)=>store.save(op.next,data.revision);
function routine(data,name='상체'){
  return M.createRoutine(data,name,[M.newExercise('벤치프레스'),M.newExercise('랫풀다운')],clock);
}
test('new IRON records do not use legacy calendar storage key',()=>{
  const {db,store}=storage();let data=store.load().data;
  const r=routine(data);data=save(store,data,r);
  assert.equal(data.routines.length,1);
  assert.equal(db.has('formday_calendar_proto_v1'),false);
});
test('one unfinished session across active, paused and saved states',()=>{
  let data=M.empty();const r=routine(data);data=r.next;
  const begin=M.start(data,{routineId:r.routine.id},clock);data=begin.next;
  assert.throws(()=>M.start(data,{},clock),/진행 중/);
  data=M.changeState(data,begin.session.id,'pause',advance(2)).next;
  assert.throws(()=>M.start(data,{},clock),/진행 중/);
  data=M.changeState(data,begin.session.id,'stashPaused',advance(3)).next;
  assert.throws(()=>M.start(data,{},clock),/진행 중/);
  assert.equal(M.getUnfinished(data).status,'SAVED');
});
test('stashed time is excluded when the workout resumes',()=>{
  let data=M.empty();const begin=M.start(data,{},clock);data=begin.next;
  const id=begin.session.id;
  data=M.changeState(data,id,'stash',advance(10)).next;
  data=M.changeState(data,id,'resumeSaved',advance(120)).next;
  assert.equal(M.getUnfinished(data).activeMs,600000);
  assert.equal(M.getUnfinished(data).activeSince,advance(120).toISOString());
});
test('partial completion keeps completed sets and does not advance cycle',()=>{
  let data=M.empty();const r=routine(data);data=r.next;
  const p=M.createProgram(data,'2분할','cycle',[r.routine.id],{});data=p.next;
  const b=M.start(data,{routineId:r.routine.id,programId:p.program.id},clock);data=b.next;
  const first=b.session.exercises[0].sets[0];
  data=M.setValue(data,b.session.id,b.session.exercises[0].id,first.id,{weight:65,reps:10,done:true},advance(5)).next;
  data=M.finish(data,b.session.id,'PARTIAL',advance(6)).next;
  assert.equal(data.sessions[0].status,'PARTIAL');
  assert.equal(M.recordSummary(data.sessions[0]).volume,650);
  assert.equal(data.programs[0].nextIndex,0);
  assert.equal(M.getUnfinished(data),null);
});
test('full completion advances cycle only from its expected routine',()=>{
  let data=M.empty();const r=routine(data);data=r.next;
  const r2=M.createRoutine(data,'하체',[M.newExercise('스쿼트')],clock);data=r2.next;
  const p=M.createProgram(data,'순환 2분할','cycle',[r.routine.id,r2.routine.id]);data=p.next;
  const b=M.start(data,{routineId:r.routine.id,programId:p.program.id},clock);data=b.next;
  const ex=b.session.exercises[0];
  data=M.setValue(data,b.session.id,ex.id,ex.sets[0].id,{done:true},advance(2)).next;
  data=M.finish(data,b.session.id,'COMPLETED',advance(3)).next;
  assert.equal(data.programs[0].nextIndex,1);
  assert.throws(()=>M.finish(data,b.session.id,'COMPLETED',advance(4)),/수정할 진행 중 세션/);
});
test('free workout does not advance cycle program',()=>{
  let data=M.empty();const r=routine(data);data=r.next;
  const p=M.createProgram(data,'순환','cycle',[r.routine.id]);data=p.next;
  const b=M.start(data,{},clock);data=b.next;
  const ex=b.session.exercises[0];
  data=M.setValue(data,b.session.id,ex.id,ex.sets[0].id,{done:true},advance(2)).next;
  data=M.finish(data,b.session.id,'COMPLETED',advance(3)).next;
  assert.equal(data.programs[0].nextIndex,0);
  assert.equal(data.sessions[0].programId,null);
});
test('routine edits never change a past completed workout snapshot',()=>{
  let data=M.empty();const r=routine(data);data=r.next;
  const b=M.start(data,{routineId:r.routine.id},clock);data=b.next;
  const ex=b.session.exercises[0];
  data=M.setValue(data,b.session.id,ex.id,ex.sets[0].id,{done:true,weight:70},advance(1)).next;
  data=M.finish(data,b.session.id,'COMPLETED',advance(2)).next;
  const before=JSON.stringify(data.sessions[0]);
  const changed=[M.newExercise('딥스')];
  data=M.updateRoutine(data,r.routine.id,'상체 수정',changed).next;
  assert.equal(JSON.stringify(data.sessions[0]),before);
  assert.equal(data.routines[0].exercises[0].name,'딥스');
});
test('automatic reload recovery preserves active time and does not complete',()=>{
  const b=M.start(M.empty(),{},clock);
  const safe=M.resumeAfterReload(b.next,advance(500));
  assert.equal(safe.sessions[0].status,'SAVED');
  assert.equal(safe.sessions[0].activeMs,0);
  assert.equal(safe.sessions[0].endedAt,null);
  assert.equal(safe.sessions.length,1);
});
test('a workout with zero done sets cannot be finalized',()=>{
  const b=M.start(M.empty(),{},clock);
  assert.throws(()=>M.finish(b.next,b.session.id,'COMPLETED',advance(1)),/완료한 세트가 없어/);
  assert.throws(()=>M.finish(b.next,b.session.id,'PARTIAL',advance(1)),/완료한 세트가 없어/);
});
test('optimistic revision conflict does not overwrite other tab changes',()=>{
  const {obj,store}=storage();const initial=store.load().data;
  const next=store.save(M.start(initial,{},clock).next,initial.revision);
  const stored=obj.getItem(M.KEY);
  assert.throws(()=>store.save(M.empty(),initial.revision),/다른 탭/);
  assert.equal(obj.getItem(M.KEY),stored);
  assert.ok(next.revision);
});
test('unreadable stored JSON cannot be silently replaced with new data',()=>{
  const db=new Map([[M.KEY,'{corrupt']]);
  const obj={getItem:key=>db.get(key)||null,setItem(){throw Error('MUST NOT WRITE')}};
  const store=M.createStore(obj);
  assert.match(store.load().error,/원본은 변경하지 않았습니다/);
  assert.throws(()=>store.save(M.empty(),''),/기존 기록이 손상돼/);
  assert.equal(db.get(M.KEY),'{corrupt');
});
test('restore validates exact independent schema',()=>{
  const current=M.start(M.empty(),{},clock).next;
  const imported=M.normalize(JSON.parse(JSON.stringify(current)));
  assert.deepEqual(imported,current);
  assert.throws(()=>M.normalize({...current,version:2}),/지원하지 않는/);
  assert.throws(()=>M.normalize({...current,sessions:[...current.sessions,...current.sessions]}),/중복/);
});
