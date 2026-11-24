/**
 * FORMDAY Connect: read-only Firestore snapshot adapter.
 * A trusted MCP host must supply verifiedUid (from OAuth) and loadDocument.
 * Never accept UID or Firestore document path from model tool arguments.
 */
const SLOTS=Object.freeze(["calendar","iron"]);
const UID=/^[A-Za-z0-9_-]{6,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const isObject=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function guard(ok,message){if(!ok)throw Error(message);}
function day(v){
 guard(typeof v==="string"&&DATE.test(v),"날짜 형식이 올바르지 않습니다.");
 const d=new Date(v+"T12:00:00Z");
 guard(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v,"존재하지 않는 날짜입니다.");
 return v;
}
function timeRange(a={},now=Date.now()){
 const today=new Date(now+9*3600000).toISOString().slice(0,10);
 const start=new Date(Date.parse(today+"T00:00:00Z")-13*86400000).toISOString().slice(0,10);
 const from=day(a.from||start),to=day(a.to||today);
 const days=(Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000;
 guard(days>=0&&days<=366,"조회 기간은 최대 366일입니다.");
 guard(a.limit===undefined||(Number.isInteger(a.limit)&&a.limit>=1&&a.limit<=150),"최대 건수는 1~150입니다.");
 return {from,to,limit:a.limit||50};
}
const array=v=>Array.isArray(v)?v:[];
const safe=(v,max=200)=>typeof v==="string"?v.slice(0,max):"";
function parseDocument(kind,d){
 guard(SLOTS.includes(kind),"허용되지 않은 기록 종류입니다.");
 if(d==null)return null;
 guard(isObject(d)&&d.format===1&&typeof d.revision==="string"&&d.revision.length>=1&&
   d.revision.length<=100&&typeof d.payload==="string"&&d.payload.length<=600000,
   "클라우드 문서 형식이 올바르지 않습니다.");
 let body;
 try{body=JSON.parse(d.payload);}catch(e){throw Error("기록 JSON 해석 실패");}
 guard(isObject(body),"기록 본문 형식 오류");
 if(kind==="calendar")guard([1,2,3].includes(body.schemaVersion)&&array(body.events).length<=5000&&
   Array.isArray(body.events),"캘린더 스키마 불일치");
 if(kind==="iron")guard(body.version===1&&Array.isArray(body.sessions)&&
   Array.isArray(body.routines)&&Array.isArray(body.programs),"IRON MODE 스키마 불일치");
 return {revision:d.revision,data:body};
}
function ordered(v){return [...v].sort((a,b)=>a.date.localeCompare(b.date)||String(a.id||"").localeCompare(String(b.id||"")));}
function selected(items,from,to){return ordered(array(items).filter(x=>typeof x?.date==="string"&&x.date>=from&&x.date<=to));}
function workout(s){
 let performed=0,working=0,volume=0;
 const exercises=array(s.exercises).slice(0,30).map(e=>{
  let count=0;
  for(const set of array(e.sets)){
   if(set?.done!==true)continue;
   count++;performed++;
   if(set.warmup===true)continue;
   working++;
   if(typeof set.weight==="number"&&Number.isFinite(set.weight)&&set.weight>=0&&
      typeof set.reps==="number"&&Number.isFinite(set.reps)&&set.reps>0)
     volume+=set.weight*set.reps;
  }
  return {name:safe(e.name,80),setsCompleted:count};
 });
 return {id:safe(s.id,100),date:day(s.date),name:safe(s.label,100),
  state:safe(s.status,20),setsCompleted:performed,workingSets:working,
  totalVolumeKg:Math.round(volume*100)/100,
  activeMinutes:typeof s.activeMs==="number"?Math.round(s.activeMs/60000):0,exercises};
}
function calendarEvent(e){
 return {id:safe(e.id,100),date:day(e.date),type:safe(e.type,20),
  start:safe(e.start,5),end:safe(e.end,5),
  title:safe(e.title,300),completed:e.completed===true,
  repeat:safe(e.repeat,16),sample:e.isSample===true,
  hasOccurrenceOverrides:isObject(e.occurrences)&&Object.keys(e.occurrences).length>0};
}
function mealEvent(e){
 const items=array(e.detail?.items).slice(0,50).map(i=>({
  name:safe(i?.food?.name||i?.name,100),
  grams:typeof i?.grams==="number"?i.grams:i?.food?.basisUnit==='g'&&typeof i.amount==='number'?i.amount:null,
  quantity:typeof i?.quantity==="number"?i.quantity:null,
  amount:typeof i?.amount==='number'?i.amount:null,unit:safe(i?.food?.basisUnit,10),
  nutritionBasisAmount:typeof i?.food?.basisAmount==='number'?i.food.basisAmount:null,
  nutrientsPerBasis:Object.fromEntries(['kcal','protein','carbs','fat','unsat'].map(k=>[k,
   typeof i?.food?.nutrients?.[k]==='number'?i.food.nutrients[k]:null])),
  source:{kind:safe(i?.food?.source?.kind,20),label:safe(i?.food?.source?.label,250)}
 }));
 return {...calendarEvent(e),items,notes:safe(e.detail?.notes,2000)};
}
function weightEvent(e){return {id:safe(e.id,100),date:day(e.date),
 kilograms:typeof e.detail?.weight==="number"?e.detail.weight:null,
 bodyFatPercent:typeof e.detail?.bodyfat==="number"?e.detail.bodyfat:null};}
export function createReader({verifiedUid,loadDocument,clock=()=>Date.now()}){
 guard(typeof verifiedUid==="string"&&UID.test(verifiedUid),"인증된 사용자 ID가 없습니다.");
 guard(typeof loadDocument==="function","클라우드 조회 연결이 없습니다.");
 const get=async name=>{
  guard(SLOTS.includes(name),"허용되지 않은 저장 종류입니다.");
  const docPath="users/"+verifiedUid+"/formday_sync/"+name;
  const raw=await loadDocument(docPath);
  return parseDocument(name,raw)||{revision:null,data:null};
 };
 return Object.freeze({
  async status(){
   const [c,i]=await Promise.all([get("calendar"),get("iron")]);
   return {connected:true,calendar:{present:!!c.data,revision:c.revision,
    eventCount:c.data?.events?.length||0},iron:{present:!!i.data,revision:i.revision,
    sessionCount:i.data?.sessions?.length||0,routineCount:i.data?.routines?.length||0}};
  },
  async workouts(args={}){
   const r=timeRange(args,clock()),s=await get("iron");
   const rows=selected(s.data?.sessions,r.from,r.to).filter(x=>args.includeUnfinished===true||
     x.status==="COMPLETED"||x.status==="PARTIAL");
   return {revision:s.revision,total:rows.length,from:r.from,to:r.to,
    records:rows.slice(-r.limit).map(workout)};
  },
  async routines(args={}){
   const r=timeRange(args,clock()),s=await get("iron"),rows=array(s.data?.routines),programs=array(s.data?.programs);
   return {revision:s.revision,total:rows.length,programTotal:programs.length,
    programs:programs.slice(0,r.limit).map(p=>({id:safe(p.id,100),name:safe(p.name,100),mode:safe(p.mode,10),
     routineIds:array(p.routineIds).slice(0,14).map(x=>safe(x,100)),
     weekdays:Object.fromEntries(Object.entries(isObject(p.weekdays)?p.weekdays:{}).filter(([k])=>/^[0-6]$/.test(k)).map(([k,v])=>[k,safe(v,100)])),
     active:p.active===true,nextIndex:Number.isInteger(p.nextIndex)?p.nextIndex:null})),
    records:rows.slice(0,r.limit).map(x=>({
    id:safe(x.id,100),name:safe(x.name,100),updatedAt:safe(x.updatedAt,50),
    exercises:array(x.exercises).slice(0,30).map(e=>({
     name:safe(e.name,80),targets:array(e.sets).slice(0,50).map(set=>({
      weightKg:typeof set.weight==="number"?set.weight:null,
      reps:typeof set.reps==="number"?set.reps:null,
      restSeconds:typeof set.restSec==="number"?set.restSec:null,
      warmup:set.warmup===true}))}))}))};
  },
  async calendar(args={}){
   const r=timeRange(args,clock()),s=await get("calendar");
   const rows=selected(s.data?.events,r.from,r.to).filter(x=>args.includeSamples===true||x.isSample!==true);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.length,
    records:rows.slice(-r.limit).map(calendarEvent),
    note:"반복 일정은 시작 날짜로 조회되며 발생일마다 확장하지 않았습니다."};
  },
  async meals(args={}){
   const r=timeRange(args,clock()),s=await get("calendar");
   const rows=selected(s.data?.events,r.from,r.to).filter(x=>x.type==="meal"&&x.isSample!==true);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.length,
    records:rows.slice(-r.limit).map(mealEvent),
    note:"미검증 영양값은 생성하지 않습니다. 영양 합계 계산은 별도 검증이 필요합니다."};
  },
  async weightHistory(args={}){
   const r=timeRange(args,clock()),s=await get("calendar");
   const rows=selected(s.data?.events,r.from,r.to).filter(x=>
    x.type==="weight"&&x.completed===true&&x.isSample!==true);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.length,
    records:rows.slice(-r.limit).map(weightEvent)};
  }
 });
}
export const TOOL_CONTRACT=Object.freeze({
 formday_status:"Read available cloud record types",
 formday_workouts:"Read actual strength exercise sessions",
 formday_routines:"Read planned strength routines",
 formday_calendar:"Read calendar events",
 formday_meals:"Read recorded meal entries without inferred nutrition",
 formday_weight_history:"Read recorded bodyweight measurements"
});
