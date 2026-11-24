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
