/* Server-only adapter; not deployed. Firebase user ID token, never Admin IAM. */
import {createHash} from 'node:crypto';
import {createFirebaseVerifier,FIREBASE_PROJECT} from './firebase-rest.mjs';
import {PHOTO_MAX_BYTES} from './meal-photo-attachment.mjs';

const RESOURCE='projects/'+FIREBASE_PROJECT+'/databases/(default)/documents';
const BASE='https://firestore.googleapis.com/v1/'+RESOURCE;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const UID=/^[A-Za-z0-9_-]{6,128}$/;
const HASH=/^[a-f0-9]{64}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const allowedMime=new Set(['image/jpeg','image/png','image/webp']);
function check(ok,message){if(!ok)throw Error(message);}
function asInt(value){const v=value?.integerValue;return typeof v==='number'&&Number.isSafeInteger(v)?v:typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):NaN;}
function asString(value){check(typeof value?.stringValue==='string','INVALID_DOCUMENT_FIELD');return value.stringValue;}
function decodeBytes(field){
 const s=field?.bytesValue;
 check(typeof s==='string'&&s.length<=Math.ceil(PHOTO_MAX_BYTES/3)*4&&B64.test(s),'INVALID_DOCUMENT_BYTES');
 const b=Buffer.from(s,'base64');check(b.length>=12&&b.length<=PHOTO_MAX_BYTES&&b.toString('base64')===s,'INVALID_DOCUMENT_BYTES');return b;
}
function photoDoc(doc,expectedName){
 check(doc?.name===expectedName&&doc.fields&&typeof doc.fields==='object','DOCUMENT_IDENTITY_MISMATCH');
 const f=doc.fields;
 check(typeof f.updatedAt?.timestampValue==='string','INVALID_DOCUMENT_TIMESTAMP');
 return {format:asInt(f.format),eventId:asString(f.eventId),sha256:asString(f.sha256),mime:asString(f.mime),size:asInt(f.size),bytes:decodeBytes(f.bytes)};
}
function calendarDoc(doc,expectedName){
 check(doc?.name===expectedName&&doc.fields&&typeof doc.fields==='object','DOCUMENT_IDENTITY_MISMATCH');
 const f=doc.fields;return {format:asInt(f.format),revision:asString(f.revision),payload:asString(f.payload)};
}
async function boundedJSON(res,limit){
 const declared=res.headers.get('content-length');
 check(!declared||(/^\d+$/.test(declared)&&Number(declared)<=limit),'RESPONSE_TOO_LARGE');
 check(res.body&&typeof res.body.getReader==='function','MISSING_RESPONSE_STREAM');
 const reader=res.body.getReader();const chunks=[];let total=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
   if(total>limit){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}
   chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
 }finally{reader.releaseLock();}
}
/**
 * Only call from existing trusted host after resolving the owner session.
 * uid/token are never accepted from MCP arguments. Verifier must be the existing
 * Firebase signature verifier (inject only for synthetic tests). fetchImpl is
 * fixed platform fetch in production, not client input.
 * No automatic write retries, including after network errors.
 */
export async function createOwnerPhotoTransaction({principal,verifyFirebaseToken=createFirebaseVerifier(),fetchImpl=fetch}={}){
 check(principal&&UID.test(principal.uid||'')&&typeof principal.token==='string'&&principal.token.length>=150,'VERIFIED_OWNER_REQUIRED');
 const {uid,token}=principal;
 const verified=await verifyFirebaseToken(token);
 check(verified?.uid===uid&&verified?.token===token,'OWNER_TOKEN_MISMATCH');
 const calendarPath='users/'+uid+'/formday_sync/calendar';
 const photoPath=id=>'users/'+uid+'/formday_meal_photos/'+id;
 async function request(path,{method='GET',body,limit=1100000,missing=false}={}){
  const res=await fetchImpl(BASE+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(missing&&res.status===404){await res.body?.cancel();return null;}
  if(!res.ok){await res.body?.cancel();throw Error('FIRESTORE_REQUEST_DENIED_OR_FAILED_'+res.status);}
  return boundedJSON(res,limit);
 }
 return async function withOwnerTransaction(requestUid,fn){
  check(requestUid===uid&&typeof fn==='function','OWNER_SCOPE_MISMATCH');
  const begin=await request(':beginTransaction',{method:'POST',body:{options:{readWrite:{}}},limit:8192});
  const txId=begin?.transaction;
  check(typeof txId==='string'&&txId.length>0&&txId.length<=4096&&B64.test(txId),'INVALID_TRANSACTION_ID');
  const query='?transaction='+encodeURIComponent(txId);
  let active=true,calendarRead=false,calendarFound=false,photoId=null,photoWasMissing=false,write=null,commitStarted=false;
  const ensure=()=>check(active&&!write,'TRANSACTION_CLOSED_OR_ALREADY_STAGED');
  async function read(path){return request('/'+path+query,{missing:true});}
  const api=Object.freeze({
   async readCalendar(){
    ensure();check(!calendarRead,'CALENDAR_ALREADY_READ');calendarRead=true;
    const d=await read(calendarPath);calendarFound=d!==null;
    return d===null?null:calendarDoc(d,RESOURCE+'/'+calendarPath);
   },
   async readPhoto(id){
    ensure();check(calendarRead&&calendarFound&&photoId===null&&typeof id==='string'&&ID.test(id),'INVALID_PHOTO_READ_SCOPE');
    photoId=id;const d=await read(photoPath(id));photoWasMissing=d===null;
    return d===null?null:photoDoc(d,RESOURCE+'/'+photoPath(id));
   },
   async createPhoto(id,fields){
    ensure();check(calendarFound&&id===photoId&&photoWasMissing,'PHOTO_CREATE_PRECONDITION');
    check(fields&&Object.keys(fields).sort().join(',')==='bytes,eventId,format,mime,sha256,size','INVALID_PHOTO_WRITE_FIELDS');
    check(fields.format===1&&fields.eventId===id&&allowedMime.has(fields.mime)&&HASH.test(fields.sha256||'')&&fields.bytes instanceof Uint8Array&&fields.size===fields.bytes.byteLength&&fields.size>=12&&fields.size<=PHOTO_MAX_BYTES,'INVALID_PHOTO_WRITE');
    const b=Buffer.from(fields.bytes);check(createHash('sha256').update(b).digest('hex')===fields.sha256,'INVALID_PHOTO_HASH');
    const str=stringValue=>({stringValue}),int=n=>({integerValue:String(n)});
    write={update:{name:RESOURCE+'/'+photoPath(id),fields:{
     format:int(1),eventId:str(id),sha256:str(fields.sha256),mime:str(fields.mime),size:int(b.byteLength),bytes:{bytesValue:b.toString('base64')}
    }},currentDocument:{exists:false},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
   }
  });
  async function rollback(){try{await request(':rollback',{method:'POST',body:{transaction:txId},limit:8192});}catch{/* no retry or logging of private data */}}
  try{
   const value=await fn(api);active=false;
   if(!write){await rollback();return value;}
   commitStarted=true;
   const result=await request(':commit',{method:'POST',body:{transaction:txId,writes:[write]},limit:32768});
   check(Array.isArray(result?.writeResults)&&result.writeResults.length===1&&typeof result.commitTime==='string','PHOTO_COMMIT_OUTCOME_UNKNOWN');
   return value;
  }catch(e){active=false;if(!commitStarted)await rollback();throw e;}
 };
}
