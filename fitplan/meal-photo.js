/* Draft original-photo attachment. Existing authenticated Firebase app only.
 * Separate documents; never embeds image bytes in calendar payload or localStorage.
 * Do not deploy until the owner-only Rules fragment and integration gates pass.
 */
import {getApps} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,runTransaction,serverTimestamp,Bytes} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const P=window.FormdayMealPhotoPolicy;
const C=window.FormdayCore;
const SYNC=window.FormdaySyncPolicy;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
function checkedCalendar(snapshot,event){
  if(!snapshot.exists())throw Error('클라우드 식단을 먼저 동기화해 주세요.');
  const remote=SYNC.docValid(snapshot.data());
  P.checkTarget(C.normalizeState(JSON.parse(remote.payload)),event.id,event.date);
}
async function checkedPhoto(snapshot,event){
  if(!snapshot.exists())return null;
  const d=snapshot.data();
  if(d.format!==1||d.eventId!==event.id||!P.validHash(d.sha256)||!(d.bytes instanceof Bytes))throw Error('사진 문서 형식 오류: 원본을 덮어쓰지 않습니다.');
  const bytes=d.bytes.toUint8Array();
  P.checkBytes(bytes,d.mime);
  if(d.size!==bytes.length||await digest(bytes)!==d.sha256)throw Error('사진 원본 무결성 오류: 원본을 덮어쓰지 않습니다.');
  return {bytes,mime:d.mime,sha256:d.sha256};
}
function cloud(event,guard,db,uid){
  const calendar=doc(db,'users',uid,'formday_sync','calendar');
  const photo=doc(db,'users',uid,'formday_meal_photos',event.id);
  return {
    async read(){
      guard();
      const cal=await getDocFromServer(calendar);guard();checkedCalendar(cal,event);
      const snapshot=await getDocFromServer(photo);guard();
      const result=await checkedPhoto(snapshot,event);guard();return result;
    },
    async save(expected,next){
      guard();
      await runTransaction(db,async tx=>{
        guard();
        const cal=await tx.get(calendar);guard();checkedCalendar(cal,event);
        const s=await tx.get(photo);guard();
        // Verify the current image, not just the untrusted digest field.
        const current=await checkedPhoto(s,event);guard();
        const action=P.decide(current?.sha256??null,expected,next?.sha256??null);
        if(action==='write')tx.set(photo,{format:1,eventId:event.id,sha256:next.sha256,mime:next.mime,size:next.bytes.length,bytes:Bytes.fromUint8Array(next.bytes),updatedAt:serverTimestamp()});
        if(action==='delete')tx.delete(photo);
      });
      guard();
      // Do not report success based only on a write acknowledgement.
      const actual=await this.read();guard();
      if((actual?.sha256??null)!==(next?.sha256??null))throw Error('클라우드 재조회 결과가 일치하지 않습니다.');
      return actual;
    }
  };
}
function mount(container,event){
  if(!container?.isConnected||!P?.eligible(event))return;
  const host=document.createElement('section');
  host.className='fd-meal-photo';host.setAttribute('data-meal-ui-only','');
  host.style.cssText='margin:16px 0;padding:14px;border:1px solid #475057;border-radius:12px;display:grid;gap:10px;';
  host.innerHTML='<h3>식사 사진 원본</h3><p class="helper">저장된 완료 식단에 연결합니다. JPEG·PNG·WebP 원본 700KiB 이하. 사진 저장은 식단 내용 저장과 별개입니다.</p><p role="status" aria-live="polite" data-photo-status>사진을 불러오는 중입니다.</p><button type="button" data-photo-expand hidden class="btn btn-outline">사진 확대</button><img data-photo-preview hidden alt="등록한 식사 사진" style="max-width:100%;max-height:260px;object-fit:contain;border-radius:8px"><label>원본 선택 <input type="file" accept="image/jpeg,image/png,image/webp" data-photo-file disabled></label><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="btn btn-primary" data-photo-save disabled>사진 저장</button><button type="button" class="btn btn-outline" data-photo-refresh>다시 조회</button><button type="button" class="danger" data-photo-delete disabled>사진 삭제</button></div>';
  container.append(host);
  const q=s=>host.querySelector(s);
  const status=q('[data-photo-status]'),img=q('[data-photo-preview]'),input=q('[data-photo-file]'),save=q('[data-photo-save]'),refresh=q('[data-photo-refresh]'),remove=q('[data-photo-delete]'),expand=q('[data-photo-expand]');
  let disposed=false,busy=false,ready=false,current=null,draft=null,url=null,epoch=0,unsub=null;
  const app=getApps().find(a=>a.name==='formday-auth');
  const auth=app?getAuth(app):null,uid=auth?.currentUser?.uid||null;
  const db=app?getFirestore(app):null;
  function guard(){if(disposed||!host.isConnected||!uid||auth.currentUser?.uid!==uid)throw Error('계정 또는 화면이 변경되었습니다. 다시 열어 주세요.');}
  const api=uid&&db&&SYNC&&C?cloud(event,guard,db,uid):null;
  const tell=t=>{if(!disposed&&host.isConnected)status.textContent=t;};
  function show(photo){
    if(url)URL.revokeObjectURL(url);
    url=null;img.hidden=true;img.removeAttribute('src');expand.hidden=true;
    if(photo){url=URL.createObjectURL(new Blob([photo.bytes],{type:photo.mime}));img.src=url;img.hidden=false;expand.hidden=false;img.style.maxHeight='260px';expand.textContent='사진 확대';}
  }
  function controls(){
    input.disabled=disposed||busy||!ready||!api;
    save.disabled=disposed||busy||!ready||!draft||!api;
    remove.disabled=disposed||busy||!ready||!current||!api;
    refresh.disabled=disposed||busy||!api;
  }
  function dispose(){
    if(disposed)return;
    disposed=true;epoch++;unsub?.();observer.disconnect();
    show(null);current=null;draft=null;input.value='';
  }
  const observer=new MutationObserver(()=>{if(!host.isConnected)dispose();});
  observer.observe(document.body,{childList:true,subtree:true});
  if(auth)unsub=onAuthStateChanged(auth,user=>{
    if(user?.uid!==uid){ready=false;epoch++;current=null;draft=null;show(null);input.value='';tell('계정이 변경되었습니다. 식단을 다시 열어 주세요.');dispose();input.disabled=save.disabled=remove.disabled=refresh.disabled=true;}
  });
  async function load(){
    if(busy||disposed||!api)return;
    busy=true;ready=false;epoch++;controls();
    draft=null;current=null;show(null);input.value='';
    try{
      current=await api.read();guard();ready=true;show(current);
      tell(current?'원본 사진이 클라우드에 저장되어 있습니다.':'등록된 사진이 없습니다.');
    }catch(e){tell('사진을 조회하지 못했습니다. '+(e?.code==='permission-denied'?'사진 저장 권한 설정이 필요합니다.':e.message));}
    finally{busy=false;controls();}
  }
  input.onchange=async()=>{
    const file=input.files?.[0],version=++epoch;
    draft=null;show(current);controls();
    if(!file)return;
    try{
      guard();if(file.size>P.MAX_BYTES)throw Error('700KiB 이하의 원본 파일을 선택해 주세요. 원본은 변경하지 않았습니다.');
      const bytes=new Uint8Array(await file.arrayBuffer());guard();P.checkBytes(bytes,file.type);
      const candidate={bytes,mime:file.type,sha256:await digest(bytes)};guard();
      // Decode locally before permitting upload; reject invalid or excessive dimensions.
      const testUrl=URL.createObjectURL(new Blob([bytes],{type:file.type}));
      try{
        const probe=new Image();probe.src=testUrl;await probe.decode();
        if(!probe.naturalWidth||!probe.naturalHeight||probe.naturalWidth*probe.naturalHeight>30000000)throw Error('이미지 크기를 확인해 주세요.');
      }finally{URL.revokeObjectURL(testUrl);}
      guard();if(version!==epoch)return;
      draft=candidate;show(draft);tell('원본 미리보기 · 아직 저장되지 않았습니다.');controls();
    }catch(e){if(version===epoch){draft=null;show(current);tell('사진 선택 실패: '+e.message);controls();}}
  };
  async function commit(next){
    if(busy||!ready||disposed||!api)return;
    busy=true;epoch++;controls();tell('사진 저장 및 클라우드 재조회 중입니다.');
    try{
      current=await api.save(current?.sha256??null,next);guard();draft=null;input.value='';show(current);
      tell(current?'원본 사진 저장 및 클라우드 재조회 완료.':'사진 삭제 및 클라우드 재조회 완료.');
    }catch(e){ready=false;draft=null;current=null;input.value='';show(null);tell('저장 결과를 확인하지 못했습니다. 중복 저장하지 말고 다시 조회해 주세요. '+(e.message||''));}
    finally{busy=false;controls();}
  }
  save.onclick=()=>{if(draft&&(!current||current.sha256===draft.sha256||window.confirm('이 식단의 기존 사진을 교체할까요?')))commit(draft);};
  remove.onclick=()=>{if(current&&window.confirm('이 식단의 사진만 삭제할까요? 식단 영양기록은 그대로 유지됩니다.'))commit(null);};
  refresh.onclick=load;
  expand.onclick=()=>{img.style.maxHeight=img.style.maxHeight==='none'?'260px':'none';expand.textContent=img.style.maxHeight==='none'?'사진 축소':'사진 확대';};
  if(api)load();else{tell('Google 로그인 및 클라우드 연결을 먼저 완료한 뒤 이 식단을 다시 열어 주세요.');controls();}
}
window.FormdayMealPhotos=Object.freeze({mount});
