'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const B=require('../fitplan/backup.js');
const C=require('../fitplan/core.js');
function storage(raw){return {getItem:key=>key===C.STORE?raw:null,setItem(){throw Error('backup must never write')}}}
const state=C.normalizeState({events:[{id:'weight-one',date:'2026-11-23',start:'07:00',end:'07:05',title:'체중',type:'weight',repeat:'none',completed:true,detail:{weight:80,bodyfat:null}}],customFoods:[],settings:{protein:150,carbs:200,fat:50}});
test('backup is a complete, original-format v3 JSON document without mutating storage',()=>{
  const raw=JSON.stringify(state);
  const file=B.makeBackup(C,storage(raw),new Date(2026,10,23,14,23));
  const loaded=C.normalizeState(JSON.parse(file.text));
  assert.equal(file.eventCount,1);
  assert.equal(file.foodCount,0);
  assert.equal(file.sampleCount,0);
  assert.equal(file.filename,'FORMDAY-backup-2026-11-23_1423.json');
  assert.equal(JSON.parse(file.text).app,'formday');
  assert.equal(JSON.parse(file.text).version,3);
  assert.equal(loaded.events[0].detail.weight,80);
  assert.equal(JSON.stringify(state),raw);
});
test('does not substitute sample content when nothing is saved',()=>{
  assert.throws(()=>B.makeBackup(C,storage(null)),/아직 저장된/);
});
test('refuses unreadable or unsupported versions rather than silently backing up an empty state',()=>{
  assert.throws(()=>B.makeBackup(C,storage('{broken')),/기록을 읽을 수 없습니다/);
  assert.throws(()=>B.makeBackup(C,storage(JSON.stringify({...state,schemaVersion:500}))),/기록을 읽을 수 없습니다/);
});
test('preserves saved food library and a legacy meal snapshot without recomputation',()=>{
  const legacy={events:[{id:'meal1',date:'2026-11-23',start:'12:00',end:'12:30',title:'점심',type:'meal',repeat:'none',completed:true,detail:{food:'닭가슴살(조리)',grams:150}}],settings:{protein:150,carbs:200,fat:50}};
  const file=B.makeBackup(C,storage(JSON.stringify(legacy)));
  const restored=C.normalizeState(JSON.parse(file.text));
  assert.equal(restored.events.length,1);
  assert.equal(restored.events[0].detail.items[0].food.source.kind,'legacy');
  assert.equal(restored.events[0].detail.items[0].amount,150);
});