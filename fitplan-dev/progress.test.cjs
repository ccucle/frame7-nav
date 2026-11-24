'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../fitplan/core.js');
const N=require('../fitplan/nutrition.js');
const D=require('../fitplan/progress-data.js');
const V=require('../fitplan/progress.js');
const today='2026-11-24';
const settings={protein:150,carbs:200,fat:50};
const stateOf=(events=[],extra={})=>C.normalizeState({events,settings:{...settings,...extra}});
const weight=(id,date,value,start='07:00',extra={})=>({id,date,start,end:start.slice(0,3)+'59',type:'weight',title:'체중',repeat:'none',completed:true,detail:{weight:value},...extra});
const food=(id,kcal)=>N.validateFood({id,name:'기록 식품',nameEn:'',brand:'',category:'',basisAmount:100,basisUnit:'g',
  nutrients:{kcal,protein:0,carbs:0,fat:0,unsat:null},source:{kind:kcal===null?'unknown':'user'}});
const meal=(id,date,values,extra={})=>({id,date,start:'12:00',end:'12:30',type:'meal',title:'식사',repeat:'none',completed:true,
  detail:{items:values.map((kcal,i)=>({id:id+'-item'+i,food:food(id+'-food'+i,kcal),amount:100})),notes:''},...extra});
const build=(state,range='7')=>D.build(C,N,state,{range,today});

test('daily weight selects the last time with a stable ID tie-breaker and excludes sample, unfinished and future measurements',()=>{
  const events=[weight('am','2026-11-20',80),weight('z-last','2026-11-20',78,'18:00'),weight('a-earlier','2026-11-20',79,'18:00'),
    weight('later','2026-11-22',77),weight('demo',today,50,'20:00',{isSample:true}),
    weight('not-done',today,65,'21:00',{completed:false}),weight('future','2026-11-25',40)];
  const state=stateOf(events),before=JSON.stringify(state),model=build(state);
  assert.equal(model.daily.length,2);
  assert.equal(model.daily[0].weight,78);
  assert.equal(model.daily[0].weightTime,'18:00');
  assert.equal(model.daily[0].weightCount,3);
  assert.equal(model.summary.latestWeight.weight,77);
  assert.equal(model.summary.weightChange,-1);
  assert.equal(build(stateOf(events.slice().reverse())).daily[0].weight,78);
  assert.equal(JSON.stringify(state),before);
});

test('calorie totals and recorded-day averages preserve real zero, unknown and missing days as different states',()=>{
  const state=stateOf([
    meal('one','2026-11-20',[100]),meal('two','2026-11-20',[200]),meal('zero','2026-11-21',[0]),
    meal('unknown','2026-11-22',[null]),meal('planned','2026-11-23',[500],{completed:false}),
    meal('partial',today,[50,null]),meal('demo',today,[9999],{isSample:true}),meal('future','2026-11-25',[9999])
  ]);
  const model=build(state),day=date=>model.buckets.find(b=>b.start===date);
  assert.equal(day('2026-11-20').kcal,300);
  assert.equal(day('2026-11-21').kcal,0);
  assert.equal(day('2026-11-22').kcal,null);
  assert.equal(day('2026-11-22').mealCount,1);
  assert.equal(day('2026-11-23').kcal,null);
  assert.equal(day('2026-11-23').mealCount,0);
  assert.equal(day(today).kcal,50);
  assert.equal(day(today).partialKcalDays,1);
  assert.equal(model.summary.averageKcal,116.67);
  assert.equal(model.summary.knownCalorieDays,3);
  assert.equal(model.summary.mealDays,4);
  assert.equal(model.summary.partialCalorieDays,2);
  assert.equal(model.targets.kcal,1850);
});

test('repeating plans are never expanded into measurements or consumed calories without saved actual occurrences',()=>{
  let state=stateOf([weight('daily-weight','2026-11-01',80,'07:00',{repeat:'daily'}),meal('daily-meal','2026-11-01',[500],{repeat:'daily'})]);
  assert.equal(build(state,'all').daily.length,0);
  const actual=C.occurrence(state.events.find(e=>e.id==='daily-meal'),'2026-11-22');
  actual.completed=true;
  state=C.upsert(state,actual,{scope:'occurrence',occurrenceDate:'2026-11-22'});
  const model=build(state,'all');
  assert.equal(model.daily.length,1);
  assert.equal(model.daily[0].date,'2026-11-22');
  assert.equal(model.daily[0].kcal,500);
  assert.equal(model.start,'2026-11-22');
});

test('7, 30 and 90 day ranges end today and use a linear calendar-day scale through leap and daylight-saving dates',()=>{
  for(const range of ['7','30','90']){
    const model=build(stateOf(),range);
    assert.equal(model.dayCount,Number(range));
    assert.equal(model.buckets.length,Number(range));
    assert.equal(model.buckets.at(-1).end,today);
    assert.ok(model.buckets.every(b=>b.weight===null&&b.kcal===null));
  }
  assert.equal(D.dayNumber('2024-03-01')-D.dayNumber('2024-02-28'),2);
  assert.equal(D.dayNumber('2026-03-09')-D.dayNumber('2026-03-07'),2);
  const model=D.build(C,N,stateOf(),{range:'7',today:'2024-03-02'});
  assert.ok(model.buckets.some(bin=>bin.start==='2024-02-29'));
  const g=V.geometry(model,'weight',320);
  const gaps=g.points.slice(1).map((p,i)=>p.x-g.points[i].x);
  assert.ok(gaps.every(gap=>Math.abs(gap-gaps[0])<1e-9));
});

test('long all-time charts include every day and every recorded value in explicitly labeled mean buckets',()=>{
  const first=D.dayNumber(today)-399,events=[];
  for(let i=0;i<400;i++){
    const date=D.dateAt(first+i);
    events.push(weight('w'+i,date,80+i/100));
    if(i%2===0)events.push(meal('m'+i,date,[1000+i]));
  }
  const model=build(stateOf(events),'all');
  assert.equal(model.dayCount,400);
  assert.equal(model.bucketDays,4);
  assert.equal(model.buckets.length,100);
  assert.equal(model.buckets[0].start,D.dateAt(first));
  assert.equal(model.buckets.at(-1).end,today);
  assert.equal(model.buckets.reduce((sum,b)=>sum+b.days,0),400);
  assert.equal(model.buckets.reduce((sum,b)=>sum+b.weightDays,0),400);
  assert.equal(model.buckets.reduce((sum,b)=>sum+b.kcalDays,0),200);
  assert.equal(model.daily.length,400);
  assert.equal(model.buckets[0].weight,80.02);
  assert.equal(model.buckets[0].kcal,1001);
  const markup=V.pageMarkup(model,{width:390});
  assert.match(markup,/모든 날짜를 빠짐없이 4일 구간/);
  assert.match(markup,/원래 일별 수치/);
  assert.match(V.tableMarkup(model,19),/2025-10-21/);
});

test('current target weight and macro calorie goals do not fabricate measurements or a target when unset',()=>{
  const state=stateOf([weight('real',today,80)]);
  state.settings.targetWeight=75;
  const model=build(state);
  assert.equal(model.targets.weight,75);
  assert.equal(model.summary.weightToGoal,5);
  assert.equal(model.summary.weightChange,null);
  assert.match(V.chartMarkup(model,'weight',320,6),/fp-target-line/);
  assert.equal(build(stateOf()).targets.weight,null);
  assert.equal(build(stateOf()).summary.latestWeight,null);
  assert.match(V.pageMarkup(build(stateOf()),{width:320}),/목표 설정/);
});

test('missing dates split weight lines instead of interpolating across gaps and valid zero calories remain plotted',()=>{
  const model=build(stateOf([weight('a','2026-11-20',80),weight('b','2026-11-22',79),meal('zero',today,[0])]));
  const weightGeometry=V.geometry(model,'weight',320);
  assert.equal(weightGeometry.segments.length,2);
  assert.ok(weightGeometry.segments.every(segment=>segment.length===1));
  const calorieGeometry=V.geometry(model,'kcal',320);
  assert.equal(calorieGeometry.points.filter(p=>p.value!==null).length,1);
  assert.equal(calorieGeometry.points.at(-1).value,0);
  assert.match(V.chartMarkup(model,'kcal',320,6),/칼로리 0 kcal/);
});

test('SVG controls have keyboard names, pressed state, descriptions and an exact daily numeric table',()=>{
  const model=build(stateOf([weight('w',today,80),meal('m',today,[100,null])]));
  const html=V.pageMarkup(model,{width:320,selected:{weight:6,kcal:6}});
  assert.match(html,/role="group" aria-labelledby="fp-weight-svg-title fp-weight-svg-desc"/);
  assert.match(html,/role="button" tabindex="0" focusable="true" aria-pressed="true"/);
  assert.match(html,/aria-label="2026-11-24 체중 80 kg"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/<details class="fp-table-details"/);
  assert.match(html,/<caption>날짜별 실제 체중과 완료한 식사의 열량<\/caption>/);
  assert.match(html,/<th scope="row">2026-11-24/);
  assert.match(html,/100 kcal \+/);
  assert.match(html,/미기록일은 0으로 채우지 않으며/);
});

test('chart coordinates and hit targets fit phone and desktop layouts without changing the date range',()=>{
  const model=build(stateOf([weight('w',today,80),meal('m',today,[1500])]),'90');
  for(const width of [280,320,350,390,720,1120]){
    for(const metric of ['weight','kcal']){
      const g=V.geometry(model,metric,width);
      assert.equal(g.width,width);
      assert.equal(g.points.length,90);
      assert.ok(g.points.every(p=>p.x-12>=0&&p.x+12<=width));
      assert.ok(g.points.filter(p=>p.y!==null).every(p=>p.y>=g.top&&p.y<=g.baseline));
      assert.ok(g.ticks.length<=(width<520?3:5));
    }
  }
});

test('data refresh and keyboard selection update only the progress host, without changing screen or writing records',()=>{
  const state=stateOf([weight('a','2026-11-20',80),weight('b','2026-11-22',79)]),original=JSON.stringify(state);
  const events=new Map(),hostEvents=new Map(),detail={innerHTML:''};let renders=0,focuses=0,html='';
  const host={clientWidth:350,contains:()=>false,querySelectorAll:()=>[],
    querySelector(selector){if(selector==='details')return {open:false};if(selector.startsWith('#fp-'))return detail;if(selector.startsWith('[data-progress-point='))return {focus(){focuses++;}};return null;},
    addEventListener(name,fn){hostEvents.set(name,fn);},
    get innerHTML(){return html;},set innerHTML(value){html=value;renders++;}};
  const document={body:{dataset:{fdScreen:'home'}},activeElement:null,getElementById:id=>id==='fd-progress-root'?host:null,addEventListener(){}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[2026,10,24,12]));}}
  const root={Date:FixedDate,FormdayCore:C,FormdayNutrition:N,FormdayBridge:{getState:()=>state},addEventListener(name,fn){events.set(name,fn);},clearTimeout(){},setTimeout(){}};
  const api=V.mount(root,document);
  assert.equal(renders,0);
  api.render();assert.equal(document.body.dataset.fdScreen,'home');
  const previous=renders;events.get('formday:changed')();assert.equal(renders,previous);
  document.body.dataset.fdScreen='progress';events.get('formday:changed')();
  assert.ok(renders>previous);assert.equal(document.body.dataset.fdScreen,'progress');
  // Both fixture points are in the fixed 30-day window.
  const point={dataset:{progressMetric:'weight',progressIndex:'0'},closest:()=>point};
  let prevented=false;
  hostEvents.get('keydown')({target:point,key:'Home',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.ok(focuses>0);assert.match(detail.innerHTML,/2026-11-20/);
  assert.equal(JSON.stringify(state),original);
});

const A=require('../fitplan/iron-data.js');
const I=require('../fitplan/iron-store.js');
const W=require('../fitplan/workouts.js');
const K=require('../fitplan/calendar-workouts.js');
function trainingEvent(id,date,name,sets,extra={}){
 return {id,date,start:'07:00',end:'08:00',type:'strength',title:name,repeat:'none',completed:false,detail:{exercises:[{id:id+'-exercise',name,sets:sets.map((s,i)=>({id:id+'-set-'+i,rpe:null,warmup:false,done:true,...s})),notes:''}],notes:''},...extra};
}
const trainingBuild=(state,independent,range='7')=>D.buildTraining(C,W,A,state,independent,{range,today});
test('body-part charts aggregate actual main sets and kg times reps, not plans, warmups, samples or future dates',()=>{
 const events=[trainingEvent('chest',today,'벤치프레스',[{weight:60,reps:10},{weight:65,reps:8},{weight:20,reps:15,warmup:true},{weight:999,reps:10,done:false}]),
 trainingEvent('back','2026-11-23','랫풀다운',[{weight:40,reps:10}]),
 trainingEvent('body',today,'푸시업',[{weight:0,reps:20}]),
 trainingEvent('other',today,'사용자 운동',[{weight:10,reps:5}]),
 trainingEvent('sample',today,'스쿼트',[{weight:100,reps:10}],{isSample:true}),
 trainingEvent('future','2026-11-25','스쿼트',[{weight:100,reps:10}]),
 trainingEvent('plan',today,'스쿼트',[{weight:100,reps:10,done:false}])];
 const state=stateOf(events),before=JSON.stringify(state),model=trainingBuild(state,null);
 const g=name=>model.groups.find(x=>x.group===name);
 assert.deepEqual(g('가슴'),{group:'가슴',sets:3,volume:1120,maxWeight:65});
 assert.deepEqual(g('등'),{group:'등',sets:1,volume:400,maxWeight:40});
 assert.deepEqual(g('하체'),{group:'하체',sets:0,volume:0,maxWeight:null});
 assert.equal(g('기타').volume,50);assert.equal(model.totalSets,5);assert.equal(model.totalVolume,1570);
 const series=D.trainingSeries(model,'가슴','sets');
 assert.equal(series.buckets.at(-1).sets,3);assert.equal(series.buckets.at(-2).sets,null);
 assert.equal(JSON.stringify(state),before);
});
test('linked workout reflection contributes one record to body-part graphs and independent-only records remain available',()=>{
 const plan=trainingEvent('linked',today,'벤치프레스',[{weight:40,reps:10,done:false}]);
 let state=stateOf([plan]),begun=I.startCalendar(I.empty(),K.prepareStart(C,state,'linked',today),new Date(today+'T09:00:00Z'));
 const s=begun.session,ex=s.exercises[0];
 let actual=I.setValue(begun.next,s.id,ex.id,ex.sets[0].id,{weight:55,done:true},new Date(today+'T09:10:00Z')).next;
 actual=I.finish(actual,s.id,'COMPLETED',new Date(today+'T09:20:00Z')).next;
 assert.equal(trainingBuild(state,actual).totalVolume,550);
 state=K.applySession(C,state,actual.sessions[0]).next;
 assert.equal(trainingBuild(state,actual).totalVolume,550);
 assert.equal(trainingBuild(state,actual).totalSets,1);
 assert.equal(trainingBuild(stateOf([]),actual).totalVolume,550);
});
test('all-time training buckets sum volume and sets while maximum weight remains a maximum',()=>{
 const events=Array.from({length:240},(_,i)=>trainingEvent('long'+i,D.dateAt(D.dayNumber(today)-239+i),'스쿼트',[{weight:i+1,reps:2}]));
 const model=trainingBuild(stateOf(events),null,'all');
 assert.equal(model.bucketDays,2);assert.equal(model.totalSets,240);assert.equal(model.totalVolume,57840);
 const series=D.trainingSeries(model,'하체','maxWeight');assert.equal(series.buckets[0].maxWeight,2);
 const volume=D.trainingSeries(model,'하체','volume');assert.equal(volume.buckets[0].volume,6);
 assert.equal(volume.buckets.at(-1).values.sets,2);
 assert.match(V.trainingSection(model,{trainingGroup:'하체',trainingMetric:'maxWeight',width:320}),/부위별 운동 기록/);
 assert.match(V.trainingSection(model,{trainingGroup:'하체',trainingMetric:'maxWeight',width:320}),/최고 중량/);
 assert.match(V.trainingSection(model,{width:320}),/부위별 세트 수/);
});
test('training charts omit invalid confirmed sessions and preserve genuine zero-weight sets',()=>{
 const base=I.start(I.empty(),{exerciseNames:['푸시업']},new Date(today+'T07:00:00Z'));
 const e=base.session.exercises[0];let data=I.setValue(base.next,base.session.id,e.id,e.sets[0].id,{done:true},new Date(today+'T07:01:00Z')).next;
 data=I.finish(data,base.session.id,'PARTIAL',new Date(today+'T07:02:00Z')).next;
 const invalid={...I.copy(data.sessions[0]),id:'invalid',exercises:data.sessions[0].exercises.map(e=>({...e,sets:e.sets.map(s=>({...s,done:false}))}))};
 const sample={...I.copy(data.sessions[0]),id:'sample',isSample:true};
 const model=trainingBuild(stateOf([]),{...data,sessions:[...data.sessions,invalid,sample]});
 assert.equal(model.totalSets,1);assert.equal(model.totalVolume,0);
 assert.equal(D.trainingSeries(model,'가슴','maxWeight').buckets.at(-1).maxWeight,0);
});

test('all-time weight and training views share the earliest actual date when training starts first',()=>{
 const state=stateOf([trainingEvent('old-training','2026-10-01','벤치프레스',[{weight:60,reps:10}]),weight('w',today,80)]);
 const base=build(state,'all'),training=trainingBuild(state,null,'all');
 assert.equal(base.start,today);assert.equal(training.start,'2026-10-01');
 const aligned=D.build(C,N,state,{range:'all',today,earliestDate:training.start});
 assert.equal(aligned.start,training.start);
 assert.equal(aligned.buckets.at(-1).weight,80);
});
test('training filters and point selection work inside the real graph view without writing workout records',()=>{
 const state=stateOf([trainingEvent('chest',today,'벤치프레스',[{weight:60,reps:10}]),trainingEvent('back','2026-11-23','랫풀다운',[{weight:40,reps:10}])]);
 const before=JSON.stringify(state),events=new Map(),listeners=new Map(),detail={innerHTML:''};
 let html='';
 const host={clientWidth:350,contains:()=>false,querySelectorAll:()=>[],
  querySelector(selector){return selector==='#fp-training-detail'?detail:null},
  addEventListener(name,fn){listeners.set(name,fn)},get innerHTML(){return html},set innerHTML(v){html=v}};
 const document={body:{dataset:{fdScreen:'progress'}},activeElement:null,getElementById:id=>id==='fd-progress-root'?host:null,addEventListener(){}};
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:[2026,10,24,12]))}}
 const root={Date:FixedDate,FormdayCore:C,FormdayNutrition:N,FormdayWorkouts:W,FormdayIronData:A,FormdayBridge:{getState:()=>state},FormdayIndependent:{getSnapshot:()=>I.empty()},addEventListener(name,fn){events.set(name,fn)},clearTimeout(){},setTimeout(){}};
 V.mount(root,document);assert.match(html,/부위별 운동 기록/);
 const click=(selector,dataset)=>listeners.get('click')({target:{closest:q=>q===selector?{dataset}:null}});
 click('[data-training-group]',{trainingGroup:'등'});
 click('[data-training-metric]',{trainingMetric:'sets'});
 assert.match(html,/등 · 완료 세트/);
 assert.match(html,/2026-11-23 완료 세트 1 세트/);
 click('[data-training-point]',{trainingPoint:'28'});
 assert.match(detail.innerHTML,/2026-11-23/);
 assert.match(detail.innerHTML,/총 운동량 400 kg/);
 assert.equal(JSON.stringify(state),before);
});
