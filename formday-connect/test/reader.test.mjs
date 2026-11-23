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
