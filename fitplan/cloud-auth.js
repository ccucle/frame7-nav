/* FORMDAY v0.5.2 · Google-only popup retry in iOS standalone PWA.
 * Authentication-only: does not access Firestore or exercise storage.
 */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const firebaseConfig=Object.freeze({
 apiKey:'AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E',
 authDomain:'healthy-df79f.firebaseapp.com',
 projectId:'healthy-df79f',
 appId:'1:188014722362:web:8478b91792c6e0890ae403',
 messagingSenderId:'188014722362'
});
const el=id=>document.getElementById(id);
const button=el('fd-account-btn'),dialog=el('fd-account-dialog');
const googleBtn=el('fd-login'),logoutBtn=el('fd-logout'),closeBtn=el('fd-account-close');
const status=el('fd-account-status'),account=el('fd-account-label');
const warning=el('fd-account-warning'),pwaNotice=el('fd-standalone-notice');
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=!!(isIOS&&(navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)')?.matches));
let auth=null,busy=false,user=null,hintTimer=null;
function say(message,error=false){
 if(!status)return;
 status.textContent=message;
 status.dataset.error=error?'true':'false';
}
function errorText(e){
 const code=String(e?.code||'');
 const errors={
  'auth/popup-blocked':'Google 팝업이 차단되었습니다. 홈 화면 웹앱에서 팝업 실행이 차단됐을 수 있습니다.',
  'auth/popup-closed-by-user':'Google 로그인 창이 닫혔거나 취소되었습니다.',
  'auth/cancelled-popup-request':'Google 로그인 요청이 취소되었습니다.',
  'auth/unauthorized-domain':'FORMDAY 주소를 Firebase 승인된 도메인에 등록해야 합니다.',
  'auth/operation-not-allowed':'Firebase의 Google 로그인 제공업체 설정을 확인해야 합니다.',
  'auth/network-request-failed':'네트워크 연결을 확인해 주세요.',
  'auth/web-storage-unsupported':'이 웹앱 환경이 인증 저장소 사용을 지원하지 않습니다.',
  'auth/operation-not-supported-in-this-environment':'이 웹앱 환경에서 Google 팝업 인증이 지원되지 않습니다.',
  'auth/account-exists-with-different-credential':'기존 계정의 로그인 방식이 달라 확인이 필요합니다. 계정을 삭제하지 마세요.'
 };
 return errors[code]||(code?'Google 로그인이 완료되지 않았습니다. 오류 코드: '+code:'Google 인증 창을 확인해 주세요.');
}
function lock(next){busy=next;if(googleBtn)googleBtn.disabled=next;if(logoutBtn)logoutBtn.disabled=next;}
function showUser(next){
 user=next;
 if(googleBtn)googleBtn.hidden=!!next;
 if(logoutBtn)logoutBtn.hidden=!next;
 if(account)account.textContent=next?(next.email||'Google 계정 로그인됨'):'로그인하지 않았습니다';
 if(button){
  const label=next?'계정 확인됨':'Google 로그인';
  button.setAttribute('aria-label',label);
  button.title=label;
  button.dataset.signedIn=next?'true':'false';
 }
 if(pwaNotice)pwaNotice.hidden=!standalone||!!next;
 if(warning)warning.textContent=next?'로그인되었습니다. 기기 동기화에서 캘린더와 웨이트의 연결 상태를 각각 확인하세요. 연결된 기록은 온라인에서 자동 동기화되며, 이 기기에도 저장됩니다.':'같은 Google 계정으로 로그인하면 기기 동기화를 연결할 수 있습니다. 로그인 전 작성한 기록은 이 브라우저에 보관됩니다.';
 if(!busy)say(next?'Google 계정이 확인되었습니다. 기존 로컬 기록은 그대로 유지됩니다.':'Google 계정으로 로그인할 수 있습니다. FORMDAY 비밀번호는 필요하지 않습니다.');
}
function googleSignIn(){
 if(!auth||busy)return;
 lock(true);
 say('Google 로그인 창을 여는 중입니다. Google 계정을 선택해 주세요.');
 let promise;
 try{
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  // Invoke the SDK synchronously during the user's button click.
  promise=signInWithPopup(auth,provider);
 }catch(e){say(errorText(e),true);lock(false);return;}
 hintTimer=window.setTimeout(()=>{
  if(busy)say('인증 창이 뜨지 않거나 멈췄다면, 아이폰 홈 화면 웹앱의 팝업 인증 제한일 수 있습니다. 현재 화면을 캡처해 주세요.',true);
 },18000);
 promise.then(result=>{
  showUser(result.user);
  say('Google 로그인 성공. 기존 로컬 운동 기록은 유지됩니다.');
 }).catch(e=>say(errorText(e),true)).finally(()=>{
  if(hintTimer!==null){window.clearTimeout(hintTimer);hintTimer=null;}
  lock(false);
 });
}
function googleSignOut(){
 if(!auth||busy)return;
 lock(true);
 say('Google 계정에서 로그아웃하는 중입니다.');
 signOut(auth).then(()=>say('로그아웃했습니다. 기기의 운동 기록은 유지됩니다.'))
  .catch(e=>say('로그아웃 실패: '+String(e?.code||'네트워크 확인'),true))
  .finally(()=>lock(false));
}
if(button&&dialog&&googleBtn&&logoutBtn&&closeBtn&&status&&account){
 button.disabled=true;
 button.addEventListener('click',()=>{
  if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
 });
 closeBtn.addEventListener('click',()=>dialog.close());
 googleBtn.addEventListener('click',googleSignIn);
 logoutBtn.addEventListener('click',googleSignOut);
 try{
  const app=initializeApp(firebaseConfig,'formday-auth');
  auth=getAuth(app);
  onAuthStateChanged(auth,showUser,()=>say('Google 로그인 상태를 확인할 수 없습니다. 기존 운동 기록은 유지됩니다.',true));
  button.disabled=false;
  showUser(auth.currentUser);
 }catch(e){
  button.disabled=true;
  say('Firebase 인증 모듈을 초기화하지 못했습니다. 기존 기록은 변경하지 않았습니다.',true);
 }
}
