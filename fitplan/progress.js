/* Accessible SVG progress views. Reads existing records; never writes them. */
(function(root,factory){
  'use strict';
  const data=typeof module==='object'&&module.exports?require('./progress-data.js'):root.FormdayProgressData;
  const api=factory(data);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FormdayProgressView=api;
  if(typeof document!=='undefined')api.mount(root,document);
})(typeof window!=='undefined'?window:globalThis,function(D){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const signed=value=>(value>0?'+':'')+fmt(value);
  const label=metric=>metric==='weight'?'체중':'기록한 칼로리';
  const unit=metric=>metric==='weight'?'kg':'kcal';
  const dates=bin=>bin.start===bin.end?bin.start:bin.start+' ~ '+bin.end;
  const numeric=(value,suffix)=>value===null?'—':fmt(value)+' '+suffix;
  const PAGE_SIZE=20;

  function geometry(model,metric,requestedWidth=680){
    const width=Math.max(280,Math.min(1280,requestedWidth)),height=280;
    const left=56,right=18,top=32,bottom=48,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const values=model.buckets.map(bin=>bin[metric]).filter(value=>value!==null);
    const target=model.targets[metric];
    if(target!==null)values.push(target);
    let min,max;
    if(metric==='weight'){
      min=values.length?Math.min(...values):0;max=values.length?Math.max(...values):100;
      const padding=Math.max(.5,(max-min)*.15);min=Math.max(0,min-padding);max+=padding;
    }else{min=0;max=Math.max(1,...values)*1.12;}
    const x=index=>left+((index-D.dayNumber(model.start)+.5)/model.dayCount)*plotWidth;
    const y=value=>top+(max-value)/(max-min)*plotHeight;
    const points=model.buckets.map(bin=>({index:bin.index,value:bin[metric],
      x:x((D.dayNumber(bin.start)+D.dayNumber(bin.end))/2),
      y:bin[metric]===null?null:y(bin[metric]),
      barWidth:Math.max(1,Math.min(26,plotWidth*bin.days/model.dayCount*.7))}));
    const segments=[];let segment=[];
    for(const point of points){
      if(point.value===null){if(segment.length)segments.push(segment);segment=[];}
      else segment.push(point);
    }
    if(segment.length)segments.push(segment);
    const tickCount=Math.min(width<520?3:5,model.dayCount);
    const ticks=Array.from({length:tickCount},(_,i)=>{
      const offset=tickCount===1?0:Math.round((model.dayCount-1)*i/(tickCount-1));
      const date=D.dateAt(D.dayNumber(model.start)+offset);
      return {date,x:x(D.dayNumber(date))};
    });
    return {width,height,left,right,top,bottom,plotWidth,plotHeight,min,max,points,segments,ticks,
      baseline:height-bottom,targetY:target===null?null:y(target)};
  }
  function pointLabel(model,metric,bin){
    const aggregation=model.bucketDays>1?' 기록일 평균':'';
    const value=bin[metric]===null?'기록 없음':fmt(bin[metric])+' '+unit(metric);
    const partial=metric==='kcal'&&bin.partialKcalDays?' · 열량 미확인 항목 포함':'';
    return dates(bin)+' '+label(metric)+aggregation+' '+value+partial;
  }
  function chartMarkup(model,metric,width,selected){
    const g=geometry(model,metric,width),id='fp-'+metric;
    const target=model.targets[metric],known=g.points.filter(p=>p.value!==null);
    if(!known.length&&target===null)return '<div class="fp-empty">선택한 기간에 완료된 '+label(metric)+' 기록이 없습니다.<br>기록을 추가하면 날짜에 맞춰 표시됩니다.</div>';
    const grid=Array.from({length:5},(_,i)=>{
      const y=g.top+i*g.plotHeight/4,value=g.max-i*(g.max-g.min)/4;
      return '<line class="fp-grid" x1="'+g.left+'" y1="'+y+'" x2="'+(g.width-g.right)+'" y2="'+y+'"/><text class="fp-axis-label" x="'+(g.left-9)+'" y="'+(y+4)+'" text-anchor="end">'+fmt(value)+'</text>';
    }).join('');
    const axis=g.ticks.map((tick,index)=>'<text class="fp-axis-label" x="'+tick.x+'" y="'+(g.height-18)+'" text-anchor="'+(index===0?'start':index===g.ticks.length-1?'end':'middle')+'">'+
      esc((model.dayCount>365?tick.date.slice(2):tick.date.slice(5)).replace(/-/g,'.'))+'</text>').join('');
    const line=metric==='weight'?g.segments.map(segment=>'<path class="fp-weight-line" d="'+segment.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+','+p.y.toFixed(2)).join(' ')+'"/>').join(''):'';
    const targetLine=target===null?'':'<line class="fp-target-line" x1="'+g.left+'" y1="'+g.targetY+'" x2="'+(g.width-g.right)+'" y2="'+g.targetY+'"/>';
    const marks=known.map(p=>{
      const bin=model.buckets[p.index],active=p.index===selected;
      const graphic=metric==='weight'?'<circle class="fp-hit" cx="'+p.x+'" cy="'+p.y+'" r="12"/><circle class="fp-mark" cx="'+p.x+'" cy="'+p.y+'" r="4.5"/>':
        '<rect class="fp-hit" x="'+(p.x-Math.max(10,p.barWidth/2))+'" y="'+Math.min(p.y,g.baseline-14)+'" width="'+Math.max(20,p.barWidth)+'" height="'+Math.max(14,g.baseline-p.y)+'"/>'+
        '<rect class="fp-mark" x="'+(p.x-p.barWidth/2)+'" y="'+Math.min(p.y,g.baseline-2)+'" width="'+p.barWidth+'" height="'+Math.max(2,g.baseline-p.y)+'" rx="2"/>';
      return '<g class="fp-point '+(active?'is-selected ':'')+(metric==='kcal'&&bin.partialKcalDays?'fp-partial':'')+'" role="button" tabindex="'+(active?'0':'-1')+'" focusable="true" aria-pressed="'+active+'" aria-label="'+esc(pointLabel(model,metric,bin))+'" data-progress-point="'+metric+'-'+p.index+'" data-progress-metric="'+metric+'" data-progress-index="'+p.index+'"><title>'+esc(pointLabel(model,metric,bin))+'</title>'+graphic+'</g>';
    }).join('');
    return '<svg class="fp-svg" viewBox="0 0 '+g.width+' '+g.height+'" width="'+g.width+'" height="'+g.height+'" role="group" aria-labelledby="'+id+'-svg-title '+id+'-svg-desc">'+
      '<title id="'+id+'-svg-title">'+label(metric)+' · '+model.start+'부터 '+model.end+'까지</title>'+
      '<desc id="'+id+'-svg-desc">'+(model.bucketDays>1?model.bucketDays+'일씩 묶은 기록일 평균입니다.':'날짜 간 간격이 같은 일별 그래프입니다.')+' 기록 없는 날짜는 0으로 채우지 않습니다. '+(metric==='weight'?'기록이 없는 구간의 선은 연결하지 않습니다. ':'')+'점이나 막대를 선택하면 아래에 수치가 표시됩니다. 선택한 점에서 좌우 화살표로 다른 기록을 확인하세요.</desc>'+
      grid+targetLine+line+marks+axis+'</svg>'+
      (!known.length?'<p class="fp-empty-note">선택 기간의 수치는 아직 없습니다. 점선은 현재 설정한 목표입니다.</p>':'');
  }
  function detailMarkup(model,metric,index){
    const bin=model.buckets[index];
    if(!bin)return '<p>선택한 기간에 기록이 없습니다.</p>';
    const value=bin[metric],aggregation=model.bucketDays>1?' · 기록일 평균':'';
    let note;
    if(metric==='weight'){
      const day=model.bucketDays===1?model.daily.find(row=>row.date===bin.start):null;
      note=value===null?'체중 측정 기록 없음':model.bucketDays===1?
        (day?.weightTime||'')+' 마지막 측정'+(day?.weightCount>1?' · 같은 날 '+day.weightCount+'회 중 마지막 값':''):
        bin.days+'일 중 '+bin.weightDays+'일 측정 · 최저 '+fmt(bin.weightMin)+' / 최고 '+fmt(bin.weightMax)+' kg';
    }else{
      note=bin.mealCount===0?'완료된 식사 기록 없음':bin.mealCount+'건 식사 · 열량 수치를 확인한 '+bin.kcalDays+'일'+
        (bin.partialKcalDays?' · '+bin.partialKcalDays+'일에 열량 미확인 항목 포함':'');
      if(value===null&&bin.mealCount)note+=' · 합계 계산 불가';
      if(value!==null&&model.targets.kcal!==null)note+=' · 현재 목표의 '+fmt(value/model.targets.kcal*100)+'% (확인된 기록 기준)';
    }
    return '<span class="fp-detail-date">'+esc(dates(bin)+aggregation)+'</span><strong>'+numeric(value,unit(metric))+
      (metric==='kcal'&&value!==null&&bin.partialKcalDays?' <small>+ 미확인</small>':'')+'</strong><p>'+esc(note)+'</p>';
  }
  function metricCard(model,metric,width,selected){
    const target=model.targets[metric],valid=model.buckets.filter(b=>b[metric]!==null);
    selected=selected??valid.at(-1)?.index??model.buckets.length-1;
    const rangeNote=model.bucketDays>1?model.bucketDays+'일씩 묶은 기록일 평균 · 미기록일은 평균 분모에서 제외':
      metric==='weight'?'같은 날 여러 번 측정하면 마지막 시간의 값':'완료한 식사에서 확인된 열량만 합산';
    return '<section class="fp-card" aria-labelledby="fp-'+metric+'-title"><div class="fp-card-head"><div><span class="fp-kicker">'+(metric==='weight'?'BODY WEIGHT':'CALORIE INTAKE')+'</span><h3 id="fp-'+metric+'-title">'+(metric==='weight'?'체중 변화':'기록한 칼로리')+'</h3></div><span class="fp-unit">'+unit(metric)+'</span></div>'+
      '<p class="fp-card-note">'+rangeNote+'</p><div class="fp-legend"><span><i class="fp-legend-record"></i>'+(model.bucketDays>1?'기록일 평균':'실제 기록')+'</span>'+
      (target!==null?'<span><i class="fp-legend-target"></i>현재 목표 '+fmt(target)+' '+unit(metric)+'</span>':'')+'</div>'+
      chartMarkup(model,metric,width,selected)+'<div class="fp-detail" id="fp-'+metric+'-detail" role="status" aria-live="polite">'+detailMarkup(model,metric,selected)+'</div>'+
      '<div class="fp-point-controls"><button type="button" data-progress-step="-1" data-progress-metric="'+metric+'" '+(!valid.length?'disabled':'')+' aria-label="이전 '+label(metric)+' 기록">← 이전 기록</button><span>점·막대 선택 / 좌우 방향키</span><button type="button" data-progress-step="1" data-progress-metric="'+metric+'" '+(!valid.length?'disabled':'')+' aria-label="다음 '+label(metric)+' 기록">다음 기록 →</button></div>'+
      (metric==='weight'&&target===null?'<p class="fp-footnote">목표 체중선은 상단의 <b>목표 설정</b>에서 목표 체중을 입력하면 표시됩니다.</p>':'')+'</section>';
  }
  function tableMarkup(model,page){
    const rows=model.daily.slice().reverse(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    const current=Math.max(0,Math.min(page,pages-1)),slice=rows.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE);
    return '<p class="fp-table-note">기록이 있는 날짜 '+rows.length+'일 · 최신순 · '+(current+1)+' / '+pages+'페이지. 미기록 날짜는 표에 추가하지 않습니다.</p>'+
      '<div class="fp-table-wrap"><table><caption>날짜별 실제 체중과 완료한 식사의 열량</caption><thead><tr><th scope="col">날짜</th><th scope="col">체중</th><th scope="col">기록한 칼로리</th></tr></thead><tbody>'+
      (slice.length?slice.map(day=>'<tr><th scope="row">'+day.date+'</th><td>'+numeric(day.weight,'kg')+(day.weight!==null?'<small>'+esc(day.weightTime)+' 측정</small>':'<small>측정 없음</small>')+'</td><td>'+
        (day.kcal===null?(day.mealCount?'열량 미확인':'기록 없음'):fmt(day.kcal)+' kcal'+(day.partial?' +':''))+
        (day.mealCount?'<small>식사 '+day.mealCount+'건'+(day.partial?' · 미확인 항목 '+day.missingKcalItems+'개':'')+'</small>':'')+'</td></tr>').join(''):
        '<tr><td colspan="3">선택한 기간에 실제 기록이 없습니다.</td></tr>')+'</tbody></table></div>'+
      '<div class="fp-table-pages"><button type="button" data-progress-page="-1" '+(current===0?'disabled':'')+'>이전 날짜 묶음</button><span>'+ (current+1)+' / '+pages+'</span><button type="button" data-progress-page="1" '+(current===pages-1?'disabled':'')+'>다음 날짜 묶음</button></div>';
  }
  function pageMarkup(model,options={}){
    const s=model.summary,width=options.width||680,selected=options.selected||{};
    const latest=s.latestWeight,change=s.weightChange;
    const goalNote=model.targets.weight===null?'목표 체중 미설정':s.weightToGoal===null?'목표 '+fmt(model.targets.weight)+' kg':s.weightToGoal===0?'목표 체중과 같음':
      '목표보다 '+fmt(Math.abs(s.weightToGoal))+' kg '+(s.weightToGoal>0?'높음':'낮음');
    return '<section class="fp-view" aria-labelledby="fd-page-title">'+
      '<div class="fp-range" role="group" aria-label="그래프 조회 기간">'+D.RANGES.map(range=>'<button type="button" data-progress-range="'+range+'" aria-pressed="'+(model.range===range)+'">'+(range==='all'?'전체':range+'일')+'</button>').join('')+'</div>'+
      '<p class="fp-period">'+model.start+' ~ '+model.end+' · '+fmt(model.dayCount)+'일'+(model.bucketDays>1?' · 그래프는 '+model.bucketDays+'일 묶음':' · 일별 보기')+'</p>'+
      '<div class="fp-summary"><article><span>최근 측정 체중</span><strong>'+numeric(latest?.weight??null,'kg')+'</strong><small>'+(latest?latest.date+' 측정'+(latest.date<model.start?' · 선택 기간 이전':''):'실제 측정 기록 없음')+' · '+goalNote+'</small></article>'+
      '<article><span>선택 기간 체중 변화</span><strong>'+(change===null?'—':signed(change)+' kg')+'</strong><small>'+(change===null?'변화 비교에는 서로 다른 날짜의 측정이 2회 필요합니다.':s.firstWeight.date+' → '+s.lastWeight.date+' · '+s.weightDays+'일 측정')+'</small></article>'+
      '<article><span>확인된 섭취량 평균</span><strong>'+numeric(s.averageKcal,'kcal')+'</strong><small>열량 수치가 있는 '+s.knownCalorieDays+'일 기준'+(s.partialCalorieDays?' · 미확인 항목이 있는 날 '+s.partialCalorieDays+'일':'')+'</small></article>'+
      '<article><span>현재 칼로리 목표</span><strong>'+numeric(model.targets.kcal,'kcal')+'</strong><small>'+(s.calorieGoalPercent===null?'목표 설정의 탄수화물·단백질·지방 기준':'기록일 평균은 현재 목표의 '+fmt(s.calorieGoalPercent)+'%')+'</small></article></div>'+
      '<div class="fp-notice"><b>식사 기록은 하루 전체 섭취량과 다를 수 있습니다.</b> 입력하지 않은 식사와 미확인 열량은 추정하지 않습니다. 미기록일은 0으로 채우지 않으며, 평균은 열량 수치가 있는 날만 나눕니다.</div>'+
      (model.bucketDays>1?'<p class="fp-aggregation">긴 기간은 모든 날짜를 빠짐없이 '+model.bucketDays+'일 구간으로 나눴습니다. 각 점·막대는 해당 구간의 <b>기록한 날 평균</b>입니다. 구간에 기록이 없으면 비워 둡니다. 원래 일별 수치는 아래 표에서 확인할 수 있습니다.</p>':'')+
      metricCard(model,'weight',width,selected.weight)+metricCard(model,'kcal',width,selected.kcal)+
      '<details class="fp-table-details" '+(options.tableOpen?'open':'')+'><summary>일별 수치로 보기 · '+model.daily.length+'일 기록</summary>'+tableMarkup(model,options.page||0)+'</details>'+
      '<p class="fp-method">체험용 샘플·미완료·미래 날짜는 제외합니다. 목표선은 현재 목표 설정을 전체 기간에 표시하며 과거 목표 변경 이력을 뜻하지 않습니다. 목표 칼로리는 단백질 × 4 + 탄수화물 × 4 + 지방 × 9로 계산합니다.</p></section>';
  }
  function mount(root,document){
    const host=document.getElementById('fd-progress-root'),core=root.FormdayCore,nutrition=root.FormdayNutrition,bridge=root.FormdayBridge;
    if(!host||!D||!core||!nutrition||!bridge)return null;
    let range='30',model=null,selected={weight:null,kcal:null},page=0,resizeTimer=null;
    const visible=()=>document.body.dataset.fdScreen==='progress';
    const today=()=>core.iso(new (root.Date||Date)());
    function defaultIndex(metric){
      const known=model.buckets.filter(bin=>bin[metric]!==null);
      return known.at(-1)?.index??model.buckets.slice().reverse().find(bin=>metric==='kcal'&&bin.mealCount>0)?.index??model.buckets.length-1;
    }
    function render(){
      const active=document.activeElement,focus=active&&host.contains(active)?
        active.getAttribute('data-progress-range')!==null?['data-progress-range',active.getAttribute('data-progress-range')]:
        active.getAttribute('data-progress-point')!==null?['data-progress-point',active.getAttribute('data-progress-point')]:
        active.getAttribute('data-progress-page')!==null?['data-progress-page',active.getAttribute('data-progress-page')]:null:null;
      const tableOpen=!!host.querySelector('details')?.open;
      try{
        const previous=model;
        model=D.build(core,nutrition,bridge.getState(),{range,today:today()});
        for(const metric of ['weight','kcal']){
          if(!previous||previous.start!==model.start||previous.end!==model.end||
            !model.buckets[selected[metric]]||model.buckets[selected[metric]][metric]===null)selected[metric]=defaultIndex(metric);
        }
        page=Math.min(page,Math.max(0,Math.ceil(model.daily.length/PAGE_SIZE)-1));
        host.innerHTML=pageMarkup(model,{width:Math.max(280,(host.clientWidth||720)-40),selected,page,tableOpen});
        if(focus)host.querySelector('['+focus[0]+'="'+focus[1]+'"]')?.focus({preventScroll:true});
      }catch(error){
        host.innerHTML='<section class="fp-card fp-error" role="alert"><h2>그래프를 불러오지 못했습니다.</h2><p>'+esc(error.message||'기록 형식을 확인해 주세요.')+'</p><p>기존 기록은 변경하지 않았습니다.</p></section>';
      }
    }
    function select(metric,index,moveFocus=false){
      if(!model||!['weight','kcal'].includes(metric)||!model.buckets[index])return;
      selected[metric]=index;
      host.querySelectorAll('[data-progress-metric="'+metric+'"][data-progress-point]').forEach(point=>{
        const active=Number(point.dataset.progressIndex)===index;
        point.classList.toggle('is-selected',active);point.setAttribute('aria-pressed',String(active));point.setAttribute('tabindex',active?'0':'-1');
      });
      const detail=host.querySelector('#fp-'+metric+'-detail');if(detail)detail.innerHTML=detailMarkup(model,metric,index);
      if(moveFocus)host.querySelector('[data-progress-point="'+metric+'-'+index+'"]')?.focus({preventScroll:true});
    }
    function step(metric,direction,edge){
      if(!model)return;
      const indices=model.buckets.filter(bin=>bin[metric]!==null).map(bin=>bin.index);if(!indices.length)return;
      const current=Math.max(0,indices.indexOf(selected[metric]));
      const next=edge==='first'?0:edge==='last'?indices.length-1:Math.max(0,Math.min(indices.length-1,current+direction));
      select(metric,indices[next],true);
    }
    host.addEventListener('click',event=>{
      const button=event.target.closest('[data-progress-range]');
      if(button){range=button.dataset.progressRange;page=0;render();return;}
      const point=event.target.closest('[data-progress-point]');
      if(point){select(point.dataset.progressMetric,Number(point.dataset.progressIndex));return;}
      const move=event.target.closest('[data-progress-step]');
      if(move){step(move.dataset.progressMetric,Number(move.dataset.progressStep));return;}
      const pager=event.target.closest('[data-progress-page]');
      if(pager&&!pager.disabled){page+=Number(pager.dataset.progressPage);render();}
    });
    host.addEventListener('keydown',event=>{
      const point=event.target.closest('[data-progress-point]');if(!point)return;
      if(event.key==='Enter'||event.key===' '){event.preventDefault();select(point.dataset.progressMetric,Number(point.dataset.progressIndex));}
      else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        event.preventDefault();step(point.dataset.progressMetric,event.key==='ArrowLeft'?-1:1,event.key==='Home'?'first':event.key==='End'?'last':null);
      }
    });
    const refresh=()=>{if(visible())render();};
    root.addEventListener('formday:changed',refresh);
    root.addEventListener('formday:iron-changed',refresh);
    root.addEventListener('focus',()=>{if(visible()&&model?.end!==today())render();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible()&&model?.end!==today())render();});
    root.addEventListener('resize',()=>{if(!visible())return;root.clearTimeout(resizeTimer);resizeTimer=root.setTimeout(render,150);});
    const api=Object.freeze({render,getSummary:(chosenRange='30')=>D.build(core,nutrition,bridge.getState(),{range:chosenRange,today:today()}).summary});
    root.FormdayProgress=api;
    if(visible())render();
    return api;
  }
  return Object.freeze({geometry,pointLabel,chartMarkup,detailMarkup,tableMarkup,pageMarkup,mount});
});
