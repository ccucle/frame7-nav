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
  for(const ex of b.session.exercises)for(const set of ex.sets)data=M.setValue(data,b.session.id,ex.id,set.id,{done:true},advance(2)).next;
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
  const listeners={},hostListeners={},answers=[],prompts=[],fields=new Map(),dayFields=new Map();let markup='',pickerConfig=null,pickerActive=false,modal=null,modeField=null;
  const banner={hidden:true,textContent:'',classList:{toggle(){}}};
  const globalWorkout={dataset:{indNav:'start'},attributes:{},classList:{toggle(){},remove(){}},setAttribute(name,value){this.attributes[name]=value;}};
  const host={
    get innerHTML(){return markup+(modal?'<dialog id="'+modal.id+'">'+modal.innerHTML+'</dialog>':'');},
    set innerHTML(value){
      markup=value;modal=null;fields.clear();dayFields.clear();
      modeField=value.includes('name="fi-mode"')?{value:value.includes('value="fixed" checked')?'fixed':'cycle'}:null;
      for(const match of value.matchAll(/<select data-fi-weekday="([0-6])">([\s\S]*?)<\/select>/g)){
        const selected=[...match[2].matchAll(/<option value="([^"]*)" ([^>]*)>/g)].find(m=>m[2].includes('selected'));
        dayFields.set(match[1],{dataset:{fiWeekday:match[1]},value:selected?.[1]||''});
      }
      if(value.includes('id="fi-banner"')){fields.set('#fi-banner',banner);banner.textContent=value.match(/id="fi-banner"[^>]*>([^<]*)/)?.[1]||'';}
      for(const id of ['fi-routine-name','fi-program-name']){
        const tag=value.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0];
        if(tag)fields.set('#'+id,{value:tag.match(/value="([^"]*)"/)?.[1]||''});
      }
    },
    querySelector(selector){
      if(selector==='#fi-session-sheet')return modal;
      if(modal&&selector==='#fi-banner')return banner;
      if(selector==='input[name=fi-mode]:checked')return modeField;
      return fields.get(selector)||null;
    },
    querySelectorAll(selector){
      if(selector==='[data-fi-program-routine]')return [...markup.matchAll(/data-fi-program-routine="([^"]+)" ([^>]*)>/g)].map(m=>({dataset:{fiProgramRoutine:m[1]},checked:m[2].includes('checked')}));
      if(selector==='[data-fi-weekday]')return [...dayFields.values()];
      return [];
    },
    addEventListener(type,fn){(hostListeners[type]??=[]).push(fn);},appendChild(child){modal=child;return child;}
  };
  function dialog(){
    let value='';
    const element={id:'',className:'',dataset:{},open:false,style:{removeProperty(){},setProperty(){}},
      get innerHTML(){return value;},set innerHTML(text){value=text;if(text.includes('id="fi-banner"'))banner.textContent=text.match(/id="fi-banner"[^>]*>([^<]*)/)?.[1]||'';},
      setAttribute(name,value){this[name]=value;},addEventListener(){},contains(){return false;},
      querySelector:selector=>selector==='#fi-banner'?banner:null,querySelectorAll:()=>[],
      showModal(){this.open=true;},close(){this.open=false;},remove(){if(modal===this)modal=null;}};
    return element;
  }
  const calendar={innerHTML:'',hidden:true};
  const document={body:{dataset:{fdScreen:'home'}},
    createElement:tag=>{assert.equal(tag,'dialog');return dialog();},
    getElementById:id=>id==='fd-ind-root'?host:id==='fd-iron-calendar'?calendar:id==='main-content'?{scrollIntoView(){}}:null,
    querySelector:()=>null,querySelectorAll:selector=>selector==='[data-ind-nav]'?[globalWorkout]:[],
    addEventListener:(type,fn,capture=false)=>(listeners[type]??=[]).push({fn,capture})};
  const root={FormdayIronStore:options.missingStore?null:M,FormdayWorkouts:W,FormdayBridge:options.bridge,
    localStorage:backing.obj,addEventListener(){},dispatchEvent(){},setInterval(){},requestAnimationFrame:fn=>fn(),
    confirm:text=>{prompts.push(text);return answers.shift()??false;}};
  if(!options.missingPicker)root.FormdayExercisePicker={isOpen:()=>pickerActive,open(config){if(pickerActive)return false;pickerConfig=config;pickerActive=true;return true;}};
  const TestDate=options.fixedToday?class extends Date{constructor(...args){super(...(args.length?args:[options.fixedToday]))}}:Date;
  const context=vm.createContext({window:root,document,Date:TestDate,console,CustomEvent:class{constructor(type){this.type=type;}}});
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
    subnav:page=>click({fiNav:page}),workout:clickOptions=>click({indNav:'start'},clickOptions),
    setMode(value){modeField.value=value;const event={target:{name:'fi-mode',value}};for(const fn of hostListeners.input||[])fn(event);for(const fn of hostListeners.change||[])fn(event);},
    setWeekday(day,value){const field=dayFields.get(String(day));assert.ok(field);field.value=value;const event={target:field};for(const fn of hostListeners.input||[])fn(event);for(const fn of hostListeners.change||[])fn(event);},
    getWeekday(day){return dayFields.get(String(day))?.value;}};
}
test('canceling an untouched routine draft releases cloud apply without prompting',()=>{
  const view=ui();
  view.action('new-routine');assert.equal(view.api.canCloudApply(),false);
  view.action('back-home');assert.equal(view.api.canCloudApply(),true);
  assert.equal(view.prompts.length,0);
  assert.match(view.host.innerHTML,/data-fi-nav="home" aria-current="page"/);
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
  assert.match(view.host.innerHTML,/data-fi-nav="home" aria-current="page"/);
  for(const page of ['routines','programs','home']){
    view.subnav(page);
    assert.match(view.host.innerHTML,new RegExp('data-fi-nav="'+page+'" aria-current="page"'));
    assert.equal(view.globalWorkout.attributes['aria-current'],'page');
  }
  assert.match(view.host.innerHTML,/data-fd-route="library"/);
  assert.doesNotMatch(view.host.innerHTML,/data-fi-nav="history"/);
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

test('program updates preserve identity, completed sessions and pending routine after reordering',()=>{
  let data=routine(M.empty(),'가슴').next;
  data=routine(data,'등').next;data=routine(data,'하체').next;
  const [a,b,c]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'기존','cycle',[a,b,c]);data=p.next;
  const begin=M.start(data,{routineId:a,programId:p.program.id},clock),ex=begin.session.exercises[0];
  data=begin.next;
  for(const e of begin.session.exercises)for(const set of e.sets)data=M.setValue(data,begin.session.id,e.id,set.id,{done:true},advance(1)).next;
  data=M.finish(data,begin.session.id,'COMPLETED',advance(2)).next;
  data.programs[0].active=false;
  const before=JSON.stringify(data);
  const result=M.updateProgram(data,p.program.id,'수정','cycle',[c,a,b]);
  assert.equal(JSON.stringify(data),before);
  assert.equal(result.next.programs.length,1);
  assert.equal(result.program.id,p.program.id);
  assert.equal(result.program.name,'수정');
  assert.equal(result.program.active,false);
  assert.equal(result.program.nextIndex,2);
  assert.deepEqual(result.next.sessions,data.sessions);
  assert.deepEqual(result.next.routines,data.routines);
  assert.deepEqual(M.normalize(result.next),result.next);
  const removed=M.updateProgram(result.next,p.program.id,'수정','cycle',[c,a]);
  assert.equal(removed.program.nextIndex,0);
});
test('program edits support fixed weekdays and preserve original data on validation errors',()=>{
  let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;
  const [a,b]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'순환','cycle',[a,b]);data=p.next;
  const fixed=M.updateProgram(data,p.program.id,'요일별','fixed',[b,a],{'1':b,'3':a});
  assert.deepEqual(fixed.program.weekdays,{'1':b,'3':a});
  assert.equal(fixed.program.mode,'fixed');
  assert.equal(fixed.program.nextIndex,0);
  const back=M.updateProgram(fixed.next,p.program.id,'순환','cycle',[a,b],fixed.program.weekdays);
  assert.deepEqual(back.program.weekdays,{});
  const before=JSON.stringify(data);
  assert.throws(()=>M.updateProgram(data,p.program.id,'오류','fixed',[a],{'1':b}),/요일별/);
  assert.throws(()=>M.updateProgram(data,p.program.id,'오류','cycle',[]),/1~14/);
  assert.throws(()=>M.updateProgram(data,p.program.id,'오류','cycle',[a,a]),/중복/);
  assert.throws(()=>M.updateProgram(data,'missing','오류','cycle',[a]),/찾을 수 없습니다/);
  assert.equal(JSON.stringify(data),before);
});
test('editing program does not alter an unfinished session or accidentally advance a removed routine',()=>{
  let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;
  const [a,b]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'순환','cycle',[a,b]);data=p.next;
  const started=M.start(data,{routineId:a,programId:p.program.id},clock);
  const edited=M.updateProgram(started.next,p.program.id,'새 계획','cycle',[b]);
  assert.deepEqual(edited.next.sessions,started.next.sessions);
  const s=started.session,ex=s.exercises[0];
  const done=M.setValue(edited.next,s.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
  const final=M.finish(done,s.id,'COMPLETED',advance(2)).next;
  assert.equal(final.programs[0].nextIndex,0);
  assert.equal(final.programs[0].routineIds[0],b);
  assert.equal(final.sessions[0].routineId,a);
});
test('program edit UI reloads the original plan and saves the same ID in its new order',()=>{
  let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;data=routine(data,'하체').next;
  const [a,b,c]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'기존 프로그램','cycle',[c,a,b]);
  const view=ui(p.next);view.api.open('programs');
  assert.match(view.host.innerHTML,/data-fi-action="edit-program"/);
  view.action('edit-program',{id:p.program.id});
  assert.equal(view.fields.get('#fi-program-name').value,'기존 프로그램');
  assert.equal(view.api.canCloudApply(),false);
  view.fields.get('#fi-program-name').value='수정 프로그램';
  view.action('program-move-up',{id:b});
  assert.equal(view.fields.get('#fi-program-name').value,'수정 프로그램');
  view.action('save-program');
  const saved=view.backing.store.load().data;
  assert.equal(saved.programs.length,1);
  assert.equal(saved.programs[0].id,p.program.id);
  assert.equal(saved.programs[0].name,'수정 프로그램');
  assert.deepEqual(saved.programs[0].routineIds,[c,b,a]);
  assert.equal(view.api.canCloudApply(),true);
  assert.match(view.host.innerHTML,/수정 프로그램/);
});
test('editing existing program can be canceled without saving or losing the stored plan',()=>{
  let data=routine(M.empty(),'가슴').next;
  const p=M.createProgram(data,'기존','cycle',[data.routines[0].id]);
  const view=ui(p.next);
  view.api.open('programs');view.action('edit-program',{id:p.program.id});
  view.fields.get('#fi-program-name').value='임시 변경';
  view.answers.push(false);view.action('program-list');
  assert.equal(view.fields.get('#fi-program-name').value,'임시 변경');
  view.answers.push(true);view.action('program-list');
  assert.deepEqual(view.backing.store.load().data.programs,p.next.programs);
  assert.equal(view.api.canCloudApply(),true);
});

test('fixed program editor only displays weekday assignment and all routines directly',()=>{
  let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;
  const [a,b]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'기존 요일','fixed',[a],{'1':a});
  const view=ui(p.next);
  view.api.open('programs');view.action('edit-program',{id:p.program.id});
  assert.doesNotMatch(view.host.innerHTML,/포함할 루틴과 순서|data-fi-program-routine|data-fi-action="program-move-up"/);
  assert.match(view.host.innerHTML,/요일별 루틴 배치/);
  assert.equal(view.getWeekday(1),a);
  assert.equal(view.host.innerHTML.split('<option value="'+b+'"').length-1,7);
  view.setWeekday(1,b);view.setWeekday(3,b);view.setWeekday(5,a);
  view.action('save-program');
  const saved=view.backing.store.load().data.programs;
  assert.equal(saved.length,1);assert.equal(saved[0].id,p.program.id);
  assert.deepEqual(saved[0].routineIds,[b,a]);
  assert.deepEqual(saved[0].weekdays,{'1':b,'3':b,'5':a});
});
test('switching fixed and cycle keeps each draft and only displays relevant controls',()=>{
  let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;data=routine(data,'하체').next;
  const [a,b,c]=data.routines.map(r=>r.id);
  const p=M.createProgram(data,'순환','cycle',[c,a]);
  const view=ui(p.next);view.api.open('programs');view.action('edit-program',{id:p.program.id});
  assert.match(view.host.innerHTML,/포함할 루틴과 순서/);
  assert.doesNotMatch(view.host.innerHTML,/data-fi-weekday/);
  view.setMode('fixed');
  assert.doesNotMatch(view.host.innerHTML,/포함할 루틴과 순서/);
  view.setWeekday(2,b);
  view.setMode('cycle');
  assert.match(view.host.innerHTML,/포함할 루틴과 순서/);
  assert.doesNotMatch(view.host.innerHTML,/data-fi-weekday/);
  view.action('program-move-up',{id:a});
  view.setMode('fixed');assert.equal(view.getWeekday(2),b);
  view.setMode('cycle');view.action('save-program');
  const saved=view.backing.store.load().data.programs[0];
  assert.deepEqual(saved.routineIds,[a,c]);assert.deepEqual(saved.weekdays,{});
});
test('new fixed program needs at least one weekday and can save directly without routine checkboxes',()=>{
  const data=routine(M.empty(),'가슴').next,a=data.routines[0].id;
  const view=ui(data);view.api.open('programs');view.action('new-program');view.setMode('fixed');
  view.action('save-program');
  assert.equal(view.backing.store.load().data.programs.length,0);
  assert.match(view.host.innerHTML,/하루 이상 운동을 지정/);
  view.setWeekday(4,a);view.action('save-program');
  const saved=view.backing.store.load().data.programs[0];
  assert.equal(saved.mode,'fixed');assert.deepEqual(saved.routineIds,[a]);assert.deepEqual(saved.weekdays,{'4':a});
});

test('cloud merge permits safely stashed sessions without forcing completion',()=>{
 const start=M.start(M.empty(),{},clock),ex=start.session.exercises[0];
 const done=M.setValue(start.next,start.session.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
 const saved=M.changeState(done,start.session.id,'stash',advance(2)).next;
 const view=ui(saved);
 const next=M.createRoutine(saved,'추가 루틴',[M.newExercise('스쿼트')]).next;
 assert.equal(view.api.canCloudApply(),false);
 assert.equal(view.api.canCloudMerge(next),true);
 const persisted=view.backing.store.save(next,saved.revision);
 assert.equal(view.api.cloudMergeReload(persisted.revision),true);
 assert.deepEqual(view.api.getSnapshot().sessions,saved.sessions);
 assert.equal(view.api.getSnapshot().routines.length,1);
});
test('cloud merge never imports active sessions or replaces an open editor',()=>{
 const view=ui();view.action('new-routine');
 assert.equal(view.api.canCloudMerge(M.empty()),false);
 const idle=ui();
 assert.equal(idle.api.canCloudMerge(M.start(M.empty(),{},clock).next),false);
});

test('deleting a program only removes that program and leaves routines and session snapshots intact',()=>{
 let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;
 const [a,b]=data.routines.map(r=>r.id);
 const p=M.createProgram(data,'삭제 대상','cycle',[a,b]);data=p.next;
 const keep=M.createProgram(data,'보존 대상','cycle',[b]);data=keep.next;
 const begin=M.start(data,{routineId:a,programId:p.program.id},clock),ex=begin.session.exercises[0];
 data=M.setValue(begin.next,begin.session.id,ex.id,ex.sets[0].id,{weight:50,done:true},advance(1)).next;
 const before=JSON.stringify(data);
 const result=M.deleteProgram(data,p.program.id);
 assert.equal(JSON.stringify(data),before);assert.equal(result.program.id,p.program.id);
 assert.deepEqual(result.next.programs,[keep.program]);assert.deepEqual(result.next.routines,data.routines);
 assert.deepEqual(result.next.sessions,data.sessions);
 const finished=M.finish(result.next,begin.session.id,'COMPLETED',advance(2)).next;
 assert.equal(finished.sessions[0].programId,p.program.id);
 assert.equal(finished.sessions[0].status,'COMPLETED');
 assert.deepEqual(finished.programs,[keep.program]);
 assert.throws(()=>M.deleteProgram(result.next,p.program.id),/찾을 수 없습니다/);
});
test('program cards expose short balanced action labels and delete only on explicit confirmation',()=>{
 let data=routine(M.empty(),'가슴').next;
 const a=data.routines[0].id,p=M.createProgram(data,'테스트 프로그램','cycle',[a]);
 const view=ui(p.next);view.api.open('programs');
 assert.match(view.host.innerHTML,/fi-program-card-head/);
 assert.match(view.host.innerHTML,/data-fi-action="begin-program-routine"[^>]*>운동 시작<\/button>/);
 assert.match(view.host.innerHTML,/data-fi-action="register-program"[^>]*>캘린더 등록<\/button>/);
 assert.match(view.host.innerHTML,/data-fi-action="edit-program"[^>]*>수정<\/button>/);
 assert.match(view.host.innerHTML,/data-fi-action="delete-program"[^>]*>삭제<\/button>/);
 const raw=view.backing.obj.getItem(M.KEY);
 view.action('confirm-delete-program',{id:p.program.id});
 assert.equal(view.writes.length,0);
 view.action('delete-program',{id:p.program.id});
 assert.equal(view.backing.obj.getItem(M.KEY),raw);assert.equal(view.writes.length,0);
 assert.match(view.host.innerHTML,/정말 삭제할까요/);
 assert.match(view.host.innerHTML,/테스트 프로그램/);
 assert.match(view.host.innerHTML,/캘린더 일정 및 운동 기록은 유지/);
 assert.equal(view.api.canCloudApply(),false);
 assert.equal(view.api.canCloudMerge(p.next),false);
 view.action('cancel-delete-program');
 assert.equal(view.backing.obj.getItem(M.KEY),raw);assert.equal(view.writes.length,0);
 assert.doesNotMatch(view.host.innerHTML,/fi-program-delete-dialog/);
 view.action('delete-program',{id:p.program.id});
 view.action('confirm-delete-program',{id:p.program.id});
 const saved=view.backing.store.load().data;
 assert.equal(saved.programs.length,0);assert.deepEqual(saved.routines,p.next.routines);
 assert.equal(saved.sessions.length,0);assert.match(view.host.innerHTML,/저장된 프로그램이 없습니다/);
});
test('failed program deletion retains the program and does not change other records',()=>{
 const data=routine(M.empty(),'가슴').next,p=M.createProgram(data,'보존할 프로그램','cycle',[data.routines[0].id]);
 const view=ui(p.next);view.api.open('programs');
 const raw=view.backing.obj.getItem(M.KEY),set=view.backing.obj.setItem;
 view.backing.obj.setItem=(key,value)=>{if(key===M.KEY)throw Error('Quota');return set(key,value)};
 view.action('delete-program',{id:p.program.id});
 view.action('confirm-delete-program',{id:p.program.id});
 assert.equal(view.backing.obj.getItem(M.KEY),raw);assert.equal(view.api.getSnapshot().programs.length,1);
 assert.match(view.host.innerHTML,/보존할 프로그램/);assert.match(view.host.innerHTML,/저장 실패/);
});
test('fixed program cards with no workout today retain registration, edit and delete actions',()=>{
 const data=routine(M.empty(),'가슴').next;
 const p=M.createProgram(data,'요일 고정','fixed',[data.routines[0].id],{});
 const view=ui(p.next);view.api.open('programs');
 assert.match(view.host.innerHTML,/오늘 배정 없음/);
 assert.doesNotMatch(view.host.innerHTML,/data-fi-action="begin-program-routine"/);
 assert.match(view.host.innerHTML,/data-fi-action="register-program"/);
 assert.match(view.host.innerHTML,/data-fi-action="edit-program"/);
 assert.match(view.host.innerHTML,/data-fi-action="delete-program"/);
});

test('repeated delete taps, unrelated confirmation ID and stale confirmation never delete a program',()=>{
 let data=routine(M.empty(),'가슴').next;
 const first=M.createProgram(data,'첫 번째','cycle',[data.routines[0].id]);data=first.next;
 const second=M.createProgram(data,'두 번째','cycle',[data.routines[0].id]);
 const view=ui(second.next);view.api.open('programs');
 view.action('delete-program',{id:first.program.id});
 view.action('delete-program',{id:first.program.id});
 view.action('delete-program',{id:second.program.id});
 view.action('confirm-delete-program',{id:second.program.id});
 assert.equal(view.writes.length,0);
 assert.equal(view.api.getSnapshot().programs.length,2);
 view.action('cancel-delete-program');
 view.action('confirm-delete-program',{id:first.program.id});
 assert.equal(view.writes.length,0);
 view.action('delete-program',{id:first.program.id});
 view.subnav('home');view.action('confirm-delete-program',{id:first.program.id});
 assert.equal(view.writes.length,0);assert.equal(view.api.getSnapshot().programs.length,2);
});
test('deletion confirmation is tied to the stored revision and cannot overwrite another tab',()=>{
 const data=routine(M.empty(),'가슴').next,p=M.createProgram(data,'보존','cycle',[data.routines[0].id]);
 const view=ui(p.next);view.api.open('programs');view.action('delete-program',{id:p.program.id});
 const latest=M.updateProgram(p.next,p.program.id,'다른 탭 수정','cycle',[data.routines[0].id]);
 const saved=view.backing.store.save(latest.next,p.next.revision);
 const raw=view.backing.obj.getItem(M.KEY);
 view.action('confirm-delete-program',{id:p.program.id});
 assert.equal(view.backing.obj.getItem(M.KEY),raw);
 assert.equal(view.backing.store.load().data.programs[0].name,'다른 탭 수정');
 assert.equal(view.backing.store.load().data.revision,saved.revision);
 assert.match(view.host.innerHTML,/다른 탭/);
});

test('history excludes zero-completion, future and explicitly marked sample sessions but keeps originals for review',()=>{
 const b=M.start(M.empty(),{},clock),ex=b.session.exercises[0];
 let data=M.setValue(b.next,b.session.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
 data=M.finish(data,b.session.id,'COMPLETED',advance(2)).next;
 const actual=data.sessions[0];
 const invalid={...M.copy(actual),id:'bad-record',label:'완료 세트 없음',exercises:actual.exercises.map(e=>({...e,sets:e.sets.map(s=>({...s,done:false}))}))};
 const future={...M.copy(actual),id:'future-record',label:'미래 기록',date:'9999-12-31'};
 const sample={...M.copy(actual),id:'sample-record',label:'샘플 기록',isSample:true};
 const view=ui(M.normalize({...data,sessions:[actual,invalid,future,sample]}),{fixedToday:'2026-11-24T12:00:00Z'});
 view.api.open('history');
 assert.match(view.host.innerHTML,/전체 1회 기록/);
 assert.match(view.host.innerHTML,/확인 필요 기록 3건/);
 assert.match(view.host.innerHTML,/실제 완료 세트 없음/);
 assert.match(view.host.innerHTML,/미래 날짜/);
 assert.match(view.host.innerHTML,/체험용으로 표시된 기록/);
 assert.equal(view.api.getSnapshot().sessions.length,4);
 assert.equal(view.writes.length,0);
});
test('test-named confirmed records are visibly flagged without deleting or assuming non-performance',()=>{
 const b=M.start(M.empty(),{label:'[TEST] 확인 대상'},clock),ex=b.session.exercises[0];
 let data=M.setValue(b.next,b.session.id,ex.id,ex.sets[0].id,{done:true},advance(1)).next;
 data=M.finish(data,b.session.id,'COMPLETED',advance(2)).next;
 const view=ui(data,{fixedToday:'2026-11-24T12:00:00Z'});view.api.open('history');
 assert.match(view.host.innerHTML,/테스트 이름 · 수행 여부 확인 필요/);
 view.action('record-detail',{id:b.session.id});
 assert.match(view.host.innerHTML,/기록 ID/);assert.match(view.host.innerHTML,/시작 시각/);
 assert.equal(view.api.getSnapshot().sessions.length,1);assert.equal(view.writes.length,0);
});

test('explicit finish completes a workout and advances its program without marking skipped sets done',()=>{
 let data=routine(M.empty(),'가슴').next;data=routine(data,'등').next;
 const p=M.createProgram(data,'순환','cycle',data.routines.map(r=>r.id)),b=M.start(p.next,{routineId:data.routines[0].id,programId:p.program.id},clock);
 const e=b.session.exercises[0],total=b.session.exercises.reduce((n,ex)=>n+ex.sets.length,0);
 const started=M.setValue(b.next,b.session.id,e.id,e.sets[0].id,{weight:42.5,reps:7,done:true},advance(1)).next;
 const f=M.finish(started,b.session.id,'COMPLETED',advance(2));
 assert.equal(f.session.status,'COMPLETED');assert.equal(f.next.programs[0].nextIndex,1);
 assert.equal(M.recordSummary(f.session).completedSets,1);assert.equal(M.allSetsDone(f.session),false);
 assert.equal(f.session.exercises[0].sets[0].weight,42.5);assert.equal(f.session.exercises[0].sets[0].reps,7);
 assert.deepEqual(f.session.exercises,started.sessions[0].exercises);
 const view=ui(f.next,{fixedToday:'2026-11-24T12:00:00Z'});view.api.open('history');
 assert.match(view.host.innerHTML,new RegExp('실제 1/'+total+'세트'));
 view.action('record-detail',{id:f.session.id});assert.match(view.host.innerHTML,/운동 완료/);
 assert.match(view.host.innerHTML,new RegExp('1/'+total+'세트 완료'));
 assert.equal(view.writes.length,0);
});

test('starting an empty free calendar plan uses the existing exercise picker before creating a linked session',()=>{
  const date='2026-11-23',detail={exercises:[],notes:'',freePlan:true};
  const baseline=JSON.stringify({id:'free-day',date,title:'자유운동',detail});
  const plan={eventId:'free-day',date,label:'자유운동',exercises:[],notes:'',baseline,freePlan:true};
  const view=ui(M.empty(),{fixedToday:date+'T12:00:00',bridge:{prepareScheduledWorkout:()=>plan}});
  view.api.open('calendar',{eventId:plan.eventId,date});
  assert.equal(view.pickerIsOpen,true);assert.equal(view.writes.length,0);
  assert.equal(view.choose(['스쿼트']),true);
  const state=JSON.parse(view.backing.obj.getItem(M.KEY)),session=state.sessions[0];
  assert.equal(state.sessions.length,1);assert.equal(session.calendarSource.eventId,plan.eventId);
  assert.equal(session.exercises[0].name,'스쿼트');assert.ok(session.exercises[0].sets.every(s=>!s.done));
});
