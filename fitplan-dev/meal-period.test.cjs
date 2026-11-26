'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../fitplan/core.js'),N=require('../fitplan/nutrition.js'),P=require('../fitplan/sync-policy.js'),I=require('../fitplan/iron-store.js');
const day='2026-11-23',detail=N.normalizeMeal({food:'합성 식품',grams:100});
const legacy={id:'old-meal',date:day,start:'07:45',end:'08:20',type:'meal',title:'합성 식사',repeat:'none',completed:true,detail,isSample:false};
const state=events=>C.normalizeState({revision:'meal-rev',settings:C.defaults,events});
test('four periods are valid with deterministic legacy fallback and no migration',()=>{
 assert.deepEqual(Object.values(N.MEAL_PERIODS),['아침','점심','저녁','간식']);
 for(const [time,period] of [['05:00','breakfast'],['10:59','breakfast'],['11:00','lunch'],['14:59','lunch'],['15:00','snack'],['17:00','dinner'],['21:59','dinner'],['22:00','snack']])assert.equal(N.inferMealPeriod(time),period);
 const before=state([legacy]);const out=C.normalizeState(before);
 assert.deepEqual(out,before);assert.equal(Object.hasOwn(out.events[0].detail,'mealPeriod'),false);
 assert.equal(N.mealPeriodLabel(out.events[0],true),'아침 (추정)');
 assert.equal(N.mealPeriodOf({type:'weight',start:'08:00'}),null);
});
test('category anchors stay technical; recorded times are preserved when reclassified',()=>{
 const a=N.mealTimeFields('snack');assert.equal(a.mealTimeBasis,'category');assert.ok(C.validTime(a.start)&&C.validTime(a.end)&&a.start<a.end);
 assert.equal(N.inferMealPeriod(a.start),'snack');
 assert.deepEqual(N.mealTimeFields('dinner',legacy),{start:legacy.start,end:legacy.end,mealTimeBasis:'recorded'});
 const updated={...legacy,...a,detail:{...detail,mealPeriod:'snack',mealTimeBasis:'category'}};
 assert.deepEqual(N.mealTimeFields('breakfast',updated),{start:'08:00',end:'08:01',mealTimeBasis:'category'});
 assert.throws(()=>N.mealTimeFields('brunch'));assert.throws(()=>N.normalizeMeal({...detail,mealPeriod:'brunch'}));
 assert.throws(()=>N.normalizeMeal({...detail,mealTimeBasis:'category'}));
});
test('category fields survive revision-checked local save, backup and cloud snapshot normalization',()=>{
 const e={...legacy,start:'12:00',end:'12:01',detail:{...detail,mealPeriod:'lunch',mealTimeBasis:'category'}};
 const s=state([e]),map=new Map([[C.STORE,JSON.stringify(s)]]),store=C.makeStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)});
 const saved=store.save(s,s.revision);
 assert.deepEqual(store.load().data,saved);
 const cloud=P.safePayload('calendar',saved,C,I);
 assert.deepEqual(C.normalizeState(JSON.parse(cloud.payload)),saved);
 const backup=P.backupPayload('calendar',saved,C,I);
 assert.deepEqual(C.normalizeState(JSON.parse(JSON.stringify(backup))),saved);
 assert.equal(N.mealPeriodLabel(saved.events[0],true),'점심');
 assert.deepEqual(N.calculateMeal(saved.events[0].detail),N.calculateMeal(detail));
});
test('recurring meal and day-specific record keep their own periods and original history',()=>{
 const s=state([{...legacy,repeat:'daily',completed:false,detail:{...detail,mealPeriod:'breakfast',mealTimeBasis:'recorded'}}]);
 const occurrence=C.occurrence(s.events[0],day);
 const next=C.upsert(s,{...occurrence,detail:{...occurrence.detail,mealPeriod:'snack',mealTimeBasis:'recorded'},completed:true},{scope:'occurrence',occurrenceDate:day});
 assert.equal(N.mealPeriodOf(C.occurrence(next.events[0],day)),'snack');
 assert.equal(N.mealPeriodOf(C.occurrence(next.events[0],'2026-11-24')),'breakfast');
 assert.equal(next.events[0].start,legacy.start);assert.equal(C.occurrence(next.events[0],day).start,legacy.start);
});
