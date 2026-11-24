/**
 * FORMDAY Connect: read-only Firestore snapshot adapter.
 * A trusted MCP host must supply verifiedUid (from OAuth) and loadDocument.
 * Never accept UID or Firestore document path from model tool arguments.
 */
const SLOTS=Object.freeze(["calendar","iron"]);
const UID=/^[A-Za-z0-9_-]{6,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const isObject=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const own=(v,key)=>Object.prototype.hasOwnProperty.call(v,key);
const DAY_MS=86400000;
const kstFormatter=new Intl.DateTimeFormat("en-CA",{
 timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
});
function guard(ok,message){if(!ok)throw Error(message);}
function day(v){
 guard(typeof v==="string"&&DATE.test(v),"날짜 형식이 올바르지 않습니다.");
 const d=new Date(v+"T12:00:00Z");
 guard(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v,"존재하지 않는 날짜입니다.");
 return v;
}
function kstToday(clock){
 const instant=clock();
 guard(typeof instant==="number"&&Number.isFinite(instant)&&
  Number.isFinite(new Date(instant).getTime()),"한국 기준 현재 날짜를 확인할 수 없습니다.");
 const parts=Object.fromEntries(kstFormatter.formatToParts(instant).map(p=>[p.type,p.value]));
 return day(parts.year+"-"+parts.month+"-"+parts.day);
}
function timeRange(a={},clock=()=>Date.now()){
 const today=kstToday(clock);
 const start=new Date(Date.parse(today+"T00:00:00Z")-13*DAY_MS).toISOString().slice(0,10);
 const from=day(a.from===undefined?start:a.from),to=day(a.to===undefined?today:a.to);
 const days=(Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/DAY_MS;
 guard(days>=0&&days<=366,"조회 기간은 최대 366일입니다.");
 guard(a.limit===undefined||(Number.isInteger(a.limit)&&a.limit>=1&&a.limit<=150),"최대 건수는 1~150입니다.");
 return {from,to,limit:a.limit||50};
}
const array=v=>Array.isArray(v)?v:[];
const safe=(v,max=200)=>typeof v==="string"?v.slice(0,max):"";
const positive=(v,max)=>typeof v==="number"&&Number.isFinite(v)&&v>0&&v<=max?v:null;
const bounded=(v,min,max)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const time=v=>typeof v==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?v:null;
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
// Match FORMDAY core.js baseRule/occurs/occurrence. Calendar dates are labels,
// so use day arithmetic, independent of the server's local timezone or DST.
function baseRule(e,date,enforceEnd=true){
 if(date<e.date||(enforceEnd&&e.repeatUntil&&date>e.repeatUntil))return false;
 if(e.repeat==="daily")return true;
 if(e.repeat==="weekly")return (Date.parse(date+"T00:00:00Z")-
  Date.parse(e.date+"T00:00:00Z"))%(7*DAY_MS)===0;
 return date===e.date;
}
function prepareSeries(events){
 let overrideCount=0;
 return array(events).map(raw=>{
  guard(isObject(raw),"캘린더 일정 형식이 올바르지 않습니다.");
  const e={...raw,date:day(raw.date),repeat:raw.repeat===undefined?"none":raw.repeat,
   repeatUntil:raw.repeatUntil?day(raw.repeatUntil):null};
  guard(["none","daily","weekly"].includes(e.repeat),"지원하지 않는 반복 일정입니다.");
  guard(!e.repeatUntil||e.repeatUntil>=e.date,"반복 종료일이 올바르지 않습니다.");
  guard(raw.occurrences===undefined||isObject(raw.occurrences),"날짜별 기록 형식이 올바르지 않습니다.");
  guard(raw.excludedDates===undefined||(Array.isArray(raw.excludedDates)&&
   raw.excludedDates.length<=20000),"제외 날짜 형식이 올바르지 않습니다.");
  const snapshots=new Map(),excluded=new Set(raw.excludedDates||[]);
  if(e.repeat==="none"){
   guard(Object.keys(raw.occurrences||{}).length===0&&excluded.size===0,
    "일반 일정에는 반복 기록을 넣을 수 없습니다.");
   e.repeatUntil=null;
  }else{
   for(const [date,snapshot] of Object.entries(raw.occurrences||{})){
    day(date);
    guard(baseRule(e,date,false)&&isObject(snapshot)&&
     (snapshot.date===undefined||snapshot.date===date)&&snapshot.type===e.type&&
     time(snapshot.start)&&time(snapshot.end)&&snapshot.end>snapshot.start&&
     (snapshot.completed===undefined||typeof snapshot.completed==="boolean"),
     "날짜별 기록이 반복 일정과 일치하지 않습니다.");
    snapshots.set(date,snapshot);
   }
   // Legacy version 1/2 completed dates are converted exactly as the site's
   // normalizer does. An explicit date snapshot always takes precedence.
   guard(raw.doneDates===undefined||(Array.isArray(raw.doneDates)&&raw.doneDates.length<=20000),
    "기존 완료 날짜 형식이 올바르지 않습니다.");
   for(const date of raw.doneDates||[]){
    day(date);guard(baseRule(e,date,false),"기존 완료 날짜가 반복 일정과 일치하지 않습니다.");
    if(!snapshots.has(date))snapshots.set(date,{...e,date,completed:true});
   }
   for(const date of excluded){
    day(date);guard(baseRule(e,date,false)&&!snapshots.has(date),
     "반복 기록과 제외 날짜가 충돌합니다.");
   }
  }
  overrideCount+=snapshots.size;
  guard(overrideCount<=20000,"날짜별 기록이 지원 범위를 넘었습니다.");
  return {event:e,snapshots,excluded};
 });
}
function occurrence({event:e,snapshots,excluded},date){
 const snapshot=snapshots.get(date);
 if(!snapshot&&(excluded.has(date)||!baseRule(e,date)))return null;
 const source=snapshot||e,plannedRepeat=e.repeat!=="none"&&!snapshot;
 return {id:e.id,date,start:source.start,end:source.end,type:source.type,title:source.title,
  repeat:e.repeat,repeatUntil:e.repeatUntil,seriesDate:e.date,
  detail:plannedRepeat&&e.type==="weight"?{weight:null,bodyfat:null}:source.detail,
  completed:plannedRepeat?false:source.completed===true,isSample:e.isSample===true,
  hasOccurrenceOverrides:snapshots.size>0};
}
function selectedOccurrences(events,{from,to,limit},predicate,sortByTitle=true){
 const series=prepareSeries(events);
 let total=0,records=[];
 const end=Date.parse(to+"T00:00:00Z");
 for(let stamp=Date.parse(from+"T00:00:00Z");stamp<=end;stamp+=DAY_MS){
  const date=new Date(stamp).toISOString().slice(0,10),rows=[];
  for(const s of series){
   const row=occurrence(s,date);
   if(row&&predicate(row))rows.push(row);
  }
  // FORMDAY dayEvents sorts by time, title, then ID; weightRecords omits the
  // title comparison. Keep only one day's
  // temporary rows and the requested tail, not a 5,000 x 367-day expansion.
  rows.sort((a,b)=>safe(a.start).localeCompare(safe(b.start))||
   (sortByTitle?safe(a.title,300).localeCompare(safe(b.title,300)):0)||
   safe(a.id,100).localeCompare(safe(b.id,100)));
  total+=rows.length;
  records=records.concat(rows).slice(-limit);
 }
 return {total,records};
}
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
  title:safe(e.title,300),start:time(e.start),end:time(e.end),completed:e.completed===true,
  repeat:safe(e.repeat,16),repeatUntil:e.repeatUntil||null,seriesDate:e.seriesDate||e.date,
  sample:e.isSample===true,hasOccurrenceOverrides:e.hasOccurrenceOverrides===true};
}
function foodSource(raw){
 if(!isObject(raw)||!["usda","user","legacy","unknown"].includes(raw.kind))return null;
 let url="";
 if(typeof raw.url==="string"&&raw.url.length<=2000&&!/[\u0000-\u0020\u007f]/.test(raw.url)){
  try{const u=new URL(raw.url);if(u.protocol==="https:"&&u.hostname&&!u.username&&!u.password)url=raw.url;}catch{}
 }
 return {kind:raw.kind,label:safe(raw.label,250),url,code:safe(raw.code,100),
  datasetDate:safe(raw.datasetDate,40),checkedAt:safe(raw.checkedAt,40)};
}
function mealItem(raw){
 const i=isObject(raw)?raw:{},food=isObject(i.food)?i.food:{};
 const modern=own(i,"amount");
 const legacyGrams=positive(i.grams,20000);
 const amount=modern?positive(i.amount,20000):legacyGrams;
 const unit=modern?(["g","ml","serving"].includes(food.basisUnit)?food.basisUnit:null):
  (legacyGrams===null?null:"g");
 return {name:safe(food.name||i.name,400),amount,unit,
  basisAmount:positive(food.basisAmount,20000),source:foodSource(food.source),
  nutritionBasisAmount:positive(food.basisAmount,20000),
  nutrientsPerBasis:Object.fromEntries(["kcal","protein","carbs","fat","unsat"].map(key=>{
   const value=food.nutrients?.[key];
   // Preserve recorded values per their recorded basis. No serving conversion,
   // nutrient imputation, or claim that an unverified value was measured.
   return [key,typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null];
  })),
  grams:unit==="g"?amount:null,
  quantity:unit==="serving"?amount:(!modern?positive(i.quantity,20000):null)};
}
function mealEvent(e){
 const raw=Array.isArray(e.detail?.items)?e.detail.items:
  (typeof e.detail?.food==="string"?[{name:e.detail.food,grams:e.detail.grams}]:[]);
 const items=raw.slice(0,50).map(mealItem);
 return {...calendarEvent(e),items,notes:safe(e.detail?.notes,2000)};
}
function weightEvent(e){return {id:safe(e.id,100),date:day(e.date),
 kilograms:positive(e.detail?.weight,500),
 bodyFatPercent:bounded(e.detail?.bodyfat,0,100)};}
export function createReader({verifiedUid,loadDocument,clock=()=>Date.now()}){
 guard(typeof verifiedUid==="string"&&UID.test(verifiedUid),"인증된 사용자 ID가 없습니다.");
 guard(typeof loadDocument==="function","클라우드 조회 연결이 없습니다.");
 guard(typeof clock==="function","현재 시각 확인 함수가 없습니다.");
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
   const r=timeRange(args,clock),s=await get("iron");
   const rows=selected(s.data?.sessions,r.from,r.to).filter(x=>args.includeUnfinished===true||
     x.status==="COMPLETED"||x.status==="PARTIAL");
   return {revision:s.revision,total:rows.length,from:r.from,to:r.to,
    records:rows.slice(-r.limit).map(workout)};
  },
  async routines(args={}){
   const r=timeRange(args,clock),s=await get("iron"),rows=array(s.data?.routines),programs=array(s.data?.programs);
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
   const r=timeRange(args,clock),s=await get("calendar");
   const rows=selectedOccurrences(s.data?.events,r,x=>args.includeSamples===true||!x.isSample);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.total,
    records:rows.records.map(calendarEvent),
    note:"한국 날짜 기준 발생일을 조회합니다. 반복 제외일·종료일과 저장된 날짜별 수정 기록을 반영합니다."};
  },
  async meals(args={}){
   const r=timeRange(args,clock),s=await get("calendar");
   const rows=selectedOccurrences(s.data?.events,r,x=>x.type==="meal"&&!x.isSample);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.total,
    records:rows.records.map(mealEvent),
    note:"날짜별 식단과 저장된 분량·단위를 조회합니다. 완료되지 않은 일정은 섭취 확정이 아닙니다. 영양값을 추정하거나 단위를 환산하지 않습니다."};
  },
  async weightHistory(args={}){
   const r=timeRange(args,clock),s=await get("calendar");
   const rows=selectedOccurrences(s.data?.events,r,x=>
    x.type==="weight"&&x.completed&&!x.isSample&&positive(x.detail?.weight,500)!==null,false);
   return {revision:s.revision,from:r.from,to:r.to,total:rows.total,
    records:rows.records.map(weightEvent)};
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
