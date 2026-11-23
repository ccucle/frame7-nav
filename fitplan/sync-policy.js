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
    (Array.isArray(data.programs)&&data.programs.length>0);
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
  if(bytes(payload)>550000)throw Error('이 기록은 무료 동기화 문서의 최대 안전 크기(550KB)를 넘었습니다. 원본은 이 기기에 유지됩니다. JSON 백업 후 분할 저장 구조로 확장해야 합니다.');
  return {payload,revision:validated.revision,format:1};
 }
 return Object.freeze({slots,decide,isUserData,docValid,safePayload,bytes});
});