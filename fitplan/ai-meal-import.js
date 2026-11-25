/* FORMDAY AI meal import — strict single-meal format; never executes pasted text. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./core.js'):root.FormdayCore,node?require('./nutrition.js'):root.FormdayNutrition);
  if(node)module.exports=api;else root.FormdayAIMealImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C,N){
  'use strict';
  const FORMAT='formday-ai-meal-v1';
  const KEYS=['kcal','carbs','protein','fat','unsat'];
  const EVIDENCE={photo_estimate:'사진 기반 AI 추정 · 미검증',estimate:'AI 추정 · 미검증',user_label:'사용자 제공 영양 표시',unknown:'영양정보 미확인'};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const fail=message=>{throw new Error(message);};
  function object(o,allowed,required,label){
    if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k))||required.some(k=>!own(o,k)))fail(label+' 형식을 확인해 주세요.');
    return o;
  }
  function text(value,max,label,optional=false){
    if(optional&&(value===undefined||value===null))return '';
    if(typeof value!=='string'||value.length>max||(!optional&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(label+'을(를) 확인해 주세요.');
    return value.trim();
  }
  function parse(raw){
    if(typeof raw!=='string'||!raw.trim()||raw.length>80000)fail('AI 식단 JSON을 붙여넣어 주세요. 최대 80,000자입니다.');
    let s=raw.trim();
    const fenced=/^\x60\x60\x60(?:json)?\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60$/i.exec(s);
    if(fenced)s=fenced[1].trim();
    let value;
    try{value=JSON.parse(s);}catch{fail('JSON 형식이 올바르지 않습니다. 전체 식단 JSON 한 개만 붙여넣어 주세요.');}
    object(value,['format','date','start','end','title','notes','items'],['format','title','items'],'식단');
    if(value.format!==FORMAT)fail('FORMDAY AI 식단 가져오기 형식이 아닙니다. 일반 백업은 가져올 수 없습니다.');
    for(const key of ['date','start','end']){
      const v=value[key];
      if(v!==undefined&&v!==null&&!(key==='date'?C.validDate(v):C.validTime(v)))fail('날짜와 시간은 YYYY-MM-DD / HH:MM 또는 null로 입력해 주세요.');
    }
    if(value.start&&value.end&&value.start>=value.end)fail('종료 시간은 시작 시간보다 늦어야 합니다.');
    const title=text(value.title,160,'식단 제목');
    const notes=text(value.notes,1000,'메모',true);
    if(!Array.isArray(value.items)||value.items.length<1||value.items.length>50)fail('한 끼에 음식 1~50개를 입력해 주세요.');
    const items=value.items.map((item,index)=>{
      object(item,['name','amount','unit','evidence','nutrients'],['name','amount','unit','evidence'],'음식 '+(index+1));
      const name=text(item.name,160,'음식 이름');
      if(typeof item.amount!=='number'||!Number.isFinite(item.amount)||item.amount<=0||item.amount>20000)fail(name+': 섭취량은 0보다 크고 20,000 이하인 숫자여야 합니다.');
      if(!['g','ml','serving'].includes(item.unit))fail(name+': 단위는 g, ml, serving 중 하나여야 합니다.');
      if(typeof item.evidence!=='string'||!own(EVIDENCE,item.evidence))fail(name+': 영양정보 출처를 선택해 주세요.');
      const n=object(item.nutrients===undefined?{}:item.nutrients,KEYS,[],'음식 영양정보');
      const nutrients=Object.fromEntries(KEYS.map(k=>[k,own(n,k)?n[k]:null]));
      if(item.evidence==='unknown'&&KEYS.some(k=>nutrients[k]!==null))fail(name+': 미확인 영양성분은 null로 입력해 주세요.');
      const food=N.validateFood({id:C.uid(),name,basisAmount:item.amount,basisUnit:item.unit,nutrients,
        source:{kind:item.evidence==='user_label'?'user':'unknown',label:EVIDENCE[item.evidence]}});
      return {id:C.uid(),amount:item.amount,food};
    });
    const detail=N.normalizeMeal({items,notes:['AI 식단 가져오기 · 섭취량 및 AI 추정값은 사용자 확인 기준.',notes].filter(Boolean).join('\n')});
    return {date:value.date??null,start:value.start??null,end:value.end??null,title,detail,id:C.uid()};
  }
  function kstDay(now=new Date()){
    if(!now||!Number.isFinite(now.getTime()))fail('현재 날짜를 확인할 수 없습니다.');
    return new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10);
  }
  const normalizedName=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  function signature(items){
    return JSON.stringify(items.map(i=>[normalizedName(i.food.name),i.food.basisUnit,i.amount]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  function prepare(state,parsed,schedule,now=new Date()){
    if(!state||!parsed||!schedule)fail('먼저 식단 미리보기를 확인해 주세요.');
    const {date,start,end}=schedule;
    if(!C.validDate(date))fail('실제 식사 날짜를 입력해 주세요.');
    if(date>kstDay(now))fail('미래 날짜에 완료된 식사를 등록할 수 없습니다.');
    if(!C.validTime(start)||!C.validTime(end)||start>=end)fail('실제 시작·종료 시간을 입력해 주세요. 종료 시간은 시작보다 늦어야 합니다.');
    const detail=N.normalizeMeal(parsed.detail);
    const sig=signature(detail.items);
    // Conservative: identical portions or overlapping meal times on the same date
    // can be a retry or a partial duplicate; do not modify any previous meal.
    const match=C.dayEvents(state,date).find(e=>e.type==='meal'&&!e.isSample&&
      (signature(e.detail.items)===sig||(e.start<end&&start<e.end)));
    if(match)fail('중복 가능 식단: '+match.start+'–'+match.end+' '+match.title+'. 기존 기록을 확인해 주세요. 자동으로 추가하거나 덮어쓰지 않습니다.');
    if(state.events.some(e=>e.id===parsed.id))fail('이미 사용한 가져오기 식별자입니다. 기존 기록을 확인해 주세요.');
    const event={id:parsed.id,date,start,end,type:'meal',title:parsed.title,repeat:'none',repeatUntil:null,completed:true,detail,isSample:false};
    // The existing calendar normalization and revision-checked save own all persistence.
    return {event,next:C.upsert(state,event),totals:N.calculateMeal(detail)};
  }
  return Object.freeze({FORMAT,KEYS,parse,prepare,kstDay});
});
