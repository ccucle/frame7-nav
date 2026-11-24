import test from "node:test";
import assert from "node:assert/strict";
import {createReader} from "../src/reader.mjs";
import {READ_TOOLS,createDispatcher} from "../src/tools.mjs";
import {createFirestoreAdapter} from "../src/firebase-adapter.mjs";

const uid="unitTestUser9";
const calendar={schemaVersion:3,revision:"c1",events:[
 {id:"meal1",date:"2026-11-21",type:"meal",title:"아침",completed:true,
   isSample:false,repeat:"none",detail:{items:[{food:{name:"달걀"},grams:60}]}},
 {id:"weight1",date:"2026-11-22",type:"weight",title:"체중",completed:true,
   isSample:false,repeat:"none",detail:{weight:82.4,bodyfat:19.5}},
 {id:"demo1",date:"2026-11-22",type:"meal",title:"예시",completed:true,
   isSample:true,repeat:"none",detail:{items:[]}}
]};
const iron={version:1,revision:"i1",programs:[],routines:[
 {id:"R1",name:"상체",updatedAt:"2026-11-20T01:00:00Z",exercises:[
   {name:"벤치프레스",sets:[{weight:60,reps:10,restSec:90,warmup:false}]}]}],
 sessions:[
  {id:"S1",label:"상체",date:"2026-11-21",status:"COMPLETED",
   activeMs:2400000,exercises:[{name:"벤치프레스",sets:[
    {weight:60,reps:10,warmup:false,done:true},
    {weight:20,reps:15,warmup:true,done:true},
    {weight:70,reps:5,warmup:false,done:false}]}]},
  {id:"S2",label:"미완료 운동",date:"2026-11-22",status:"SAVED",
   activeMs:600000,exercises:[]}
 ]};
const doc=(revision,data)=>({format:1,revision,payload:JSON.stringify(data)});
const map=new Map([
 ["users/"+uid+"/formday_sync/calendar",doc("c1",calendar)],
 ["users/"+uid+"/formday_sync/iron",doc("i1",iron)]
]);
function reader(){return createReader({verifiedUid:uid,loadDocument:async path=>map.get(path)||null});}
const opts={from:"2026-11-20",to:"2026-11-23"};

test("can read two bounded cloud snapshots",async()=>{
 const result=await reader().status();
 assert.equal(result.connected,true);
 assert.equal(result.calendar.eventCount,3);
 assert.equal(result.iron.sessionCount,2);
});
test("real strength sets only, excludes warm-up from volume",async()=>{
 const result=await reader().workouts(opts);
 assert.equal(result.total,1);
 assert.equal(result.records[0].setsCompleted,2);
 assert.equal(result.records[0].workingSets,1);
 assert.equal(result.records[0].totalVolumeKg,600);
});
test("draft sessions require explicit opt-in",async()=>{
 assert.equal((await reader().workouts(opts)).total,1);
 assert.equal((await reader().workouts({...opts,includeUnfinished:true})).total,2);
});
test("meal/weight views exclude sample events and do not invent calorie values",async()=>{
 const meals=await reader().meals(opts);
 const weights=await reader().weightHistory(opts);
 assert.equal(meals.total,1);
 assert.equal(meals.records[0].items[0].name,"달걀");
 assert.equal(meals.records[0].items[0].calories,undefined);
 assert.equal(weights.records[0].kilograms,82.4);
});
test("routine targets are distinct from historical sessions",async()=>{
 const routines=await reader().routines();
 assert.equal(routines.records[0].exercises[0].targets[0].weightKg,60);
 const program={id:"program1",name:"기존 프로그램",mode:"fixed",routineIds:["R1"],
  weekdays:{"1":"R1"},active:true,nextIndex:0};
 const r=createReader({verifiedUid:uid,loadDocument:async()=>doc("i1",{...iron,programs:[program]})});
 const saved=await r.routines();
 assert.equal(saved.programTotal,1);assert.deepEqual(saved.programs,[program]);
 assert.equal(saved.records[0].id,"R1");
});
test("rejects UID path traversal, invalid date and oversized read",async()=>{
 assert.throws(()=>createReader({verifiedUid:"../other",loadDocument:async()=>{}}));
 await assert.rejects(reader().calendar({from:"2026-02-30",to:"2026-03-15"}));
 await assert.rejects(reader().workouts({from:"2026-01-01",to:"2027-06-01"}));
 await assert.rejects(reader().meals({...opts,limit:500}));
});
test("dispatcher exposes only six read tools and forbids arbitrary user IDs",async()=>{
 assert.equal(READ_TOOLS.length,6);
 assert.ok(READ_TOOLS.every(t=>t.annotations.readOnlyHint===true));
 const dispatch=createDispatcher({verifiedUid:uid,loadDocument:async path=>map.get(path)||null});
 await assert.rejects(dispatch("formday_delete",{}));
 await assert.rejects(dispatch("formday_status",{userId:"anotherUid"}));
 assert.equal((await dispatch("formday_status",{})).connected,true);
});
test("Admin adapter reads only the exact owner-shaped paths",async()=>{
 const calls=[];
 const load=createFirestoreAdapter({doc:path=>({get:async()=>{
   calls.push(path);return {exists:true,data:()=>map.get(path)};
 }})});
 await load("users/"+uid+"/formday_sync/calendar");
 assert.deepEqual(calls,["users/"+uid+"/formday_sync/calendar"]);
 await assert.rejects(load("users/"+uid+"/other_private/accounts"));
 await assert.rejects(load("users/../../admin/formday_sync/calendar"));
});

// These regression fixtures use the persisted FORMDAY v0.6.1 shapes. They are
// synthetic records, not reads of a connected user's Firebase documents.
function event(overrides={}){
 return {id:"event1",date:"2026-11-21",start:"08:00",end:"08:30",
  type:"meal",title:"아침",repeat:"none",repeatUntil:null,completed:false,
  detail:{items:[]},occurrences:{},excludedDates:[],isSample:false,...overrides};
}
function food(name,unit="g",basisAmount=100){
 return {id:"food1",name,basisUnit:unit,basisAmount,
  nutrients:{kcal:null,protein:null,carbs:null,fat:null,unsat:null},
  source:{kind:"unknown",label:"영양정보 없음",url:"",code:"",datasetDate:"",checkedAt:""}};
}
function storedReader(events,{clock=()=>Date.parse("2026-11-23T15:00:00Z"),payload}={}){
 const data={schemaVersion:3,revision:"synthetic-r1",events};
 return createReader({verifiedUid:uid,clock,loadDocument:async path=>
  path.endsWith("/calendar")?{format:1,revision:data.revision,payload:payload||JSON.stringify(data)}:
  doc("synthetic-i1",{version:1,routines:[],programs:[],sessions:[]})});
}
const monday={from:"2026-11-23",to:"2026-11-23"};

test("default range uses Asia/Seoul day at midnight and year boundaries",async()=>{
 const cases=[
  ["2026-11-23T14:59:59Z","2026-11-23","2026-11-10"],
  ["2026-11-23T15:00:00Z","2026-11-24","2026-11-11"],
  ["2026-11-23T23:59:59Z","2026-11-24","2026-11-11"],
  ["2026-12-31T15:00:00Z","2027-01-01","2026-12-19"]
 ];
 for(const [instant,to,from] of cases){
  const r=storedReader([event({date:to})],{clock:()=>Date.parse(instant)});
  for(const method of ["calendar","meals","weightHistory","workouts"]){
   const result=await r[method]();
   assert.equal(result.to,to,method+" "+instant);assert.equal(result.from,from);
  }
  assert.equal((await r.calendar()).records[0].date,to);
 }
});
test("invalid injected time and explicit empty dates fail instead of selecting another day",async()=>{
 await assert.rejects(storedReader([],{clock:()=>NaN}).calendar());
 await assert.rejects(storedReader([]).calendar({from:"",to:"2026-11-24"}));
});
test("meal amount, unit, nutrition basis and stored source are read without conversion",async()=>{
 const source={kind:"usda",label:"USDA FoodData Central · SR Legacy",
  url:"https://fdc.nal.usda.gov/food-details/123",code:"123",datasetDate:"2018-04",checkedAt:"2026-11-23"};
 const items=[
  {id:"egg",food:{...food("달걀"),source,
   nutrients:{kcal:155,protein:13,carbs:1.1,fat:11,unsat:5.6}},amount:60},
  {id:"milk",food:food("우유","ml",200),amount:250},
  {id:"bread",food:food("빵","serving",1),amount:2}
 ];
 const r=storedReader([event({date:monday.from,detail:{items,notes:"사용자가 확인한 분량 60g"}})]);
 const meal=(await r.meals(monday)).records[0],result=meal.items;
 assert.deepEqual(result.map(x=>({amount:x.amount,unit:x.unit,basisAmount:x.basisAmount,grams:x.grams,quantity:x.quantity})),[
  {amount:60,unit:"g",basisAmount:100,grams:60,quantity:null},
  {amount:250,unit:"ml",basisAmount:200,grams:null,quantity:null},
  {amount:2,unit:"serving",basisAmount:1,grams:null,quantity:2}
 ]);
 assert.deepEqual(result[0].source,source);
 assert.equal(result[1].source.kind,"unknown");
 assert.ok(result.every(x=>x.calories===undefined&&x.nutrients===undefined));
 assert.deepEqual(result.map(x=>x.nutritionBasisAmount),[100,200,1]);
 assert.deepEqual(result[0].nutrientsPerBasis,{kcal:155,protein:13,carbs:1.1,fat:11,unsat:5.6});
 assert.deepEqual(result[1].nutrientsPerBasis,{kcal:null,protein:null,carbs:null,fat:null,unsat:null});
 assert.equal(meal.notes,"사용자가 확인한 분량 60g");
});
test("invalid meal quantities stay unavailable and unsafe source URLs are not returned",async()=>{
 const items=[-1,0,20001,"60",null].map((amount,i)=>({id:"bad"+i,food:food("미확인"),amount}));
 items[0].food.nutrients={kcal:-1,protein:-2,carbs:"12",fat:0,unsat:null};
 items.push({id:"bad-basis",amount:20,food:{...food("기준량 오류"),basisAmount:-100,
  source:{kind:"unknown",url:"javascript:alert(1)"}}});
 const payload=JSON.stringify({schemaVersion:3,events:[event({date:monday.from,detail:{items}})]})
  .replace('"amount":-1','"amount":1e400').replace('"kcal":-1','"kcal":1e400');
 const result=(await storedReader([],{payload}).meals(monday)).records[0].items;
 assert.deepEqual(result.slice(0,5).map(x=>x.amount),[null,null,null,null,null]);
 assert.ok(result.slice(0,5).every(x=>x.grams===null&&x.quantity===null));
 assert.equal(result[5].basisAmount,null);
 assert.equal(result[5].nutritionBasisAmount,null);
 assert.equal(result[5].source.url,"");
 assert.deepEqual(result[0].nutrientsPerBasis,{kcal:null,protein:null,carbs:null,fat:0,unsat:null});
});
test("legacy meal grams remain readable without inventing nutrition provenance",async()=>{
 const result=await storedReader([event({date:monday.from,
  detail:{food:"기존 식사",grams:120}})]).meals(monday);
 const item=result.records[0].items[0];
 assert.equal(item.name,"기존 식사");assert.equal(item.amount,120);
 assert.equal(item.unit,"g");assert.equal(item.grams,120);
 assert.equal(item.source,null);assert.equal(item.basisAmount,null);
});
test("calendar expands weekly dates and includes stored times and original series date",async()=>{
 const e=event({id:"weekly",date:"2026-11-16",repeat:"weekly",type:"strength",title:"가슴루틴1",
  start:"10:00",end:"11:00",completed:true});
 const r=storedReader([e]);
 const result=await r.calendar({...monday,to:"2026-11-30"});
 assert.equal(result.total,2);
 assert.deepEqual(result.records.map(x=>[x.date,x.seriesDate,x.start,x.end,x.completed]),[
  ["2026-11-23","2026-11-16","10:00","11:00",false],
  ["2026-11-30","2026-11-16","10:00","11:00",false]
 ]);
 assert.equal((await r.calendar({from:"2026-11-15",to:"2026-11-15"})).total,0);
});
test("daily exclusions, inclusive end date and preserved post-end snapshots match site semantics",async()=>{
 const e=event({id:"daily",repeat:"daily",repeatUntil:"2026-11-24",excludedDates:["2026-11-22"],
  occurrences:{"2026-11-26":{date:"2026-11-26",type:"meal",title:"보존된 식사",
   start:"09:00",end:"09:40",completed:true,detail:{items:[]}}}});
 const result=await storedReader([e]).calendar({from:"2026-11-21",to:"2026-11-27"});
 assert.deepEqual(result.records.map(x=>x.date),["2026-11-21","2026-11-23","2026-11-24","2026-11-26"]);
 const saved=result.records.at(-1);
 assert.equal(saved.title,"보존된 식사");assert.equal(saved.start,"09:00");
 assert.equal(saved.end,"09:40");assert.equal(saved.completed,true);
 assert.equal(saved.hasOccurrenceOverrides,true);
});
test("dated meal overrides are returned on their day without marking the recurring plan eaten",async()=>{
 const e=event({repeat:"daily",completed:true,detail:{items:[{food:food("예정 식사"),amount:100}]},
  occurrences:{"2026-11-23":{date:"2026-11-23",type:"meal",title:"수정한 점심",start:"12:30",end:"13:00",
   completed:true,detail:{items:[{food:food("실제 식사"),amount:180}]}}}});
 const result=await storedReader([e]).meals({from:"2026-11-23",to:"2026-11-24"});
 assert.deepEqual(result.records.map(x=>[x.date,x.title,x.completed,x.items[0].name,x.items[0].amount]),[
  ["2026-11-23","수정한 점심",true,"실제 식사",180],
  ["2026-11-24","아침",false,"예정 식사",100]
 ]);
});
test("weight history uses completed occurrence measurements and never copies a series template",async()=>{
 const e=event({id:"weight-repeat",type:"weight",repeat:"daily",completed:true,detail:{weight:90,bodyfat:25},
  occurrences:{
   "2026-11-23":{type:"weight",title:"측정",start:"07:00",end:"07:05",completed:true,detail:{weight:82.4,bodyfat:19.5}},
   "2026-11-24":{type:"weight",title:"미완료",start:"07:00",end:"07:05",completed:false,detail:{weight:82.1}}
  }});
 const result=await storedReader([e]).weightHistory({from:"2026-11-21",to:"2026-11-25"});
 assert.equal(result.total,1);assert.equal(result.records[0].date,"2026-11-23");
 assert.equal(result.records[0].kilograms,82.4);assert.equal(result.records[0].bodyFatPercent,19.5);
});
test("legacy doneDates become completed occurrences and explicit snapshots take precedence",async()=>{
 const e=event({type:"weight",repeat:"daily",completed:false,detail:{weight:82.5},
  doneDates:["2026-11-22","2026-11-23"],occurrences:{"2026-11-23":{
   type:"weight",title:"수정 측정",start:"07:00",end:"07:05",completed:true,detail:{weight:82.3}}}});
 const result=await storedReader([e]).weightHistory({from:"2026-11-21",to:"2026-11-24"});
 assert.deepEqual(result.records.map(x=>[x.date,x.kilograms]),[["2026-11-22",82.5],["2026-11-23",82.3]]);
});
test("limits count all occurrences but return only the last requested records in site day order",async()=>{
 const events=[event({id:"z",title:"Z",start:"09:00",end:"09:30",repeat:"daily"}),
  event({id:"a",title:"A",start:"08:00",end:"08:30",repeat:"daily"}),
  event({id:"sample",isSample:true,repeat:"daily"})];
 const result=await storedReader(events).calendar({from:"2026-11-21",to:"2026-11-23",limit:3});
 assert.equal(result.total,6);
 assert.deepEqual(result.records.map(x=>[x.date,x.id]),[["2026-11-22","z"],["2026-11-23","a"],["2026-11-23","z"]]);
 assert.equal((await storedReader(events).calendar({...monday,includeSamples:true})).total,3);
});
test("malformed repeat metadata fails instead of inventing occurrences",async()=>{
 const malformed=[
  event({repeat:"monthly"}),
  event({repeat:"weekly",occurrences:{"2026-11-23":{type:"meal"}}}),
  event({repeat:"daily",repeatUntil:"2026-02-30"}),
  event({repeat:"daily",occurrences:{"2026-11-23":{date:"2026-11-24",type:"meal"}}})
 ];
 for(const e of malformed)await assert.rejects(storedReader([e]).calendar(monday));
});
test("invalid completed bodyweight values are excluded from measurement history",async()=>{
 const events=[0,-1,501,"82.4",null].map((weight,i)=>event({id:"invalid"+i,date:monday.from,type:"weight",completed:true,detail:{weight}}));
 events.push(event({id:"valid",date:monday.from,type:"weight",completed:true,detail:{weight:82.4,bodyfat:-1}}));
 const result=await storedReader(events).weightHistory(monday);
 assert.equal(result.total,1);assert.equal(result.records[0].kilograms,82.4);
 assert.equal(result.records[0].bodyFatPercent,null);
});
test("weight result limit follows the site's time and ID order without title reordering",async()=>{
 const events=[event({id:"a",date:monday.from,title:"Z",type:"weight",completed:true,detail:{weight:82.4}}),
  event({id:"z",date:monday.from,title:"A",type:"weight",completed:true,detail:{weight:82.3}})];
 const result=await storedReader(events).weightHistory({...monday,limit:1});
 assert.equal(result.total,2);assert.equal(result.records[0].id,"z");
});

test('default date range follows Korea calendar day across UTC midnight',async()=>{
 const r=createReader({verifiedUid:uid,loadDocument:async path=>map.get(path),clock:()=>Date.parse('2026-11-23T15:01:00Z')});
 assert.equal((await r.meals()).to,'2026-11-24');
});
