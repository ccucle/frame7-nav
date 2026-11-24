/* Append-only commands. Existing snapshots are validated, never normalized
 * back into storage. A signed preview binds the exact addition and revision. */
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import * as z from 'zod/v4';
import Calendar from '../../fitplan/core.js';
import Iron from '../../fitplan/iron-store.js';

export const APPEND_SCOPE='formday:append';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const day=z.string().refine(Calendar.validDate,'Actual YYYY-MM-DD date required');
const time=z.string().refine(Calendar.validTime,'HH:MM required');
const label=z.string().trim().min(1).max(100);
const nutrient=z.number().min(0).max(2000).nullable();
const mealItem=z.strictObject({name:label,amount:z.number().positive().max(20000),
 unit:z.enum(['g','ml','serving']),
 nutrition:z.strictObject({basisAmount:z.number().positive().max(20000),
  kcal:z.number().min(0).max(20000).nullable(),protein:nutrient,carbs:nutrient,fat:nutrient,
  unsat:nutrient.optional()}).optional(),
 evidence:z.enum(['photo_estimate','user_label','unknown'])});
export const APPEND_SCHEMAS={
 formday_preview_routine:z.strictObject({routineId:id,date:day,start:time,end:time}),
 formday_preview_program:z.strictObject({name:label,mode:z.enum(['fixed','cycle']),
  routineIds:z.array(id).min(1).max(14),weekdays:z.partialRecord(z.enum(['0','1','2','3','4','5','6']),id).default({})}),
 formday_preview_meal:z.strictObject({date:day,start:time,end:time,title:label,
  items:z.array(mealItem).min(1).max(50),notes:z.string().max(1000).default('')}),
 formday_commit_append:z.strictObject({previewToken:z.string().min(60).max(55000)})
};
export const APPEND_DESCRIPTIONS={
 formday_preview_routine:'Preview adding an existing routine as an uncompleted calendar strength plan. Supply an exact local date and times. Does not start or complete an IRON session. Returns a short-lived previewToken; no write occurs.',
 formday_preview_program:'Preview creating an IRON program from existing routine IDs. Weekdays use 0=Sunday, 1=Monday through 6=Saturday. No write occurs.',
 formday_preview_meal:'Preview adding a consumed meal. Interpret the user photo in ChatGPT; send food names and portions, never image URLs or credentials. Mark photo_estimate explicitly; omit unavailable nutrition rather than inventing zeros. Clarify ambiguous foods/portions before saving. No write occurs.',
 formday_commit_append:'Save the exact previewed addition when it matches the user request. Never claim saved until saved or already_saved is returned. Use the SAME previewToken after an uncertain response; on conflict fetch a new preview. Cannot edit or delete existing records.'
};
function check(ok,code){if(!ok)throw Error(code);}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const hasScope=scope=>typeof scope==='string'&&scope.split(' ').includes(APPEND_SCOPE);
export function createPreviewCodec(keyText){
 check(typeof keyText==='string'&&/^[A-Za-z0-9_-]{43}$/.test(keyText),'Invalid preview signing key');
 const key=createHmac('sha256',Buffer.from(keyText,'base64url')).update('FORMDAY_APPEND_PREVIEW_V1').digest();
 const mac=value=>createHmac('sha256',key).update(value).digest();
 return Object.freeze({
  seal(value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');
   check(body.length<=54000,'Preview too large');return body+'.'+mac(body).toString('base64url');},
  open(token){check(typeof token==='string'&&token.length<=55000,'Invalid preview');
   const parts=token.split('.');check(parts.length===2&&parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)),'Invalid preview');
   const sig=Buffer.from(parts[1],'base64url'),expected=mac(parts[0]);
   check(sig.length===expected.length&&timingSafeEqual(sig,expected),'Invalid preview signature');
   return JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}
 });
}
function snapshot(doc,kind){
 check(doc?.format===1&&typeof doc.payload==='string'&&doc.payload.length<650000,'Existing cloud sync required');
 const data=JSON.parse(doc.payload);
 check(data.revision===doc.revision&&typeof doc.revision==='string'&&doc.revision.length>0,'Snapshot revision mismatch');
 check(typeof doc.updateTime==='string'&&/^\d{4}-\d\d-\d\dT/.test(doc.updateTime),'Missing snapshot concurrency version');
 if(kind==='iron')Iron.normalize(data);else{
  check(data.schemaVersion===3&&data.demo!==true,'Real calendar schema v3 required');Calendar.normalizeState(data);
 }
 return data;
}
function append(data,kind,entity,revision){
 const collection=kind==='iron'?'programs':'events';
 const next={...data,revision,[collection]:[...data[collection],entity]};
 if(kind==='iron')Iron.normalize(next);else Calendar.normalizeState(next);
 const payload=JSON.stringify(next);
 check(Buffer.byteLength(payload,'utf8')<=550000,'Cloud snapshot size limit');
 return {format:1,revision,payload};
}
function event(args,entityId,type,detail,completed){
 const raw={id:entityId,date:args.date,start:args.start,end:args.end,type,title:args.title,
  repeat:'none',repeatUntil:null,completed,detail,occurrences:{},excludedDates:[],isSample:false};
 return Calendar.normalizeState({schemaVersion:3,revision:'preview',events:[raw],settings:{}}).events[0];
}
export function createAppendDispatcher({uid,scope,resource,loadDocument,commitDocument,codec,clock=()=>Date.now()}){
 check(/^[A-Za-z0-9_-]{6,128}$/.test(uid||''),'Verified user required');
 const path=kind=>'users/'+uid+'/formday_sync/'+kind;
 async function read(kind){const doc=await loadDocument(path(kind));return {doc,data:snapshot(doc,kind)};}
 return async function dispatch(name,input){
  check(hasScope(scope),'Append consent required');
  check(Object.hasOwn(APPEND_SCHEMAS,name),'Unknown append tool');
  const args=APPEND_SCHEMAS[name].parse(input);
  if(name==='formday_commit_append'){
   const preview=codec.open(args.previewToken);
   check(preview.v===1&&preview.uid===uid&&preview.resource===resource&&preview.scope===APPEND_SCOPE,
    'Preview identity or audience mismatch');
   check(Number.isFinite(preview.expiresAt),'Invalid preview expiry');
   check(['calendar','iron'].includes(preview.kind),'Invalid preview target');
   const {doc,data}=await read(preview.kind);
   const prior=data[preview.kind==='iron'?'programs':'events'].find(x=>x.id===preview.entity.id);
   if(prior){check(isDeepStrictEqual(prior,preview.entity),'Existing addition changed; no write performed');
    return {status:'already_saved',id:prior.id,kind:preview.kind};}
   check(clock()<preview.expiresAt,'Preview expired without a matching saved entry; review records before creating a new preview');
   check(doc.updateTime===preview.updateTime&&doc.revision===preview.revision&&digest(doc.payload)===preview.payloadHash,
    'Cloud records changed; create a new preview');
   const next=append(data,preview.kind,preview.entity,'connect_'+randomUUID().replaceAll('-',''));
   // Firestore commit acknowledgement is authoritative; a failed network reply
   // is never treated as success. Reusing this preview finds the existing ID.
   await commitDocument(path(preview.kind),next,doc.updateTime);
   return {status:'saved',id:preview.entity.id,kind:preview.kind,revision:next.revision};
  }
  const kind=name==='formday_preview_program'?'iron':'calendar';
  const {doc,data}=await read(kind);
  const entityId='connect_'+randomUUID().replaceAll('-','');
  let entity;
  if(name==='formday_preview_program'){
   check(args.mode!=='fixed'||Object.keys(args.weekdays).length>0,'Fixed program needs weekdays');
   check(args.mode!=='cycle'||Object.keys(args.weekdays).length===0,'Cycle program must not specify weekdays');
   entity={id:entityId,...args,nextIndex:0,active:true};
  }else if(name==='formday_preview_routine'){
   const iron=await read('iron');
   const routine=Iron.normalize(iron.data).routines.find(x=>x.id===args.routineId);
   check(routine,'Routine not found');
   const exercises=routine.exercises.map((ex,i)=>({...ex,id:entityId+'_e'+i,
    sets:ex.sets.map((s,j)=>({...s,id:entityId+'_s'+i+'_'+j,done:false}))}));
   entity=event({...args,title:routine.name},entityId,'strength',{
    exercises,notes:'FORMDAY Connect · 루틴 '+routine.name+' ('+routine.id+') 계획 복사. IRON 운동 기록 아님.'},false);
  }else{
   const items=args.items.map((item,i)=>{
    check(item.evidence!=='unknown'||!item.nutrition,'Unknown nutrition must be omitted');
    check(item.evidence!=='user_label'||item.nutrition&&['kcal','protein','carbs','fat'].every(k=>item.nutrition[k]!==null),
     'Label nutrition requires all four values');
    const n=item.nutrition;
    return {id:entityId+'_m'+i,amount:item.amount,food:{id:entityId+'_f'+i,name:item.name,
     basisAmount:n?.basisAmount??item.amount,basisUnit:item.unit,
     nutrients:Object.fromEntries(['kcal','protein','carbs','fat','unsat'].map(k=>[k,n?.[k]??null])),
     source:{kind:item.evidence==='user_label'?'user':'unknown',label:item.evidence==='photo_estimate'?
      '사진 기반 추정 · 미검증':'영양정보 미확인'}}};
   });
   const evidence=args.items.map(i=>i.name+': '+({photo_estimate:'사진 기반 추정',user_label:'사용자 제공 표시사항',unknown:'영양정보 미확인'}[i.evidence])).join('; ');
   entity=event(args,entityId,'meal',{items,notes:args.notes+'\nFORMDAY Connect · '+evidence},true);
  }
  append(data,kind,entity,'preview'); // Validate new entry and total size before issuing capability.
  const expiresAt=clock()+10*60*1000;
  const previewToken=codec.seal({v:1,uid,resource,scope:APPEND_SCOPE,kind,entity,
   revision:doc.revision,updateTime:doc.updateTime,payloadHash:digest(doc.payload),expiresAt});
  return {status:'preview',kind,entry:entity,expiresAt:new Date(expiresAt).toISOString(),previewToken,
   note:'저장 전 미리보기입니다. 사이트에서는 클라우드 내려받기로 반영됩니다.'};
 };
}
