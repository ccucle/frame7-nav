/* Server-only attachment core for the existing Connect development source.
 * NOT an exposed tool or a live Sites integration.
 * Never accept principal/authorization/storage implementation from client input.
 */
import {createHash} from 'node:crypto';
import Calendar from '../../fitplan/core.js';

export const PHOTO_MAX_BYTES=716800;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const UID=/^[A-Za-z0-9_-]{6,128}$/;
const HASH=/^[a-f0-9]{64}$/;
const MIME=new Set(['image/jpeg','image/png','image/webp']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code){const e=new Error(code);e.code=code;throw e;}
const check=(condition,code)=>{if(!condition)fail(code);};
function validSignature(b,mime){
 if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
 return b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP';
}
function validateBytes(bytes,mime){
 check(bytes instanceof Uint8Array&&bytes.byteLength>=12&&bytes.byteLength<=PHOTO_MAX_BYTES&&MIME.has(mime),'INVALID_PHOTO_FILE');
 const b=Buffer.from(bytes);
 check(validSignature(b,mime),'INVALID_PHOTO_SIGNATURE');
 return b;
}
function target(doc,mealId,date){
 check(doc?.format===1&&typeof doc.payload==='string'&&Buffer.byteLength(doc.payload,'utf8')<=650000,'CALENDAR_UNAVAILABLE');
 let raw;
 try{raw=JSON.parse(doc.payload);}catch{fail('INVALID_CALENDAR');}
 check(raw?.schemaVersion===3&&raw.revision===doc.revision&&raw.demo!==true&&Array.isArray(raw.events),'INVALID_CALENDAR');
 const matches=raw.events.filter(e=>e?.id===mealId);
 check(matches.length===1,'MEAL_NOT_UNIQUE');
 let data;
 try{data=Calendar.normalizeState(raw);}catch{fail('INVALID_CALENDAR');}
 const e=data.events.find(e=>e.id===mealId);
 check(e&&e.date===date&&e.type==='meal'&&e.repeat==='none'&&e.completed===true&&e.isSample!==true,'MEAL_NOT_ELIGIBLE');
 return e;
}
function photoMeta(doc,mealId){
 if(doc===null)return null;
 check(doc&&doc.format===1&&doc.eventId===mealId&&typeof doc.sha256==='string'&&HASH.test(doc.sha256),'CORRUPT_PHOTO');
 let b;
 try{b=validateBytes(doc.bytes,doc.mime);}catch{fail('CORRUPT_PHOTO');}
 check(doc.size===b.byteLength&&doc.sha256===sha(b),'CORRUPT_PHOTO');
 return {sha256:doc.sha256,size:doc.size,mime:doc.mime};
}
/*
 * Trusted host adapter contract:
 * principal is supplied only after existing host + Firebase identity verification.
 * authorizePhoto checks that the current authenticated request explicitly authorized
 * this exact existing meal and uploaded file. Existing append consent alone is NOT enough.
 * decodeImage must actually decode bytes locally, check MIME and dimensions;
 * no external processing or metadata removal. No decoder => no write.
 * withOwnerTransaction(uid, fn) supplies a transaction bound to verified owner credentials
 * and enforced Firestore Rules, not Admin/service-account bypass. It must read calendar
 * and photo atomically, retry on stale reads, and enforce create-if-absent (no upsert).
 * tx.readCalendar(), tx.readPhoto(id) return owner-scoped decoded documents or null;
 * tx.createPhoto(id,fields) maps bytes to Firestore bytes and updatedAt to REQUEST_TIME.
 * A read-only callback must fetch actual server values, never local cache.
 * No client-supplied UID/path, no auth token or raw bytes in response/logs.
 */
export function createMealPhotoAttachment({principal,authorizePhoto,decodeImage,withOwnerTransaction}={}){
 check(principal&&typeof principal.uid==='string'&&UID.test(principal.uid),'VERIFIED_OWNER_REQUIRED');
 check([authorizePhoto,decodeImage,withOwnerTransaction].every(x=>typeof x==='function'),'PHOTO_HOST_NOT_READY');
 const uid=principal.uid;
 async function authorize(meta){
  check(principal.uid===uid&&await authorizePhoto({principal,...meta})===true,'PHOTO_CONSENT_REQUIRED');
 }
 return Object.freeze({
  async attach(input){
   check(input&&Object.keys(input).every(k=>['mealId','date','bytes','mime'].includes(k)),'INVALID_ATTACHMENT_INPUT');
   const {mealId,date,mime}=input;
   check(typeof mealId==='string'&&ID.test(mealId)&&typeof date==='string'&&Calendar.validDate(date),'INVALID_MEAL_ID_OR_DATE');
   const bytes=validateBytes(input.bytes,mime),hash=sha(bytes);
   const meta={mealId,date,sha256:hash,size:bytes.byteLength,mime};
   await authorize(meta);
   let decoded;
   try{decoded=await decodeImage(Buffer.from(bytes),mime);}catch{fail('INVALID_IMAGE_DECODE');}
   check(decoded?.mime===mime&&Number.isSafeInteger(decoded.width)&&Number.isSafeInteger(decoded.height)&&decoded.width>0&&decoded.height>0&&decoded.width*decoded.height<=30000000,'INVALID_IMAGE_DECODE');
   await authorize(meta);
   let writeResult;
   try{
    writeResult=await withOwnerTransaction(uid,async tx=>{
     await authorize(meta);
     target(await tx.readCalendar(),mealId,date);
     const prior=photoMeta(await tx.readPhoto(mealId),mealId);
     if(prior){
      check(prior.sha256===hash&&prior.size===meta.size&&prior.mime===mime,'PHOTO_EXISTS_DIFFERENT');
      return 'already_saved';
     }
     await authorize(meta);
     await tx.createPhoto(mealId,{format:1,eventId:mealId,sha256:hash,mime,size:meta.size,bytes:Buffer.from(bytes)});
     return 'saved';
    });
   }catch(e){
    if(['PHOTO_EXISTS_DIFFERENT','MEAL_NOT_ELIGIBLE','MEAL_NOT_UNIQUE','INVALID_CALENDAR','CALENDAR_UNAVAILABLE','CORRUPT_PHOTO','PHOTO_CONSENT_REQUIRED'].includes(e?.code))throw e;
    // The storage adapter may have committed before the response was lost.
    // Never issue another write on this uncertain result.
    fail('PHOTO_OUTCOME_UNKNOWN_RETRY_SAME_ATTACHMENT');
   }
   check(writeResult==='saved'||writeResult==='already_saved','PHOTO_OUTCOME_UNKNOWN_RETRY_SAME_ATTACHMENT');
   let observed;
   try{
    await authorize(meta);
    observed=await withOwnerTransaction(uid,async tx=>{
     await authorize(meta);
     target(await tx.readCalendar(),mealId,date);
     return photoMeta(await tx.readPhoto(mealId),mealId);
    });
   }catch{fail('PHOTO_READBACK_UNAVAILABLE_RETRY_SAME_ATTACHMENT');}
   check(observed&&observed.sha256===hash&&observed.mime===mime&&observed.size===meta.size,'PHOTO_READBACK_MISMATCH_RETRY_SAME_ATTACHMENT');
   return {status:writeResult,mealId,date,sha256:hash,mime,size:meta.size,readBackVerified:true};
  }
 });
}
