'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const W=require('../fitplan/workouts.js');

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
    this.style={setProperty(){},removeProperty(){}};
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
      stack.at(-1).appendChild(child);if(!['input','img','br','hr','meta','link','source','wbr'].includes(tag))stack.push(child);
    }
  }
}
function ui(){
  let now=Date.parse('2026-11-24T02:00:00.000Z');
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const document=new Events();document.hidden=false;document.body=new Element('body',document);document.body.dataset.fdScreen='home';
  document.createElement=tag=>new Element(tag,document);document.querySelector=s=>document.body.querySelector(s);document.querySelectorAll=s=>document.body.querySelectorAll(s);document.getElementById=id=>document.querySelector('#'+id);
  const main=document.body.appendChild(new Element('main',document));main.setAttribute('id','main-content');
  const host=main.appendChild(new Element('div',document));host.setAttribute('id','fd-ind-root');
  const calendar=main.appendChild(new Element('div',document));calendar.setAttribute('id','fd-iron-calendar');
  const db=new Map(),root=new Events(),intervals=[],timeouts=new Map();let failWrite=false,picker=null,pickerActive=false,timeoutId=0;
  root.localStorage={getItem:key=>db.get(key)??null,setItem:(key,value)=>{if(failWrite&&key==='formday_iron_independent_v1')throw Error('quota');db.set(key,value);},removeItem:key=>db.delete(key)};
  root.FormdayWorkouts=W;root.FormdayExerciseMedia={byName:{'벤치프레스':{src:'assets/exercises/bench.svg',alt:'벤치프레스 동작'},'스쿼트':{src:'assets/exercises/squat.svg',alt:'스쿼트 동작'}}};
  root.innerHeight=844;root.visualViewport=new Events();root.visualViewport.height=844;root.visualViewport.offsetTop=0;
  root.setInterval=fn=>{intervals.push(fn);return intervals.length;};root.clearInterval=()=>{};root.requestAnimationFrame=fn=>fn();root.dispatchEvent=event=>root.emit(event.type,event);
  root.setTimeout=(fn,delay=0)=>{timeouts.set(++timeoutId,{fn,at:now+delay});return timeoutId;};root.clearTimeout=id=>timeouts.delete(id);root.scrollTo=()=>{};
  const answers=[],prompts=[];root.confirm=text=>{prompts.push(text);return answers.shift()??false;};root.prompt=()=>null;
  root.FormdayExercisePicker={isOpen:()=>pickerActive,open:config=>{picker=config;pickerActive=true;return true;}};
  const context=vm.createContext({window:root,document,Date:Clock,console,setTimeout:root.setTimeout,clearTimeout:root.clearTimeout,CustomEvent:class{constructor(type){this.type=type;}}});
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron-store.js'),'utf8'),context);root.FormdayIronStore=context.FormdayIronStore;
  vm.runInContext(fs.readFileSync(require.resolve('../fitplan/iron-independent.js'),'utf8'),context);
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
  return {api,root,document,host,db,answers,prompts,snapshot,action,choose,row,field,edit,complete,start,sheet:()=>host.querySelector('#fi-session-sheet'),
    get picker(){return picker;},get pickerActive(){return pickerActive;},failStorage(value=true){failWrite=value;},
    advance(ms){now+=ms;for(const [id,item]of [...timeouts])if(item.at<=now){timeouts.delete(id);item.fn();}for(const fn of intervals)fn();},hide(){document.hidden=true;document.emit('visibilitychange');},show(){document.hidden=false;document.emit('visibilitychange');},
    timer(){return host.querySelector('#fi-timer-number')?.textContent;}};
}
const active=view=>view.snapshot().sessions.find(s=>['ACTIVE','PAUSED','SAVED'].includes(s.status));

test('checking one set preserves all visible weights, repetitions and notes without completing other sets',()=>{
  const view=ui();view.start();
  view.edit(0,0,'kg',62.5);view.edit(0,0,'reps',8);view.edit(1,1,'kg',90);view.edit(1,1,'reps',6);
  const sessionNote=view.host.querySelector('#fi-session-note');assert.ok(sessionNote);sessionNote.value='오늘은 천천히';
  const ex=active(view).exercises[1],exerciseNote=view.host.querySelector('[data-fi-ex-note="'+ex.id+'"]');assert.ok(exerciseNote);exerciseNote.value='무릎 위치 확인';
  view.complete(0);
  const saved=active(view);assert.equal(saved.notes,'오늘은 천천히');assert.equal(saved.exercises[1].notes,'무릎 위치 확인');
  assert.equal(saved.exercises[0].sets[0].weight,62.5);assert.equal(saved.exercises[0].sets[0].reps,8);assert.equal(saved.exercises[0].sets[0].done,true);
  assert.equal(saved.exercises[1].sets[1].weight,90);assert.equal(saved.exercises[1].sets[1].reps,6);assert.equal(saved.exercises[1].sets[1].done,false);
  assert.equal(saved.exercises.flatMap(x=>x.sets).filter(x=>x.done).length,1);
});
test('numeric change saves without replacing the field or turning it into a completed set',()=>{
  const view=ui();view.start();const input=view.edit(0,0,'kg',72.5),rendered=view.host.renderCount;
  view.host.emit('change',{target:input});
  assert.equal(view.field(0,0,'kg'),input);assert.equal(view.host.renderCount,rendered);assert.equal(active(view).exercises[0].sets[0].weight,72.5);assert.equal(active(view).exercises[0].sets[0].done,false);
  view.complete(0);assert.equal(active(view).exercises[0].sets[0].done,true);
});
test('storage failure keeps edited values and completion state available for a successful retry',()=>{
  const view=ui();view.start();const original=JSON.stringify(view.snapshot()),input=view.edit(0,0,'kg',77.5),rendered=view.host.renderCount;
  view.failStorage();view.complete(0);
  assert.equal(JSON.stringify(view.snapshot()),original);assert.equal(view.host.renderCount,rendered);assert.equal(view.field(0,0,'kg'),input);assert.equal(input.value,'77.5');
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
  assert.match(view.timer()||'',/40|0:40/);
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
  const view=ui();view.start();view.edit(0,0,'kg',80);view.edit(0,0,'reps',5);view.complete(0);view.edit(0,0,'kg',82.5);view.answers.push(true,false);view.action('finish');
  assert.equal(active(view),undefined);assert.notEqual(view.document.body.dataset.fiSession,'true');const saved=view.snapshot().sessions[0];assert.equal(saved.status,'COMPLETED');assert.equal(saved.exercises[0].sets[0].weight,82.5);assert.equal(saved.exercises[0].sets[0].reps,5);
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
  view.advance(5000);assert.equal(view.host.querySelector('#fi-duration').textContent,'00:00:13');assert.equal(view.timer(),'0:47');
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
