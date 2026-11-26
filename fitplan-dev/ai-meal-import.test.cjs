'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../fitplan/core.js');
const N=require('../fitplan/nutrition.js');
const AI=require('../fitplan/ai-meal-import.js');
const now=new Date('2026-11-23T04:00:00Z');
const schedule={date:'2026-11-23',mealPeriod:'lunch'};
const item={name:'합성 시험 음식',amount:150,unit:'g',evidence:'photo_estimate',nutrients:{kcal:200,carbs:20,protein:15,fat:6,unsat:null}};
const fixture=(overrides={})=>({format:AI.FORMAT,...schedule,title:'합성 시험 식사',items:[item],...overrides});
const parse=(overrides={})=>AI.parse(JSON.stringify(fixture(overrides)));
const initial=()=>C.normalizeState({revision:'initial',events:[{id:'existing-weight',type:'weight',date:'2026-11-23',start:'07:00',end:'07:10',title:'합성 체중',repeat:'none',completed:true,detail:{weight:80,bodyfat:null}}],settings:{protein:150,carbs:200,fat:50},demo:false});
test('strict meal JSON and fenced JSON preserve full eaten-portion nutrition, estimate label and missing unsaturated fat',()=>{
 const value=fixture();const p=AI.parse('\x60\x60\x60json\n'+JSON.stringify(value)+'\n\x60\x60\x60');
 const n=N.calculateMeal(p.detail);
 assert.equal(n.kcal,200);assert.equal(n.carbs,20);assert.equal(n.protein,15);assert.equal(n.fat,6);assert.equal(n.missing.unsat,1);
 assert.equal(p.detail.items[0].food.basisAmount,150);assert.match(p.detail.items[0].food.source.label,/추정/);
});
test('append-only plan preserves existing state and settings, one real non-repeating completed meal',()=>{
 const state=initial(),before=JSON.stringify(state),p=parse(),r=AI.prepare(state,p,schedule,now);
 assert.equal(JSON.stringify(state),before);
 assert.deepEqual(r.next.events[0],state.events[0]);assert.deepEqual(r.next.settings,state.settings);
 assert.equal(r.next.events.length,2);assert.equal(r.event.completed,true);assert.equal(r.event.repeat,'none');
 assert.equal(r.event.isSample,false);assert.equal(r.next.revision,'initial');
 assert.equal(r.event.detail.mealPeriod,'lunch');assert.equal(r.event.detail.mealTimeBasis,'category');
});
test('same main meal category is blocked without modifying old data',()=>{
 const state=AI.prepare(initial(),parse(),schedule,now).next;
 const before=JSON.stringify(state);
 assert.throws(()=>AI.prepare(state,parse({title:'이름 변경'}),schedule,now),/중복 가능/);
 assert.throws(()=>AI.prepare(state,parse({items:[{...item,name:'다른 음식'}]}),schedule,now),/중복 가능/);
 assert.equal(JSON.stringify(state),before);
});
test('different category and sample meals are handled separately',()=>{
 const p=parse(),saved=AI.prepare(initial(),p,schedule,now).next;
 const other=parse({items:[{...item,name:'다른 음식'}]});
 assert.equal(AI.prepare(saved,other,{...schedule,mealPeriod:'snack'},now).next.events.length,3);
 const sample={...saved,events:saved.events.map(e=>e.type==='meal'?{...e,isSample:true}:e)};
 assert.equal(AI.prepare(sample,parse(),schedule,now).next.events.length,3);
});
test('missing category, malformed or future date fail; date is Seoul time',()=>{
 assert.equal(AI.kstDay(new Date('2026-11-23T15:00:00Z')),'2026-11-24');
 const p=parse({date:null,mealPeriod:null});
 assert.equal(p.mealPeriod,null);
 for(const timing of [{...schedule,date:'2026-11-24'},{...schedule,date:'2026-02-30'},{...schedule,mealPeriod:''},{...schedule,mealPeriod:'brunch'}])assert.throws(()=>AI.prepare(initial(),p,timing,now));
 assert.throws(()=>parse({start:'99:00'}));assert.throws(()=>parse({date:'2026-02-30'}));
});
test('unknown optional nutrients stay null rather than zero and user label requires complete basic values',()=>{
 const p=parse({items:[{name:'시험 미확인 식품',amount:1,unit:'serving',evidence:'unknown'}]});
 assert.equal(p.detail.items[0].food.nutrients.kcal,null);
 assert.equal(N.calculateMeal(p.detail).missing.kcal,1);
 assert.throws(()=>parse({items:[{...item,evidence:'unknown'}]}),/미확인/);
 assert.throws(()=>parse({items:[{...item,evidence:'user_label',nutrients:{kcal:10}}]}));
});
test('reject executable text, backups, extra fields, unknown units, nonnumeric or impossible nutrient values',()=>{
 for(const v of ['alert(1)','[]','{"app":"formday","events":[]}',JSON.stringify(fixture({events:[]})),JSON.stringify(fixture({items:[{...item,unit:'kg'}]})),JSON.stringify(fixture({items:[{...item,amount:'150'}]})),JSON.stringify(fixture({items:[{...item,nutrients:{fat:2,unsat:3}}]})),JSON.stringify(fixture({items:[{...item,nutrients:{protein:999}}]}))]){
  assert.throws(()=>AI.parse(v),Error);
 }
 assert.throws(()=>AI.parse(JSON.stringify(fixture({items:Array.from({length:51},()=>item)}))));
 assert.throws(()=>AI.parse(' '.repeat(80001)));
 assert.throws(()=>AI.parse('{"format":"formday-ai-meal-v1","title":"test","items":[],"__proto__":{}}'));
});

test('explicit Korean or English period works without time and legacy JSON retains supplied clock data',()=>{
 const a=parse({mealPeriod:'저녁'});assert.equal(a.mealPeriod,'dinner');assert.equal(a.start,null);
 const p=parse({mealPeriod:undefined,start:'07:40',end:'08:20'});
 assert.equal(p.mealPeriod,'breakfast');assert.equal(p.periodInferred,true);
 const r=AI.prepare(initial(),p,{...schedule,mealPeriod:'breakfast'},now);
 assert.equal(r.event.start,'07:40');assert.equal(r.event.end,'08:20');assert.equal(r.event.detail.mealTimeBasis,'recorded');
 assert.throws(()=>parse({mealPeriod:'brunch'}));assert.throws(()=>parse({start:'12:30',end:'12:00'}));
});
test('different snacks in the same category can be imported, while identical ones cannot',()=>{
 const snack={...schedule,mealPeriod:'snack'};
 const s=AI.prepare(initial(),parse(),snack,now).next;
 assert.throws(()=>AI.prepare(s,parse(),snack,now),/중복 가능/);
 const other=parse({items:[{...item,name:'다른 간식'}]});
 assert.equal(AI.prepare(s,other,snack,now).next.events.length,3);
 assert.equal(AI.prepare(s,parse(),schedule,now).next.events.length,3);
});
