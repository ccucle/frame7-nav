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
test('favorite-only exercise data is protected during first pairing and survives backup import',()=>{
 const data=I.toggleFavorite(I.empty(),'벤치프레스',true).next;
 assert.equal(P.isUserData('iron',data,true),true);
 assert.equal(P.decide({meta:null,local:P.isUserData('iron',data,true),localRevision:'favorite-rev',remote:true,remoteRevision:'remote-rev'}),'review');
 const file=JSON.parse(JSON.stringify(P.backupPayload('iron',data,C,I)));
 assert.deepEqual(I.normalize(file.data).favoriteExercises,['벤치프레스']);
 assert.equal(I.normalize(file.data).sessions.length,0);
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

test('merge retains both independent additions, deduplicates IDs and preserves input',()=>{
 let base=I.createRoutine(I.empty(),'가슴',[I.newExercise('벤치프레스')]).next;
 const local=I.createRoutine(base,'등',[I.newExercise('랫풀다운')]).next;
 const remote=I.createRoutine(base,'하체',[I.newExercise('스쿼트')]).next;
 const before=JSON.stringify({local,remote,base});
 const out=P.mergeRecords('iron',local,remote,null,{},C,I);
 assert.equal(out.conflicts.length,0);
 assert.deepEqual(out.next.routines.map(x=>x.name),['가슴','등','하체']);
 assert.equal(JSON.stringify({local,remote,base}),before);
});
test('same ID divergent routine requires explicit choice without a common base',()=>{
 const base=I.createRoutine(I.empty(),'가슴',[I.newExercise('벤치프레스')]).next,id=base.routines[0].id;
 const local=I.updateRoutine(base,id,'가슴 수정 1',base.routines[0].exercises).next;
 const remote=I.updateRoutine(base,id,'가슴 수정 2',base.routines[0].exercises).next;
 const out=P.mergeRecords('iron',local,remote,null,{},C,I);
 assert.equal(out.next,null);assert.equal(out.conflicts.length,1);
 const resolved=P.mergeRecords('iron',local,remote,null,{[out.conflicts[0].key]:'local'},C,I);
 assert.equal(resolved.next.routines[0].name,'가슴 수정 1');
});
test('known common ancestor distinguishes independent edits and intentional removal',()=>{
 let base=I.createRoutine(I.empty(),'가슴',[I.newExercise('벤치프레스')]).next;
 base=I.createRoutine(base,'등',[I.newExercise('랫풀다운')]).next;
 const local=I.updateRoutine(base,base.routines[0].id,'가슴 수정',base.routines[0].exercises).next;
 const remote={...I.copy(base),routines:[base.routines[0]]};
 const out=P.mergeRecords('iron',local,remote,base,{},C,I);
 assert.equal(out.conflicts.length,0);
 assert.deepEqual(out.next.routines.map(x=>x.name),['가슴 수정']);
});
test('identical content is recognized independently of transport revision',()=>{
 const base=I.createRoutine(I.empty(),'가슴',[I.newExercise('벤치프레스')]).next;
 assert.equal(P.equivalent('iron',{...base,revision:'a'},{...base,revision:'b'},C,I),true);
});
test('merge refuses two distinct unfinished sessions',()=>{
 const local=I.start(I.empty(),{}).next,remote=I.start(I.empty(),{}).next;
 const out=P.mergeRecords('iron',local,remote,null,{},C,I);
 assert.equal(out.next,null);assert.match(out.error,/진행 중인 운동/);
});
test('calendar merge preserves events and resolves separately changed goal fields',()=>{
 const base=C.normalizeState({settings:{...C.defaults},events:[]});
 const l=C.upsert({...base,settings:{...base.settings,protein:160}},{id:'l',date:'2026-11-24',start:'07:00',end:'08:00',type:'weight',title:'체중',repeat:'none',completed:true,detail:{weight:80}}).events;
 const r=C.upsert({...base,settings:{...base.settings,carbs:210}},{id:'r',date:'2026-11-25',start:'07:00',end:'08:00',type:'weight',title:'체중',repeat:'none',completed:true,detail:{weight:81}}).events;
 const out=P.mergeRecords('calendar',{...base,events:l,settings:{...base.settings,protein:160}},{...base,events:r,settings:{...base.settings,carbs:210}},base,{},C,I);
 assert.equal(out.next.events.length,2);assert.equal(out.next.settings.protein,160);assert.equal(out.next.settings.carbs,210);
});
