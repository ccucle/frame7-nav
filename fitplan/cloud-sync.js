/* FORMDAY v0.6.0 — opt-in, owner-only Firestore sync.
 * Calendar and IRON stored independently. No automatic first-device overwrite.
 * Conflict stops sync; local save is always preserved.
 */
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  getFirestore,doc,onSnapshot,runTransaction,getDocFromServer,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const config={
  apiKey:'AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E',
  authDomain:'healthy-df79f.firebaseapp.com',projectId:'healthy-df79f',
  appId:'1:188014722362:web:8478b91792c6e0890ae403',
  messagingSenderId:'188014722362'
};
const P=window.FormdaySyncPolicy,C=window.FormdayCore,I=window.FormdayIronStore;
const btn=document.getElementById('fd-sync-open'),dialog=document.getElementById('fd-sync-dialog');
const panel=document.getElementById('fd-sync-panel'),closeBtn=document.getElementById('fd-sync-close');
const keys={calendar:C?.STORE,iron:I?.KEY};
const labels={calendar:'캘린더 · 식단 · 체중 · 이전 웨이트',iron:'IRON MODE · 루틴 · 운동 세션'};
const PREFIX='formday_cloud_sync_v1:';
const entry=kind=>slots[kind],slots={
  calendar:{unsubscribe:null,remote:null,ready:false,working:false,issues:'',status:'로그인 필요',timer:null},
  iron:{unsubscribe:null,remote:null,ready:false,working:false,issues:'',status:'로그인 필요',timer:null}
};
let auth=null,db=null,account=null,accountGeneration=0;
let stopped=false;
const reviews={calendar:null,iron:null};
const safe=t=>String(t??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[x]));
function show(message,problem=false){
  const n=document.getElementById('fd-sync-status');
  if(n){n.textContent=message;n.dataset.error=problem?'true':'false';}
}
function metadataKey(kind,uid=account.uid){return PREFIX+uid+':'+kind;}
function accountContext(){return {uid:account?.uid||null,generation:accountGeneration};}
function isCurrent(context){return context.generation===accountGeneration&&context.uid===(account?.uid||null);}
function requireCurrent(context){
  if(!context.uid||!isCurrent(context))throw Error('계정 연결이 변경되어 이전 동기화 작업을 중단했습니다.');
}
function ownerKey(kind){return PREFIX+'owner:'+kind;}
function ownerConflict(kind){
 const prev=localStorage.getItem(ownerKey(kind));
 return !!(prev&&account&&prev!==account.uid&&local(kind).hasStored);
}
function readMeta(kind){
  try{
    if(!account)return null;
    const raw=localStorage.getItem(metadataKey(kind));
    if(!raw)return null;
    const m=JSON.parse(raw);
    return m && m.version===1 && typeof m.remoteRevision==='string' &&
      typeof m.localRevision==='string'?m:null;
  }catch(e){throw Error('동기화 연결 기록을 읽을 수 없습니다. 저장 공간 상태를 확인해 주세요.');}
}
function saveMeta(kind,remoteRevision,localRevision,context,base=null){
  requireCurrent(context);
  const obj={version:1,remoteRevision,localRevision,updatedAt:new Date().toISOString()};
  const key=metadataKey(kind,context.uid);
  localStorage.setItem(key,JSON.stringify(obj));
  localStorage.setItem(ownerKey(kind),context.uid);
  if(localStorage.getItem(key)!==JSON.stringify(obj)||localStorage.getItem(ownerKey(kind))!==context.uid)
    throw Error('동기화 상태를 기기에 저장하지 못했습니다.');
  // Optional common ancestor, stored in the current browser only. If quota
  // prevents this, synchronization still works; never trust a stale base.
  if(base)try{
    localStorage.setItem(key+':base',JSON.stringify({remoteRevision,localRevision,data:base}));
  }catch(e){}
}
function local(kind){
  const store=kind==='calendar'?C.makeStore(localStorage):I.createStore(localStorage);
  const result=store.load();
  if(result.error)throw Error(kind+'의 기존 기록을 읽을 수 없어 동기화를 막았습니다. '+result.error);
  const raw=localStorage.getItem(keys[kind]);
  const data=result.data;
  return {store,raw,data,hasData:P.isUserData(kind,data,raw!==null),
    hasStored:raw!==null,revision:data?.revision||''};
}
function readRemote(snapshot){
  if(!snapshot.exists())return null;
  const cloud=P.docValid(snapshot.data());
  return cloud;
}
function writable(){
  return !!account&&!!db&&!stopped;
}
function syncError(e){
  if(e?.code==='permission-denied')return '권한 거부: Firestore 보안 규칙에 사용자별 동기화 경로를 허용해야 합니다. 현재는 서버에 어떤 데이터도 전송하지 않았습니다.';
  if(e?.code==='unavailable')return 'Firebase 서버가 현재 연결되지 않았습니다. 이 기기의 기록은 유지됩니다.';
  if(e?.message)return e.message;
  return '클라우드 연결 오류입니다. 기기의 기록은 유지됩니다.';
}
function setIssue(kind,e){
  slots[kind].issues=syncError(e);
  slots[kind].status='오류 · 로컬 기록 보호';
  render();
}
function cloudState(kind){
  const s=entry(kind);
  if(!account)return '로그인 필요';
  if(s.issues)return '오류';
  if(!s.ready)return '서버 확인 중';
  try{
    if(ownerConflict(kind))return 'account-mismatch';
    const l=local(kind),meta=readMeta(kind);
    const action=P.decide({meta,local:l.hasStored,localRevision:l.revision,
      remote:!!s.remote,remoteRevision:s.remote?.revision||''});
    if((action==='review'||action==='conflict')&&s.remote&&l.hasStored&&P.equivalent(kind,l.data,JSON.parse(s.remote.payload),C,I))return 'identical';
    return action;
  }catch(e){s.issues=e.message;return '오류';}
}
const names={
 'empty':'저장할 실제 기록 없음','first-upload':'최초 업로드 필요',
 'download':'기기에 클라우드 기록 적용 가능','review':'기기와 클라우드 기록이 모두 존재함',
 'push':'변경사항 서버 전송 대기','synced':'동기화 완료',
 'conflict':'양쪽 기록이 달라 자동 동기화 중단',
 'identical':'동일한 기록 · 연결 복구 가능',
 'server-missing':'서버 원본이 사라져 확인 필요',
 'account-mismatch':'다른 Google 계정의 로컬 기록이 남아 있음'
};
function actionLabel(value){
  return names[value]||value;
}
const groupNames={routines:'루틴',programs:'프로그램',sessions:'운동 기록',favoriteExercises:'즐겨찾기',events:'캘린더 일정',customFoods:'등록 식품',favoriteFoodIds:'즐겨찾기 식품',settings:'목표 설정'};
function commonBase(kind,l,meta){
 if(!meta)return null;
 try{
  const saved=JSON.parse(localStorage.getItem(metadataKey(kind)+':base')||'null');
  if(saved&&saved.remoteRevision===meta.remoteRevision&&saved.localRevision===meta.localRevision)
   return kind==='calendar'?C.normalizeState(saved.data):I.normalize(saved.data);
 }catch(e){}
 // Old installations may have the exact last paired local version in their
 // existing previous backup. Only use it if its revision matches the pair.
 try{
  const raw=localStorage.getItem(l.store.backupKey);
  if(raw){
   const v=kind==='calendar'?C.normalizeState(JSON.parse(raw)):I.normalize(JSON.parse(raw));
   if(v.revision&&v.revision===meta.localRevision)return v;
  }
 }catch(e){}
 return null;
}
function mergeSummary(kind,value){
 if(!value)return '기록 없음';
 if(kind==='iron')return '루틴 '+value.routines.length+'개 · 프로그램 '+value.programs.length+'개 · 운동 '+value.sessions.length+'개';
 return '일정 '+value.events.length+'개 · 등록 식품 '+value.customFoods.length+'개';
}
function conflictText(value){
 if(value===null)return '이 쪽에 없음';
 if(typeof value!=='object')return String(value);
 const lines=[];
 if(value.name||value.title||value.label)lines.push(value.name||value.title||value.label);
 if(value.date)lines.push(value.date+(value.start?' '+value.start+'–'+value.end:''));
 if(value.status)lines.push(({ACTIVE:'진행 중',PAUSED:'일시정지',SAVED:'임시 보관',COMPLETED:'완료',PARTIAL:'부분 완료'})[value.status]||value.status);
 if(value.mode)lines.push(value.mode==='fixed'?'요일 고정형':'순환형');
 if(value.routineIds)lines.push('루틴 '+value.routineIds.length+'개');
 const exercises=value.exercises||value.detail?.exercises;
 if(exercises)lines.push(...exercises.map(e=>e.name+' · '+e.sets.map(s=>s.weight+'kg×'+s.reps+'회'+(s.done?' ✓':'')).join(' / ')));
 if(value.detail?.weight!=null)lines.push(value.detail.weight+'kg');
 if(value.detail?.food)lines.push(value.detail.food);
 return lines.join('\n')||'상세 비교에서 확인';
}
function reviewView(kind){
 const review=reviews[kind];if(!review)return '';
 const result=review.result;
 return '<div class="fd-merge-review"><h3>병합 미리보기</h3><p class="fd-sync-meta">이 기기: '+safe(mergeSummary(kind,review.local))+'<br>클라우드: '+safe(mergeSummary(kind,review.remote))+'</p>'+
  '<p class="fd-sync-note">'+(review.base?'마지막 공통 기록을 기준으로 변경 사항을 비교했습니다.':'공통 기록을 확인할 수 없어 양쪽의 고유 기록을 보존합니다. 한쪽에서 삭제했던 항목도 포함될 수 있으니 확인해 주세요.')+'</p>'+
  '<p class="fd-sync-meta">동일 '+result.stats.same+'개 · 기기만 '+result.stats.localOnly+'개 · 서버만 '+result.stats.remoteOnly+'개 · 공통 기준 처리 '+result.stats.baseResolved+'개</p>'+
  result.conflicts.map((c,i)=>'<div class="fd-merge-conflict"><strong>'+safe(groupNames[c.group]||c.group)+' · '+safe(c.label)+'</strong>'+
   '<p>양쪽에서 같은 항목의 내용이 다릅니다. 유지할 쪽을 선택하세요.</p>'+
   ['local','remote'].map(side=>'<label class="fd-merge-choice"><input type="radio" name="fd-merge-'+kind+'-'+i+'" data-sync-merge-choice="'+safe(c.key)+'" data-kind="'+kind+'" value="'+side+'" '+(review.choices[c.key]===side?'checked':'')+'><span><b>'+(side==='local'?'이 기기':'클라우드')+'</b><small>'+safe(conflictText(c[side]))+'</small></span></label>').join('')+
   '<details><summary>원본 내용 비교</summary><pre>'+safe(JSON.stringify({기기:c.local,클라우드:c.remote},null,2))+'</pre></details></div>').join('')+
  (result.error?'<p class="fd-sync-error">'+safe(result.error)+' · 먼저 충돌 항목 또는 미완료 운동을 정리해 주세요.</p>':'')+
  (result.next?'<p class="fd-sync-note">병합 결과: '+safe(mergeSummary(kind,result.next))+'</p>':'')+
  '<button type="button" data-sync-action="merge-apply" data-kind="'+kind+'" '+(!result.next||entry(kind).working?'disabled':'')+'>기록 합치고 동기화 재개</button>'+
  '<button type="button" class="fd-sync-secondary" data-sync-action="merge-cancel" data-kind="'+kind+'">취소</button></div>';
}
function slotView(kind){
 const s=entry(kind),action=cloudState(kind);
 let meta=null;
 try{meta=account?readMeta(kind):null;}catch(e){s.issues=e.message;}
 const localState=(()=>{try{const l=local(kind);return (l.hasData?'이 기기 기록 있음':'실제 기록 없음')+(l.data?.events?' · 일정 '+l.data.events.length+'개':'')+(l.data?.sessions?' · 운동 '+l.data.sessions.length+'개':'');}catch(e){return '기록 상태 확인 실패';}})();
 const hasRemote=s.ready&&!!s.remote;
 return '<section class="fd-sync-section"><div class="fd-sync-header"><strong>'+safe(labels[kind])+'</strong>'+
 '<span class="fd-sync-state" data-state="'+safe(action)+'">'+safe(actionLabel(action))+'</span></div>'+
 '<p class="fd-sync-meta">'+safe(localState)+' · '+(hasRemote?'서버 기록 있음':'서버 기록 없음 또는 미확인')+'</p>'+
 (s.issues?'<p class="fd-sync-error">'+safe(s.issues)+'</p>':'')+
 (action==='account-mismatch'?'<p class="fd-sync-error">이 브라우저에 다른 Google 계정으로 연결했던 기록이 있습니다. 계정이 다른 상태에서 동기화를 진행하지 않습니다. 기존 계정으로 다시 로그인하거나 백업 후 별도 이전 절차를 진행하세요.</p>':'')+
 (action==='first-upload'?'<p class="fd-sync-note">이 기기의 실제 기록을 처음 올릴 수 있습니다. 기존 JSON 백업을 먼저 보관하세요.</p>'+
  '<button type="button" data-sync-action="seed" data-kind="'+kind+'">이 기기 기록 최초 업로드</button>':'')+
 (action==='review'||action==='conflict'||action==='identical'?'<p class="fd-sync-warning">이 기기와 클라우드 기록을 비교하고 안전하게 합칠 수 있습니다. 원본을 보관하며, 서로 다른 같은 항목은 직접 선택합니다.</p>'+
  '<button type="button" data-sync-action="merge-review" data-kind="'+kind+'" '+(s.working?'disabled':'')+'>양쪽 기록 비교 및 복구</button>'+
  reviewView(kind)+
  '<details class="fd-sync-replace"><summary>기존 방식으로 한쪽 기록만 사용</summary><p class="fd-sync-note">병합을 권장합니다. 이 방법은 이 기기의 현재 기록을 서버 기록으로 교체합니다.</p>'+
  '<button type="button" class="fd-sync-secondary" data-sync-action="take" data-kind="'+kind+'">클라우드 기록으로 변경 (로컬 백업 후)</button></details>':'')+
 (action==='download'?'<button type="button" data-sync-action="receive" data-kind="'+kind+'">클라우드 기록 불러오기</button>':'')+
 (action==='push'?'<button type="button" data-sync-action="send" data-kind="'+kind+'">변경사항 지금 전송</button>':'')+
 (s.working?'<p class="fd-sync-note">기록 확인 또는 동기화 처리 중입니다.</p>':'')+
 '<div class="fd-sync-small-actions"><button type="button" class="fd-sync-secondary" data-sync-action="backup" data-kind="'+kind+'">이 기기 JSON 백업</button>'+
 '<button type="button" class="fd-sync-secondary" data-sync-action="refresh" data-kind="'+kind+'">다시 확인</button></div>'+
 (account&&localStorage.getItem(keys[kind]+'_merge_backup_'+account.uid)?'<button type="button" class="fd-sync-secondary" data-sync-action="merge-backup" data-kind="'+kind+'">병합 전 양쪽 복구 사본 받기</button>':'')+
 (meta?'<p class="fd-sync-note">마지막 동기화 연결: '+safe(new Date(meta.updatedAt).toLocaleString('ko-KR'))+'</p>':'')+'</section>';
}
function render(){
 if(!panel)return;
 panel.innerHTML='<p class="fd-sync-identity">'+(account?'Google 계정: <b>'+safe(account.email||'로그인됨')+'</b>':'Google 계정으로 로그인해야 동기화할 수 있습니다.')+'</p>'+
 '<p class="fd-sync-note">연결 후 온라인에서 변경 사항을 자동 동기화합니다. 충돌이 발생하면 양쪽 기록 비교 및 복구를 이용하세요. 원본을 자동으로 덮어쓰지 않습니다.</p>'+
 (P&&C&&I?P.slots.map(slotView).join(''):'<p class="fd-sync-error">동기화 저장소 파일을 불러오지 못했습니다.</p>');
}
function readyToApply(kind){
 if(kind==='calendar')return window.FormdayBridge?.canCloudApply?.()===true;
 return window.FormdayIndependent?.canCloudApply?.()===true;
}
function verifyRemote(kind,remote){
 const source=JSON.parse(remote.payload),validated=kind==='calendar'?C.normalizeState(source):I.normalize(source);
 if(validated.revision!==remote.revision)throw Error('서버 기록과 버전이 일치하지 않습니다. 원본을 유지했습니다.');
 return validated;
}
function exactLocal(kind,review){
 const l=local(kind);
 if(l.raw!==review.localRaw||l.revision!==review.localRevision)throw Error('비교 중 이 기기의 기록이 변경되었습니다. 다시 비교해 주세요.');
 return l;
}
function backupBoth(kind,context,review){
 // One durable pair per slot, containing the original snapshots (not the merged result).
 // Do not proceed if both originals cannot be stored and read back.
 const key=keys[kind]+'_merge_backup_'+context.uid;
 const raw=JSON.stringify({version:1,local:review.local,remote:review.remote,localRevision:review.localRevision,remoteRevision:review.remoteRevision,savedAt:new Date().toISOString()});
 localStorage.setItem(key,raw);
 if(localStorage.getItem(key)!==raw)throw Error('병합 전 양쪽 원본을 보관하지 못했습니다.');
}
function recalc(kind){
 const review=reviews[kind];if(!review)return;
 review.result=P.mergeRecords(kind,review.local,review.remote,review.base,review.choices,C,I);
}
async function prepareMerge(kind){
 const s=entry(kind);
 if(!writable()||s.working||ownerConflict(kind))return;
 const context=accountContext();s.working=true;reviews[kind]=null;
 try{
  const l=local(kind),meta=readMeta(kind);
  if(!l.hasStored||!l.data)throw Error('이 기기의 기록이 없습니다. 클라우드 기록 불러오기를 사용해 주세요.');
  const result=await getDocFromServer(doc(db,'users',context.uid,'formday_sync',kind));
  requireCurrent(context);
  if(!result.exists())throw Error('서버 기록이 없습니다.');
  const remote=readRemote(result),validated=verifyRemote(kind,remote);
  if(local(kind).raw!==l.raw)throw Error('비교 중 기기 기록이 바뀌었습니다. 다시 시도해 주세요.');
  s.remote=remote;s.ready=true;s.issues='';
  reviews[kind]={context,local:l.data,remote:validated,localRaw:l.raw,localRevision:l.revision,remoteRevision:remote.revision,remotePayload:remote.payload,
    base:commonBase(kind,l,meta),choices:{},result:null};
  recalc(kind);
  show('양쪽 원본을 비교했습니다. 병합 미리보기에서 확인해 주세요.');
 }catch(e){if(isCurrent(context)){reviews[kind]=null;show(syncError(e),true);}}
 finally{if(isCurrent(context)){s.working=false;render();}}
}
async function applyMerge(kind){
 const s=entry(kind),review=reviews[kind];
 if(!review||!review.result?.next||!writable()||s.working)return;
 const context=review.context;s.working=true;let committed=false;
 try{
  requireCurrent(context);
  if(ownerConflict(kind))throw Error('계정이 변경되었습니다.');
  const l=exactLocal(kind,review);
  const identical=P.equivalent(kind,review.local,review.remote,C,I);
  // An identical pair can be repaired without changing either store. All
  // data-changing merges require the existing editor/session safety guards.
  if(!identical&&!readyToApply(kind))throw Error('진행 중인 운동이나 편집을 완료한 후 다시 시도해 주세요. 기존 기록은 유지됩니다.');
  if(!identical&&kind==='iron'&&review.result.next.sessions.some(x=>x.status==='ACTIVE'))
   throw Error('다른 기기의 진행 중인 운동을 종료한 후 다시 시도해 주세요.');
  if(!identical&&!window.confirm('병합 미리보기대로 기록을 합치고 이 Google 계정에 동기화할까요? 양쪽 원본은 이 기기에 복구 사본으로 보관합니다.'))return;
  requireCurrent(context);exactLocal(kind,review);
  if(!identical)backupBoth(kind,context,review);
  const ref=doc(db,'users',context.uid,'formday_sync',kind);
  const data=review.result.next;
  const payload=identical?null:P.safePayload(kind,{...data,revision:kind==='calendar'?C.uid():I.uid()},C,I);
  await runTransaction(db,async transaction=>{
   requireCurrent(context);exactLocal(kind,review);
   const remoteSnap=await transaction.get(ref);requireCurrent(context);exactLocal(kind,review);
   if(!remoteSnap.exists())throw Error('서버 기록이 변경되었습니다. 다시 비교해 주세요.');
   const remote=readRemote(remoteSnap);
   if(remote.revision!==review.remoteRevision||remote.payload!==review.remotePayload)throw Error('비교 후 서버 기록이 변경되었습니다. 다시 비교해 주세요.');
   if(!identical){
    if(!readyToApply(kind))throw Error('운동이나 편집이 시작되어 병합을 중단했습니다.');
    transaction.set(ref,{...payload,updatedAt:serverTimestamp()});
   }
  });
  committed=!identical;requireCurrent(context);
  const before=exactLocal(kind,review);
  if(!identical&&!readyToApply(kind))throw Error('서버 병합은 완료되었지만 기기에서 편집이 시작됐습니다. 기기 원본은 유지됩니다.');
  const saved=identical?before.data:before.store.save(data,before.revision);
  saveMeta(kind,identical?review.remoteRevision:payload.revision,saved.revision,context,saved);
  s.remote=identical?{format:1,revision:review.remoteRevision,payload:review.remotePayload}:payload;
  s.issues='';reviews[kind]=null;
  if(!identical){if(kind==='calendar')window.FormdayBridge?.cloudReload?.();else window.FormdayIndependent?.cloudReload?.();}
  show(labels[kind]+' · 기록 비교 및 동기화 복구 완료');
 }catch(e){if(isCurrent(context)){reviews[kind]=null;show((committed?'서버 병합 후 기기 반영을 완료하지 못했습니다. 기기 원본과 양쪽 복구 사본은 보존됩니다. 다시 비교해 주세요. ':'')+syncError(e),true);}}
 finally{if(isCurrent(context)){s.working=false;render();}}
}
function chooseMerge(kind,key,side){
 const review=reviews[kind];if(!review||!['local','remote'].includes(side)||!review.result.conflicts.some(c=>c.key===key))return;
 review.choices[key]=side;recalc(kind);render();
}
function exportMergeBackup(kind){
 try{
  if(!account||ownerConflict(kind))throw Error('현재 계정의 복구 사본을 확인해 주세요.');
  const raw=localStorage.getItem(keys[kind]+'_merge_backup_'+account.uid);
  if(!raw)throw Error('이 기기에 보관된 병합 복구 사본이 없습니다.');
  const data=JSON.parse(raw);
  // Export both copies in their existing import formats.
  for(const side of ['local','remote']){
   const content=JSON.stringify(P.backupPayload(kind,data[side],C,I),null,2);
   const file=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(file),a=document.createElement('a');
   a.href=url;a.download='FORMDAY-'+kind+'-before-merge-'+side+'.json';document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  show('양쪽 복구 사본 다운로드를 요청했습니다. 파일 앱에서 확인해 주세요.');
 }catch(e){show(syncError(e),true);}
}
async function download(kind,interactive=false){
 const s=entry(kind);
 if(!writable()||s.working)return;
 if(ownerConflict(kind)){show('기존 로컬 기록은 다른 Google 계정에 연결돼 있습니다. 원래 계정으로 로그인하거나 백업 후 계정을 분리해야 합니다.',true);return;}
 if(!readyToApply(kind)){show('현재 운동이나 입력창을 편집 중입니다. 먼저 기록을 저장·종료하고 다시 시도해 주세요.',true);return;}
 const context=accountContext();
 s.working=true;
 try{
  const ref=doc(db,'users',context.uid,'formday_sync',kind);
  const result=await getDocFromServer(ref);
  requireCurrent(context);
  if(!result.exists())throw Error('서버에 불러올 기록이 없습니다.');
  const remote=readRemote(result),obj=JSON.parse(remote.payload);
  const validated=kind==='calendar'?C.normalizeState(obj):I.normalize(obj);
  if(kind==='iron'&&validated.sessions.some(x=>x.status==='ACTIVE')){
    show('다른 기기에서 운동이 진행 중입니다. 그 기기에서 일시정지·임시 보관 또는 완료한 후 이 기기에서 이어서 확인해 주세요. 실행 중 세션을 중복으로 열지 않았습니다.');
    return;
  }
  const l=local(kind),meta=readMeta(kind);
  const action=P.decide({meta,local:l.hasStored,localRevision:l.revision,remote:true,remoteRevision:remote.revision});
  if(action!=='download'&&!(interactive&&(action==='review'||action==='conflict')))
    throw Error('기기나 서버의 기록이 바뀌었습니다. 다시 확인해 주세요.');
  if(!interactive&&l.hasStored&&!meta)throw Error('이 기기에 저장된 기록이 있어 자동으로 교체하지 않았습니다.');
  if(interactive&&l.hasStored){
    if(!window.confirm('이 기기의 현재 기록이 클라우드 기록으로 교체됩니다. 기존 기록은 기기에 별도 복구 사본을 만든 후 진행합니다. JSON 파일도 백업했는지 확인해 주세요. 계속할까요?'))return;
  }
  requireCurrent(context);
  if(!readyToApply(kind))throw Error('클라우드 자료를 확인하는 동안 운동이나 입력 편집이 시작됐습니다. 기록을 보존하기 위해 적용을 중단했습니다.');
  const before=local(kind);
  if(before.revision!==l.revision)throw Error('기기 기록이 전송 중 변경되어 불러오기를 중단했습니다.');
  // Preserve old bytes independently from store_previous backup; abort if quota is full.
  if(before.raw!==null&&(interactive||!meta)){
    // Preserve first pre-import copy once. No unbounded backup keys on every sync.
    const backupKey=keys[kind]+'_cloud_preexisting_'+context.uid;
    if(localStorage.getItem(backupKey)===null){
      localStorage.setItem(backupKey,before.raw);
      if(localStorage.getItem(backupKey)!==before.raw)throw Error('복구 사본을 보관하지 못했습니다.');
    }
  }
  const saved=before.store.save(validated,before.revision);
  saveMeta(kind,remote.revision,saved.revision,context,saved);
  s.remote=remote;
  s.issues='';
  if(kind==='calendar')window.FormdayBridge?.cloudReload?.();
  else window.FormdayIndependent?.cloudReload?.();
  show(labels[kind]+' 데이터를 이 기기로 불러왔습니다. 현재 화면도 최신 기록으로 갱신했습니다.');
 }catch(e){if(isCurrent(context)){setIssue(kind,e);show(syncError(e),true);}}
 finally{if(isCurrent(context)){s.working=false;render();}}
}
async function upload(kind,first=false){
 const s=entry(kind);
 if(!writable()||s.working||!s.ready)return;
 if(ownerConflict(kind)){show('이 기기의 기록은 다른 Google 계정 소유로 표시돼 자동 전송하지 않았습니다.',true);return;}
 const context=accountContext();
 s.working=true;
 try{
  const l=local(kind),meta=readMeta(kind);
  if(first&&!l.hasData)throw Error('최초 업로드할 실제 기록이 없습니다.');
  if(!first&&!l.data)throw Error('기기에 업로드할 기록 형식이 없습니다.');
  if(first){
    if(meta||s.remote)throw Error('클라우드에 기록이 있어 최초 업로드할 수 없습니다.');
    if(!window.confirm('이 Google 계정의 클라우드에 '+labels[kind]+' 기록을 최초로 올릴까요? 로컬 JSON 백업을 먼저 저장해 주세요.'))return;
  }else if(!meta){
    throw Error('첫 연결이 완료되지 않아 자동 업로드하지 않았습니다.');
  }
  requireCurrent(context);
  const payload=P.safePayload(kind,l.data,C,I);
  const ref=doc(db,'users',context.uid,'formday_sync',kind);
  await runTransaction(db,async transaction=>{
   // Firestore may retry this callback after an account has changed.
   requireCurrent(context);
   const remote=await transaction.get(ref);
   requireCurrent(context);
   if(first){
     if(remote.exists())throw Error('다른 기기에서 이미 서버 기록을 만들었습니다. 자동으로 덮어쓰지 않습니다.');
   }else{
     if(!remote.exists()||remote.data()?.revision!==meta.remoteRevision)
       throw Error('다른 기기의 기록이 변경되었습니다. 자동 업로드를 중단합니다.');
   }
   transaction.set(ref,{format:1,revision:payload.revision,payload:payload.payload,updatedAt:serverTimestamp()});
  });
  requireCurrent(context);
  const newest=local(kind);
  saveMeta(kind,payload.revision,l.revision,context,l.data);
  s.issues='';s.remote={format:1,revision:payload.revision,payload:payload.payload};
  if(newest.revision!==l.revision)schedule(kind);
  show(labels[kind]+' 기록을 Google 계정의 Firestore에 저장했습니다.');
 }catch(e){if(isCurrent(context)){setIssue(kind,e);show(syncError(e),true);}}
 finally{if(isCurrent(context)){s.working=false;render();}}
}
function schedule(kind){
 const s=entry(kind);
 const context=accountContext();
 if(s.timer!==null)clearTimeout(s.timer);
 s.timer=setTimeout(()=>{if(!isCurrent(context))return;s.timer=null;evaluate(kind);},3500);
}
function evaluate(kind){
 const s=entry(kind);
 if(!writable()||!s.ready||s.issues||s.working)return;
 let action;
 try{action=cloudState(kind);}catch(e){setIssue(kind,e);return;}
 if(action==='push'){upload(kind);return;}
 if(action==='download'&&readyToApply(kind)){download(kind,false);return;}
 render();
}
function onRemote(kind,snapshot){
 const s=entry(kind);
 if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
 try{
  s.remote=readRemote(snapshot);s.ready=true;s.issues='';
  if(!s.working)evaluate(kind);
 }catch(e){setIssue(kind,e);}
 render();
}
function stopSubscriptions(){
 for(const kind of P.slots){
  const s=entry(kind);
  if(s.unsubscribe){s.unsubscribe();s.unsubscribe=null;}
  if(s.timer!==null){clearTimeout(s.timer);s.timer=null;}
  s.ready=false;s.remote=null;s.issues='';s.working=false;reviews[kind]=null;
 }
}
function subscribe(kind){
 const s=entry(kind);
 if(s.unsubscribe){s.unsubscribe();s.unsubscribe=null;}
 s.ready=false;s.remote=null;s.issues='';
 if(!account)return;
 const context=accountContext();
 try{
  const ref=doc(db,'users',context.uid,'formday_sync',kind);
  s.unsubscribe=onSnapshot(ref,{includeMetadataChanges:true},
   snap=>{if(isCurrent(context))onRemote(kind,snap);},
   error=>{if(isCurrent(context))setIssue(kind,error);});
 }catch(e){if(isCurrent(context))setIssue(kind,e);}
}
function login(user){
 accountGeneration++;
 stopSubscriptions();
 account=user||null;
 if(!user){render();show('Google 로그인을 하면 클라우드 연결이 준비됩니다.');return;}
 for(const kind of P.slots)subscribe(kind);
 render();
}
function backup(kind){
 try{
  const l=local(kind);
  if(!l.hasStored)throw Error('다운로드할 저장 기록이 없습니다.');
  const content=JSON.stringify(P.backupPayload(kind,l.data,C,I),null,2);
  const file=new Blob([content],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');
  a.href=url;a.download='FORMDAY-'+kind+'-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  show('백업 다운로드를 요청했습니다. '+(kind==='iron'?'운동 기록의 IRON MODE 백업 가져오기':'캘린더의 기록 가져오기')+'에서 복원할 수 있습니다. 파일 앱에서 저장을 확인해 주세요.');
 }catch(e){show(syncError(e),true);}
}
if(btn&&dialog&&panel&&P&&C&&I){
 btn.addEventListener('click',()=>{
  if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
  render();
 });
 closeBtn?.addEventListener('click',()=>dialog.close());
 panel.addEventListener('click',event=>{
  const b=event.target.closest('[data-sync-action]');
  if(!b)return;
  const kind=b.dataset.kind,action=b.dataset.syncAction;
  if(!P.slots.includes(kind))return;
  if(action==='backup'){backup(kind);return;}
  if(action==='seed'){upload(kind,true);return;}
  if(action==='merge-review'){prepareMerge(kind);return;}
  if(action==='merge-apply'){applyMerge(kind);return;}
  if(action==='merge-cancel'){reviews[kind]=null;render();return;}
  if(action==='merge-backup'){exportMergeBackup(kind);return;}
  if(action==='take'){download(kind,true);return;}
  if(action==='receive'){download(kind,false);return;}
  if(action==='send'){upload(kind,false);return;}
  if(action==='refresh'){reviews[kind]=null;subscribe(kind);render();return;}
 });
 panel.addEventListener('change',event=>{
  const target=event.target;
  if(target?.dataset?.syncMergeChoice&&P.slots.includes(target.dataset.kind))chooseMerge(target.dataset.kind,target.dataset.syncMergeChoice,target.value);
 });
 window.addEventListener('formday:changed',()=>schedule('calendar'));
 window.addEventListener('formday:iron-changed',()=>schedule('iron'));
 window.addEventListener('online',()=>P.slots.forEach(k=>{entry(k).issues='';evaluate(k);}));
 // Foreground polling is a fallback for pagehide/visibilitychange saves that
 // do not dispatch a change event. It does not query Firestore.
 setInterval(()=>{
  if(document.hidden||!account)return;
  for(const kind of P.slots){
   const s=entry(kind);if(!s.ready||s.working||s.issues)continue;
   const a=cloudState(kind);
   if(a==='push'||a==='download')schedule(kind);
  }
 },12000);
 try{
  const app=getApps().find(x=>x.name==='formday-auth')||initializeApp(config,'formday-auth');
  auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,login,e=>{show(syncError(e),true);});
 }catch(e){show(syncError(e),true);}
 render();
}
