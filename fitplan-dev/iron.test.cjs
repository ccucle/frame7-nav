'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const C=require('../fitplan/core.js');
const W=require('../fitplan/workouts.js');
const D=require('../fitplan/iron-data.js');
const read=filename=>fs.readFileSync(path.join(__dirname,'../fitplan',filename),'utf8');

function sample(id,date,name,kg,reps,isSample=false,warmup=false){
  return {id,date,start:'07:00',end:'08:00',type:'strength',title:'테스트 루틴',
    repeat:'none',completed:true,isSample,
    detail:{exercises:[{id:'exercise-'+id,name,sets:[{
      id:'set-'+id,weight:kg,reps,done:true,rpe:8,warmup
    }]}]}}
}
const fixture=()=>C.normalizeState({events:[
  sample('a','2026-11-23','벤치프레스',60,10),
  sample('b','2026-11-25','스쿼트',100,5),
  sample('c','2026-11-25','벤치프레스',500,1,true),
  {id:'weight',date:'2026-11-25',start:'06:00',end:'06:05',type:'weight',
    title:'체중',repeat:'none',completed:true,detail:{weight:80.5,bodyfat:null}}
],settings:{protein:150,carbs:200,fat:50}});
test('catalog contains existing trusted workout names and supports muscle filtering',()=>{
  const catalog=D.all(W.catalog);
  assert.ok(catalog.length>=60);
  assert.equal(D.info('벤치프레스',W.catalog).group,'가슴');
  assert.equal(D.info('벤치프레스',W.catalog).equipment,'바벨');
  assert.ok(catalog.some(x=>x.group==='등'&&x.equipment==='케이블'));
});
test('the current week includes real records but excludes all demo records',()=>{
  const a=D.analytics(C,W,fixture(),new Date(2026,10,25));
  assert.equal(a.trainingDays,2);
  assert.equal(a.totalVolume,1100);
  assert.deepEqual(a.byGroup,{가슴:600,하체:500});
  assert.equal(a.weight,80.5);
  assert.ok(a.bestPR.oneRM<200);
  assert.equal(a.currentWorkout.length,1);
});
test('estimated 1RM uses completed non-warmup 1–10-repetition sets only',()=>{
  const base=fixture();
  base.events.push(sample('warm','2026-11-25','스쿼트',1000,1,false,true));
  const a=D.analytics(C,W,C.normalizeState(base),new Date(2026,10,25));
  assert.ok(Math.abs(a.prMap.get('스쿼트').oneRM-(100*(1+5/30)))<0.000001);
  assert.equal(a.byGroup['하체'],500);
});
test('a week without completed training yields genuine empty-state figures',()=>{
  const state=C.normalizeState({events:[],settings:{protein:150,carbs:200,fat:50}});
  const a=D.analytics(C,W,state,new Date(2026,10,25));
  assert.equal(a.trainingDays,0);
  assert.equal(a.bestPR,null);
  assert.equal(a.weight,null);
  assert.equal(a.totalVolume,0);
});
test('iron UI uses existing record bridge, not new Firestore writes or paid APIs',()=>{
  const src=read('iron.js');
  assert.match(src,/FormdayBridge/);
  assert.match(src,/saveSet/);
  assert.doesNotMatch(src,/\b(?:getFirestore|setDoc|updateDoc|CloudFunctions|payment)\b/);
});
test('the visual redesign leaves local backup and Firebase login loading intact',()=>{
  const html=read('index.html');
  assert.match(html,/id="fd-iron-root"/);
  assert.match(html,/cloud-auth.js/);
  assert.match(html,/backup.js/);
  assert.match(html,/iron-data.js/);
  assert.match(html,/iron.js/);
  assert.match(html,/id="new-event"/);
  assert.match(html,/data-fd-route="calendar"/);
});

function independentSession(id,date,kg=60,reps=10,overrides={}){
  return {id,date,status:'COMPLETED',label:'독립 운동',startedAt:date+'T07:00:00Z',
    endedAt:date+'T08:00:00Z',exercises:sample(id,date,'벤치프레스',kg,reps).detail.exercises,...overrides};
}
const independentState=(...sessions)=>({version:1,routines:[],programs:[],sessions});

test('legacy and finalized independent workouts share weekly volume, main sets, training days and PRs without writes',()=>{
  const state=C.normalizeState({events:[sample('legacy','2026-11-23','벤치프레스',60,10)],settings:C.defaults});
  const partial=independentSession('partial','2026-11-24',100,5,{status:'PARTIAL'});
  partial.exercises[0].name='스쿼트';
  partial.exercises[0].sets.push({id:'not-done',weight:999,reps:10,done:false,warmup:false});
  const independent=independentState(independentSession('same-day','2026-11-23',30,8),partial);
  const original=JSON.stringify({state,independent});
  const a=D.analytics(C,W,state,new Date(2026,10,25),independent);
  assert.equal(a.trainingDays,2);
  assert.equal(a.strengthSessions,3);
  assert.equal(a.completedSets,3);
  assert.equal(a.totalVolume,1340);
  assert.deepEqual(a.byGroup,{가슴:840,하체:500});
  assert.equal(a.prMap.get('벤치프레스').oneRM,80);
  assert.equal(a.bestPR.name,'스쿼트');
  assert.equal(JSON.stringify({state,independent}),original);
});

test('unfinished sessions, routine goals, samples, warmup-only and future records cannot inflate actual metrics',()=>{
  const state=C.normalizeState({events:[
    sample('future','2026-11-26','스쿼트',2000,1),
    sample('demo','2026-11-25','벤치프레스',1000,1,true),
    sample('warmup','2026-11-25','스쿼트',1000,1,false,true)
  ],settings:C.defaults});
  const independent=independentState(
    ...['ACTIVE','PAUSED','SAVED'].map(status=>independentSession(status,'2026-11-25',500,1,{status})),
    independentSession('future','2026-11-26',2000,1),
    independentSession('demo','2026-11-25',2000,1,{isSample:true}),
    independentSession('warm','2026-11-25',1000,1,{exercises:sample('warm','2026-11-25','스쿼트',1000,1,false,true).detail.exercises})
  );
  independent.routines.push({id:'goal',name:'루틴 목표',exercises:sample('goal','2026-11-25','스쿼트',999,10).detail.exercises});
  const a=D.analytics(C,W,state,new Date(2026,10,25),independent);
  assert.equal(a.trainingDays,0);
  assert.equal(a.strengthSessions,0);
  assert.equal(a.completedSets,0);
  assert.equal(a.totalVolume,0);
  assert.equal(a.bestPR,null);
  assert.equal(a.currentWorkout.some(e=>e.isSample),false);
});

test('the same independent session is counted once while distinct storage identities remain separate',()=>{
  const state=C.normalizeState({events:[sample('same-id','2026-11-25','벤치프레스',60,10)],settings:C.defaults});
  const session=independentSession('same-id','2026-11-25');
  const independent=independentState(session,structuredClone(session));
  const a=D.analytics(C,W,state,new Date(2026,10,25),independent);
  assert.equal(a.trainingDays,1);
  assert.equal(a.strengthSessions,2);
  assert.equal(a.completedSets,2);
  assert.equal(a.totalVolume,1200);
  const day=D.daySummary(C,state,independent,'2026-11-25',new Date(2026,10,25));
  assert.equal(day.workoutCount,2);
  assert.equal(day.completedWorkouts,2);
  assert.equal(day.volume,1200);
});

test('calendar daily totals include partial independent workouts and exclude warmups from both sides of the set ratio',()=>{
  const state=C.normalizeState({events:[sample('legacy','2026-11-25','벤치프레스',60,10),
    {id:'cardio',type:'cardio',date:'2026-11-25',start:'09:00',end:'09:30',title:'러닝',repeat:'none',completed:true,
      detail:{cardio:'러닝',minutes:30,distance:5,intensity:'보통'}}],settings:C.defaults});
  const partial=independentSession('partial','2026-11-25',40,10,{status:'PARTIAL'});
  partial.exercises[0].sets.push({id:'warmup',weight:1000,reps:1,done:true,warmup:true},{id:'planned',weight:80,reps:10,done:false,warmup:false});
  const day=D.daySummary(C,state,independentState(partial,independentSession('active','2026-11-25',500,1,{status:'ACTIVE'})),'2026-11-25',new Date(2026,10,25));
  assert.deepEqual(day,{workoutCount:3,completedWorkouts:3,strengthSessions:2,cardioSessions:1,setCount:3,completedSets:2,volume:1000});
  const future=D.daySummary(C,state,independentState(partial),'2026-11-25',new Date(2026,10,24));
  assert.equal(future.completedWorkouts,0);
  assert.equal(future.completedSets,0);
  assert.equal(future.volume,0);
});

// A small render/navigation adapter exercises the actual dashboard script.
// It intentionally does not simulate layout or persistence.
function bootDashboard(independent){
  const listeners=new Map(),docListeners=new Map();
  const classes=initial=>({items:new Set(initial||[]),toggle(name,on){if(on)this.items.add(name);else this.items.delete(name);},remove(...names){names.forEach(n=>this.items.delete(n));},contains(name){return this.items.has(name);}});
  const button=(dataset,initial)=>({dataset,disabled:false,attrs:{},classList:classes(initial),setAttribute(k,v){this.attrs[k]=v;},closest(){return this;}});
  const routes=[button({fdRoute:'home'}),button({fdRoute:'analysis'}),button({fdRoute:'calendar'})];
  const oldNav=button({go:'calendar'},['active']),indNav=button({indNav:'routines'},['fd-current','active']);
  const node={innerHTML:'',addEventListener(){},querySelector(){return null;}};
  const body={dataset:{}};
  const title={},sub={},crumb={firstChild:{textContent:''}},main={scrollIntoView(){}};
  const document={body,getElementById:id=>id==='fd-iron-root'?node:null,
    querySelector:s=>({'.page-title':title,'.page-sub':sub,'.crumb':crumb,'#main-content':main}[s]||null),
    querySelectorAll:s=>({'[data-fd-route]':routes,'[data-go]':[oldNav],'[data-ind-nav]':[indNav]}[s]||[]),
    addEventListener(type,fn){docListeners.set(type,fn);}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[2026,10,25,12]));}}
  let snapshot=independent,allowNavigation=true,navigationChecks=0;
  const context=vm.createContext({document,Date:FixedDate,FormdayCore:C,FormdayWorkouts:W,FormdayIronData:D,
    FormdayBridge:{getState:()=>C.normalizeState({events:[],settings:C.defaults}),getVisibleTypes:()=>['strength','cardio','meal','weight']},
    FormdayIndependent:{getSnapshot:()=>snapshot,beforeNavigate(){navigationChecks++;return allowNavigation;},open(){}},
    addEventListener(type,fn){listeners.set(type,fn);},setInterval(){}});
  context.window=context;
  vm.runInContext(read('iron.js'),context,{filename:'iron.js'});
  return {node,body,routes,oldNav,indNav,emit:type=>listeners.get(type)?.(),
    setSnapshot(value){snapshot=value;},allowNavigation(value){allowNavigation=value;},
    navigationChecks:()=>navigationChecks,
    click(target){docListeners.get('click')({target,preventDefault(){}});},
    navigate(route){docListeners.get('click')({target:routes.find(x=>x.dataset.fdRoute===route),preventDefault(){}});}};
}

test('independent record changes refresh dashboard values but focus and data updates preserve an open independent editor',()=>{
  const app=bootDashboard(independentState());
  assert.equal(app.oldNav.classList.contains('active'),false);
  assert.equal(app.indNav.classList.contains('fd-current'),false);
  app.setSnapshot(independentState(independentSession('done','2026-11-25')));
  app.emit('formday:iron-changed');
  assert.match(app.node.innerHTML,/600 <small>kg<\/small>/);
  const rendered=app.node.innerHTML;
  app.body.dataset.fdScreen='independent';
  app.emit('focus');app.emit('formday:changed');app.emit('formday:iron-changed');
  assert.equal(app.body.dataset.fdScreen,'independent');
  assert.equal(app.node.innerHTML,rendered);
  app.allowNavigation(false);app.navigate('analysis');
  assert.equal(app.body.dataset.fdScreen,'independent');
  app.allowNavigation(true);app.navigate('analysis');
  assert.equal(app.body.dataset.fdScreen,'analysis');
  assert.match(app.node.innerHTML,/기록한 웨이트/);
});

test('dashboard resumes unfinished training before suggesting saved routine goals',()=>{
  const pending=independentSession('paused','2026-11-24',100,10,{status:'PAUSED',label:'어제 시작한 운동'});
  const independent=independentState(pending);
  independent.routines=[{id:'r',name:'상체 루틴',exercises:[]}];
  const app=bootDashboard(independent);
  assert.match(app.node.innerHTML,/어제 시작한 운동/);
  assert.match(app.node.innerHTML,/운동 이어하기/);
  independent.sessions=[];app.emit('formday:iron-changed');
  assert.match(app.node.innerHTML,/저장한 루틴으로 시작/);
  assert.match(app.node.innerHTML,/data-fd-action="choose-routine"/);
});

test('a detached mini-calendar date still uses the draft guard and opens the calendar after approval',()=>{
  const app=bootDashboard(independentState());
  app.body.dataset.fdScreen='independent';
  const rendered=app.node.innerHTML;
  // This is the target after app.js has chosen the date and replaced its
  // mini-calendar: the date itself remains, but there is no .mini-cal ancestor.
  const dateTarget={dataset:{mini:'2026-11-24'},isConnected:false,
    closest(selector){return selector==='[data-mini]'?this:null;}};
  app.allowNavigation(false);app.click(dateTarget);
  assert.equal(app.navigationChecks(),1);
  assert.equal(app.body.dataset.fdScreen,'independent');
  assert.equal(app.node.innerHTML,rendered);
  app.allowNavigation(true);app.click(dateTarget);
  assert.equal(app.navigationChecks(),2);
  assert.equal(app.body.dataset.fdScreen,'calendar');
  assert.equal(app.oldNav.classList.contains('active'),true);
  assert.equal(dateTarget.dataset.mini,'2026-11-24');
});
