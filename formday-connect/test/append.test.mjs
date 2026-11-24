import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createReader} from '../src/reader.mjs';
import Calendar from '../../fitplan/core.js';
import Iron from '../../fitplan/iron-store.js';
import {createAppendDispatcher,createPreviewCodec} from '../src/append.mjs';
import {createUserScopedFirestoreReader} from '../src/firebase-rest.mjs';
import {createUserScopedFirestoreCommitter} from '../src/firebase-append.mjs';
import {createProtectedMcpHandler} from '../src/mcp-gateway.mjs';

const uid='syntheticUser123',resource='https://formday-test.example/mcp';
const principal={uid,token:'synthetic-'.repeat(30)};
const key=randomBytes(32).toString('base64url');
const routineInput={routineId:'r1',date:'2026-11-30',start:'18:00',end:'19:00'};
const programInput={name:'주간 프로그램',mode:'fixed',routineIds:['r1'],weekdays:{1:'r1'}};
const mealInput={date:'2026-11-24',start:'12:00',end:'12:30',title:'점심',
 items:[{name:'비빔밥',amount:1,unit:'serving',evidence:'photo_estimate'}]};
function fixture(){
 const calendar=Calendar.normalizeState({schemaVersion:3,revision:'c1',settings:{},events:[
  {id:'history1',date:'2026-11-20',start:'09:00',end:'09:05',type:'weight',title:'체중',repeat:'none',completed:true,detail:{weight:80}}
 ]});
 calendar.events[0].originalExtension={untouched:true};calendar.customSetting='keep';
 const iron=Iron.normalize({version:1,revision:'i1',sessions:[],programs:[],routines:[
  {id:'r1',name:'가슴루틴1',exercises:[{id:'e1',name:'벤치프레스',sets:[
   {id:'s1',weight:60,reps:10,rpe:8,restSec:90,warmup:false}]}]}
 ]});
 const docs={calendar:{format:1,revision:'c1',payload:JSON.stringify(calendar),updateTime:'2026-11-24T00:00:00Z'},
  iron:{format:1,revision:'i1',payload:JSON.stringify(iron),updateTime:'2026-11-24T00:00:00Z'}};
 const calls=[];let commits=0,now=Date.parse('2026-11-24T01:00:00Z'),lostReply=false,denied=false,race=false;
 const prefix='projects/healthy-df79f/databases/(default)/documents/';
 const url='https://firestore.googleapis.com/v1/'+prefix;
 const fetchImpl=async(target,options)=>{
  calls.push({target,options});assert.equal(options.headers.Authorization,'Bearer '+principal.token);
  if(options.method==='GET'){
   assert.ok(target.startsWith(url+'users/'+uid+'/formday_sync/'));
   const kind=target.split('/').at(-1);assert.ok(['calendar','iron'].includes(kind));
   const d=docs[kind];if(!d)return new Response(null,{status:404});
   return Response.json({updateTime:d.updateTime,fields:{format:{integerValue:'1'},revision:{stringValue:d.revision},payload:{stringValue:d.payload}}});
  }
  assert.equal(target,url.slice(0,-1)+':commit');assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);assert.equal(body.writes.length,1);
  const w=body.writes[0],kind=w.update.name.split('/').at(-1);
  assert.equal(w.update.name,prefix+'users/'+uid+'/formday_sync/'+kind);
  assert.deepEqual(w.updateMask.fieldPaths,['format','revision','payload']);
  assert.deepEqual(w.updateTransforms,[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]);
  if(denied)return new Response(null,{status:403});
  if(race){race=false;docs[kind].updateTime='2026-11-24T01:00:00Z';}
  if(w.currentDocument.updateTime!==docs[kind].updateTime)return new Response(null,{status:409});
  const f=w.update.fields;
  docs[kind]={format:1,revision:f.revision.stringValue,payload:f.payload.stringValue,updateTime:'2026-11-24T02:00:'+String(++commits).padStart(2,'0')+'Z'};
  if(lostReply){lostReply=false;throw Error('simulated reply lost after commit');}
  return Response.json({writeResults:[{updateTime:docs[kind].updateTime}],commitTime:docs[kind].updateTime});
 };
 const codec=createPreviewCodec(key);
 const dispatch=(override={})=>createAppendDispatcher({uid,scope:'formday:read formday:append',resource,
  loadDocument:createUserScopedFirestoreReader({principal,fetchImpl}),
  commitDocument:createUserScopedFirestoreCommitter({principal,fetchImpl}),codec,clock:()=>now,...override});
 return {docs,calendar,iron,fetchImpl,codec,dispatch:dispatch(),make:dispatch,calls,
  commits:()=>commits,expire:()=>now+=600001,loseReply:()=>lostReply=true,deny:()=>denied=true,race:()=>race=true};
}
const commit=(f,p)=>f.dispatch('formday_commit_append',{previewToken:p.previewToken});
test('routine preview writes nothing; commit preserves history and copies an uncompleted calendar plan',async()=>{
 const f=fixture(),originalIron=f.docs.iron.payload;
 const p=await f.dispatch('formday_preview_routine',routineInput);
 assert.equal(f.commits(),0);assert.equal(p.entry.type,'strength');
 const r=await commit(f,p);assert.equal(r.status,'saved');assert.equal(r.readBackVerified,true);
 assert.deepEqual(f.calls.slice(-2).map(c=>c.options.method),['POST','GET']);
 assert.equal(f.calls.at(-1).target.split('/').at(-1),'calendar');
 assert.equal(r.revision,f.docs.calendar.revision);
 const data=JSON.parse(f.docs.calendar.payload);
 assert.deepEqual(data.events[0],f.calendar.events[0]);assert.equal(data.customSetting,'keep');
 assert.equal(data.events[1].completed,false);assert.equal(data.events[1].detail.exercises[0].sets[0].done,false);
 assert.equal(data.events[1].detail.exercises[0].sets[0].weight,60);
 assert.equal(f.docs.iron.payload,originalIron);assert.equal(Calendar.normalizeState(data).events.length,2);
});
test('program addition is compatible with site normalization and preserves routines/sessions',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_program',programInput);
 await commit(f,p);const data=JSON.parse(f.docs.iron.payload);
 assert.deepEqual(data.routines,f.iron.routines);assert.deepEqual(data.sessions,f.iron.sessions);
 assert.deepEqual(Iron.normalize(data).programs[0],p.entry);
 assert.equal(data.programs[0].weekdays['1'],'r1');
});
test('photo meal keeps unknown nutrition null and preserves estimate wording through site roundtrip',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 await commit(f,p);const e=Calendar.normalizeState(JSON.parse(f.docs.calendar.payload)).events[1];
 assert.equal(e.completed,true);assert.equal(e.detail.items[0].food.nutrients.kcal,null);
 assert.match(e.detail.items[0].food.source.label,/사진 기반 추정/);
 assert.match(e.detail.notes,/사진 기반 추정/);
});
test('supplied estimates remain labelled; unknown or incomplete label nutrition is refused',async()=>{
 const f=fixture(),nutrition={basisAmount:1,kcal:500,protein:20,carbs:70,fat:15};
 const p=await f.dispatch('formday_preview_meal',{...mealInput,items:[{...mealInput.items[0],nutrition}]});
 assert.equal(p.entry.detail.items[0].food.nutrients.kcal,500);
 assert.equal(p.entry.detail.items[0].food.source.kind,'unknown');
 await assert.rejects(f.dispatch('formday_preview_meal',{...mealInput,items:[{...mealInput.items[0],evidence:'unknown',nutrition}]}));
 await assert.rejects(f.dispatch('formday_preview_meal',{...mealInput,items:[{...mealInput.items[0],evidence:'user_label'}]}));
 assert.equal(f.commits(),0);
});
test('repeat commit is idempotent, including reply lost after successful save',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 f.loseReply();await assert.rejects(commit(f,p),/outcome unknown/);
 const reconciled=await commit(f,p);
 assert.equal(reconciled.status,'already_saved');assert.equal(reconciled.readBackVerified,true);assert.equal(f.commits(),1);
 assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
 assert.equal(f.calls.at(-1).options.method,'GET');
 f.expire();assert.equal((await commit(f,p)).status,'already_saved');assert.equal(f.commits(),1);
 assert.equal((await commit(f,p)).status,'already_saved');assert.equal(f.commits(),1);
});
test('an acknowledged commit with unavailable read-back is not reported saved or resent',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 const load=createUserScopedFirestoreReader({principal,fetchImpl:f.fetchImpl});
 const guarded=f.make({loadDocument:async path=>{
  if(f.commits()>0)throw Error('simulated read permission or network failure');
  return load(path);
 }});
 await assert.rejects(guarded('formday_commit_append',{previewToken:p.previewToken}),/verification unavailable.*SAME previewToken/);
 assert.equal(f.commits(),1);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
 const retry=await commit(f,p);assert.equal(retry.status,'already_saved');assert.equal(retry.readBackVerified,true);
 assert.equal(f.commits(),1);
});
test('retry never confirms a corrupted snapshot containing duplicate addition IDs',async()=>{
 for(const [tool,input,kind,collection] of [
  ['formday_preview_meal',mealInput,'calendar','events'],
  ['formday_preview_program',programInput,'iron','programs']
 ]){
  const f=fixture(),p=await f.dispatch(tool,input);await commit(f,p);
  const data=JSON.parse(f.docs[kind].payload);data[collection].push(structuredClone(p.entry));
  f.docs[kind].payload=JSON.stringify(data);
  await assert.rejects(commit(f,p),/중복|duplicated/);
  assert.equal(f.commits(),1);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
 }
});
test('an acknowledged commit whose entry is missing on read-back is not reported saved',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 const load=createUserScopedFirestoreReader({principal,fetchImpl:f.fetchImpl});
 const guarded=f.make({loadDocument:async path=>{
  if(f.commits()>0){
   const data=JSON.parse(f.docs.calendar.payload);data.events=data.events.filter(e=>e.id!==p.entry.id);
   data.revision='site_after_save';
   f.docs.calendar={...f.docs.calendar,revision:data.revision,payload:JSON.stringify(data),updateTime:'2026-11-24T02:05:00Z'};
  }
  return load(path);
 }});
 await assert.rejects(guarded('formday_commit_append',{previewToken:p.previewToken}),/exact saved addition could not be verified/);
 assert.equal(f.commits(),1);
 await assert.rejects(commit(f,p),/records changed/);assert.equal(f.commits(),1);
});
test('an acknowledged commit whose entry changed before read-back is not reported saved',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 const load=createUserScopedFirestoreReader({principal,fetchImpl:f.fetchImpl});
 const guarded=f.make({loadDocument:async path=>{
  if(f.commits()>0){
   const data=JSON.parse(f.docs.calendar.payload);data.events.find(e=>e.id===p.entry.id).title='사이트에서 수정한 제목';
   data.revision='site_after_save';
   f.docs.calendar={...f.docs.calendar,revision:data.revision,payload:JSON.stringify(data),updateTime:'2026-11-24T02:05:00Z'};
  }
  return load(path);
 }});
 await assert.rejects(guarded('formday_commit_append',{previewToken:p.previewToken}),/exact saved addition could not be verified/);
 assert.equal(f.commits(),1);
 await assert.rejects(commit(f,p),/Existing addition changed/);assert.equal(f.commits(),1);
});
test('read-back confirms the addition while preserving a later unrelated site edit',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_program',programInput);
 const load=createUserScopedFirestoreReader({principal,fetchImpl:f.fetchImpl});
 const guarded=f.make({loadDocument:async path=>{
  if(f.commits()>0){
   const data=JSON.parse(f.docs.iron.payload);data.favoriteExercises=['bench'];data.revision='site_after_save';
   f.docs.iron={...f.docs.iron,revision:data.revision,payload:JSON.stringify(data),updateTime:'2026-11-24T02:05:00Z'};
  }
  return load(path);
 }});
 const result=await guarded('formday_commit_append',{previewToken:p.previewToken});
 assert.equal(result.status,'saved');assert.equal(result.readBackVerified,true);assert.equal(result.revision,'site_after_save');
 assert.deepEqual(JSON.parse(f.docs.iron.payload).favoriteExercises,['bench']);
 assert.deepEqual(JSON.parse(f.docs.iron.payload).programs[0],p.entry);assert.equal(f.commits(),1);
 assert.deepEqual(f.calls.slice(-2).map(c=>c.options.method),['POST','GET']);
 assert.equal(f.calls.at(-1).target.split('/').at(-1),'iron');
});
test('a deleted addition is not recreated by retrying its old preview',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);await commit(f,p);
 const d=JSON.parse(f.docs.calendar.payload);d.events=d.events.filter(e=>e.id!==p.entry.id);
 f.docs.calendar.payload=JSON.stringify(d);
 await assert.rejects(commit(f,p),/records changed/);assert.equal(f.commits(),1);
});
test('changes before commit and races after reading are rejected without overwriting',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 f.docs.calendar.updateTime='2026-11-24T00:01:00Z';await assert.rejects(commit(f,p),/records changed/);
 const fresh=await f.dispatch('formday_preview_meal',mealInput);f.race();
 await assert.rejects(commit(f,fresh),/records changed/);assert.equal(f.commits(),0);
});
test('simultaneous commits of the same preview append only once',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 const results=await Promise.allSettled([commit(f,p),commit(f,p)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.commits(),1);
 assert.equal((await commit(f,p)).status,'already_saved');
});
test('preview is bound to user, audience, signature and expiry',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);
 await assert.rejects(f.make({uid:'anotherUser123'})('formday_commit_append',{previewToken:p.previewToken}),/identity/);
 await assert.rejects(f.make({resource:'https://elsewhere.example/mcp'})('formday_commit_append',{previewToken:p.previewToken}),/audience/);
 const parts=p.previewToken.split('.');const body=JSON.parse(Buffer.from(parts[0],'base64url'));body.entity.title='tampered';
 await assert.rejects(commit(f,{previewToken:Buffer.from(JSON.stringify(body)).toString('base64url')+'.'+parts[1]}),/signature/);
 f.expire();await assert.rejects(commit(f,p),/expired/);assert.equal(f.commits(),0);
});
test('read-only scope, arbitrary paths and uid input cannot reach writes',async()=>{
 const f=fixture();await assert.rejects(f.make({scope:'formday:read'})('formday_preview_meal',mealInput),/consent/);
 await assert.rejects(f.dispatch('formday_preview_meal',{...mealInput,uid:'anotherUser123'}));
 const writer=createUserScopedFirestoreCommitter({principal,fetchImpl:f.fetchImpl});
 for(const p of ['users/otherUser/formday_sync/calendar','users/'+uid+'/formday_sync/calendar?x','users/'+uid+'/private'])
  await assert.rejects(writer(p,{},''),/path/);
 assert.equal(f.calls.length,0);
});
test('invalid dates, missing routines, duplicate references and invalid schedule are refused',async()=>{
 const f=fixture();
 await assert.rejects(f.dispatch('formday_preview_routine',{...routineInput,date:'2026-02-30'}));
 await assert.rejects(f.dispatch('formday_preview_routine',{...routineInput,routineId:'absent'}));
 await assert.rejects(f.dispatch('formday_preview_routine',{...routineInput,end:'17:00'}));
 await assert.rejects(f.dispatch('formday_preview_program',{...programInput,routineIds:['r1','r1']}));
 await assert.rejects(f.dispatch('formday_preview_program',{...programInput,weekdays:{}}));
 assert.equal(f.commits(),0);
});
test('missing, invalid, demo or oversized cloud snapshots never get replaced',async()=>{
 for(const mutate of [f=>f.docs.calendar=null,f=>f.docs.calendar.updateTime=undefined,
  f=>f.docs.calendar.revision='mismatch',f=>{const d=JSON.parse(f.docs.calendar.payload);d.demo=true;f.docs.calendar.payload=JSON.stringify(d);},
  f=>{const d=JSON.parse(f.docs.calendar.payload);d.preserved='x'.repeat(550000);f.docs.calendar.payload=JSON.stringify(d); }]){
  const f=fixture();mutate(f);await assert.rejects(f.dispatch('formday_preview_meal',mealInput));assert.equal(f.commits(),0);
 }
});
test('permission denial is never reported as a completed save',async()=>{
 const f=fixture(),p=await f.dispatch('formday_preview_meal',mealInput);f.deny();
 await assert.rejects(commit(f,p),/permission denied/);assert.equal(f.commits(),0);
});
function rpc(method,params){return new Request(resource,{method:'POST',headers:{
 'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer synthetic-access'},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
async function rpcData(response){const text=await response.text();
 const payload=text.startsWith('event:')||text.startsWith('data:')?text.split('\n').find(x=>x.startsWith('data:')).slice(5):text;
 return JSON.parse(payload);}
test('MCP exposes append tools only with feature flag and consent; actual RPC preview and commit work',async()=>{
 const f=fixture();
 const handler=(scope,enableAppend)=>createProtectedMcpHandler({baseUrl:new URL(resource).origin,fetchImpl:f.fetchImpl,
  authenticateRequest:async()=>({uid,firebaseIdToken:principal.token,scope}),verifyFirebaseToken:async()=>principal,
  enableAppend,previewCodec:f.codec,clock:()=>Date.parse('2026-11-24T01:00:00Z')});
 for(const [scope,flag] of [['formday:read',true],['formday:read formday:append',false]]){
  const h=handler(scope,flag),list=await rpcData(await h(rpc('tools/list',{})));
  assert.equal(list.result.tools.length,6);
  const denied=await rpcData(await h(rpc('tools/call',{name:'formday_commit_append',arguments:{previewToken:'x'.repeat(70)}})));
  assert.ok(denied.error||denied.result?.isError);
 }
 const h=handler('formday:read formday:append',true),list=await rpcData(await h(rpc('tools/list',{})));
 assert.equal(list.result.tools.length,10);
 assert.equal(list.result.tools.find(x=>x.name==='formday_commit_append').annotations.readOnlyHint,false);
 const p=await rpcData(await h(rpc('tools/call',{name:'formday_preview_meal',arguments:mealInput})));
 const preview=JSON.parse(p.result.content[0].text);
 const r=await rpcData(await h(rpc('tools/call',{name:'formday_commit_append',arguments:{previewToken:preview.previewToken}})));
 assert.equal(JSON.parse(r.result.content[0].text).status,'saved');assert.equal(f.commits(),1);
 assert.equal((await handler(undefined,true)(rpc('tools/list',{}))).status,401);
});

test('new meal portions/evidence and programs are readable after append',async()=>{
 const f=fixture();
 const meal=await f.dispatch('formday_preview_meal',mealInput);await commit(f,meal);
 const program=await f.dispatch('formday_preview_program',programInput);await commit(f,program);
 const read=createReader({verifiedUid:uid,loadDocument:createUserScopedFirestoreReader({principal,fetchImpl:f.fetchImpl})});
 const result=await read.meals({from:'2026-11-24',to:'2026-11-24'}),item=result.records[0].items[0];
 assert.equal(item.amount,1);assert.equal(item.unit,'serving');assert.equal(item.grams,null);
 assert.equal(item.nutrientsPerBasis.kcal,null);assert.match(item.source.label,/사진 기반 추정/);
 const routines=await read.routines();assert.equal(routines.programs[0].id,program.entry.id);
 assert.equal(routines.programs[0].weekdays['1'],'r1');
});
