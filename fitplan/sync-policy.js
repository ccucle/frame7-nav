/* FORMDAY Cloud Sync policy, no network, no account effects.
 * Pure conflict decisions for the two original validated record stores.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdaySyncPolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const slots=Object.freeze(['calendar','iron']);
 function decide({meta=null,local=false,localRevision='',remote=false,remoteRevision=''}) {
  if(!meta){
   if(remote&&local)return 'review';
   if(remote&&!local)return 'download';
   if(!remote&&local)return 'first-upload';
   return 'empty';
  }
  if(!remote)return 'server-missing';
  const cloudUnchanged=meta.remoteRevision===remoteRevision;
  const localUnchanged=meta.localRevision===localRevision;
  if(cloudUnchanged&&localUnchanged)return 'synced';
  if(cloudUnchanged&&!localUnchanged)return 'push';
  if(!cloudUnchanged&&localUnchanged)return 'download';
  return 'conflict';
 }
 function isUserData(slot,data,rawPresent){
  if(!rawPresent||!data)return false;
  if(slot==='calendar')return data.demo!==true ||
    (Array.isArray(data.events)&&data.events.some(x=>x.isSample!==true)) ||
    (Array.isArray(data.customFoods)&&data.customFoods.length>0);
  if(slot==='iron')return (Array.isArray(data.sessions)&&data.sessions.length>0)||
    (Array.isArray(data.routines)&&data.routines.length>0)||
    (Array.isArray(data.programs)&&data.programs.length>0)||
    (Array.isArray(data.favoriteExercises)&&data.favoriteExercises.length>0);
  return false;
 }
 function docValid(doc){
  if(!doc||doc.format!==1||typeof doc.revision!=='string'||
    doc.revision.length<1||doc.revision.length>100||
    typeof doc.payload!=='string')throw Error('클라우드 문서 형식이 올바르지 않습니다.');
  if(new TextEncoder().encode(doc.payload).length>650000)
    throw Error('클라우드 기록이 허용된 용량을 초과합니다.');
  return doc;
 }
 function bytes(value){return new TextEncoder().encode(value).length;}
 function safePayload(slot,source,core,iron){
  if(!slots.includes(slot))throw Error('동기화 저장소가 올바르지 않습니다.');
  const validated=slot==='calendar'?core.normalizeState(source):iron.normalize(source);
  const payload=JSON.stringify(validated);
  if(bytes(payload)>550000)throw Error('이 기록은 현재 앱의 동기화 크기 제한(550KB)을 넘었습니다. 원본은 이 기기에 유지됩니다. JSON 백업을 보관해 주세요.');
  return {payload,revision:validated.revision,format:1};
 }
 function backupPayload(slot,source,core,iron,exportedAt=new Date().toISOString()){
  if(!slots.includes(slot))throw Error('백업 저장소가 올바르지 않습니다.');
  // Use each store's established import format. File backups are not limited
  // by the cloud document size, and never mutate the live record or revision.
  if(slot==='calendar')return {app:'formday',version:core.VERSION,exportedAt,...core.normalizeState(source)};
  return {app:'formday-iron',version:iron.VERSION,exportedAt,data:iron.normalize(source)};
 }
 // Ignore transport revision only; do not confuse two different records with equal titles.
 const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 const equal=(a,b)=>canonical(a)===canonical(b);
 const normalized=(slot,source,core,iron)=>slot==='calendar'?core.normalizeState(source):iron.normalize(source);
 function equivalent(slot,a,b,core,iron){
  if(!a||!b)return false;
  const {revision:ar,...av}=normalized(slot,a,core,iron);
  const {revision:br,...bv}=normalized(slot,b,core,iron);
  return equal(av,bv);
 }
 function mergeRecords(slot,local,remote,base,choices={},core,iron){
  if(!slots.includes(slot))throw Error('동기화 저장소가 올바르지 않습니다.');
  const l=normalized(slot,local,core,iron),r=normalized(slot,remote,core,iron),b=base?normalized(slot,base,core,iron):null;
  const next={...l},conflicts=[],stats={localOnly:0,remoteOnly:0,same:0,baseResolved:0};
  const display=(record,key)=>record==null?'없음':typeof record==='string'?record:
   String(record.name||record.title||record.label||key)+(record.date?' · '+record.date:'')+(record.status?' · '+record.status:'');
  function choose(group,id,lv,rv,bv,known){
   if(equal(lv,rv)){stats.same++;return lv;}
   if(known){
    if(equal(lv,bv)){stats.baseResolved++;return rv;}
    if(equal(rv,bv)){stats.baseResolved++;return lv;}
   }
   if(!known){
    if(lv===undefined){stats.remoteOnly++;return rv;}
    if(rv===undefined){stats.localOnly++;return lv;}
   }
   const key=JSON.stringify([group,id]);
   const choice=choices[key];
   conflicts.push({key,group,id,label:display(lv??rv,id),local:lv===undefined?null:lv,remote:rv===undefined?null:rv,
    resolved:choice==='local'||choice==='remote'});
   return choice==='remote'?rv:lv;
  }
  function records(group,keyfn=x=>x.id){
   const lm=new Map(l[group].map(x=>[keyfn(x),x])),rm=new Map(r[group].map(x=>[keyfn(x),x])),bm=new Map((b?.[group]||[]).map(x=>[keyfn(x),x]));
   const ids=new Set([...lm.keys(),...rm.keys(),...bm.keys()]);
   next[group]=Array.from(ids,id=>choose(group,id,lm.get(id),rm.get(id),bm.get(id),!!b)).filter(v=>v!==undefined);
  }
  if(slot==='iron'){
   records('routines');records('programs');records('sessions');records('favoriteExercises',x=>x);
  }else{
   records('events');records('customFoods');records('favoriteFoodIds',x=>x);
   const settings={};
   for(const id of Object.keys(l.settings))settings[id]=choose('settings',id,l.settings[id],r.settings[id],b?.settings[id],!!b);
   next.settings=settings;
   next.demo=l.demo&&r.demo;
  }
  const unresolved=conflicts.some(c=>!c.resolved);
  if(unresolved)return {conflicts,stats,next:null,error:''};
  // Validation also rejects multiple unfinished sessions, missing routine links,
  // invalid repetitions, or merged collections beyond supported limits.
  try{return {conflicts,stats,next:normalized(slot,next,core,iron),error:''};}
  catch(e){return {conflicts,stats,next:null,error:e.message};}
 }
 return Object.freeze({slots,decide,isUserData,docValid,safePayload,backupPayload,bytes,equivalent,mergeRecords});
});
