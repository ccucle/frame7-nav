'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const W=require('../fitplan/workouts.js');
const C=require('../fitplan/core.js');

// Small, isolated DOM for exercising shipped event handlers and replacement of
// live input elements. It does not replace browser layout or device verification.
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[s]));
class Events{
  constructor(){this.events=new Map();}
  addEventListener(type,callback,options=false){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push({callback,capture:options===true||options?.capture===true,once:options?.once===true});}
  removeEventListener(type,callback){this.events.set(type,(this.events.get(type)||[]).filter(item=>item.callback!==callback));}
  emit(type,details={}){
    const event={type,target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...details};
    for(const capture of [true,false])for(const item of [...this.events.get(type)||[]]){if(item.capture===capture&&!event.stopped){item.callback(event);if(item.once)this.removeEventListener(type,item.callback);}}
    return event;
  }
}
class Element extends Events{
  constructor(tag,document){
    super();this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.attributes=new Map();this.dataset={};this.parentElement=null;
    this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.open=false;this.scrollTop=0;this._text='';this._html='';this.renderCount=0;this.showModalCount=0;
    this.style={setProperty(key,value){this[key]=String(value);},removeProperty(key){delete this[key];}};
    this.classList={contains:name=>(this.className||'').split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set((this.className||'').split(/\s+/).filter(Boolean).concat(names))].join(' ');},remove:(...names)=>{this.className=(this.className||'').split(/\s+/).filter(x=>!names.includes(x)).join(' ');},toggle:(name,force)=>{const enabled=force??!this.classList.contains(name);this.classList[enabled?'add':'remove'](name);return enabled;}};
  }
  setAttribute(key,value){
    value=String(value);this.attributes.set(key,value);
    if(key==='class')this.className=value;
    if(key==='id'||key==='name'||key==='type')this[key]=value;
    if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    if(['disabled','hidden','checked','open'].includes(key))this[key]=true;
    if(key==='value')this.value=value;
  }
  getAttribute(key){return this.attributes.get(key)??null;}
  removeAttribute(key){this.attributes.delete(key);if(['disabled','hidden','checked','open'].includes(key))this[key]=false;}
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  append(...children){for(const child of children)this.appendChild(child);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  get isConnected(){return this.document.body?.contains(this)===true;}
  matches(selector){
    return selector.split(',').some(part=>{
      part=part.trim();if(!part)return false;
      if(part.includes(':checked')&&!this.checked)return false;
      const tag=part.match(/^[a-z][a-z\d-]*/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
      const id=part.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
      for(const [,name]of part.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name))return false;
      for(const [,key,quoted,plain]of part.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)){
        if(!this.attributes.has(key))return false;const value=quoted??plain;if(value!==undefined&&this.getAttribute(key)!==value)return false;
      }
      return true;
    });
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){this.document.activeElement=this;}
  scrollIntoView(){}
  getBoundingClientRect(){return {left:0,top:36,right:390,bottom:844,width:390,height:808};}
  setPointerCapture(){}
  releasePointerCapture(){}
  showModal(){this.open=true;this.showModalCount++;}
  close(){if(!this.open)return;this.open=false;this.emit('close');}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
  get innerHTML(){return this._html;}
  set innerHTML(value){
    this._html=String(value);this._text='';this.renderCount++;for(const child of this.children)child.parentElement=null;this.children=[];
    const stack=[this];
    for(const token of this._html.match(/<[^>]*>|[^<]+/g)||[]){
      if(token.startsWith('</')){const closed=stack.pop();if(closed?.tagName==='TEXTAREA')closed.value=closed.textContent;continue;}
      if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}
      const tag=token.match(/^<([a-z\d-]+)/i)?.[1];if(!tag)continue;
      const child=new Element(tag,this.document);for(const match of token.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g))child.setAttribute(match[1],decode(match[2]||''));
      stack.at(-1).appendChild(child);if(!['input','img','br','hr','meta','link','source','wbr'].includes(tag)&&!token.endsWith('/>'))stack.push(child);
    }
  }
}
function ui(options={}){
  let now=Date.parse('2026-11-24T02:00:00.000Z');
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const document=new Events();document.hidden=false;document.body=new Element('body',document);document.body.dataset.fdScreen='home';
  document.createElement=tag=>new Element(tag,document);document.querySelector=s=>document.body.querySelector(s);document.querySelectorAll=s=>document.body.querySelectorAll(s);document.getElementById=id=>document.querySelector('#'+id);
  const main=document.body.appendChild(new Element('main',document));main.setAttribute('id','main-content');
  const host=main.appendChild(new Element('div',document));host.setAttribute('id','fd-ind-root');
  const calendar=main.appendChild(new Element('div',document));calendar.setAttribute('id','fd-iron-calendar');
  const db=options.storage||new Map(),root=new Events(),intervals=[],timeouts=new Map(),writes=[];let failWrite=false,picker=null,pickerActive=false,timeoutId=0;
  root.localStorage={getItem:key=>db.get(key)??null,setItem:(key,value)=>{if(failWrite&&key==='formday_iron_independent_v1')throw Error('quota');writes.push([key,value]);db.set(key,value);},removeItem:key=>db.delete(key)};
  root.FormdayWorkouts=W;root.FormdayExerciseMedia={byName:{'벤치프레스':{src:'assets/exercises/bench.svg',alt:'벤치프레스 동작'},'스쿼트':{src:'assets/exercises/squat.svg',alt:'스쿼트 동작'}}};
  root.innerHeight=844;root.visualViewport=new Events();root.visualViewport.height=844;root.visualViewport.offsetTop=0;
  root.setInterval=fn=>{intervals.push(fn);return intervals.length;};root.clearInterval=()=>{};root.requestAnimationFrame=fn=>fn();root.dispatchEvent=event=>root.emit(event.type,event);
  root.setTimeout=(fn,delay=0)=>{timeouts.set(++timeoutId,{fn,at:now+delay});return timeoutId;};root.clearTimeout=id=>timeouts.delete(id);root.scrollTo=()=>{};
  const audioEvents=[];
  if(options.audio)root.AudioContext=class{
    constructor(){this.currentTime=0;this.state='running';this.destination={};audioEvents.push('context');}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createOscillator(){return {frequency:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){},start(){audioEvents.push('start');},stop(){audioEvents.push('stop');}};}
  };
  const answers=[],prompts=[];root.confirm=text=>{prompts.push(text);return answers.shift()??false;};root.prompt=()=>null;
  root.FormdayExercisePicker={isOpen:()=>pickerActive,open:config=>{picker=config;pickerActive=true;return true;}};
  const context=vm.createContext({window:root,document,Date:Clock,console,setTimeout:root.setTimeout,clearTimeout:root.clearTimeout,CustomEvent:class{constructor(type){this.type=type;}}});
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron-store.js'),'utf8'),context);root.FormdayIronStore=context.FormdayIronStore;
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/calendar-workouts.js'),'utf8'),context);root.FormdayCalendarWorkouts=context.FormdayCalendarWorkouts;
  if(options.initialState){const initial=typeof options.initialState==='function'?options.initialState(root.FormdayIronStore):options.initialState;db.set(root.FormdayIronStore.KEY,JSON.stringify(root.FormdayIronStore.normalize(initial)));}
  if(options.bridge)root.FormdayBridge=typeof options.bridge==='function'?options.bridge({root,db,document}):options.bridge;
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron-independent.js'),'utf8'),context);
  if(options.dashboard){
    const dashboard=main.appendChild(new Element('div',document));dashboard.setAttribute('id','fd-iron-root');
    root.FormdayCore=C;root.FormdayIronData=require('../fitplan/iron-data.js');
    root.FormdayBridge={getState:()=>C.normalizeState({events:[],settings:C.defaults}),getToday:()=>C.iso(new Clock())};
    root.FormdayProgress={render(){}};
    vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron.js'),'utf8'),context);
  }
  const api=root.FormdayIndependent;
  const snapshot=()=>JSON.parse(JSON.stringify(api.getSnapshot()));
  function action(name,extra={}){
    const selector='[data-fi-action="'+name+'"]'+Object.entries(extra).map(([key,value])=>'[data-'+key+'="'+value+'"]').join('');
    const target=host.querySelector(selector);assert.ok(target,'action exists: '+selector);assert.equal(target.disabled,false,'action is enabled: '+name);
    return document.emit('click',{target});
  }
  const choose=names=>{assert.ok(pickerActive);const ok=picker.onConfirm(names);if(ok===true){pickerActive=false;picker.onClose?.({reason:'confirmed'});}return ok;};
  const row=(exerciseIndex,setIndex=0)=>{
    const ex=snapshot().sessions.find(s=>['ACTIVE','PAUSED','SAVED'].includes(s.status))?.exercises[exerciseIndex];
    assert.ok(ex,'exercise exists');return host.querySelector('[data-fi-set="'+ex.sets[setIndex].id+'"]');
  };
  const field=(exerciseIndex,setIndex,name)=>{const input=row(exerciseIndex,setIndex)?.querySelector('[data-fi-'+name+']');assert.ok(input,'input exists: '+name);return input;};
  const edit=(exerciseIndex,setIndex,name,value)=>{const input=field(exerciseIndex,setIndex,name);input.value=String(value);host.emit('input',{target:input});return input;};
  const complete=(exerciseIndex,setIndex=0)=>{const session=snapshot().sessions.find(s=>['ACTIVE','PAUSED','SAVED'].includes(s.status)),ex=session.exercises[exerciseIndex];return action('save-session-set',{ex:ex.id,id:ex.sets[setIndex].id});};
  const start=(names=['벤치프레스','스쿼트'])=>{api.open('home');action('start-free');assert.equal(choose(names),true);};
  return {api,root,document,host,db,writes,answers,prompts,snapshot,action,choose,row,field,edit,complete,start,audioEvents,sheet:()=>host.querySelector('#fi-session-sheet'),
    get picker(){return picker;},get pickerActive(){return pickerActive;},failStorage(value=true){failWrite=value;},
    advance(ms){now+=ms;for(const [id,item]of [...timeouts])if(item.at<=now){timeouts.delete(id);item.fn();}for(const fn of intervals)fn();},hide(){document.hidden=true;document.emit('visibilitychange');},show(){document.hidden=false;document.emit('visibilitychange');},
    timer(){return host.querySelector('#fi-timer-number')?.textContent;}};
}
const active=view=>view.snapshot().sessions.find(s=>['ACTIVE','PAUSED','SAVED'].includes(s.status));

test('set edits, bulk completion and pause preserve existing notes after note editors are removed',()=>{
  const view=ui();view.start();
  const M=view.root.FormdayIronStore,initial=view.snapshot(),session=active(view);
  const notes={notes:'기존 운동 메모',exercises:session.exercises.map((ex,index)=>({id:ex.id,notes:'기존 종목 메모 '+(index+1)}))};
  M.createStore(view.root.localStorage).save(M.updateSession(initial,session.id,notes).next,initial.revision);
  view.root.emit('storage',{key:M.KEY});view.answers.push(true);view.action('reload');view.api.open('session');
  const assertNotes=()=>{
    const saved=active(view);assert.equal(saved.notes,notes.notes);
    assert.deepEqual(saved.exercises.map(ex=>({id:ex.id,notes:ex.notes})),notes.exercises);
    const persisted=JSON.parse(view.db.get(M.KEY)).sessions.find(s=>s.id===session.id);
    assert.equal(persisted.notes,notes.notes);assert.deepEqual(persisted.exercises.map(ex=>({id:ex.id,notes:ex.notes})),notes.exercises);
  };
  assert.equal(view.host.querySelector('#fi-session-note'),null);assert.equal(view.host.querySelectorAll('[data-fi-ex-note]').length,0);assertNotes();
  view.edit(0,0,'kg',62.5);view.edit(0,0,'reps',8);view.edit(1,1,'kg',90);view.edit(1,1,'reps',6);
  view.complete(0);
  const saved=active(view);assertNotes();
  assert.equal(saved.exercises[0].sets[0].weight,62.5);assert.equal(saved.exercises[0].sets[0].reps,8);assert.equal(saved.exercises[0].sets[0].done,true);
  assert.equal(saved.exercises[1].sets[1].weight,90);assert.equal(saved.exercises[1].sets[1].reps,6);assert.equal(saved.exercises[1].sets[1].done,false);
  assert.equal(saved.exercises.flatMap(x=>x.sets).filter(x=>x.done).length,1);
  view.action('complete-exercise',{id:session.exercises[1].id});assertNotes();assert.ok(active(view).exercises[1].sets.every(set=>set.done));
  view.action('pause');assert.equal(active(view).status,'PAUSED');assertNotes();
  view.action('resume');assert.equal(active(view).status,'ACTIVE');assertNotes();
  assert.equal(active(view).exercises[1].sets[1].weight,90);assert.equal(active(view).exercises[1].sets[1].reps,6);
});
test('numeric change saves without replacing the field or turning it into a completed set',()=>{
  const view=ui();view.start();const input=view.edit(0,0,'kg',72.5),rendered=view.host.renderCount;
  view.host.emit('change',{target:input});
  assert.equal(view.field(0,0,'kg'),input);assert.equal(view.host.renderCount,rendered);assert.equal(active(view).exercises[0].sets[0].weight,72.5);assert.equal(active(view).exercises[0].sets[0].done,false);
  view.complete(0);assert.equal(active(view).exercises[0].sets[0].done,true);
});
test('storage failure keeps edited values and completion state available for a successful retry',()=>{
  const view=ui();view.start();const original=JSON.stringify(view.snapshot()),input=view.edit(0,0,'kg',77.5),rendered=view.host.renderCount;
  assert.equal(view.host.querySelector('.fs-rest').hidden,true);
  view.failStorage();view.complete(0);
  assert.equal(JSON.stringify(view.snapshot()),original);assert.equal(view.host.renderCount,rendered);assert.equal(view.field(0,0,'kg'),input);assert.equal(input.value,'77.5');
  assert.equal(view.host.querySelector('.fs-rest').hidden,true);
  assert.match(view.host.querySelector('#fi-banner')?.textContent||'',/저장|입력/);
  view.failStorage(false);view.complete(0);assert.equal(active(view).exercises[0].sets[0].weight,77.5);assert.equal(active(view).exercises[0].sets[0].done,true);
});
test('invalid repetitions retain every field and prevent pause or minimize',()=>{
  const view=ui();view.start();view.edit(1,0,'kg',92.5);const invalid=view.edit(0,0,'reps',''),rendered=view.host.renderCount;
  view.action('pause');assert.equal(active(view).status,'ACTIVE');assert.equal(view.field(0,0,'reps'),invalid);assert.equal(view.host.renderCount,rendered);
  view.action('minimize-session');assert.equal(view.document.body.dataset.fiSession,'true');assert.equal(view.field(1,0,'kg').value,'92.5');
});
test('minimizing saves edits and restores hub chrome while keeping the workout active',()=>{
  const view=ui();view.start();assert.equal(view.document.body.dataset.fiSession,'true');view.edit(0,0,'kg',55);view.action('minimize-session');view.advance(180);
  assert.notEqual(view.document.body.dataset.fiSession,'true');assert.equal(active(view).status,'ACTIVE');assert.equal(active(view).exercises[0].sets[0].weight,55);
  view.action('inspect-session');assert.equal(view.document.body.dataset.fiSession,'true');assert.equal(view.field(0,0,'kg').value,'55');
});
test('pause persists unblurred input and freezes the rest timer until resume',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);view.advance(10000);const remaining=view.timer();
  view.edit(1,0,'kg',102.5);view.action('pause');assert.equal(active(view).status,'PAUSED');assert.equal(active(view).exercises[1].sets[0].weight,102.5);
  view.advance(30000);assert.equal(view.timer(),remaining);view.action('resume');view.advance(10000);assert.notEqual(view.timer(),remaining);
  assert.equal(view.timer(),'00:40');
});
test('phone visibility transition saves visible fields before pausing and retains them on return',()=>{
  const view=ui();view.start();view.edit(0,1,'kg',67.5);view.edit(1,2,'reps',11);view.hide();
  assert.equal(active(view).status,'PAUSED');assert.equal(active(view).exercises[0].sets[1].weight,67.5);assert.equal(active(view).exercises[1].sets[2].reps,11);
  view.show();assert.equal(view.field(0,1,'kg').value,'67.5');assert.equal(view.field(1,2,'reps').value,'11');assert.equal(active(view).status,'PAUSED');
});
test('opening and confirming the exercise picker preserves current inputs and does not complete added sets',()=>{
  const view=ui();view.start();view.edit(0,0,'kg',68);view.edit(1,1,'reps',12);view.action('add-session-ex');assert.equal(view.pickerActive,true);
  assert.equal(view.choose(['랫풀다운']),true);const saved=active(view);
  assert.equal(saved.exercises[0].sets[0].weight,68);assert.equal(saved.exercises[1].sets[1].reps,12);assert.equal(saved.exercises[2].name,'랫풀다운');assert.ok(saved.exercises[2].sets.every(set=>set.done===false));
});
test('switching between all exercises and one at a time preserves edits across next and previous',()=>{
  const view=ui();view.start();view.edit(1,0,'kg',115);view.action('toggle-session-view');view.edit(0,0,'kg',73);view.action('session-next');
  assert.equal(view.field(1,0,'kg').value,'115');view.edit(1,0,'reps',7);view.action('session-prev');assert.equal(view.field(0,0,'kg').value,'73');
  view.action('toggle-session-view');assert.equal(view.field(1,0,'reps').value,'7');assert.equal(active(view).exercises[1].sets[0].done,false);
});
test('completing the workout keeps finalized values and leaves immersive session mode',()=>{
  const view=ui({dashboard:true});view.start();view.edit(0,0,'kg',80);view.edit(0,0,'reps',5);view.complete(0);view.edit(0,0,'kg',82.5);view.answers.push(true,false);view.action('finish');
  assert.equal(active(view),undefined);assert.notEqual(view.document.body.dataset.fiSession,'true');const saved=view.snapshot().sessions[0];assert.equal(saved.status,'PARTIAL');assert.equal(saved.exercises[0].sets[0].weight,82.5);assert.equal(saved.exercises[0].sets[0].reps,5);
  assert.equal(view.document.body.dataset.fdScreen,'progress');assert.ok(view.host.querySelector('#fi-history-detail'));
  assert.equal(view.host.querySelector('.fi-hub-nav'),null);assert.equal(view.document.activeElement.id,'fi-history-detail');
  view.action('record-detail',{id:saved.id});assert.equal(view.document.body.dataset.fdScreen,'progress');
  const before=JSON.stringify(view.snapshot());view.root.dispatchEvent(new Event('formday:changed'));
  assert.ok(view.host.querySelector('#fi-history-detail'));assert.equal(JSON.stringify(view.snapshot()),before);
});

test('storage conflict keeps stale inputs visible until confirmed reload, then never writes them over the newer revision',()=>{
  const view=ui();view.start();const stale=view.edit(0,0,'kg',99),M=view.root.FormdayIronStore,session=active(view),ex=session.exercises[0];
  const storage=M.createStore(view.root.localStorage),newer=storage.save(M.updateSession(view.snapshot(),session.id,{exercises:[{id:ex.id,sets:[{id:ex.sets[0].id,weight:111}]}]}).next,view.snapshot().revision);
  const expected=JSON.stringify(newer);view.root.emit('storage',{key:M.KEY});
  assert.equal(view.field(0,0,'kg'),stale);assert.equal(stale.value,'99');assert.equal(view.host.querySelector('#fi-session-reload').hidden,false);
  view.answers.push(true);view.action('reload');
  assert.equal(JSON.stringify(view.snapshot()),expected);assert.equal(view.db.get(M.KEY),expected);assert.notEqual(view.document.body.dataset.fiSession,'true');
  view.api.open('session');assert.equal(view.field(0,0,'kg').value,'111');
});
test('warmup sets are excluded from live metrics and edits to a done main set repaint totals without replacing inputs',()=>{
  const view=ui();view.start(['벤치프레스']);const ex=active(view).exercises[0];
  view.edit(0,0,'kg',20);view.edit(0,0,'reps',10);view.action('toggle-warmup',{ex:ex.id,id:ex.sets[0].id});view.complete(0,0);
  assert.equal(view.host.querySelector('#fi-session-volume').textContent,'0');assert.equal(view.host.querySelector('#fi-session-sets').textContent,'0');
  view.edit(0,1,'kg',50);view.edit(0,1,'reps',5);view.complete(0,1);
  assert.equal(view.host.querySelector('#fi-session-volume').textContent,'250');assert.equal(view.host.querySelector('#fi-session-sets').textContent,'1');
  const input=view.edit(0,1,'kg',55);view.host.emit('change',{target:input});
  assert.equal(view.field(0,1,'kg'),input);assert.equal(view.host.querySelector('#fi-session-volume').textContent,'275');assert.equal(view.host.querySelector('#fi-session-sets').textContent,'1');
});
test('complete-all and undo preserve entered values and guard against discarding completed sets',()=>{
  const view=ui();view.start(['벤치프레스']);const ex=active(view).exercises[0];
  for(const [index,kg,reps]of [[0,50,8],[1,60,6],[2,60,5]]){view.edit(0,index,'kg',kg);view.edit(0,index,'reps',reps);}
  view.action('complete-exercise',{id:ex.id});assert.ok(active(view).exercises[0].sets.every(set=>set.done));
  assert.equal(view.host.querySelector('#fi-session-volume').textContent,'1,060');assert.equal(view.host.querySelector('#fi-session-sets').textContent,'3');assert.equal(view.host.querySelector('#fi-session-exercises').textContent,'1');
  for(const action of ['replace-session-ex','load-previous','remove-session-set'])assert.equal(view.host.querySelector('[data-fi-action="'+action+'"][data-id="'+ex.id+'"]').disabled,true);
  view.action('complete-exercise',{id:ex.id});const saved=active(view).exercises[0];assert.ok(saved.sets.every(set=>!set.done));assert.deepEqual(saved.sets.map(set=>[set.weight,set.reps]),[[50,8],[60,6],[60,5]]);
  assert.equal(view.host.querySelector('#fi-session-volume').textContent,'0');assert.equal(view.host.querySelector('[data-fi-action="replace-session-ex"][data-id="'+ex.id+'"]').disabled,false);
});
test('previous-record loading imports only completed sets as new unfinished entries and preserves finalized history',()=>{
  const view=ui();view.start(['벤치프레스']);view.edit(0,0,'kg',55);view.edit(0,0,'reps',5);view.complete(0,0);view.edit(0,1,'kg',60);view.edit(0,1,'reps',6);view.complete(0,1);
  view.answers.push(true,false);view.action('finish');const history=view.snapshot().sessions[0],before=JSON.stringify(history);view.advance(1000);view.start(['벤치프레스']);const ex=active(view).exercises[0];
  view.answers.push(true);view.action('load-previous',{id:ex.id});const loaded=active(view).exercises[0];
  assert.deepEqual(loaded.sets.map(set=>[set.weight,set.reps,set.done]),[[55,5,false],[60,6,false]]);assert.ok(loaded.sets.every(set=>!history.exercises[0].sets.some(old=>old.id===set.id)));
  assert.equal(JSON.stringify(view.snapshot().sessions.find(session=>session.id===history.id)),before);
  view.complete(0);const snapshot=JSON.stringify(view.snapshot());
  for(const action of ['load-previous','replace-session-ex']){
    const button=view.host.querySelector('[data-fi-action="'+action+'"][data-id="'+ex.id+'"]');assert.equal(button.disabled,true);view.document.emit('click',{target:button});assert.equal(JSON.stringify(view.snapshot()),snapshot);
  }
});
test('exercise replacement requires confirmation and changes only the unfinished exercise',()=>{
  const view=ui();view.start();const old=active(view),ex=old.exercises[0],other=JSON.stringify(old.exercises[1]);view.edit(0,0,'kg',75);
  view.answers.push(false);view.action('replace-session-ex',{id:ex.id});assert.equal(view.pickerActive,false);assert.equal(active(view).exercises[0].name,'벤치프레스');assert.equal(active(view).exercises[0].sets[0].weight,75);
  view.answers.push(true);view.action('replace-session-ex',{id:ex.id});assert.equal(view.pickerActive,true);assert.equal(view.choose(['랫풀다운']),true);
  const saved=active(view);assert.equal(saved.exercises[0].name,'랫풀다운');assert.ok(saved.exercises[0].sets.every(set=>!set.done));assert.equal(JSON.stringify(saved.exercises[1]),other);
});

test('invalid input survives a phone interruption without counting hidden time, then correction resumes safely',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);view.advance(8000);
  const invalid=view.edit(1,0,'reps','');view.hide();const duration=view.host.querySelector('#fi-duration').textContent,rest=view.timer();
  view.advance(120000);view.show();
  assert.equal(view.field(1,0,'reps'),invalid);assert.equal(invalid.value,'');assert.equal(view.host.querySelector('#fi-duration').textContent,duration);assert.equal(view.timer(),rest);
  invalid.value='9';view.host.emit('input',{target:invalid});view.host.emit('change',{target:invalid});
  const saved=active(view);assert.equal(saved.exercises[1].sets[0].reps,9);assert.equal(saved.exercises[1].sets[0].done,false);assert.equal(saved.activeMs,8000);
  assert.equal(saved.activeSince,new Date(Date.parse('2026-11-24T02:00:00.000Z')+128000).toISOString());
  view.advance(5000);assert.equal(view.host.querySelector('#fi-duration').textContent,'00:00:13');assert.equal(view.timer(),'00:47');
});

test('workout opens in one stable native dialog and preserves scroll when sets rerender',()=>{
  const view=ui();view.start();const sheet=view.sheet();assert.ok(sheet);assert.equal(sheet.tagName,'DIALOG');assert.equal(sheet.open,true);assert.equal(sheet.showModalCount,1);
  assert.equal(sheet.getAttribute('aria-label'),'진행 중인 운동 창');assert.equal(view.document.body.classList.contains('fs-sheet-open'),true);
  const scroll=sheet.querySelector('.fs-scroll');assert.ok(scroll);scroll.scrollTop=137;view.edit(0,0,'kg',65);view.complete(0);
  assert.equal(view.sheet(),sheet);assert.equal(sheet.open,true);assert.equal(sheet.showModalCount,1);assert.equal(sheet.querySelector('.fs-scroll').scrollTop,137);
});
test('Escape and backdrop dismissal preserve invalid or unsaved input when saving is blocked',()=>{
  const view=ui();view.start();const sheet=view.sheet(),input=view.edit(0,0,'reps','');const canceled=sheet.emit('cancel');view.advance(250);
  assert.equal(canceled.defaultPrevented,true);assert.equal(sheet.open,true);assert.equal(view.field(0,0,'reps'),input);assert.equal(input.value,'');
  input.value='7';view.host.emit('input',{target:input});view.failStorage();sheet.emit('click',{target:sheet});view.advance(250);
  assert.equal(sheet.open,true);assert.equal(view.field(0,0,'reps'),input);assert.equal(view.document.body.classList.contains('fs-sheet-open'),true);
});
test('Escape saves current entries and closes once after the slide transition without ending the workout',()=>{
  const view=ui();view.start();const sheet=view.sheet();view.edit(0,0,'kg',83);sheet.emit('cancel');sheet.emit('cancel');
  assert.equal(active(view).exercises[0].sets[0].weight,83);assert.equal(sheet.open,true);view.advance(179);assert.equal(sheet.open,true);view.advance(1);
  assert.equal(sheet.open,false);assert.equal(view.document.body.classList.contains('fs-sheet-open'),false);assert.notEqual(view.document.body.dataset.fiSession,'true');assert.equal(active(view).status,'ACTIVE');
  view.action('inspect-session');assert.equal(view.sheet().open,true);assert.equal(view.field(0,0,'kg').value,'83');
});
test('only a sufficiently downward swipe on the handle dismisses the workout sheet',()=>{
  const view=ui();view.start();const sheet=view.sheet(),handle=sheet.querySelector('.fs-sheet-handle');assert.ok(handle);
  const drag=(target,dx,dy)=>{view.host.emit('pointerdown',{target,pointerId:1,button:0,clientX:100,clientY:100});view.host.emit('pointermove',{target,pointerId:1,clientX:100+dx,clientY:100+dy});view.host.emit('pointerup',{target,pointerId:1,clientX:100+dx,clientY:100+dy});};
  drag(view.field(0,0,'kg'),0,120);view.advance(200);assert.equal(sheet.open,true);
  drag(handle,0,40);view.document.emit('click',{target:handle});view.advance(200);assert.equal(sheet.open,true);
  drag(handle,120,90);view.advance(200);assert.equal(sheet.open,true);
  view.edit(0,0,'kg',71);drag(handle,10,120);view.advance(180);assert.equal(sheet.open,false);assert.equal(active(view).exercises[0].sets[0].weight,71);assert.equal(active(view).status,'ACTIVE');
});

test('completing a set opens a countdown with configured duration and finite progress',()=>{
  const view=ui();view.start();assert.equal(view.host.querySelector('.fs-rest').hidden,true);
  view.edit(0,0,'rest',60);view.complete(0);const rest=view.host.querySelector('.fs-rest');
  assert.equal(rest.hidden,false);assert.equal(rest.dataset.state,'running');assert.equal(view.timer(),'01:00');assert.equal(view.host.querySelector('#fi-timer-label').textContent,'휴식 1:00');
  view.advance(3000);assert.equal(view.timer(),'00:57');const progress=Number.parseFloat(view.host.querySelector('#fi-rest-progress').style.width);
  assert.ok(Number.isFinite(progress)&&progress>=0&&progress<=100);view.advance(3000);assert.notEqual(Number.parseFloat(view.host.querySelector('#fi-rest-progress').style.width),progress);
});
test('plus and minus ten seconds adjust remaining time and retain an explicitly paused timer',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);view.advance(3000);view.action('timer-add');assert.equal(view.timer(),'01:07');
  view.action('timer-subtract');assert.equal(view.timer(),'00:57');view.action('timer-toggle');assert.equal(view.host.querySelector('.fs-rest').dataset.state,'paused');
  view.action('timer-add');assert.equal(view.timer(),'01:07');view.action('timer-subtract');assert.equal(view.timer(),'00:57');view.advance(20000);assert.equal(view.timer(),'00:57');
  view.action('pause');view.action('resume');view.advance(10000);assert.equal(view.timer(),'00:57');assert.equal(view.host.querySelector('.fs-rest').dataset.state,'paused');
  view.hide();view.show();view.action('resume');view.advance(10000);assert.equal(view.timer(),'00:57');
});
test('rest adjustments clamp at ten minutes and zero without negative countdowns',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',600);view.complete(0);view.action('timer-add');assert.equal(view.timer(),'10:00');view.action('timer-toggle');
  for(let i=0;i<61;i++)view.action('timer-subtract');assert.equal(view.timer(),'00:00');assert.equal(view.host.querySelector('.fs-rest').dataset.state,'done');view.advance(5000);assert.equal(view.timer(),'00:00');
});
test('undoing another set keeps the current rest timer, while undoing its triggering set dismisses it',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',30);view.complete(0,0);view.edit(0,1,'rest',90);view.complete(0,1);view.advance(10000);
  view.complete(0,0);assert.equal(view.host.querySelector('.fs-rest').hidden,false);assert.equal(view.timer(),'01:20');
  view.complete(0,1);view.advance(180);assert.equal(view.host.querySelector('.fs-rest').hidden,true);assert.ok(active(view).exercises[0].sets.every(set=>!set.done));
});
test('bulk completion starts one rest timer and undo dismisses it without changing entered targets',()=>{
  const view=ui();view.start(['벤치프레스']);const ex=active(view).exercises[0];view.edit(0,2,'rest',90);view.action('complete-exercise',{id:ex.id});
  assert.equal(view.timer(),'01:30');view.advance(10000);view.action('toggle-session-view');view.advance(10000);assert.equal(view.timer(),'01:10');
  view.action('complete-exercise',{id:ex.id});view.advance(180);assert.equal(view.host.querySelector('.fs-rest').hidden,true);assert.ok(active(view).exercises[0].sets.every(set=>!set.done));assert.equal(active(view).exercises[0].sets[2].restSec,90);
});
test('rest settings do not replace unfinished inputs or change recorded workout values',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);const before=JSON.stringify(view.snapshot()),field=view.edit(1,0,'reps','');
  view.action('timer-add');view.action('timer-subtract');view.action('timer-sound');view.action('timer-presets');assert.equal(view.host.querySelector('.fs-rest-presets').hidden,false);
  view.action('timer-preset',{seconds:30});assert.equal(view.timer(),'00:30');assert.equal(view.host.querySelector('.fs-rest').dataset.state,'running');
  assert.equal(view.field(1,0,'reps'),field);assert.equal(field.value,'');assert.equal(JSON.stringify(view.snapshot()),before);
  view.action('timer-skip');view.advance(180);assert.equal(view.host.querySelector('.fs-rest').hidden,true);assert.equal(view.field(1,0,'reps'),field);assert.equal(JSON.stringify(view.snapshot()),before);
});
test('closing an old rest timer never hides a new timer started during its exit animation',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);const before=JSON.stringify(view.snapshot());view.action('timer-skip');
  assert.equal(view.host.querySelector('.fs-rest').dataset.closing,'true');assert.equal(JSON.stringify(view.snapshot()),before);view.advance(100);
  view.edit(0,1,'rest',120);view.complete(0,1);view.advance(180);assert.equal(view.host.querySelector('.fs-rest').hidden,false);assert.equal(view.host.querySelector('.fs-rest').dataset.state,'running');assert.equal(view.timer(),'02:00');
});
test('rest entry animation finishes once and unrelated session rerenders keep the timer and dialog stable',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);const dialog=view.sheet();assert.equal(view.host.querySelector('.fs-rest').dataset.entering,'true');
  view.advance(240);assert.notEqual(view.host.querySelector('.fs-rest').dataset.entering,'true');view.action('toggle-session-view');
  assert.equal(view.sheet(),dialog);assert.equal(dialog.showModalCount,1);assert.notEqual(view.host.querySelector('.fs-rest').dataset.entering,'true');view.advance(2000);assert.equal(view.timer(),'00:58');
});
test('rest expiry sounds once, mute suppresses the next alert, and reopening does not replay an expired alert',()=>{
  const view=ui({audio:true});view.start();view.edit(0,0,'rest',1);view.complete(0);const started=view.audioEvents.filter(event=>event==='start').length;
  view.advance(1000);const sounded=view.audioEvents.filter(event=>event==='start').length;assert.equal(sounded-started,2);assert.equal(view.timer(),'00:00');assert.equal(view.host.querySelector('.fs-rest').dataset.state,'done');assert.equal(view.host.querySelector('#fi-timer-label').textContent,'휴식 완료');
  view.advance(5000);view.action('toggle-session-view');assert.equal(view.audioEvents.filter(event=>event==='start').length,sounded);
  view.action('timer-sound');view.action('timer-presets');view.action('timer-preset',{seconds:30});view.advance(30000);assert.equal(view.audioEvents.filter(event=>event==='start').length,sounded);
  view.action('timer-sound');view.action('timer-presets');view.action('timer-preset',{seconds:30});view.action('minimize-session');view.advance(180);view.advance(35000);const offscreenCount=view.audioEvents.filter(event=>event==='start').length;
  view.action('inspect-session');view.advance(2000);assert.equal(view.audioEvents.filter(event=>event==='start').length,offscreenCount);assert.equal(view.timer(),'00:00');
});
test('set settings toggle preserves edits and uses accessible vector completion controls',()=>{
  const view=ui();view.start();const ex=active(view).exercises[0];view.edit(0,0,'kg',67.5);view.action('toggle-set-settings',{id:ex.id});
  assert.equal(view.host.querySelector('[data-fi-ex="'+ex.id+'"]').classList.contains('fs-settings-open'),true);view.edit(0,0,'rest',75);view.action('toggle-set-settings',{id:ex.id});
  assert.equal(view.host.querySelector('[data-fi-ex="'+ex.id+'"]').classList.contains('fs-settings-open'),false);assert.equal(active(view).exercises[0].sets[0].weight,67.5);assert.equal(active(view).exercises[0].sets[0].restSec,75);
  for(const action of ['save-session-set','complete-exercise']){const button=view.host.querySelector('[data-fi-action="'+action+'"]');assert.ok(button.querySelector('svg.fs-symbol'));assert.ok(button.getAttribute('aria-label'));}
});
test('failed pagehide persistence freezes exercise and rest time until a safe retry',()=>{
  const view=ui();view.start();view.edit(0,0,'rest',60);view.complete(0);view.advance(8000);view.failStorage();view.root.emit('pagehide');view.advance(120000);
  assert.equal(view.host.querySelector('#fi-duration').textContent,'00:00:08');assert.equal(view.timer(),'00:52');view.failStorage(false);const input=view.edit(1,0,'reps',9);view.host.emit('change',{target:input});
  assert.equal(active(view).activeMs,8000);view.advance(5000);assert.equal(view.host.querySelector('#fi-duration').textContent,'00:00:13');assert.equal(view.timer(),'00:47');
});

// Calendar persistence is represented by an isolated in-memory fixture. The
// shipped calendar model prepares and reflects records; the UI and IRON store
// run unchanged, including their real local-storage writes and lifecycle hooks.
function scheduledFixture({date='2026-11-24',reflectionError=null}={}){
  let calendar=C.normalizeState({schemaVersion:C.VERSION,events:[{
    id:'scheduled-upper',date,start:'18:10',end:'19:20',type:'strength',title:'예약한 상체 운동',repeat:'none',completed:false,
    detail:{notes:'기존 일정 메모',exercises:[
      {id:'scheduled-bench',name:'벤치프레스',notes:'벤치 높이 확인',sets:[
        {id:'bench-warmup',weight:22.5,reps:15,rpe:null,warmup:true,done:false},
        {id:'bench-work',weight:67.5,reps:7,rpe:8,warmup:false,done:false}
      ]},
      {id:'scheduled-squat',name:'스쿼트',notes:'천천히 내려가기',sets:[
        {id:'squat-1',weight:85,reps:8,rpe:null,warmup:false,done:false},
        {id:'squat-2',weight:90,reps:6,rpe:null,warmup:false,done:false},
        {id:'squat-3',weight:92.5,reps:5,rpe:null,warmup:false,done:false},
        {id:'squat-4',weight:80,reps:10,rpe:null,warmup:false,done:false}
      ]}
    ]}
  }],settings:{...C.defaults},demo:false});
  const calls={queries:[],prepares:[],reflections:[],swaps:[],closes:0};
  const copy=value=>JSON.parse(JSON.stringify(value));
  return {date,eventId:'scheduled-upper',calls,get calendar(){return copy(calendar);},set reflectionError(value){reflectionError=value;},
    bridge({root,db}){
      const K=root.FormdayCalendarWorkouts,M=root.FormdayIronStore;
      return {
        getToday:()=> '2026-11-24',getSelectedDay:()=>date,getDetailDay:()=>date,
        closeDayDetail(){calls.closes++;},
        getScheduledWorkouts(day){
          calls.queries.push(day);
          const sessions=root.FormdayIndependent?.getSnapshot?.()?.sessions||[];
          return C.dayEvents(calendar,day).filter(event=>event.type==='strength').map(event=>{
            const session=sessions.find(item=>item.calendarSource?.eventId===event.id&&item.calendarSource.date===day)||null;
            return {event,session,canReplace:!session&&!event.workoutSessionId&&!event.completed&&C.volume(event.detail).completedSets===0};
          });
        },
        prepareScheduledWorkout(id,day){calls.prepares.push({id,date:day});return K.prepareStart(C,calendar,id,day);},
        reflectWorkoutSession(session){
          const persisted=JSON.parse(db.get(M.KEY)||'{"sessions":[]}').sessions.find(item=>item.id===session.id);
          calls.reflections.push({session:copy(session),persisted:persisted?copy(persisted):null});
          if(reflectionError)return {ok:false,error:reflectionError};
          try{const result=K.applySession(C,calendar,session);if(result.next)calendar=result.next;return {ok:true,alreadyApplied:result.alreadyApplied};}
          catch(error){return {ok:false,error:error.message};}
        },
        getWorkoutReflection(session){
          const source=session.calendarSource,event=source&&calendar.events.find(item=>item.id===source.eventId);
          const occurrence=event&&C.occurrence(event,source.date);
          const applied=occurrence?.workoutSessionId===session.id;
          return {applied,message:applied?'캘린더 반영 완료':reflectionError||'캘린더 반영 대기'};
        },
        openRoutineSwap(id,day){calls.swaps.push({id,date:day});return true;}
      };
    }
  };
}
const trainingValues=session=>session.exercises.map(ex=>({name:ex.name,notes:ex.notes,sets:ex.sets.map(set=>({weight:set.weight,reps:set.reps,warmup:set.warmup,done:set.done}))}));

test('choosing a scheduled date is read-only and starting its workout preserves the exact planned sets',()=>{
  const fixture=scheduledFixture({date:'2026-11-23'}),before=JSON.stringify(fixture.calendar),view=ui({bridge:fixture.bridge});
  view.api.open('home');
  const date=view.host.querySelector('#fi-calendar-date');assert.ok(date,'scheduled-workout date control exists');
  date.value=fixture.date;view.host.emit('change',{target:date});
  assert.equal(view.snapshot().sessions.length,0);assert.equal(view.writes.length,0);assert.ok(fixture.calls.queries.includes(fixture.date));
  view.action('begin-calendar',{id:fixture.eventId,date:fixture.date});
  const session=active(view),plan=C.dayEvents(fixture.calendar,fixture.date)[0];
  assert.ok(session);assert.equal(session.label,plan.title);assert.equal(session.date,fixture.date);
  assert.equal(session.calendarSource.eventId,fixture.eventId);assert.equal(session.calendarSource.date,fixture.date);
  assert.equal(session.calendarSource.baseline,view.root.FormdayCalendarWorkouts.signature(plan));
  assert.deepEqual(trainingValues(session),trainingValues(plan.detail));assert.equal(session.notes,plan.detail.notes);
  assert.deepEqual(session.exercises.map(ex=>ex.sets.length),[2,4]);assert.equal(session.exercises.flatMap(ex=>ex.sets).some(set=>set.done),false);
  assert.equal(view.field(0,1,'kg').value,'67.5');assert.equal(view.field(1,2,'reps').value,'5');
  assert.equal(view.snapshot().routines.length,0);assert.equal(JSON.stringify(fixture.calendar),before);
  assert.deepEqual(fixture.calls.prepares,[{id:fixture.eventId,date:fixture.date}]);assert.equal(fixture.calls.reflections.length,0);
});

test('opening the same calendar workout resumes its paused session and rest timer without duplicating or resetting edits',()=>{
  const fixture=scheduledFixture(),view=ui({bridge:fixture.bridge});
  view.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  const id=active(view).id;
  view.edit(0,1,'kg',72.5);view.edit(1,3,'reps',12);view.edit(0,1,'rest',60);view.complete(0,1);view.advance(10000);
  assert.equal(view.timer(),'00:50');view.action('pause');
  assert.equal(active(view).status,'PAUSED');view.advance(30000);assert.equal(view.timer(),'00:50');view.api.open('home');
  view.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  const resumed=active(view);
  assert.equal(resumed.id,id);assert.equal(resumed.status,'ACTIVE');assert.equal(view.snapshot().sessions.length,1);
  assert.equal(resumed.exercises[0].sets[1].weight,72.5);assert.equal(resumed.exercises[0].sets[1].done,true);assert.equal(resumed.exercises[1].sets[3].reps,12);
  assert.equal(fixture.calls.prepares.length,1);assert.equal(fixture.calls.reflections.length,0);
  assert.equal(view.sheet()?.open,true);
  assert.equal(view.timer(),'00:50');view.advance(10000);assert.equal(view.timer(),'00:40');
});

test('a linked active workout stashed by a full reload resumes from SAVED with the same recorded sets',()=>{
  const fixture=scheduledFixture(),view=ui({bridge:fixture.bridge});
  view.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  view.edit(0,1,'kg',75);view.edit(1,2,'reps',9);view.complete(0,1);
  const original=active(view);assert.equal(original.status,'ACTIVE');
  const reloaded=ui({storage:new Map(view.db),bridge:fixture.bridge}),stashed=active(reloaded);
  assert.equal(stashed.status,'SAVED');assert.equal(stashed.id,original.id);
  assert.deepEqual(trainingValues(stashed),trainingValues(original));
  assert.equal(JSON.parse(reloaded.db.get(reloaded.root.FormdayIronStore.KEY)).sessions[0].status,'SAVED');
  reloaded.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  const resumed=active(reloaded);
  assert.equal(resumed.status,'ACTIVE');assert.equal(resumed.id,original.id);assert.equal(reloaded.snapshot().sessions.length,1);
  assert.equal(resumed.date,original.date);assert.deepEqual(resumed.calendarSource,original.calendarSource);
  assert.deepEqual(trainingValues(resumed),trainingValues(original));assert.equal(resumed.notes,original.notes);
  assert.equal(reloaded.field(0,1,'kg').value,'75');assert.equal(reloaded.field(1,2,'reps').value,'9');
  assert.equal(reloaded.sheet()?.open,true);assert.equal(fixture.calls.prepares.length,1);assert.equal(fixture.calls.reflections.length,0);
});

test('a calendar reflection failure keeps the finalized workout durable and retries explicitly without finalizing it again',()=>{
  const fixture=scheduledFixture({reflectionError:'캘린더 저장 공간이 부족합니다.'}),before=JSON.stringify(fixture.calendar);
  const view=ui({bridge:fixture.bridge});view.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  view.edit(0,1,'kg',71.5);view.complete(0,1);view.edit(1,3,'reps',12);view.advance(12000);
  view.answers.push(true);view.action('partial');
  const finished=view.snapshot().sessions[0],key=view.root.FormdayIronStore.KEY;
  assert.equal(finished.status,'PARTIAL');assert.equal(active(view),undefined);
  assert.equal(finished.exercises[0].sets[1].weight,71.5);assert.equal(finished.exercises[1].sets[3].reps,12);
  assert.equal(fixture.calls.reflections.length,1);assert.deepEqual(fixture.calls.reflections[0].persisted,finished,'the complete actual record was saved before the calendar was called');
  assert.equal(JSON.stringify(fixture.calendar),before);assert.ok(view.host.querySelector('[data-fi-action="retry-calendar"][data-id="'+finished.id+'"]'));

  const reloaded=ui({storage:new Map(view.db),bridge:fixture.bridge});
  assert.equal(fixture.calls.reflections.length,1,'loading persisted history never reapplies a calendar record automatically');
  reloaded.api.open('history');assert.deepEqual(reloaded.snapshot().sessions[0],finished);
  const persistedBeforeRetry=reloaded.db.get(key);fixture.reflectionError=null;
  reloaded.advance(60000);reloaded.action('retry-calendar',{id:finished.id});
  assert.equal(fixture.calls.reflections.length,2);assert.deepEqual(fixture.calls.reflections[1].session,finished);
  assert.equal(reloaded.db.get(key),persistedBeforeRetry,'retry must not run finish or rewrite the durable session');
  assert.equal(reloaded.writes.filter(([writtenKey])=>writtenKey===key).length,0);
  assert.deepEqual(reloaded.snapshot().sessions[0],finished);
  const reflected=C.dayEvents(fixture.calendar,fixture.date)[0];
  assert.equal(reflected.workoutSessionId,finished.id);assert.deepEqual(trainingValues(reflected.detail),trainingValues(finished));
  assert.equal(reloaded.host.querySelector('[data-fi-action="retry-calendar"][data-id="'+finished.id+'"]'),null);
  reloaded.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});
  assert.equal(reloaded.snapshot().sessions.length,1);assert.equal(active(reloaded),undefined);assert.notEqual(reloaded.document.body.dataset.fiSession,'true');
  assert.equal(fixture.calls.reflections.length,2);
});

test('failure to save a completed calendar workout never sends an unpersisted result to the calendar',()=>{
  const fixture=scheduledFixture(),before=JSON.stringify(fixture.calendar),view=ui({bridge:fixture.bridge});
  view.api.open('calendar',{eventId:fixture.eventId,date:fixture.date});view.complete(0,1);
  const id=active(view).id;view.failStorage();view.answers.push(true,false);view.action('finish');
  assert.equal(active(view).id,id);assert.equal(active(view).status,'ACTIVE');
  assert.equal(JSON.parse(view.db.get(view.root.FormdayIronStore.KEY)).sessions[0].status,'ACTIVE');
  assert.equal(fixture.calls.reflections.length,0);assert.equal(JSON.stringify(fixture.calendar),before);
  view.failStorage(false);view.answers.length=0;view.answers.push(true,false);view.action('finish');
  assert.equal(view.snapshot().sessions[0].status,'PARTIAL');assert.equal(fixture.calls.reflections.length,1);
  assert.equal(fixture.calls.reflections[0].persisted.status,'PARTIAL');assert.equal(C.dayEvents(fixture.calendar,fixture.date)[0].workoutSessionId,id);
  assert.equal(C.dayEvents(fixture.calendar,fixture.date)[0].completed,false);
});

test('calendar routine-swap controls delegate the selected event and date without editing stored routines or starting a session',()=>{
  const fixture=scheduledFixture(),view=ui({bridge:fixture.bridge,initialState:M=>M.createRoutine(M.empty(),'보관한 하체 루틴',[M.newExercise('스쿼트')]).next});
  const stored=view.db.get(view.root.FormdayIronStore.KEY),before=JSON.stringify(view.snapshot()),calendarBefore=JSON.stringify(fixture.calendar);
  view.api.open('home');view.action('swap-calendar',{id:fixture.eventId,date:fixture.date});
  assert.deepEqual(fixture.calls.swaps,[{id:fixture.eventId,date:fixture.date}]);
  view.api.open('calendar-swap',{eventId:fixture.eventId,date:fixture.date});
  assert.deepEqual(fixture.calls.swaps,[{id:fixture.eventId,date:fixture.date},{id:fixture.eventId,date:fixture.date}]);
  assert.equal(JSON.stringify(view.snapshot()),before);assert.equal(view.db.get(view.root.FormdayIronStore.KEY),stored);assert.equal(view.writes.length,0);
  assert.equal(JSON.stringify(fixture.calendar),calendarBefore);assert.equal(fixture.calls.prepares.length,0);assert.equal(fixture.calls.reflections.length,0);
});

test('the calendar snapshot rejects a newer stored session before a cross-tab storage event is delivered',()=>{
  const fixture=scheduledFixture(),view=ui({bridge:fixture.bridge}),M=view.root.FormdayIronStore;
  const before=view.snapshot();assert.deepEqual(JSON.parse(JSON.stringify(view.api.getCalendarSnapshot())),before);
  const plan=view.root.FormdayCalendarWorkouts.prepareStart(C,fixture.calendar,fixture.eventId,fixture.date);
  M.createStore(view.root.localStorage).save(M.startCalendar(before,plan).next,before.revision);
  const newerBytes=view.db.get(M.KEY),writes=view.writes.length;
  assert.equal(JSON.parse(newerBytes).sessions.length,1);
  // Deliberately omit the storage event: the reader must inspect the revision.
  assert.throws(()=>view.api.getCalendarSnapshot(),/다른 탭|최신 기록/);
  assert.deepEqual(view.snapshot(),before);assert.equal(view.db.get(M.KEY),newerBytes);assert.equal(view.writes.length,writes);
  assert.equal(fixture.calls.swaps.length,0);assert.equal(fixture.calls.reflections.length,0);
});

test('an open calendar routine chooser blocks cloud apply and reload until the chooser closes',()=>{
  const fixture=scheduledFixture();let swapOpen=false;
  const view=ui({bridge:environment=>({...fixture.bridge(environment),isRoutineSwapOpen:()=>swapOpen})}),M=view.root.FormdayIronStore;
  const before=view.snapshot();assert.equal(view.api.canCloudApply(),true);
  const incoming=M.createRoutine(before,'다른 기기의 루틴',[M.newExercise('스쿼트')]).next;
  M.createStore(view.root.localStorage).save(incoming,before.revision);
  const stored=view.db.get(M.KEY),writes=view.writes.length;swapOpen=true;
  assert.equal(view.api.canCloudApply(),false);assert.equal(view.api.cloudReload(),false);
  assert.deepEqual(view.snapshot(),before);assert.equal(view.db.get(M.KEY),stored);assert.equal(view.writes.length,writes);
  swapOpen=false;assert.equal(view.api.canCloudApply(),true);assert.equal(view.api.cloudReload(),true);
  assert.equal(view.snapshot().routines[0].name,'다른 기기의 루틴');assert.equal(view.db.get(M.KEY),stored);assert.equal(view.writes.length,writes);
});
