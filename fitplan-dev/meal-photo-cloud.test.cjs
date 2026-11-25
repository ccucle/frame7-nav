'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const C=require('../fitplan/core.js');
const P=require('../fitplan/meal-photo-policy.js');
const S=require('../fitplan/sync-policy.js');
const source=fs.readFileSync(require.resolve('../fitplan/meal-photo.js'),'utf8').replace(/^import .*?;\s*$/gm,'');
const date='2026-11-25',uid='test-owner',other='test-other';
const meal={id:'synthetic-meal',date,start:'12:00',end:'12:30',type:'meal',title:'Synthetic fixture',repeat:'none',completed:true,isSample:false,detail:{food:'테스트 식품',grams:100}};
const calendarPath=u=>'users/'+u+'/formday_sync/calendar';
const ironPath=u=>'users/'+u+'/formday_sync/iron';
const photoPath=u=>'users/'+u+'/formday_meal_photos/'+meal.id;
const calendar=(event=meal)=>{const payload=C.normalizeState({revision:'synthetic-r1',settings:{...C.defaults},events:event?[event]:[]});return {format:1,revision:payload.revision,payload:JSON.stringify(payload)};};
const bytes=n=>Uint8Array.from([255,216,255,n,0,0,0,0,0,0,0,0]);
const sha=async b=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const candidate=async n=>{const b=bytes(n);return {bytes:b,mime:'image/jpeg',sha256:await sha(b)};};
class MockBytes{constructor(b){this.b=b.slice();}toUint8Array(){return this.b.slice();}static fromUint8Array(b){return new MockBytes(b);}}
function boot(event=meal){
  const db=new Map([[calendarPath(uid),calendar()],[calendarPath(other),calendar()],[ironPath(uid),{opaque:'unchanged iron'}]]);
  const state={currentUid:uid,reads:[],writes:[],transactions:0,deny:false,failWrite:false,failReadback:false,failAfterCommit:false,onTxRead:null,onCommitted:null};
  const beforeCalendar=db.get(calendarPath(uid)),beforeIron=db.get(ironPath(uid)),beforeOther=db.get(calendarPath(other));
  const guard=()=>{if(state.currentUid!==uid)throw Error('account changed');};
  const check=path=>{if(state.deny||!path.startsWith('users/'+state.currentUid+'/'))throw Error('permission denied');};
  const snap=path=>({exists:()=>db.has(path),data:()=>db.get(path)});
  const doc=(_, ...parts)=>parts.join('/');
  const get=async path=>{check(path);state.reads.push(path);if(state.failReadback&&state.writes.length)throw Error('readback lost');return snap(path);};
  const runTransaction=async (_,callback)=>{
    state.transactions++;
    if(state.failWrite)throw Error('quota exceeded');
    const queued=[];
    await callback({
      get:async path=>{check(path);state.reads.push(path);const s=snap(path);state.onTxRead?.(path);return s;},
      set:(path,value)=>{check(path);queued.push(['set',path,value]);},
      delete:path=>{check(path);queued.push(['delete',path]);}
    });
    for(const [action,path,value] of queued){
      check(path);if(action==='set')db.set(path,value);else db.delete(path);state.writes.push([action,path]);
    }
    state.onCommitted?.();
    if(state.failAfterCommit)throw Error('response lost after commit');
  };
  const w={FormdayMealPhotoPolicy:P,FormdayCore:C,FormdaySyncPolicy:S};
  const apiFactory=new Function('window','crypto','Bytes','doc','getDocFromServer','runTransaction','serverTimestamp',source+'\nreturn cloud;')(w,webcrypto,MockBytes,doc,get,runTransaction,()=>0);
  const api=apiFactory(event,guard,db,uid);
  return {db,state,api,apiFactory,guard,checkUnchanged(){assert.equal(db.get(calendarPath(uid)),beforeCalendar);assert.equal(db.get(ironPath(uid)),beforeIron);assert.equal(db.get(calendarPath(other)),beforeOther);}};
}
test('photo create and exact readback, no mutation to calendar or IRON',async()=>{
  const h=boot(),p=await candidate(1);
  assert.equal(await h.api.read(),null);
  assert.equal((await h.api.save(null,p)).sha256,p.sha256);
  assert.deepEqual((await h.api.read()).bytes,p.bytes);
  assert.deepEqual(h.state.writes,[['set',photoPath(uid)]]);
  assert.equal(h.db.has(photoPath(other)),false);
  h.checkUnchanged();
});
test('same-request save and stale replace cannot duplicate or overwrite',async()=>{
  const h=boot(),a=await candidate(1),b=await candidate(2);
  await h.api.save(null,a);await h.api.save(null,a);
  await assert.rejects(h.api.save(null,b),/다른 기기/);
  assert.equal(h.state.writes.length,1);
  assert.equal((await h.api.read()).sha256,a.sha256);
  h.checkUnchanged();
});
test('explicit replace and delete require observed digest and preserve meal',async()=>{
  const h=boot(),a=await candidate(1),b=await candidate(2);
  await h.api.save(null,a);await h.api.save(a.sha256,b);
  await assert.rejects(h.api.save(a.sha256,null),/다른 기기/);
  assert.equal((await h.api.read()).sha256,b.sha256);
  assert.equal(await h.api.save(b.sha256,null),null);
  assert.equal(await h.api.save(b.sha256,null),null);
  assert.deepEqual(h.state.writes,[['set',photoPath(uid)],['set',photoPath(uid)],['delete',photoPath(uid)]]);
  h.checkUnchanged();
});
test('malformed or tampered new byte payload never enters transaction',async()=>{
  const h=boot(),a=await candidate(1),b=await candidate(2);
  await assert.rejects(h.api.save(null,{...a,bytes:b.bytes}),/무결성/);
  await assert.rejects(h.api.save(null,{...a,mime:'image/png'}));
  await assert.rejects(h.api.save(null,{...a,bytes:new Uint8Array(P.MAX_BYTES+1)}));
  assert.equal(h.state.transactions,0);assert.equal(h.state.writes.length,0);h.checkUnchanged();
});
test('missing calendar or wrong or unfinished record prevents writes',async()=>{
  const a=await candidate(1);
  for(const value of [null,calendar(null),calendar({...meal,id:'different-id'}),calendar({...meal,date:'2026-11-24'}),calendar({...meal,completed:false}),calendar({...meal,isSample:true}),calendar({...meal,repeat:'daily'})]){
    const h=boot();
    if(value===null)h.db.delete(calendarPath(uid));else h.db.set(calendarPath(uid),value);
    await assert.rejects(h.api.save(null,a));assert.equal(h.state.writes.length,0);
  }
});
test('corrupt stored digest fails closed rather than replacing bytes',async()=>{
  const h=boot(),a=await candidate(1),b=await candidate(2);
  await h.api.save(null,a);const old=h.db.get(photoPath(uid));h.db.set(photoPath(uid),{...old,bytes:MockBytes.fromUint8Array(b.bytes)});
  await assert.rejects(h.api.read(),/무결성/);
  await assert.rejects(h.api.save(a.sha256,b),/무결성/);
  assert.equal(h.state.writes.length,1);h.checkUnchanged();
});
test('permission denial or quota failure has no writes',async()=>{
  const h=boot(),a=await candidate(1);h.state.deny=true;
  await assert.rejects(h.api.read(),/permission/);await assert.rejects(h.api.save(null,a),/permission/);
  h.state.deny=false;h.state.failWrite=true;
  await assert.rejects(h.api.save(null,a),/quota/);assert.equal(h.state.writes.length,0);h.checkUnchanged();
});
test('lost acknowledgement is not reported as success; retry same payload does not duplicate',async()=>{
  const h=boot(),a=await candidate(1);h.state.failAfterCommit=true;
  await assert.rejects(h.api.save(null,a),/response lost/);
  assert.equal(h.state.writes.length,1);
  h.state.failAfterCommit=false;
  assert.equal((await h.api.save(null,a)).sha256,a.sha256);assert.equal(h.state.writes.length,1);h.checkUnchanged();
});
test('lost readback is not a confirmed save; later read resolves it',async()=>{
  const h=boot(),a=await candidate(1);h.state.failReadback=true;
  await assert.rejects(h.api.save(null,a),/readback lost/);
  h.state.failReadback=false;assert.equal((await h.api.read()).sha256,a.sha256);assert.equal(h.state.writes.length,1);h.checkUnchanged();
});
test('post-commit conflicting content is not incorrectly reported as saved',async()=>{
  const h=boot(),a=await candidate(1),b=await candidate(2);
  h.state.onCommitted=()=>{const old=h.db.get(photoPath(uid));h.db.set(photoPath(uid),{...old,bytes:MockBytes.fromUint8Array(b.bytes),sha256:b.sha256});};
  await assert.rejects(h.api.save(null,a),/재조회 결과/);assert.equal(h.state.writes.length,1);h.checkUnchanged();
});
test('account switch while reading transaction aborts before mutation',async()=>{
  const h=boot(),a=await candidate(1);
  h.state.onTxRead=path=>{if(path===photoPath(uid))h.state.currentUid=other;};
  await assert.rejects(h.api.save(null,a),/account changed/);assert.equal(h.state.writes.length,0);h.checkUnchanged();
});
test('date move preserves association by event ID; stale or deleted target denied',async()=>{
  const h=boot(),a=await candidate(1);
  await h.api.save(null,a);
  const moved={...meal,date:'2026-11-26'};h.db.set(calendarPath(uid),calendar(moved));
  await assert.rejects(h.api.read(),/동일한 완료 식단/);
  const newApi=h.apiFactory(moved,h.guard,h.db,uid);
  assert.equal((await newApi.read()).sha256,a.sha256);
  h.db.set(calendarPath(uid),calendar(null));
  await assert.rejects(newApi.read(),/동일한 완료 식단/);
  assert.equal(h.db.has(photoPath(uid)),true); // retained for undo; explicit cleanup remains a release gate
  assert.equal(h.state.writes.length,1);
});
