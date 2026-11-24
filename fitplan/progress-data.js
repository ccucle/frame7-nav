/* Read-only weight and calorie series. Calendar storage remains unchanged. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayProgressData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000,MAX_BINS=120;
  const RANGES=Object.freeze(['7','30','90','all']);
  const round=value=>Math.sign(value)*Math.round((Math.abs(value)+Number.EPSILON*Math.max(1,Math.abs(value)))*100)/100;
  function dayNumber(value){
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month-1,day);
    return Math.floor(date.getTime()/DAY);
  }
  function dateAt(index){return new Date(index*DAY).toISOString().slice(0,10);}
  function actualRecords(core,state,today){
    const records=new Map();
    for(const event of state?.events||[]){
      if(event.isSample||!['weight','meal'].includes(event.type))continue;
      const dates=event.repeat==='none'?[event.date]:Object.keys(event.occurrences||{});
      for(const date of dates){
        if(!core.validDate(date)||date>today)continue;
        const item=core.occurrence(event,date);
        if(!item||item.isSample||!item.completed)continue;
        records.set(item.id+':'+date,item);
      }
    }
    return [...records.values()];
  }
  function dailyRecords(core,nutrition,state,today){
    const days=new Map();
    function row(date){
      if(!days.has(date))days.set(date,{date,weight:null,weightTime:null,weightId:null,weightCount:0,
        kcal:null,mealCount:0,foodCount:0,knownKcalItems:0,missingKcalItems:0,partial:false});
      return days.get(date);
    }
    for(const record of actualRecords(core,state,today)){
      if(record.type==='weight'){
        const value=record.detail?.weight;
        if(!Number.isFinite(value)||value<=0||value>500)continue;
        const current=row(record.date);
        current.weightCount++;
        // Same-day measurements use time, then stable record ID for ties.
        if(current.weight===null||record.start>current.weightTime||
          (record.start===current.weightTime&&record.id>current.weightId)){
          current.weight=value;current.weightTime=record.start;current.weightId=record.id;
        }
      }else{
        const totals=nutrition.calculateMeal(record.detail),current=row(record.date);
        const known=totals.itemCount-totals.missing.kcal;
        current.mealCount++;current.foodCount+=totals.itemCount;
        current.knownKcalItems+=known;current.missingKcalItems+=totals.missing.kcal;
        if(known>0)current.kcal=(current.kcal??0)+totals.kcal;
        current.partial=current.missingKcalItems>0;
      }
    }
    return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({...day,kcal:day.kcal===null?null:round(day.kcal)}));
  }
  function build(core,nutrition,state,options={}){
    const today=options.today||core.iso(new Date());
    if(!core.validDate(today))throw new Error('그래프의 기준 날짜를 확인해 주세요.');
    const range=String(options.range||'30');
    if(!RANGES.includes(range))throw new Error('지원하지 않는 그래프 조회 기간입니다.');
    const all=dailyRecords(core,nutrition,state,today),endIndex=dayNumber(today);
    const start=range==='all'?(all[0]?.date||today):dateAt(Math.max(dayNumber('0000-01-01'),endIndex-Number(range)+1));
    const startIndex=dayNumber(start),dayCount=endIndex-startIndex+1;
    const daily=all.filter(day=>day.date>=start);
    // Every calendar day belongs to exactly one bin. Long ranges are explicitly
    // averaged rather than silently truncating or drawing millions of SVG nodes.
    const bucketDays=Math.max(1,Math.ceil(dayCount/MAX_BINS));
    const buckets=Array.from({length:Math.ceil(dayCount/bucketDays)},(_,index)=>{
      const first=startIndex+index*bucketDays,last=Math.min(endIndex,first+bucketDays-1);
      return {index,start:dateAt(first),end:dateAt(last),days:last-first+1,
        weight:null,kcal:null,weightDays:0,kcalDays:0,mealDays:0,partialKcalDays:0,
        mealCount:0,weightMin:null,weightMax:null,_weight:0,_kcal:0};
    });
    for(const day of daily){
      const bin=buckets[Math.floor((dayNumber(day.date)-startIndex)/bucketDays)];
      if(day.weight!==null){
        bin.weightDays++;bin._weight+=day.weight;
        bin.weightMin=bin.weightMin===null?day.weight:Math.min(bin.weightMin,day.weight);
        bin.weightMax=bin.weightMax===null?day.weight:Math.max(bin.weightMax,day.weight);
      }
      if(day.mealCount){bin.mealDays++;bin.mealCount+=day.mealCount;}
      if(day.partial)bin.partialKcalDays++;
      if(day.kcal!==null){bin.kcalDays++;bin._kcal+=day.kcal;}
    }
    for(const bin of buckets){
      bin.weight=bin.weightDays?round(bin._weight/bin.weightDays):null;
      bin.kcal=bin.kcalDays?round(bin._kcal/bin.kcalDays):null;
      delete bin._weight;delete bin._kcal;
    }
    const weights=daily.filter(day=>day.weight!==null),calories=daily.filter(day=>day.kcal!==null);
    const firstWeight=weights[0]||null,lastWeight=weights.at(-1)||null;
    const latestWeight=all.filter(day=>day.weight!==null).at(-1)||null;
    const settings=state?.settings||{},kcal=Number(settings.protein)*4+Number(settings.carbs)*4+Number(settings.fat)*9;
    const targetWeight=Number.isFinite(settings.targetWeight)&&settings.targetWeight>0&&settings.targetWeight<=500?settings.targetWeight:null;
    const averageKcal=calories.length?round(calories.reduce((total,day)=>total+day.kcal,0)/calories.length):null;
    return {range,start,end:today,dayCount,bucketDays,buckets,daily,
      targets:{kcal:Number.isFinite(kcal)&&kcal>0?kcal:null,weight:targetWeight},
      summary:{firstWeight,lastWeight,latestWeight,weightDays:weights.length,
        weightChange:weights.length>=2?round(lastWeight.weight-firstWeight.weight):null,
        weightToGoal:latestWeight&&targetWeight!==null?round(latestWeight.weight-targetWeight):null,
        averageKcal,knownCalorieDays:calories.length,mealDays:daily.filter(day=>day.mealCount>0).length,
        partialCalorieDays:daily.filter(day=>day.partial).length,
        calorieGoalPercent:averageKcal!==null&&Number.isFinite(kcal)&&kcal>0?round(averageKcal/kcal*100):null}}
  }
  return Object.freeze({RANGES,MAX_BINS,dayNumber,dateAt,actualRecords,dailyRecords,build});
});
