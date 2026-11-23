'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
  assert.match(html,/data-mobile="add"/);
});
