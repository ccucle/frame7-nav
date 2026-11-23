/* FORMDAY Firestore v3 document layout — offline preflight, no network requests.
 * Each record is a separate Firestore document (not a giant 1 MiB JSON).
 * User data must never be written until a security-rules emulator passes.
 */
(function(root,factory) {
  'use strict';
  const C = typeof module==='object' && module.exports ? require('./core.js') : root.FormdayCore;
  const api=factory(C);
  if(typeof module==='object' && module.exports)module.exports=api;
  root.FormdayCloudModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  const VERSION=3;
  const MAX_DOC_BYTES=850000; // headroom below Firestore's maximum 1 MiB
  const GROUPS=Object.freeze(['profile','events','occurrences','exclusions','foods']);
  const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function err(message){throw new Error(message);}
  function validateDocument(doc){
    if(!GROUPS.includes(doc.group)||typeof doc.id!=='string'||!doc.id||doc.id.includes('/')||!isObj(doc.data))err('클라우드 문서 형식이 잘못되었습니다.');
    if(new TextEncoder().encode(JSON.stringify(doc.data)).length>MAX_DOC_BYTES)err('Firestore 개별 문서 안전 크기를 초과했습니다. 원본 데이터는 유지됩니다.');
    return doc;
  }
  function snapshotToDocuments(snapshot){
    const state=C.normalizeState(snapshot),documents=[];
    const add=(group,id,data)=>documents.push(validateDocument({group,id,data}));
    let countOccurrences=0,countExclusions=0;
    add('profile','current',{
      app:'formday',schemaVersion:VERSION,revision:state.revision,
      settings:clone(state.settings),demo:state.demo,favoriteFoodIds:clone(state.favoriteFoodIds),
      eventCount:state.events.length,foodCount:state.customFoods.length,
      occurrenceCount:state.events.reduce((sum,e)=>sum+Object.keys(e.occurrences).length,0),
      exclusionCount:state.events.reduce((sum,e)=>sum+e.excludedDates.length,0)
    });
    state.events.forEach((event,index)=>{
      add('events',event.id,{order:index,event:{...clone(event),occurrences:{},excludedDates:[]}});
      Object.keys(event.occurrences).forEach(day=>{
        add('occurrences',event.id+'__'+day,{order:countOccurrences,eventId:event.id,date:day,snapshot:clone(event.occurrences[day])});
        countOccurrences++;
      });
      for(const day of event.excludedDates){
        add('exclusions',event.id+'__'+day,{eventId:event.id,date:day});
        countExclusions++;
      }
    });
    state.customFoods.forEach((food,index)=>add('foods',food.id,{order:index,food:clone(food)}));
    const keys=new Set();
    for(const doc of documents){
      const key=doc.group+'/'+doc.id;
      if(keys.has(key))err('동일한 Firestore 문서 ID가 중복되었습니다.');
      keys.add(key);
    }
    const restored=documentsToSnapshot(documents);
    if(JSON.stringify(restored)!==JSON.stringify(state))err('클라우드 문서 재구성이 원본과 일치하지 않습니다. 업로드하지 않습니다.');
    return documents;
  }
  function documentsToSnapshot(items){
    if(!Array.isArray(items)||items.length>50000)err('클라우드 데이터 목록이 올바르지 않습니다.');
    const groups=Object.fromEntries(GROUPS.map(x=>[x,[]]));
    const ids=new Set();
    for(const item of items){
      const doc=validateDocument(item);
      const key=doc.group+'/'+doc.id;
      if(ids.has(key))err('클라우드에 중복된 문서가 있습니다.');
      ids.add(key);groups[doc.group].push(doc);
    }
    if(groups.profile.length!==1||groups.profile[0].id!=='current')err('클라우드 기본 설정 문서가 없거나 중복되었습니다.');
    const profile=groups.profile[0].data;
    if(profile.app!=='formday'||profile.schemaVersion!==VERSION)err('지원하지 않는 클라우드 기록 버전입니다.');
    for(const k of ['eventCount','foodCount','occurrenceCount','exclusionCount']){
      if(!Number.isInteger(profile[k])||profile[k]<0)err('클라우드 기록 건수 정보가 올바르지 않습니다.');
    }
    if(groups.events.length!==profile.eventCount || groups.foods.length!==profile.foodCount ||
       groups.occurrences.length!==profile.occurrenceCount || groups.exclusions.length!==profile.exclusionCount)
      err('클라우드 문서가 일부 누락되었습니다. 기존 기록은 변경하지 않습니다.');
    const ordered=(group,field)=>{
      const groupItems=groups[group];
      const orderSet=new Set();
      for(const x of groupItems){
        if(!Number.isInteger(x.data.order)||x.data.order<0||x.data.order>=groupItems.length||orderSet.has(x.data.order))
          err('클라우드 문서 순서가 잘못되었습니다.');
        orderSet.add(x.data.order);
      }
      return groupItems.slice().sort((a,b)=>a.data.order-b.data.order).map(x=>x.data[field]);
    };
    const events=ordered('events','event').map(clone);
    const eventIndex=new Map();
    for(const e of events){
      if(!isObj(e)||typeof e.id!=='string'||eventIndex.has(e.id))err('클라우드 일정 ID가 잘못되었습니다.');
      e.occurrences={};e.excludedDates=[];
      eventIndex.set(e.id,e);
    }
    const occurrenceOrders=new Set();
    for(const doc of groups.occurrences.slice().sort((a,b)=>a.data.order-b.data.order)){
      const {eventId,date,snapshot,order}=doc.data;
      if(!Number.isInteger(order)||order<0||order>=groups.occurrences.length||occurrenceOrders.has(order))err('날짜별 기록 순서가 잘못되었습니다.');
      occurrenceOrders.add(order);
      const target=eventIndex.get(eventId);
      if(!target||doc.id!==eventId+'__'+date||!C.validDate(date)||Object.prototype.hasOwnProperty.call(target.occurrences,date))
        err('반복 일정의 실제 기록이 올바르지 않습니다.');
      target.occurrences[date]=snapshot;
    }
    for(const doc of groups.exclusions){
      const {eventId,date}=doc.data;
      const target=eventIndex.get(eventId);
      if(!target||doc.id!==eventId+'__'+date||!C.validDate(date)||target.excludedDates.includes(date))
        err('반복 일정의 제외 날짜가 올바르지 않습니다.');
      target.excludedDates.push(date);
    }
    const foods=ordered('foods','food').map(clone);
    return C.normalizeState({
      schemaVersion:VERSION,
      revision:profile.revision,
      events,
      settings:profile.settings,
      demo:profile.demo,
      customFoods:foods,
      favoriteFoodIds:profile.favoriteFoodIds
    });
  }
  return Object.freeze({VERSION,MAX_DOC_BYTES,GROUPS,snapshotToDocuments,documentsToSnapshot});
});