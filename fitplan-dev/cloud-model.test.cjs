'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../fitplan/core.js');
const N=require('../fitplan/nutrition.js');
const M=require('../fitplan/cloud-model.js');

function fixture() {
  const custom=N.validateFood({
    id:'c01',name:'합성 단백질 식품',nameEn:'',brand:'',category:'',basisAmount:45,basisUnit:'g',
    nutrients:{kcal:180,protein:20,carbs:15,fat:5,unsat:null},source:{kind:'user'}
  });
  return C.normalizeState({
    events:[
      {id:'train',date:'2026-11-16',start:'07:00',end:'08:00',type:'strength',title:'합성 웨이트',
       repeat:'weekly',doneDates:['2026-11-23','2026-11-16'],
       detail:{exercise:'벤치프레스',sets:3,weight:60,reps:10}},
      {id:'meal',date:'2026-11-23',start:'12:00',end:'12:30',type:'meal',
       title:'합성 식사',repeat:'none',completed:true,detail:{food:'닭가슴살(조리)',grams:150}},
      {id:'weight',date:'2026-11-23',start:'06:00',end:'06:05',type:'weight',
       title:'합성 체중',repeat:'none',completed:true,detail:{weight:80,bodyfat:18.5}}
    ],
    customFoods:[custom],favoriteFoodIds:['c01'],settings:{protein:150,carbs:200,fat:50},demo:false
  });
}
test('cloud layout round-trips all v3 fields and nutrient nulls',()=>{
  const v=fixture(),documents=M.snapshotToDocuments(v);
  assert.deepEqual(M.documentsToSnapshot(documents),v);
  assert.equal(M.documentsToSnapshot(documents).customFoods[0].nutrients.unsat,null);
  assert.equal(documents.filter(x=>x.group==='events').length,3);
  assert.equal(documents.filter(x=>x.group==='occurrences').length,2);
  assert.equal(documents.filter(x=>x.group==='profile').length,1);
  assert.ok(documents.every(x=>x.group!=='profile'||!Object.hasOwn(x.data,'events')));
});
test('cloud data may be fetched in a different document order',()=>{
  const v=fixture(),documents=M.snapshotToDocuments(v);
  assert.deepEqual(M.documentsToSnapshot(documents.slice().reverse()),v);
});
test('missing one document stops restore rather than silently losing data',()=>{
  const documents=M.snapshotToDocuments(fixture());
  const partial=documents.filter(x=>x.group!=='foods');
  assert.throws(()=>M.documentsToSnapshot(partial),/누락/);
});
test('duplicate document stops restore',()=>{
  const documents=M.snapshotToDocuments(fixture());
  assert.throws(()=>M.documentsToSnapshot([...documents,documents[0]]),/중복/);
});
test('orphaned occurrence stops restore',()=>{
  const documents=M.snapshotToDocuments(fixture());
  const invalid=documents.filter(x=>x.group!=='occurrences').concat(
    documents.filter(x=>x.group==='occurrences').map(x=>({
      ...x,id:'unknown__'+x.data.date,data:{...x.data,eventId:'unknown'}
    }))
  );
  assert.throws(()=>M.documentsToSnapshot(invalid),/반복 일정/);
});
test('unsupported schema version stops restore',()=>{
  const documents=M.snapshotToDocuments(fixture());
  documents[0].data.schemaVersion=4;
  assert.throws(()=>M.documentsToSnapshot(documents),/지원하지 않는/);
});
test('document larger than conservative 850 KB is rejected',()=>{
  const documents=M.snapshotToDocuments(fixture());
  documents[1].data.event.title='a'.repeat(900000);
  assert.throws(()=>M.documentsToSnapshot(documents),/안전 크기/);
});
test('duplicate occurrence ordering is rejected',()=>{
  const documents=M.snapshotToDocuments(fixture());
  const list=documents.filter(x=>x.group==='occurrences');
  assert.equal(list.length,2);
  list[1].data.order=list[0].data.order;
  assert.throws(()=>M.documentsToSnapshot(documents),/순서/);
});
