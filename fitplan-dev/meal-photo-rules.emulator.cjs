'use strict';
// Explicit local-only emulator suite; intentionally not in the normal *.test.cjs glob.
// No production project ID or credentials; no network fallback to production.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const host=process.env.FIRESTORE_EMULATOR_HOST||'';
const match=/^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(host);
if(!match||Number(match[2])<1||Number(match[2])>65535)throw Error('FIRESTORE_EMULATOR_HOST must point to a local emulator; production is forbidden.');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,collection,setDoc,getDocFromServer,getDocsFromServer,deleteDoc,updateDoc,Bytes,serverTimestamp,Timestamp}=require('firebase/firestore');
const {createHash}=require('node:crypto');
const fragment=fs.readFileSync(path.join(__dirname,'meal-photo.rules.fragment'),'utf8');
const mergedPath=process.env.FORMDAY_MERGED_RULES_PATH;
// The fixture is NOT the deployed rules. Only a separately verified merged rules file
// can test overlapping allows and existing production-path compatibility.
const rules=mergedPath?fs.readFileSync(mergedPath,'utf8'):
  "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents {\n"+
  "match /users/{uid}/formday_sync/{kind} { allow get, create, update: if request.auth != null && request.auth.uid == uid && kind in ['calendar','iron']; }\n"+
  fragment+"\n} }\n";
const projectId='demo-formday-photo-rules';
const uid='synthetic-owner',other='synthetic-other',id='meal-1';
let env,owner,stranger,guest;
const ref=(db,u=uid,i=id)=>doc(db,'users',u,'formday_meal_photos',i);
const syncRef=(db,u=uid,k='calendar')=>doc(db,'users',u,'formday_sync',k);
const photoCollection=(db,u=uid)=>collection(db,'users',u,'formday_meal_photos');
const raw=(n=12)=>{const b=new Uint8Array(n);b.set([255,216,255]);return b;};
function photo(patch={},i=id,n=12){
 const b=raw(n);
 return {format:1,eventId:i,sha256:createHash('sha256').update(b).digest('hex'),mime:'image/jpeg',size:b.length,bytes:Bytes.fromUint8Array(b),updatedAt:serverTimestamp(),...patch};
}
const syncRecord=()=>({format:1,revision:'fixture-r1',payload:'{"revision":"fixture-r1","events":[]}',updatedAt:serverTimestamp()});
async function seedPhoto(u=uid,i=id){
 await env.withSecurityRulesDisabled(ctx=>setDoc(ref(ctx.firestore(),u,i),photo({},i)));
}
before(async()=>{
 console.log(mergedPath?'MODE: supplied merged rules (local copy; provenance must be verified separately)':'MODE: fixture fragment only — NOT production rules validation');
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:Number(match[2]),rules}});
 owner=env.authenticatedContext(uid).firestore();
 stranger=env.authenticatedContext(other).firestore();
 guest=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  for(const u of [uid,other])for(const k of ['calendar','iron'])await setDoc(syncRef(ctx.firestore(),u,k),syncRecord());
 });
});
after(async()=>{if(env)await env.cleanup();});
test('owner create, read, update and delete exact photo; existing sync records survive',async()=>{
 const c=(await getDocFromServer(syncRef(owner))).data();
 const iron=(await getDocFromServer(syncRef(owner,uid,'iron'))).data();
 await assertSucceeds(setDoc(ref(owner),photo()));
 assert.equal((await assertSucceeds(getDocFromServer(ref(owner)))).data().eventId,id);
 await assertSucceeds(setDoc(ref(owner),photo({},id,30)));
 assert.equal((await getDocFromServer(ref(owner))).data().size,30);
 await assertSucceeds(deleteDoc(ref(owner)));
 assert.equal((await getDocFromServer(ref(owner))).exists(),false);
 assert.deepEqual((await getDocFromServer(syncRef(owner))).data(),c);
 assert.deepEqual((await getDocFromServer(syncRef(owner,uid,'iron'))).data(),iron);
});
test('unrelated account and guest cannot read or list photos',async()=>{
 await seedPhoto();
 for(const db of [stranger,guest]){
  await assertFails(getDocFromServer(ref(db)));
  await assertFails(getDocsFromServer(photoCollection(db)));
 }
});
test('owner cannot list entire photo collection; only exact document access',async()=>{
 await seedPhoto();
 await assertFails(getDocsFromServer(photoCollection(owner)));
 await assertSucceeds(getDocFromServer(ref(owner)));
});
test('unrelated account and guest cannot create, replace, update or delete photos',async()=>{
 await seedPhoto();
 for(const db of [stranger,guest]){
  await assertFails(setDoc(ref(db,uid,'new-meal'),photo({},'new-meal')));
  await assertFails(setDoc(ref(db),photo({},id,30)));
  await assertFails(updateDoc(ref(db),{size:30,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref(db)));
 }
 assert.equal((await getDocFromServer(ref(owner))).data().size,12);
});
test('separate authenticated accounts can only operate on their own namespace',async()=>{
 await assertSucceeds(setDoc(ref(stranger,other),photo()));
 await assertFails(getDocFromServer(ref(owner,other)));
 await assertFails(setDoc(ref(owner,other),photo({},id,30)));
 await assertFails(deleteDoc(ref(owner,other)));
 await assertSucceeds(getDocFromServer(ref(stranger,other)));
});
test('owner is blocked when calendar document is absent',async()=>{
 await env.withSecurityRulesDisabled(ctx=>deleteDoc(syncRef(ctx.firestore())));
 await assertFails(setDoc(ref(owner),photo()));
});
test('invalid required fields, unexpected fields, types and server timestamp are denied',async()=>{
 const missing=photo();delete missing.sha256;
 const cases=[missing,photo({extra:true}),photo({format:2}),photo({eventId:'different'}),photo({sha256:'wrong'}),photo({mime:'image/svg+xml'}),photo({size:'12'}),photo({bytes:'not bytes'}),photo({size:13}),photo({updatedAt:Timestamp.fromMillis(0)})];
 for(const value of cases)await assertFails(setDoc(ref(owner),value));
 await assertFails(setDoc(ref(owner,uid,'bad.id'),photo({},'bad.id')));
 await assertSucceeds(setDoc(ref(owner),photo()));
 await assertFails(updateDoc(ref(owner),{extra:true,updatedAt:serverTimestamp()}));
 assert.equal((await getDocFromServer(ref(owner))).data().size,12);
});
test('byte limits: 11 denied, 716800 accepted, 716801 denied',async()=>{
 const b=new Uint8Array(11);
 await assertFails(setDoc(ref(owner),photo({size:11,bytes:Bytes.fromUint8Array(b)})));
 await assertSucceeds(setDoc(ref(owner),photo({},id,716800)));
 await assertFails(setDoc(ref(owner),photo({},id,716801)));
 assert.equal((await getDocFromServer(ref(owner))).data().size,716800);
});
test('existing calendar and IRON paths still permit the expected owner access and reject other accounts',async()=>{
 for(const k of ['calendar','iron']){
  await assertSucceeds(getDocFromServer(syncRef(owner,uid,k)));
  await assertSucceeds(setDoc(syncRef(owner,uid,k),syncRecord()));
  for(const db of [stranger,guest]){
   await assertFails(getDocFromServer(syncRef(db,uid,k)));
   await assertFails(setDoc(syncRef(db,uid,k),syncRecord()));
  }
 }
});

if(mergedPath) {
 // baseline compatibility additional: these tests target the complete repo rules
 // plus the additive photo rule, not any claimed live production configuration.
 test('existing owner cannot enumerate or delete sync documents, or open arbitrary slots',async()=>{
  for(const k of ['calendar','iron']){
   await assertFails(deleteDoc(syncRef(owner,uid,k)));
   await assertSucceeds(getDocFromServer(syncRef(owner,uid,k)));
  }
  await assertFails(getDocsFromServer(collection(owner,'users',uid,'formday_sync')));
  await assertFails(getDocFromServer(syncRef(owner,uid,'unrelated')));
  await assertFails(setDoc(syncRef(owner,uid,'unrelated'),syncRecord()));
 });
 test('existing calendar and IRON reject invalid schemas after photo rule is added',async()=>{
  for(const k of ['calendar','iron']){
   const target=syncRef(owner,uid,k);
   const before=(await getDocFromServer(target)).data();
   const missing=syncRecord();delete missing.revision;
   for(const invalid of [missing,{...syncRecord(),extra:true},{...syncRecord(),format:2},{...syncRecord(),revision:''},{...syncRecord(),revision:'x'.repeat(101)},{...syncRecord(),payload:123},{...syncRecord(),payload:'x'.repeat(600001)},{...syncRecord(),updatedAt:'not a timestamp'}]){
    await assertFails(setDoc(target,invalid));
   }
   assert.deepEqual((await getDocFromServer(target)).data(),before);
  }
 });
 test('photo rules do not grant access to unrelated document paths, even for the owner',async()=>{
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users',uid,'unrelated','test'),{private:true}));
  for(const db of [owner,stranger,guest]){
   const target=doc(db,'users',uid,'unrelated','test');
   await assertFails(getDocFromServer(target));
   await assertFails(setDoc(target,{private:false}));
   await assertFails(deleteDoc(target));
   await assertFails(getDocsFromServer(collection(db,'users',uid,'unrelated')));
  }
 });
}
