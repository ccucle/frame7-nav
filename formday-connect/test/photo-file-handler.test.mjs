import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOwnerPhotoTransaction} from '../src/firebase-photo-transaction.mjs';
import {createPhotoFileHandler,PHOTO_ATTACH_TOOL} from '../src/photo-file-handler.mjs';
import {FIREBASE_PROJECT} from '../src/firebase-rest.mjs';

const uid='synthetic-owner',token='synthetic-only-'.repeat(16),principal={uid,token};
const mealId='synthetic-meal',date='2026-11-25',bytes=Uint8Array.from([255,216,255,1,0,0,0,0,0,0,0,0]);
const sha256=createHash('sha256').update(bytes).digest('hex');
const root='projects/'+FIREBASE_PROJECT+'/databases/(default)/documents';
const path='users/'+uid+'/formday_meal_photos/'+mealId;
const calPath='users/'+uid+'/formday_sync/calendar';
const base='https://firestore.googleapis.com/v1/'+root;
const str=stringValue=>({stringValue});
const payload={schemaVersion:3,revision:'r1',events:[{id:mealId,date,start:'12:00',end:'12:30',type:'meal',title:'Synthetic',repeat:'none',completed:true,isSample:false,detail:{food:'테스트',grams:100}}],settings:{protein:150,carbs:200,fat:50}};
const cal={name:root+'/'+calPath,fields:{format:{integerValue:'1'},revision:str('r1'),payload:str(JSON.stringify(payload))}};
function boot(){
 const state={photo:null,writes:0,requests:[],lose:false,deny:false,stale:false};
 const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.redirect,'error');assert.ok(url.startsWith(base));
  const suffix=url.slice(base.length),body=init.body&&JSON.parse(init.body);
  state.requests.push({suffix,method:init.method,body});
  if(suffix===':beginTransaction')return json({transaction:'dGVzdA=='});
  if(suffix===':rollback')return json({});
  if(suffix.startsWith('/'+calPath+'?'))return json(cal);
  if(suffix.startsWith('/'+path+'?'))return state.deny?json({},403):state.photo?json(state.photo):json({},404);
  if(suffix===':commit'){
   assert.equal(body.transaction,'dGVzdA==');assert.equal(body.writes.length,1);
   const w=body.writes[0];assert.equal(w.update.name,root+'/'+path);
   assert.deepEqual(w.currentDocument,{exists:false});assert.deepEqual(w.updateTransforms,[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]);
   if(state.stale||state.photo)return json({},409);
   state.writes++;state.photo={...w.update,fields:{...w.update.fields,updatedAt:{timestampValue:'2026-11-25T12:00:00Z'}}};
   if(state.lose)throw Error('simulated reply loss');
   return json({writeResults:[{}],commitTime:'2026-11-25T12:00:00Z'});
  }
  throw Error('Unexpected request');
 };
 const factory=()=>createOwnerPhotoTransaction({principal,verifyFirebaseToken:async t=>({uid,token:t}),fetchImpl});
 return {state,factory};
}
const record={format:1,eventId:mealId,sha256,size:bytes.length,mime:'image/jpeg',bytes};
test('reject mismatched identity before any Firestore request',async()=>{
 let n=0;await assert.rejects(createOwnerPhotoTransaction({principal,verifyFirebaseToken:async()=>({uid:'different-owner',token}),fetchImpl:async()=>{n++;}}),/OWNER_TOKEN_MISMATCH/);assert.equal(n,0);
});
test('owner-scoped transaction writes only exact photo doc with create precondition and server timestamp',async()=>{
 const {state,factory}=boot(),tx=await factory();await tx(uid,async t=>{assert.equal((await t.readCalendar()).revision,'r1');assert.equal(await t.readPhoto(mealId),null);await t.createPhoto(mealId,record);});
 assert.equal(state.writes,1);
 const actual=await tx(uid,async t=>{await t.readCalendar();return t.readPhoto(mealId);});
 assert.equal(actual.sha256,sha256);assert.deepEqual(actual.bytes,Buffer.from(bytes));
 assert.equal(state.requests.filter(r=>r.suffix===':commit').length,1);assert.equal(state.requests.filter(r=>r.suffix===':rollback').length,1);
});
test('no other UID or arbitrary paths or write before reads',async()=>{
 const {state,factory}=boot(),tx=await factory();
 await assert.rejects(tx('different-owner',async()=>{}),/OWNER_SCOPE_MISMATCH/);assert.equal(state.requests.length,0);
 await assert.rejects(tx(uid,t=>t.createPhoto(mealId,record)),/PHOTO_CREATE_PRECONDITION/);
 await assert.rejects(tx(uid,async t=>{await t.readCalendar();await t.readPhoto('../other');}),/INVALID_PHOTO_READ_SCOPE/);
 assert.equal(state.writes,0);assert.equal(state.requests.filter(r=>r.suffix===':commit').length,0);
});
test('permission denial and stale precondition cannot silently write or retry',async()=>{
 const {state,factory}=boot(),tx=await factory();
 const action=t=>t.readCalendar().then(()=>t.readPhoto(mealId)).then(()=>t.createPhoto(mealId,record));
 state.deny=true;await assert.rejects(tx(uid,action),/403/);state.deny=false;state.stale=true;
 await assert.rejects(tx(uid,action),/409/);
 assert.equal(state.writes,0);assert.equal(state.requests.filter(r=>r.suffix===':commit').length,1);
});
test('lost commit acknowledgement triggers neither second commit nor rollback of uncertain write',async()=>{
 const {state,factory}=boot(),tx=await factory();state.lose=true;
 await assert.rejects(tx(uid,async t=>{await t.readCalendar();await t.readPhoto(mealId);await t.createPhoto(mealId,record);}),/reply loss/);
 assert.equal(state.writes,1);assert.equal(state.requests.filter(r=>r.suffix===':commit').length,1);assert.equal(state.requests.filter(r=>r.suffix===':rollback').length,0);
});
test('file descriptor uses official top-level fileParams and requires all four schema properties',()=>{
 assert.deepEqual(PHOTO_ATTACH_TOOL._meta['openai/fileParams'],['file']);
 assert.deepEqual(Object.keys(PHOTO_ATTACH_TOOL.inputSchema.properties.file.properties).sort(),['download_url','file_id','file_name','mime_type']);
 assert.equal(PHOTO_ATTACH_TOOL.annotations.readOnlyHint,false);
});
const input={mealId,date,file:{file_id:'file_synthetic',download_url:'https://example.invalid/temporary',mime_type:'image/jpeg',file_name:'synthetic.jpg'}};
function ingress(){
 const {state,factory}=boot();let fileReads=0;
 const handler=createPhotoFileHandler({resolvePrincipal:async()=>principal,transactionFactory:async()=>factory(),
  resolveAuthorizedFile:async(ref,p,opts)=>{fileReads++;assert.equal(p,principal);assert.equal(opts.maxBytes,716800);return {fileId:ref.file_id,mime:'image/jpeg',bytes};},
  authorizePhoto:async meta=>meta.principal===principal&&meta.mealId===mealId&&meta.fileId==='file_synthetic',
  decodeImage:async(_,mime)=>({mime,width:128,height:96})});
 return {state,handler,fileReads:()=>fileReads};
}
test('host file reference -> exact photo attachment -> verified readback and same-file retry (synthetic only)',async()=>{
 const {handler,state,fileReads}=ingress();
 const saved=await handler(input);assert.equal(saved.status,'saved');assert.equal(saved.readBackVerified,true);assert.equal(saved.sha256,sha256);
 const repeated=await handler(input);assert.equal(repeated.status,'already_saved');assert.equal(state.writes,1);assert.equal(fileReads(),2);assert.equal(Object.hasOwn(saved,'bytes'),false);
});
test('no resolver means unavailable, unknown arguments rejected, MIME mismatch produces no write',async()=>{
 assert.throws(()=>createPhotoFileHandler(),/PHOTO_HOST_NOT_READY/);
 const {handler,state,fileReads}=ingress();
 await assert.rejects(handler({...input,uid:'other-owner'}),/INVALID_ATTACHMENT_INPUT/);
 await assert.rejects(handler({...input,file:{...input.file,mime_type:'image/png'}}),/HOST_FILE_MIME_MISMATCH/);
 assert.equal(state.writes,0);assert.equal(fileReads(),1);
});
test('unattested file reference fails closed without generic URL retrieval',async()=>{
 const {state,factory}=boot();const handler=createPhotoFileHandler({resolvePrincipal:async()=>principal,transactionFactory:async()=>factory(),
  resolveAuthorizedFile:async()=>{throw Error('HOST_FILE_NOT_AUTHORIZED');},authorizePhoto:async()=>true,decodeImage:async()=>({})});
 await assert.rejects(handler(input),/HOST_FILE_NOT_AUTHORIZED/);assert.equal(state.requests.length,0);
});
