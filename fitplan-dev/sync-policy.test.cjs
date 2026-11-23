'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../fitplan/sync-policy.js');
const C=require('../fitplan/core.js');
const I=require('../fitplan/iron-store.js');
const old={remoteRevision:'r1',localRevision:'l1'};
const decide=(meta,localRevision,remoteRevision,local=true,remote=true)=>
 P.decide({meta,local,localRevision,remote,remoteRevision});
test('First real records require an explicit first upload',()=>{
 assert.equal(decide(null,'l1','',true,false),'first-upload');
 assert.equal(decide(null,'','r1',false,true),'download');
 assert.equal(decide(null,'l1','r1'),'review');
});
test('After pairing, changing only one side is directional',()=>{
 assert.equal(decide(old,'l1','r1'),'synced');
 assert.equal(decide(old,'l2','r1'),'push');
 assert.equal(decide(old,'l1','r2'),'download');
});
test('Two concurrent changes never select automatic overwrite',()=>{
 assert.equal(decide(old,'l2','r2'),'conflict');
 assert.equal(decide(old,'l1','',true,false),'server-missing');
});
test('Demo data and fresh empty IRON store are not user data',()=>{
 assert.equal(P.isUserData('calendar',{demo:true,events:[{isSample:true}],customFoods:[]},true),false);
 assert.equal(P.isUserData('calendar',{demo:false,events:[],customFoods:[]},true),true);
 assert.equal(P.isUserData('iron',{sessions:[],routines:[],programs:[]},false),false);
 assert.equal(P.isUserData('iron',{sessions:[],routines:[{}],programs:[]},true),true);
});
test('Documents must be typed and size-limited',()=>{
 assert.throws(()=>P.docValid({format:2,revision:'x',payload:'{}'}));
 assert.deepEqual(P.docValid({format:1,revision:'x',payload:'{}'}),{format:1,revision:'x',payload:'{}'});
});
test('Cloud calendar and iron snapshots remain separate kinds',()=>{
 assert.deepEqual(P.slots,['calendar','iron']);
});
test('sync calendar backup round-trips through the existing importer without changing records',()=>{
 const data=C.normalizeState({events:[{id:'backup-weight',date:'2026-11-23',start:'07:00',end:'07:05',title:'체중',type:'weight',repeat:'none',completed:true,detail:{weight:80,bodyfat:20}}],settings:{...C.defaults},revision:'calendar-rev'});
 const original=JSON.stringify(data);
 const file=JSON.parse(JSON.stringify(P.backupPayload('calendar',data,C,I,'2026-11-24T00:00:00Z')));
 assert.equal(file.app,'formday');
 assert.equal(file.version,C.VERSION);
 assert.deepEqual(C.normalizeState(file),data);
 assert.equal(JSON.stringify(data),original);
});
test('sync IRON backup uses the established format and retains routines and sessions',()=>{
 let data=I.createRoutine(I.empty(),'백업 루틴',[I.newExercise('벤치프레스')]).next;
 data=I.start(data,{routineId:data.routines[0].id}).next;
 const original=JSON.stringify(data);
 const file=JSON.parse(JSON.stringify(P.backupPayload('iron',data,C,I)));
 assert.equal(file.app,'formday-iron');
 assert.equal(file.version,I.VERSION);
 assert.deepEqual(I.normalize(file.data),data);
 assert.equal(JSON.stringify(data),original);
});
test('previous sync calendar backups are accepted only for the matching valid store',()=>{
 const data=C.normalizeState({events:[],settings:{...C.defaults},revision:'calendar-rev'});
 const file={app:'FORMDAY-cloud-manual-backup',kind:'calendar',exportedAt:'2026-11-23T00:00:00Z',data};
 assert.deepEqual(C.normalizeState(file),data);
 assert.throws(()=>C.normalizeState({...file,kind:'iron'}),/백업/);
 assert.throws(()=>C.normalizeState({...file,data:{...data,schemaVersion:999}}),/버전/);
 assert.throws(()=>C.normalizeState({...file,data:null}),/백업/);
 assert.throws(()=>C.normalizeState({...file,data:{...data,events:[{}]}}));
 assert.throws(()=>P.backupPayload('other',data,C,I),/저장소/);
 assert.throws(()=>P.backupPayload('calendar',{events:[],settings:null},C,I));
 assert.throws(()=>P.backupPayload('iron',{sessions:[]},C,I));
});
