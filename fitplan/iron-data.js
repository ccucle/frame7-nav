/* FORMDAY IRON MODE · exercise directory and read-only training analytics */
(function(root,factory){
  'use strict';
  const calendarWorkouts=typeof module==='object'&&module.exports?require('./calendar-workouts.js'):root.FormdayCalendarWorkouts;
  const api=factory(calendarWorkouts);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayIronData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(calendarWorkouts){
  'use strict';
  const PHOTOS=Object.freeze({
    hero:'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&auto=format&fit=crop&q=76',
    equipment:'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1100&auto=format&fit=crop&q=76',
    strength:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1100&auto=format&fit=crop&q=76',
    dumbbell:'https://images.unsplash.com/photo-1517964603305-721ff24c04d8?w=1000&auto=format&fit=crop&q=76'
  });
  const PHOTO_CREDITS=Object.freeze([
    {url:'https://unsplash.com/photos',label:'Unsplash 운동 사진'},
    {url:'https://unsplash.com/license',label:'Unsplash 이용 허락'}
  ]);
  const EQUIPMENT=Object.freeze(['전체 장비','바벨','덤벨','머신','케이블','맨몸','기타']);
  const MUSCLES=Object.freeze(['전체','가슴','등','어깨','하체','팔','코어','전신']);
  const tips={
    '가슴':['어깨와 손목이 불편하지 않은 가동 범위부터 시작하세요.','가슴·어깨·삼두의 협응과 자세의 안정성을 확인하세요.','실패 직전까지 무리하기보다 반복 가능한 자세를 우선하세요.'],
    '등':['허리를 무리하게 젖히지 않고 몸통을 안정적으로 유지하세요.','견갑의 움직임과 팔꿈치 경로를 천천히 확인하세요.','반동보다 통제 가능한 속도와 가동 범위를 선택하세요.'],
    '어깨':['통증 없는 가동 범위에서 진행하세요.','상체 반동을 줄이고 좌우 균형을 확인하세요.','작은 중량부터 진행해 반복 가능한 자세를 찾으세요.'],
    '하체':['발의 지지와 무릎 이동을 개인의 가동 범위에 맞추세요.','허리와 몸통을 안정적으로 유지하고 통증 시 중단하세요.','반복 속도와 깊이를 통제할 수 있는 중량을 선택하세요.'],
    '팔':['팔꿈치·손목에 무리가 없는 자세를 선택하세요.','반동을 줄이고 수축과 이완을 통제하세요.','세트 간 회복 시간을 확보하세요.'],
    '코어':['호흡을 참는 시간을 지나치게 늘리지 마세요.','허리를 꺾거나 당기는 느낌 없이 복부 긴장을 유지하세요.','동작 난이도보다 정확한 반복을 우선하세요.'],
    '전신':['동작의 여러 구간을 구분해 기본 기술부터 연습하세요.','기술을 익히기 전에는 중량보다 자세를 먼저 확보하세요.','고중량 동작은 필요하면 지도자의 감독 아래 수행하세요.']
  };
  const special={
    '벤치프레스':['발을 안정적으로 지면에 두고 견갑을 벤치에 고정하세요.','바의 하강·상승 경로를 통제하고 손목을 안정적으로 유지하세요.','보조자나 안전 장치를 활용하고 무리한 1회 최대 시도는 피하세요.'],
    '스쿼트':['자신의 발목·고관절 가동 범위에서 내려가세요.','무릎과 발의 움직임을 개인 체형에 맞춰 자연스럽게 조절하세요.','안전바를 설정하고 자세가 무너지면 세트를 중단하세요.'],
    '데드리프트':['바와 몸의 거리를 가까이 유지하고 몸통을 단단하게 준비하세요.','바를 당기기 전 등과 골반 위치를 점검하세요.','허리 통증이 있으면 중단하고 기술 점검을 우선하세요.'],
    '랫풀다운':['어깨가 불편하지 않은 그립을 선택하세요.','몸통 반동보다 팔꿈치 하강에 집중하세요.','목 뒤로 억지로 내리지 않고 통제 가능한 경로를 선택하세요.'],
    '풀업':['처음에는 보조 머신이나 밴드를 사용할 수 있습니다.','어깨를 강제로 끌어내리기보다 편안한 가동 범위를 찾으세요.','흔들림을 줄이고 반복 가능한 동작을 유지하세요.']
  };
  const barbell=/벤치프레스|스쿼트|데드리프트|바벨|오버헤드프레스|티바로우|클린|스내치/;
  const dumbbell=/덤벨|고블릿|아놀드/;
  const machine=/머신|머신|레그프레스|레그컬|핵스쿼트|펙덱|스미스|프리처|어시스트|익스텐션|어브덕션|어덕션/;
  const cable=/케이블|랫풀다운|푸시다운|페이스풀|스트레이트암|시티드 케이블/;
  const bodyweight=/푸시업|딥스|풀업|런지|스텝업|크런치|레그레이즈|니레이즈|앱휠|백 익스텐션|글루트 브리지/;
  function equipmentFor(name){
    if(cable.test(name))return '케이블';
    if(dumbbell.test(name))return '덤벨';
    if(machine.test(name))return '머신';
    if(bodyweight.test(name))return '맨몸';
    if(barbell.test(name))return '바벨';
    return '기타';
  }
  function info(name,catalog){
    const row=(catalog||[]).find(x=>x.name===name);
    const group=row?row.group:'전신';
    const equipment=equipmentFor(name);
    const photo=equipment==='덤벨'?PHOTOS.dumbbell:equipment==='바벨'?PHOTOS.hero:
       equipment==='머신'||equipment==='케이블'?PHOTOS.equipment:PHOTOS.strength;
    return {name,group,equipment,photo,tips:special[name]||tips[group]||tips['전신']};
  }
  function all(catalog){
    return (catalog||[]).map(x=>info(x.name,catalog));
  }
  function calendarRecords(core,state,day){
    const result=new Map();
    for(const event of state?.events||[]){
      const dates=day?[day]:event.repeat==='none'?[event.date]:Object.keys(event.occurrences||{});
      for(const date of dates){
        const item=core.occurrence(event,date);
        if(!item||item.isSample)continue;
        // A repeating event is one record per occurrence, not one per series.
        const key='calendar:'+item.id+':'+date;
        result.set(key,{...item,source:'calendar',recordKey:key});
      }
    }
    return [...result.values()];
  }
  function isPerformedSet(s){
    return s?.done===true&&Number.isFinite(s.weight)&&s.weight>=0&&Number.isInteger(s.reps)&&s.reps>=1;
  }
  function independentRecords(core,independent){
    const result=new Map();
    for(const session of independent?.sessions||[]){
      if(!['COMPLETED','PARTIAL'].includes(session.status)||session.isSample||!core.validDate(session.date)||
        !session.exercises?.some(ex=>ex.sets?.some(isPerformedSet)))continue;
      // Matching names or weights may belong to two legitimate workouts.
      // Only an explicit, date-specific calendar source can join both stores.
      const key='iron:'+session.id;
      const source=session.calendarSource;
      const calendarKey=source&&typeof source.eventId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(source.eventId)&&
        source.date===session.date&&typeof source.baseline==='string'&&source.baseline.length>0
        ?'calendar:'+source.eventId+':'+source.date:null;
      result.set(key,{id:session.id,date:session.date,start:'',end:'',type:'strength',
        title:session.label,completed:calendarWorkouts.completion(session).state==='complete',isSample:false,source:'iron',recordKey:key,
        status:session.status,calendarKey,calendarBaseline:calendarKey?source.baseline:null,detail:{exercises:session.exercises||[]}});
    }
    return [...result.values()];
  }
  function combineRecords(calendar,independent){
    const sources=new Map(),represented=new Set();
    for(const record of independent){
      if(!record.calendarKey)continue;
      const matches=sources.get(record.calendarKey)||[];
      matches.push(record);sources.set(record.calendarKey,matches);
    }
    const entries=calendar.filter(record=>{
      if(record.type!=='strength')return true;
      const sessions=sources.get(record.recordKey);
      if(!sessions?.length)return true;
      const reflected=sessions.find(session=>record.workoutSessionId===session.id);
      if(reflected){represented.add(reflected.recordKey);return true;}
      // The session is saved before its calendar reflection. Suppress only an
      // unchanged source while reflection is pending. Conflicting actual edits
      // or another session's marker remain separate until explicitly resolved.
      if(record.workoutSessionId||!calendarWorkouts?.signature)return true;
      try{
        const signature=calendarWorkouts.signature(record);
        return !sessions.some(session=>session.calendarBaseline===signature);
      }catch(error){return true;}
    });
    const reflectedEntries=entries.map(record=>{
      const reflected=record.type==='strength'&&sources.get(record.recordKey)?.find(s=>record.workoutSessionId===s.id);
      return reflected?{...record,completed:record.completed&&reflected.completed,status:reflected.completed?'COMPLETED':'PARTIAL'}:record;
    });
    return [...reflectedEntries,...independent.filter(record=>!represented.has(record.recordKey))];
  }
  function records(core,state,independent){
    // Read-only projection: no migration, storage writes or routine targets.
    return combineRecords(calendarRecords(core,state),independentRecords(core,independent));
  }
  function strengthSummary(detail,includeActual=true){
    let setCount=0,completedSets=0,volume=0;
    for(const exercise of detail?.exercises||[]){
      for(const set of exercise.sets||[]){
        if(set.warmup)continue;
        setCount++;
        if(!includeActual||set.done!==true||!Number.isFinite(set.weight)||set.weight<0||!Number.isInteger(set.reps)||set.reps<1)continue;
        completedSets++;volume+=set.weight*set.reps;
      }
    }
    return {setCount,completedSets,volume:Math.round(volume*100)/100};
  }
  function daySummary(core,state,independent,day,clock){
    const today=core.iso(clock||new Date());
    const entries=combineRecords(calendarRecords(core,state,day),independentRecords(core,independent).filter(e=>e.date===day&&e.date<=today));
    const workouts=entries.filter(e=>e.type==='strength'||e.type==='cardio');
    const result={workoutCount:workouts.length,completedWorkouts:0,partialWorkouts:0,strengthSessions:0,cardioSessions:0,setCount:0,completedSets:0,volume:0};
    for(const record of workouts){
      if(record.type==='strength'){
        const sum=strengthSummary(record.detail,day<=today);
        result.setCount+=sum.setCount;result.completedSets+=sum.completedSets;result.volume+=sum.volume;
        if(sum.completedSets)result.strengthSessions++;
        if(day<=today){
          const completion=calendarWorkouts.completion(record);
          if(completion.state==='complete'&&sum.completedSets)result.completedWorkouts++;
          else if(completion.state==='partial')result.partialWorkouts++;
        }
      }else if(day<=today&&record.completed){result.completedWorkouts++;result.cardioSessions++;}
    }
    result.volume=Math.round(result.volume*100)/100;
    return result;
  }
  function analytics(core,workouts,state,clock,independent){
    const today=core.iso(clock||new Date());
    const monday=core.shiftDate(today,-((core.dateOf(today).getDay()+6)%7));
    const history=records(core,state,independent).filter(e=>e.date<=today);
    const week=history.filter(e=>e.date>=monday&&e.date<=today);
    const wkStrength=week.filter(e=>e.type==='strength'&&strengthSummary(e.detail).completedSets>0);
    const wkCardio=week.filter(e=>e.type==='cardio'&&e.completed);
    const byGroup={},prMap=new Map(),trainingDays=new Set();
    let totalVolume=0,completedSets=0;
    const strengthRecords=history.filter(x=>x.type==='strength');
    for(const e of strengthRecords){
      const isWeek=e.date>=monday&&e.date<=today;
      let hasDone=false;
      for(const ex of e.detail.exercises||[]){
        const group=(workouts.catalog.find(x=>x.name===ex.name)||{}).group||'기타';
        for(const s of ex.sets||[]){
          if(s.done!==true||s.warmup||!Number.isFinite(s.weight)||s.weight<0||!Number.isInteger(s.reps)||s.reps<1)continue;
          hasDone=true;
          if(s.weight>0&&s.reps<=10){
            const estimate=s.reps===1?s.weight:s.weight*(1+s.reps/30);
            const previous=prMap.get(ex.name);
            if(!previous||estimate>previous.oneRM)prMap.set(ex.name,{name:ex.name,oneRM:estimate,weight:s.weight,reps:s.reps,date:e.date});
          }
          if(isWeek){
            const vol=s.weight*s.reps;
            byGroup[group]=(byGroup[group]||0)+vol;totalVolume+=vol;completedSets++;
          }
        }
      }
      if(isWeek&&hasDone)trainingDays.add(e.date);
    }
    for(const e of wkCardio)trainingDays.add(e.date);
    const recentWeights=history.filter(e=>e.type==='weight'&&e.completed&&e.date<=today&&
      typeof e.detail.weight==='number'&&Number.isFinite(e.detail.weight)&&e.detail.weight>0)
      .sort((a,b)=>b.date.localeCompare(a.date)||b.start.localeCompare(a.start));
    const bestPR=[...prMap.values()].sort((a,b)=>b.oneRM-a.oneRM)[0]||null;
    const currentWorkout=calendarRecords(core,state,today).filter(e=>e.type==='strength');
    return {
      today,monday,week,history,trainingDays:trainingDays.size,
      strengthSessions:wkStrength.length,cardioSessions:wkCardio.length,
      totalVolume:Math.round(totalVolume*100)/100,completedSets,byGroup,
      weight:recentWeights[0]?.detail.weight??null,
      bestPR,prMap,currentWorkout
    };
  }
  return Object.freeze({PHOTOS,PHOTO_CREDITS,EQUIPMENT,MUSCLES,tips,info,all,records,isPerformedSet,strengthSummary,daySummary,analytics});
});
