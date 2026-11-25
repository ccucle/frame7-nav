import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Calendar from '../../fitplan/core.js';
import {createMealPhotoAttachment,PHOTO_MAX_BYTES} from '../src/meal-photo-attachment.mjs';
const date='2026-11-25',mealId='synthetic-meal';
const meal={id:mealId,date,start:'12:00',end:'12:30',type:'meal',title:'Synthetic fixture',repeat:'none',repeatUntil:null,completed:true,isSample:false,detail:{food:'테스트 식품',grams:100}};
function calendar(event=meal){const data=Calendar.normalizeState({schemaVersion:3,revision:'r1',settings:{...Calendar.defaults},events:event?[event]:[]});return {format:1,revision:data.revision,payload:JSON.stringify(data)};}
const file=n=>({mealId,date,mime:'image/jpeg',bytes:Uint8Array.from([255,216,255,n,0,0,0,0,0,0,0,0])});
function boot(){
 const state={cal:calendar(),photo:null,consent:true,decode:true,reads:0,writes:0,txCount:0,failReadback:false,lost:false,changed:false};
 const principal={uid:'synthetic-owner'};
 const api=createMealPhotoAttachment({principal,authorizePhoto:async meta=>state.consent&&meta.principal===principal&&meta.mealId===mealId&&meta.date===date,
  decodeImage:async(_,mime)=>{if(!state.decode)throw Error('bad image');return {mime,width:128,height:96};},
  withOwnerTransaction:async(uid,fn)=>{
   assert.equal(uid,principal.uid);state.txCount++;
   if(state.failReadback&&state.writes)throw Error('read unavailable');
   const v=await fn({readCalendar:async()=>{state.reads++;return state.cal;},readPhoto:async(id)=>{assert.equal(id,mealId);return state.photo;},
    createPhoto:async(id,value)=>{assert.equal(id,mealId);assert.equal(state.photo,null);state.photo=value;state.writes++;}});
   if(state.lost&&state.writes)throw Error('response lost');
   return v;
  }});
 return {api,state,principal};
}
test('requires actual trusted host callbacks',()=>{
 assert.throws(()=>createMealPhotoAttachment(),/VERIFIED_OWNER_REQUIRED/);
 assert.throws(()=>createMealPhotoAttachment({principal:{uid:'synthetic-owner'}}),/PHOTO_HOST_NOT_READY/);
});
test('attach original to saved meal ID, read back verified; calendar unchanged',async()=>{
 const {api,state}=boot(),before=state.cal,p=file(1);
 const r=await api.attach(p);
 assert.equal(r.status,'saved');assert.equal(r.mealId,mealId);assert.equal(r.readBackVerified,true);
 assert.equal(r.sha256,createHash('sha256').update(p.bytes).digest('hex'));
 assert.deepEqual(state.photo.bytes,Buffer.from(p.bytes));assert.equal(state.cal,before);
 assert.equal(state.writes,1);assert.equal(state.txCount,2);assert.equal(Object.hasOwn(r,'bytes'),false);
});
test('same bytes retry returns already_saved; different photo never overwrites',async()=>{
 const {api,state}=boot();await api.attach(file(1));
 assert.equal((await api.attach(file(1))).status,'already_saved');
 await assert.rejects(api.attach(file(2)),/PHOTO_EXISTS_DIFFERENT/);assert.equal(state.writes,1);
});
test('denied consent, extra UID, malformed file, oversized bytes and failed decode never write',async()=>{
 const {api,state}=boot();
 state.consent=false;await assert.rejects(api.attach(file(1)),/PHOTO_CONSENT_REQUIRED/);state.consent=true;
 await assert.rejects(api.attach({...file(1),uid:'other-user'}),/INVALID_ATTACHMENT_INPUT/);
 await assert.rejects(api.attach({...file(1),mime:'image/png'}),/INVALID_PHOTO_SIGNATURE/);
 await assert.rejects(api.attach({...file(1),bytes:new Uint8Array(PHOTO_MAX_BYTES+1)}),/INVALID_PHOTO_FILE/);
 state.decode=false;await assert.rejects(api.attach(file(1)),/INVALID_IMAGE_DECODE/);
 assert.equal(state.writes,0);assert.equal(state.txCount,0);
});
test('missing, wrong-date, incomplete and sample meal blocked',async()=>{
 for(const e of [null,{...meal,date:'2026-11-24'},{...meal,completed:false},{...meal,isSample:true}]){
  const {api,state}=boot();state.cal=calendar(e);
  await assert.rejects(api.attach(file(1)),/MEAL_NOT_(UNIQUE|ELIGIBLE)/);assert.equal(state.writes,0);
 }
});
test('uncertain write result is not reported saved; exact retry resolves existing photo',async()=>{
 const {api,state}=boot();state.lost=true;
 await assert.rejects(api.attach(file(1)),/PHOTO_OUTCOME_UNKNOWN/);
 assert.equal(state.writes,1);state.lost=false;
 assert.equal((await api.attach(file(1))).status,'already_saved');assert.equal(state.writes,1);
});
test('readback failure cannot produce success; exact retry is idempotent',async()=>{
 const {api,state}=boot();state.failReadback=true;
 await assert.rejects(api.attach(file(1)),/PHOTO_READBACK_UNAVAILABLE/);
 state.failReadback=false;assert.equal((await api.attach(file(1))).status,'already_saved');
 assert.equal(state.writes,1);
});
test('corrupt stored bytes fail closed',async()=>{
 const {api,state}=boot();await api.attach(file(1));state.photo.bytes=Buffer.from(file(2).bytes);
 await assert.rejects(api.attach(file(1)),/CORRUPT_PHOTO/);assert.equal(state.writes,1);
});
