'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../fitplan/iron-store.js');
const W=require('../fitplan/workouts.js');
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
test('adding an exercise creates valid unfinished sets and persists without changing earlier sets',()=>{
  const {store}=storage();let data=store.load().data;
  const begin=M.start(data,{},clock);data=save(store,data,begin);
  const id=begin.session.id,ex=data.sessions[0].exercises[0];
  data=save(store,data,M.setValue(data,id,ex.id,ex.sets[0].id,{weight:60,done:true},advance(1)));
  const earlier=JSON.stringify(data.sessions[0].exercises[0]);
  data=save(store,data,M.addExercise(data,id,'스쿼트',advance(2)));
  assert.equal(JSON.stringify(data.sessions[0].exercises[0]),earlier);
  assert.equal(data.sessions[0].exercises[1].name,'스쿼트');
  assert.ok(data.sessions[0].exercises[1].sets.every(s=>s.done===false));
  assert.deepEqual(store.load().data,data);
  assert.equal(M.recordSummary(data.sessions[0]).completedSets,1);
});
test('cancel removes only the unfinished session and never advances a program',()=>{
  let data=routine(M.empty()).next;
  const rid=data.routines[0].id;
  data=M.createProgram(data,'순환','cycle',[rid]).next;
  let begin=M.start(data,{},clock),ex=begin.session.exercises[0];
  data=M.setValue(begin.next,begin.session.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
  data=M.finish(data,begin.session.id,'COMPLETED',advance(2)).next;
  const history=data.sessions[0];
  for(const status of ['ACTIVE','PAUSED','SAVED']){
    begin=M.start(data,{routineId:rid,programId:data.programs[0].id},advance(3));
    let candidate=begin.next;
    if(status!=='ACTIVE')candidate=M.changeState(candidate,begin.session.id,status==='PAUSED'?'pause':'stash',advance(4)).next;
    const before=JSON.stringify(candidate);
    const canceled=M.cancel(candidate,begin.session.id).next;
    assert.equal(JSON.stringify(candidate),before,'cancel must not mutate the current snapshot');
    assert.deepEqual(canceled.sessions,[history]);
    assert.deepEqual(canceled.routines,data.routines);
    assert.deepEqual(canceled.programs,data.programs);
    assert.equal(M.getUnfinished(canceled),null);
    assert.doesNotThrow(()=>M.start(canceled,{},advance(5)));
  }
  assert.throws(()=>M.cancel(data,history.id),/취소할 진행 중/);
});
test('failed cancellation save preserves the stored session',()=>{
  const {store,obj}=storage();let data=store.load().data;
  data=save(store,data,M.start(data,{},clock));
  const before=obj.getItem(M.KEY),originalSet=obj.setItem;
  obj.setItem=(key,value)=>{if(key===M.KEY)throw Error('quota');originalSet(key,value);};
  assert.throws(()=>store.save(M.cancel(data,data.sessions[0].id).next,data.revision),/저장 실패/);
  assert.equal(obj.getItem(M.KEY),before);
  assert.deepEqual(store.load().data,data);
});
test('backup parser accepts both exported IRON formats and rejects other kinds or invalid data',()=>{
  const data=M.start(M.empty(),{},clock).next;
  for(const backup of [
    {app:'formday-iron',version:1,data},
    {app:'FORMDAY-cloud-manual-backup',kind:'iron',data}
  ])assert.deepEqual(M.parseBackup(backup),data);
  for(const backup of [null,{app:'formday-iron',version:2,data},
    {app:'FORMDAY-cloud-manual-backup',kind:'calendar',data},
    {app:'FORMDAY-cloud-manual-backup',data},
    {app:'formday',version:1,data}
  ])assert.throws(()=>M.parseBackup(backup),/백업 파일/);
  assert.throws(()=>M.parseBackup({app:'FORMDAY-cloud-manual-backup',kind:'iron',data:{...data,version:2}}),/지원하지 않는/);
  const invalid=M.copy(data);invalid.sessions[0].exercises[0].sets[0].done='true';
  assert.throws(()=>M.parseBackup({app:'formday-iron',version:1,data:invalid}),/완료 상태/);
});

// Exercise the shipped UI event handlers with isolated storage and a minimal DOM.
function ui(initial=M.empty(),options={}){
  const backing=storage();
  backing.obj.setItem(M.KEY,options.raw??JSON.stringify(initial));
  const writes=[],originalSet=backing.obj.setItem;
  backing.obj.setItem=(key,value)=>{writes.push([key,value]);return originalSet(key,value);};
  const listeners={},answers=[],prompts=[],fields=new Map();let markup='',pickerConfig=null,pickerActive=false;
  const banner={hidden:true,textContent:'',classList:{toggle(){}}};
  const globalWorkout={dataset:{indNav:'start'},attributes:{},classList:{toggle(){},remove(){}},setAttribute(name,value){this.attributes[name]=value;}};
  const host={
    get innerHTML(){return markup;},
    set innerHTML(value){
      markup=value;fields.clear();
      if(value.includes('id="fi-banner"')){fields.set('#fi-banner',banner);banner.textContent=value.match(/id="fi-banner"[^>]*>([^<]*)/)?.[1]||'';}
      for(const id of ['fi-routine-name','fi-program-name']){
        const tag=value.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];
        if(tag)fields.set('#'+id,{value:tag.match(/value="([^"]*)"/)?.[1]||''});
      }
    },
    querySelector(selector){
      if(selector==='input[name=fi-mode]:checked')return {value:markup.includes('value="fixed" checked')?'fixed':'cycle'};
      return fields.get(selector)||null;
    },
    querySelectorAll(selector){
      if(selector==='[data-fi-program-routine]')return [...markup.matchAll(/data-fi-program-routine="([^"]+)" ([^>]*)>/g)].map(m=>({dataset:{fiProgramRoutine:m[1]},checked:m[2].includes('checked')}));
      return [];
    },
    addEventListener(){}
  };
  const calendar={innerHTML:'',hidden:true};
  const document={body:{dataset:{fdScreen:'home'}},
    getElementById:id=>id==='fd-ind-root'?host:id==='fd-iron-calendar'?calendar:id==='main-content'?{scrollIntoView(){}}:null,
    querySelector:()=>null,querySelectorAll:selector=>selector==='[data-ind-nav]'?[globalWorkout]:[],
    addEventListener:(type,fn,capture=false)=>(listeners[type]??=[]).push({fn,capture})};
  const root={FormdayIronStore:options.missingStore?null:M,FormdayWorkouts:W,
    localStorage:backing.obj,addEventListener(){},dispatchEvent(){},setInterval(){},requestAnimationFrame:fn=>fn(),
    confirm:text=>{prompts.push(text);return answers.shift()??false;}};
  if(!options.missingPicker)root.FormdayExercisePicker={isOpen:()=>pickerActive,open(config){if(pickerActive)return false;pickerConfig=config;pickerActive=true;return true;}};
  const context=vm.createContext({window:root,document,Date,console,CustomEvent:class{constructor(type){this.type=type;}}});
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron-independent.js'),'utf8'),context);
  function click(dataset,clickOptions={}){
    const button={dataset,disabled:clickOptions.disabled===true};
    const child={closest(selector){
      const pairs=[['[data-fi-action]','fiAction'],['[data-fd-route]','fdRoute'],['[data-ind-nav]','indNav'],['[data-fi-nav]','fiNav']];
      return pairs.some(([match,key])=>selector.split(',').includes(match)&&dataset[key])?button:null;
    }};
    const event={defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},target:clickOptions.textNode?{parentElement:child}:child};
    for(const capture of [true,false])for(const item of listeners.click||[]){
      if(item.capture===capture&&!event.stopped)item.fn(event);
    }
    return event;
  }
  return {api:root.FormdayIndependent,host,document,fields,answers,prompts,backing,writes,banner,globalWorkout,
    get picker(){return pickerConfig;},get pickerIsOpen(){return pickerActive;},
    choose(names){const accepted=pickerConfig.onConfirm(names);if(accepted){pickerActive=false;pickerConfig.onClose?.({reason:'confirmed'});}return accepted;},
    closePicker(){pickerActive=false;pickerConfig.onClose?.({reason:'cancel'});},
    action:(action,extra={},clickOptions={})=>click({fiAction:action,...extra},clickOptions),navigate:route=>click({fdRoute:route}),
    subnav:page=>click({fiNav:page}),workout:clickOptions=>click({indNav:'start'},clickOptions)};
}
test('canceling an untouched routine draft releases cloud apply without prompting',()=>{
  const view=ui();
  view.action('new-routine');assert.equal(view.api.canCloudApply(),false);
  view.action('back-home');assert.equal(view.api.canCloudApply(),true);
  assert.equal(view.prompts.length,0);
  assert.match(view.host.innerHTML,/오늘의 운동을 시작하세요/);
});
test('routine draft edits remain until discard is explicitly confirmed',()=>{
  const view=ui();view.action('new-routine');
  view.fields.get('#fi-routine-name').value='변경한 루틴';
  view.answers.push(false);view.action('back-home');
  assert.equal(view.api.canCloudApply(),false);
  assert.equal(view.fields.get('#fi-routine-name').value,'변경한 루틴');
  assert.match(view.prompts[0],/저장하지 않은/);
  view.answers.push(true);view.action('back-home');
  assert.equal(view.api.canCloudApply(),true);
  assert.equal(view.api.getSnapshot().routines.length,0);
});
test('navigation capture stops other screen handlers when draft discard is declined',()=>{
  const view=ui();view.action('new-routine');
  view.fields.get('#fi-routine-name').value='입력 유지';
  view.answers.push(false);const denied=view.navigate('calendar');
  assert.equal(denied.stopped,true);assert.equal(denied.defaultPrevented,true);
  assert.equal(view.api.canCloudApply(),false);
  view.answers.push(true);const approved=view.navigate('calendar');
  assert.equal(approved.stopped,false);assert.equal(view.api.canCloudApply(),true);
});
test('program draft cancellation also confirms edits and releases cloud apply',()=>{
  const view=ui(routine(M.empty()).next);view.action('new-program');
  view.fields.get('#fi-program-name').value='새 분할 계획';
  view.answers.push(false);view.action('program-list');
  assert.equal(view.api.canCloudApply(),false);
  assert.equal(view.fields.get('#fi-program-name').value,'새 분할 계획');
  view.answers.push(true);view.action('program-list');
  assert.equal(view.api.canCloudApply(),true);
  assert.equal(view.api.getSnapshot().programs.length,0);
});
test('session cancellation requires confirmation mentioning already completed sets',()=>{
  const start=M.start(M.empty(),{},clock),ex=start.session.exercises[0];
  let data=M.setValue(start.next,start.session.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
  data=M.changeState(data,start.session.id,'stash',advance(2)).next;
  const view=ui(data);view.api.open('session');
  assert.match(view.host.innerHTML,/data-fi-action="cancel-session"/);
  view.answers.push(false);view.action('cancel-session');
  assert.equal(view.api.getSnapshot().sessions.length,1);
  assert.match(view.prompts[0],/완료 세트 1개/);
  view.answers.push(true);view.action('cancel-session');
  assert.equal(view.api.getSnapshot().sessions.length,0);
  assert.equal(view.backing.store.load().data.sessions.length,0);
});
test('session cancellation UI preserves its session when storage fails',()=>{
  const start=M.start(M.empty(),{},clock);
  const data=M.changeState(start.next,start.session.id,'stash',advance(2)).next;
  const view=ui(data);view.api.open('session');
  const before=JSON.stringify(view.api.getSnapshot());
  const original=view.backing.obj.setItem;
  view.backing.obj.setItem=(key,value)=>{if(key===M.KEY)throw Error('quota');original(key,value);};
  view.answers.push(true);view.action('cancel-session');
  assert.equal(JSON.stringify(view.api.getSnapshot()),before);
  assert.equal(view.backing.store.load().data.sessions.length,1);
  assert.match(view.host.innerHTML,/저장 실패/);
});
test('v1 records without favorites still load, and favorite names survive backup without a catalog dependency',()=>{
  const legacy=routine(M.empty()).next;delete legacy.favoriteExercises;
  const restored=M.normalize(legacy);
  assert.deepEqual(restored.favoriteExercises,[]);
  assert.equal(restored.version,1);
  const withOldName={...restored,favoriteExercises:['이전 카탈로그 운동']};
  assert.deepEqual(M.parseBackup({app:'formday-iron',version:1,data:withOldName}),withOldName);
  assert.deepEqual(M.parseBackup({app:'FORMDAY-cloud-manual-backup',kind:'iron',data:withOldName}),withOldName);
});
test('favorites validate names, duplicate values and the bound while toggles preserve training data',()=>{
  const data=routine(M.empty()).next,before=JSON.stringify(data);
  let next=M.toggleFavorite(data,'벤치프레스',true).next;
  next=M.toggleFavorite(next,'벤치프레스',true).next;
  assert.deepEqual(next.favoriteExercises,['벤치프레스']);
  assert.deepEqual(next.routines,data.routines);assert.equal(JSON.stringify(data),before);
  assert.deepEqual(M.toggleFavorite(next,'벤치프레스',false).next.favoriteExercises,[]);
  for(const favoriteExercises of [null,'벤치프레스',[''],[12],['벤치프레스',' 벤치프레스 '],['x'.repeat(81)],Array.from({length:501},(_,i)=>'운동 '+i)]){
    assert.throws(()=>M.normalize({...data,favoriteExercises}));
  }
  const full={...data,favoriteExercises:Array.from({length:500},(_,i)=>'운동 '+i)};
  assert.equal(M.normalize(full).favoriteExercises.length,500);
  assert.throws(()=>M.toggleFavorite(full,'추가 운동',true),/500/);
  assert.throws(()=>M.toggleFavorite(data,'벤치프레스','true'),/상태/);
});
test('batch exercise selection starts or extends one session atomically with no placeholder set',()=>{
  const empty=M.empty(),begin=M.start(empty,{exerciseNames:['스쿼트','랫풀다운']},clock);
  assert.deepEqual(begin.session.exercises.map(ex=>ex.name),['스쿼트','랫풀다운']);
  assert.ok(begin.session.exercises.every(ex=>ex.sets.every(set=>set.done===false)));
  const before=JSON.stringify(begin.next),extended=M.addExercises(begin.next,begin.session.id,['덤벨프레스','풀업'],advance(1));
  assert.equal(extended.session.exercises.length,4);
  assert.equal(JSON.stringify(begin.next),before);
  assert.throws(()=>M.addExercises(begin.next,begin.session.id,['데드리프트',''],advance(1)),/이름/);
  assert.throws(()=>M.addExercises(begin.next,begin.session.id,Array(29).fill('스쿼트'),advance(1)),/최대 30/);
  assert.equal(JSON.stringify(begin.next),before);
  assert.throws(()=>M.start(empty,{exerciseNames:[]},clock),/1~30/);
});
test('workout navigation handles icon and text targets and keeps training selected on every subpage',()=>{
  const view=ui();view.workout();
  assert.equal(view.document.body.dataset.fdScreen,'independent');
  assert.match(view.host.innerHTML,/오늘의 운동을 시작하세요/);
  for(const page of ['routines','programs','history','home']){
    view.subnav(page);
    assert.match(view.host.innerHTML,new RegExp('data-fi-nav="'+page+'" aria-current="page"'));
    assert.equal(view.globalWorkout.attributes['aria-current'],'page');
  }
  view.api.open('routines');view.workout({textNode:true});
  assert.match(view.host.innerHTML,/data-fi-nav="home" aria-current="page"/);
  view.api.open('choose');
  assert.match(view.host.innerHTML,/data-fi-nav="routines" aria-current="page"/);
});
test('a missing module or corrupt saved data gives a visible failure instead of a silent workout action',()=>{
  const missing=ui(M.empty(),{missingStore:true});missing.workout();
  assert.match(missing.host.innerHTML,/운동 화면을 불러오지 못했습니다/);
  const corrupt=ui(M.empty(),{raw:'{broken'});
  assert.equal(corrupt.api.open('start',{exercise:'벤치프레스'}),false);
  assert.equal(corrupt.document.body.dataset.fdScreen,'independent');
  assert.match(corrupt.host.innerHTML,/운동 기록을 불러오지 못했습니다/);
  assert.equal(corrupt.backing.obj.getItem(M.KEY),'{broken');
  assert.equal(corrupt.writes.length,0);
});
test('free workout opens the picker and saves all selected exercises in one write',()=>{
  const view=ui();view.workout();view.action('start-free');
  assert.equal(view.picker.multiple,true);assert.equal(view.picker.limit,30);
  assert.equal(view.api.canCloudApply(),false);
  assert.equal(view.api.getSnapshot().sessions.length,0);
  assert.equal(view.choose(['스쿼트','랫풀다운']),true);
  const current=M.getUnfinished(view.api.getSnapshot());
  assert.deepEqual(current.exercises.map(ex=>ex.name),['스쿼트','랫풀다운']);
  assert.equal(view.writes.filter(([key])=>key===M.KEY).length,1);
  assert.match(view.host.innerHTML,/aria-label="진행 중인 운동"/);
  assert.equal(view.document.body.dataset.fiSession,'true');
  assert.equal(view.pickerIsOpen,false);
});
test('canceling free selection makes no session, and a missing picker displays a useful error',()=>{
  const view=ui();view.workout();view.action('start-free');view.closePicker();
  assert.equal(view.api.getSnapshot().sessions.length,0);assert.equal(view.writes.length,0);
  assert.equal(view.api.canCloudApply(),true);
  const missing=ui(M.empty(),{missingPicker:true});missing.workout();missing.action('start-free');
  assert.match(missing.banner.textContent,/종목 선택창을 불러오지 못했습니다/);
  assert.equal(missing.api.getSnapshot().sessions.length,0);
});
test('routine multi-select stays a draft until save and keeps a separately saved favorite',()=>{
  const view=ui();view.action('new-routine');view.fields.get('#fi-routine-name').value='하체와 등';
  view.action('add-builder-ex');
  assert.equal(view.picker.onFavoriteChange('스쿼트',true),true);
  assert.deepEqual(view.picker.getFavorites(),['스쿼트']);
  assert.equal(view.fields.get('#fi-routine-name').value,'하체와 등');
  assert.equal(view.choose(['스쿼트','랫풀다운']),true);
  assert.equal(view.api.getSnapshot().routines.length,0);
  view.action('save-routine');
  const saved=view.api.getSnapshot();
  assert.equal(saved.routines[0].name,'하체와 등');
  assert.deepEqual(saved.routines[0].exercises.map(ex=>ex.name),['스쿼트','랫풀다운']);
  assert.deepEqual(saved.favoriteExercises,['스쿼트']);
  assert.match(view.host.innerHTML,/data-fi-nav="routines" aria-current="page"/);
});
test('replacing one routine exercise preserves its target sets and every existing custom name',()=>{
  const custom=M.newExercise('직접 만든 종목'),known=M.newExercise('벤치프레스');
  known.sets[0].weight=72.5;known.sets[0].reps=8;known.sets[0].restSec=105;
  const made=M.createRoutine(M.empty(),'기존 루틴',[custom,known]),view=ui(made.next);
  view.action('edit-routine',{id:made.routine.id});
  assert.match(view.host.innerHTML,/직접 만든 종목/);
  view.action('replace-builder-ex',{id:known.id});
  assert.equal(view.picker.multiple,false);assert.equal(view.picker.limit,1);
  assert.equal(view.choose(['스쿼트']),true);view.action('save-routine');
  const result=view.api.getSnapshot().routines[0];
  assert.deepEqual(result.exercises[0],custom);
  assert.equal(result.exercises[1].name,'스쿼트');
  assert.deepEqual(result.exercises[1].sets,known.sets);
});
test('invalid picker selection leaves the routine draft intact for correction',()=>{
  const view=ui();view.action('new-routine');view.fields.get('#fi-routine-name').value='입력 유지';
  view.action('add-builder-ex');
  assert.equal(view.choose(['벤치프레스','알 수 없는 종목']),false);
  assert.equal(view.pickerIsOpen,true);
  assert.equal(view.fields.get('#fi-routine-name').value,'입력 유지');
  assert.equal(view.api.getSnapshot().routines.length,0);
  assert.equal(view.choose(['벤치프레스']),true);view.action('save-routine');
  assert.equal(view.api.getSnapshot().routines[0].exercises.length,1);
});
test('failed session batch save keeps both picker selection and existing inputs available',()=>{
  const view=ui();view.workout();view.action('start-free');view.choose(['벤치프레스']);
  const before=JSON.stringify(view.api.getSnapshot()),original=view.backing.obj.setItem;
  view.action('add-session-ex');view.fields.set('#unsaved-set-input',{value:'입력 유지'});
  view.backing.obj.setItem=(key,value)=>{if(key===M.KEY)throw Error('quota');return original(key,value);};
  assert.equal(view.choose(['스쿼트','랫풀다운']),false);
  assert.equal(view.pickerIsOpen,true);
  assert.equal(JSON.stringify(view.api.getSnapshot()),before);
  assert.equal(view.fields.get('#unsaved-set-input').value,'입력 유지');
  view.closePicker();
  assert.equal(view.fields.get('#unsaved-set-input').value,'입력 유지');
  assert.match(view.banner.textContent,/저장 실패/);
});
test('favorite write failure preserves selection and unsaved routine fields',()=>{
  const view=ui();view.action('new-routine');view.fields.get('#fi-routine-name').value='아직 저장 전';view.action('add-builder-ex');
  const original=view.backing.obj.setItem;
  view.backing.obj.setItem=(key,value)=>{if(key===M.KEY)throw Error('quota');return original(key,value);};
  assert.equal(view.picker.onFavoriteChange('벤치프레스',true),false);
  assert.deepEqual(view.api.getSnapshot().favoriteExercises,[]);
  assert.equal(view.fields.get('#fi-routine-name').value,'아직 저장 전');
  assert.equal(view.pickerIsOpen,true);
});
test('external exercise start shows a storage failure and never creates a phantom session',()=>{
  const view=ui();view.document.body.dataset.fdScreen='library';
  view.backing.obj.setItem=()=>{throw Error('quota');};
  assert.equal(view.api.open('start',{exercise:'스쿼트'}),false);
  assert.equal(view.document.body.dataset.fdScreen,'independent');
  assert.match(view.host.innerHTML,/저장 실패/);
  assert.equal(view.api.getSnapshot().sessions.length,0);
});
test('resuming a saved workout enters its session and repeated resume never starts another one',()=>{
  const started=M.start(M.empty(),{},clock),data=M.changeState(started.next,started.session.id,'stash',advance(1)).next;
  const view=ui(data);view.workout();view.action('resume');
  assert.equal(M.getUnfinished(view.api.getSnapshot()).status,'ACTIVE');
  assert.match(view.host.innerHTML,/aria-label="진행 중인 운동"/);
  assert.equal(view.document.body.dataset.fiSession,'true');
  const before=JSON.stringify(view.api.getSnapshot());view.action('resume');
  assert.equal(JSON.stringify(view.api.getSnapshot()),before);
  assert.equal(view.api.getSnapshot().sessions.length,1);
});
test('confirmed routine cancellation replaces the unsaved exercise-added banner with its actual outcome',()=>{
  const view=ui();view.action('new-routine');view.fields.get('#fi-routine-name').value='취소할 초안';
  view.action('add-builder-ex');assert.equal(view.choose(['스쿼트','랫풀다운']),true);
  assert.match(view.banner.textContent,/2개 종목을 추가했습니다/);
  view.answers.push(true);view.action('routine-list');
  assert.equal(view.api.getSnapshot().routines.length,0);
  assert.equal(view.api.canCloudApply(),true);
  assert.match(view.host.innerHTML,/data-fi-nav="routines" aria-current="page"/);
  assert.equal(view.banner.textContent,'저장하지 않은 변경사항을 취소했습니다.');
  assert.doesNotMatch(view.host.innerHTML,/2개 종목을 추가했습니다/);
});
