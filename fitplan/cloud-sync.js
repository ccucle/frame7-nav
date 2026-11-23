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
let auth=null,db=null,account=null;
let stopped=false;
const safe=t=>String(t??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[x]));
function show(message,problem=false){
  const n=document.getElementById('fd-sync-status');
  if(n){n.textContent=message;n.dataset.error=problem?'true':'false';}
}
function metadataKey(kind){return PREFIX+account.uid+':'+kind;}
function ownerKey(kind){return PREFIX+'owner:'+kind;}
function ownerConflict(kind){
 const prev=localStorage.getItem(ownerKey(kind));
 return !!(prev&&account&&prev!==account.uid&&local(kind).hasData);
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
function saveMeta(kind,remoteRevision,localRevision){
  const obj={version:1,remoteRevision,localRevision,updatedAt:new Date().toISOString()};
  localStorage.setItem(metadataKey(kind),JSON.stringify(obj));
  localStorage.setItem(ownerKey(kind),account.uid);
  if(localStorage.getItem(metadataKey(kind))!==JSON.stringify(obj)||localStorage.getItem(ownerKey(kind))!==account.uid)
    throw Error('동기화 상태를 기기에 저장하지 못했습니다.');
}
function local(kind){
  const store=kind==='calendar'?C.makeStore(localStorage):I.createStore(localStorage);
  const result=store.load();
  if(result.error)throw Error(kind+'의 기존 기록을 읽을 수 없어 동기화를 막았습니다. '+result.error);
  const raw=localStorage.getItem(keys[kind]);
  const data=result.data;
  return {store,raw,data,hasData:P.isUserData(kind,data,raw!==null),
    revision:data?.revision||''};
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
    const l=local(kind);
    return P.decide({meta:readMeta(kind),local:l.hasData,localRevision:l.revision,
      remote:!!s.remote,remoteRevision:s.remote?.revision||''});
  }catch(e){s.issues=e.message;return '오류';}
}
const names={
 'empty':'저장할 실제 기록 없음','first-upload':'최초 업로드 필요',
 'download':'기기에 클라우드 기록 적용 가능','review':'기기와 클라우드 기록이 모두 존재함',
 'push':'변경사항 서버 전송 대기','synced':'동기화 완료',
 'conflict':'양쪽 기록이 달라 자동 동기화 중단',
 'server-missing':'서버 원본이 사라져 확인 필요',
 'account-mismatch':'다른 Google 계정의 로컬 기록이 남아 있음'
};
function actionLabel(value){
  return names[value]||value;
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
 (action==='review'||action==='conflict'?'<p class="fd-sync-warning">양쪽에 다른 기록이 있습니다. 자동으로 합치거나 덮어쓰지 않습니다. 로컬 백업을 다운로드한 후 클라우드 기록을 선택할 수 있습니다.</p>'+
  '<button type="button" class="fd-sync-secondary" data-sync-action="take" data-kind="'+kind+'">클라우드 기록으로 변경 (로컬 백업 후)</button>':'')+
 (action==='download'?'<button type="button" data-sync-action="receive" data-kind="'+kind+'">클라우드 기록 불러오기</button>':'')+
 (action==='push'?'<button type="button" data-sync-action="send" data-kind="'+kind+'">변경사항 지금 전송</button>':'')+
 '<div class="fd-sync-small-actions"><button type="button" class="fd-sync-secondary" data-sync-action="backup" data-kind="'+kind+'">이 기기 JSON 백업</button>'+
 '<button type="button" class="fd-sync-secondary" data-sync-action="refresh" data-kind="'+kind+'">다시 확인</button></div>'+
 (meta?'<p class="fd-sync-note">마지막 동기화 연결: '+safe(meta.updatedAt.replace('T',' ').slice(0,19))+' UTC</p>':'')+'</section>';
}
function render(){
 if(!panel)return;
 panel.innerHTML='<p class="fd-sync-identity">'+(account?'Google 계정: <b>'+safe(account.email||'로그인됨')+'</b>':'Google 계정으로 로그인해야 동기화할 수 있습니다.')+'</p>'+
 '<p class="fd-sync-note">처음 연결할 때만 업로드 방향을 확인합니다. 연결 후에는 온라인에서 변경 사항을 자동 동기화합니다. 서로 다른 기록이 동시에 수정되면 자동 덮어쓰지 않습니다.</p>'+
 (P&&C&&I?P.slots.map(slotView).join(''):'<p class="fd-sync-error">동기화 저장소 파일을 불러오지 못했습니다.</p>');
}
function readyToApply(kind){
 if(kind==='calendar')return window.FormdayBridge?.canCloudApply?.()===true;
 return window.FormdayIndependent?.canCloudApply?.()===true;
}
async function download(kind,interactive=false){
 const s=entry(kind);
 if(!writable()||s.working)return;
 if(ownerConflict(kind)){show('기존 로컬 기록은 다른 Google 계정에 연결돼 있습니다. 원래 계정으로 로그인하거나 백업 후 계정을 분리해야 합니다.',true);return;}
 if(!readyToApply(kind)){show('현재 운동이나 입력창을 편집 중입니다. 먼저 기록을 저장·종료하고 다시 시도해 주세요.',true);return;}
 s.working=true;
 try{
  const ref=doc(db,'users',account.uid,'formday_sync',kind);
  const result=await getDocFromServer(ref);
  if(!result.exists())throw Error('서버에 불러올 기록이 없습니다.');
  const remote=readRemote(result),obj=JSON.parse(remote.payload);
  const validated=kind==='calendar'?C.normalizeState(obj):I.normalize(obj);
  if(kind==='iron'&&validated.sessions.some(x=>x.status==='ACTIVE')){
    show('다른 기기에서 운동이 진행 중입니다. 그 기기에서 일시정지·임시 보관 또는 완료한 후 이 기기에서 이어서 확인해 주세요. 실행 중 세션을 중복으로 열지 않았습니다.');
    return;
  }
  const l=local(kind),meta=readMeta(kind);
  const action=P.decide({meta,local:l.hasData,localRevision:l.revision,remote:true,remoteRevision:remote.revision});
  if(action!=='download'&&!(interactive&&(action==='review'||action==='conflict')))
    throw Error('기기나 서버의 기록이 바뀌었습니다. 다시 확인해 주세요.');
  if(!interactive&&l.hasData&&!meta)throw Error('이 기기에 실제 기록이 있어 자동으로 교체하지 않았습니다.');
  if(interactive&&l.hasData){
    if(!window.confirm('이 기기의 현재 기록이 클라우드 기록으로 교체됩니다. 기존 기록은 기기에 별도 복구 사본을 만든 후 진행합니다. JSON 파일도 백업했는지 확인해 주세요. 계속할까요?'))return;
  }
  if(!readyToApply(kind))throw Error('클라우드 자료를 확인하는 동안 운동이나 입력 편집이 시작됐습니다. 기록을 보존하기 위해 적용을 중단했습니다.');
  const before=local(kind);
  if(before.revision!==l.revision)throw Error('기기 기록이 전송 중 변경되어 불러오기를 중단했습니다.');
  // Preserve old bytes independently from store_previous backup; abort if quota is full.
  if(before.raw!==null&&(interactive||!meta)){
    // Preserve first pre-import copy once. No unbounded backup keys on every sync.
    const backupKey=keys[kind]+'_cloud_preexisting_'+account.uid;
    if(localStorage.getItem(backupKey)===null){
      localStorage.setItem(backupKey,before.raw);
      if(localStorage.getItem(backupKey)!==before.raw)throw Error('복구 사본을 보관하지 못했습니다.');
    }
  }
  const saved=before.store.save(validated,before.revision);
  saveMeta(kind,remote.revision,saved.revision);
  s.remote=remote;
  s.issues='';
  if(kind==='calendar')window.FormdayBridge?.cloudReload?.();
  else window.FormdayIndependent?.cloudReload?.();
  show(labels[kind]+' 데이터를 이 기기로 불러왔습니다. 현재 화면도 최신 기록으로 갱신했습니다.');
 }catch(e){setIssue(kind,e);show(syncError(e),true);}
 finally{s.working=false;render();}
}
async function upload(kind,first=false){
 const s=entry(kind);
 if(!writable()||s.working||!s.ready)return;
 if(ownerConflict(kind)){show('이 기기의 기록은 다른 Google 계정 소유로 표시돼 자동 전송하지 않았습니다.',true);return;}
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
  const payload=P.safePayload(kind,l.data,C,I);
  const ref=doc(db,'users',account.uid,'formday_sync',kind);
  await runTransaction(db,async transaction=>{
   const remote=await transaction.get(ref);
   if(first){
     if(remote.exists())throw Error('다른 기기에서 이미 서버 기록을 만들었습니다. 자동으로 덮어쓰지 않습니다.');
   }else{
     if(!remote.exists()||remote.data()?.revision!==meta.remoteRevision)
       throw Error('다른 기기의 기록이 변경되었습니다. 자동 업로드를 중단합니다.');
   }
   transaction.set(ref,{format:1,revision:payload.revision,payload:payload.payload,updatedAt:serverTimestamp()});
  });
  const newest=local(kind);
  saveMeta(kind,payload.revision,l.revision);
  s.issues='';s.remote={format:1,revision:payload.revision,payload:payload.payload};
  if(newest.revision!==l.revision)schedule(kind);
  show(labels[kind]+' 기록을 Google 계정의 Firestore에 저장했습니다.');
 }catch(e){setIssue(kind,e);show(syncError(e),true);}
 finally{s.working=false;render();}
}
function schedule(kind){
 const s=entry(kind);
 if(s.timer!==null)clearTimeout(s.timer);
 s.timer=setTimeout(()=>{s.timer=null;evaluate(kind);},3500);
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
  s.ready=false;s.remote=null;s.issues='';s.working=false;
 }
}
function subscribe(kind){
 const s=entry(kind);
 if(s.unsubscribe){s.unsubscribe();s.unsubscribe=null;}
 s.ready=false;s.remote=null;s.issues='';
 if(!account)return;
 const uid=account.uid;
 try{
  const ref=doc(db,'users',uid,'formday_sync',kind);
  s.unsubscribe=onSnapshot(ref,{includeMetadataChanges:true},
   snap=>{if(account?.uid===uid)onRemote(kind,snap);},
   error=>{if(account?.uid===uid)setIssue(kind,error);});
 }catch(e){setIssue(kind,e);}
}
function login(user){
 stopSubscriptions();
 account=user||null;
 if(!user){render();show('Google 로그인을 하면 클라우드 연결이 준비됩니다.');return;}
 for(const kind of P.slots)subscribe(kind);
 render();
}
function backup(kind){
 try{
  const l=local(kind);
  if(!l.hasData)throw Error('다운로드할 실제 기록이 없습니다.');
  const content=JSON.stringify({app:'FORMDAY-cloud-manual-backup',kind,exportedAt:new Date().toISOString(),data:l.data},null,2);
  const file=new Blob([content],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');
  a.href=url;a.download='FORMDAY-'+kind+'-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  show('백업 다운로드를 요청했습니다. 실제 파일이 저장됐는지 파일 앱에서 확인해 주세요.');
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
  if(action==='take'){download(kind,true);return;}
  if(action==='receive'){download(kind,false);return;}
  if(action==='send'){upload(kind,false);return;}
  if(action==='refresh'){subscribe(kind);render();return;}
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
