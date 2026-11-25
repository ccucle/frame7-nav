/* Limited user-operated production test: existing owner session; no calendar/IRON/buddy writes. */
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
const config={
 apiKey:'AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E',
 authDomain:'healthy-df79f.firebaseapp.com',
 projectId:'healthy-df79f',
 appId:'1:188014722362:web:8478b91792c6e0890ae403',
 messagingSenderId:'188014722362'
};
const app=getApps().find(a=>a.name==='formday-auth')||initializeApp(config,'formday-auth');
const auth=getAuth(app),db=getFirestore(app);
const C=window.FormdayCore,P=window.FormdayMealPhotoPolicy,S=window.FormdaySyncPolicy;
const q=id=>document.getElementById(id),status=q('pilot-status'),load=q('load-meals'),select=q('meal-select'),open=q('open-meal'),section=q('meal-section'),host=q('photo-target');
let uid=null,generation=0,meals=[],controller=null,loading=false,openedId='';
const tell=message=>status.textContent=message;
function clearPhoto(){controller?.dispose();controller=null;host.replaceChildren();openedId='';}
function clear(){
 clearPhoto();meals=[];
 select.replaceChildren(new Option('식단 선택',''));select.disabled=true;open.disabled=true;section.hidden=true;
}
function current(id,epoch){return !!id&&uid===id&&auth.currentUser?.uid===id&&epoch===generation;}
function controls(){load.disabled=!uid||loading;select.disabled=!uid||loading||!meals.length;open.disabled=select.disabled||!select.value;}
onAuthStateChanged(auth,user=>{
 generation++;uid=user?.uid||null;loading=false;clear();controls();
 tell(uid?'기존 Google 로그인 연결 확인. “완료 식단 조회”를 눌러 주세요.':'메인 FORMDAY 사이트에서 기존 Google 계정으로 로그인 후 이 페이지를 다시 여세요.');
},()=>{generation++;uid=null;loading=false;clear();controls();tell('로그인 상태 조회 실패. 기존 기록은 변경하지 않았습니다.');});
load.onclick=async()=>{
 if(!uid||loading||controller?.canLeave()===false)return;
 const id=uid,epoch=++generation;loading=true;clear();controls();tell('클라우드의 완료 식단을 확인하고 있습니다.');
 try{
  const snap=await getDocFromServer(doc(db,'users',id,'formday_sync','calendar'));
  if(!current(id,epoch))return;
  if(!snap.exists())throw Error('동기화된 캘린더가 없습니다. 기존 사이트에서 연결을 확인해 주세요.');
  const remote=S.docValid(snap.data());
  meals=C.normalizeState(JSON.parse(remote.payload)).events.filter(P.eligible).sort((a,b)=>b.date.localeCompare(a.date)||b.start.localeCompare(a.start));
  select.replaceChildren(new Option('식단 선택',''));
  for(const meal of meals)select.append(new Option(meal.date+' '+meal.start+' · '+meal.title,meal.id));
  section.hidden=meals.length===0;
  tell(meals.length?'완료 식단 '+meals.length+'개를 확인했습니다. 시험할 식단 하나를 선택하세요.':'사진을 연결할 완료 식단이 없습니다. 새 기록을 자동 생성하지 않았습니다.');
 }catch(e){if(current(id,epoch)){clear();tell('식단 조회 실패: '+(e.message||'연결 상태를 확인해 주세요.'));}}
 finally{if(current(id,epoch)){loading=false;controls();}}
};
select.onchange=()=>{
 if(controller&&select.value!==openedId){
  if(controller.canLeave()===false){select.value=openedId;controls();return;}
  clearPhoto();tell('다른 식단을 선택했습니다. 사진 열기를 눌러 주세요.');
 }
 controls();
};
open.onclick=()=>{
 if(!uid||loading||controller?.canLeave()===false)return;
 const meal=meals.find(x=>x.id===select.value);
 if(!meal||!P.eligible(meal))return;
 clearPhoto();
 if(!window.FormdayMealPhotos?.mount){tell('사진 기능을 불러오지 못했습니다. 페이지를 다시 열어 주세요.');return;}
 const id=uid,epoch=generation;openedId=meal.id;
 controller=window.FormdayMealPhotos.mount(host,C.clone(meal),{canWrite:()=>current(id,epoch)&&select.value===meal.id&&openedId===meal.id});
 tell('선택한 식단: '+meal.date+' '+meal.title+' · 사진의 저장 및 재조회 결과를 아래에서 확인하세요.');
};
