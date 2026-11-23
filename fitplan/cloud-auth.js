/* FORMDAY iOS PWA login fix (v0.5.1).
 * Login-only module: never reads/writes workout records or Firestore.
 * Do not put service-account secrets in this client file.
 */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged,
  signInWithEmailAndPassword,createUserWithEmailAndPassword,EmailAuthProvider,linkWithCredential
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const firebaseConfig=Object.freeze({
  apiKey:'AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E',
  authDomain:'healthy-df79f.firebaseapp.com',
  projectId:'healthy-df79f',
  appId:'1:188014722362:web:8478b91792c6e0890ae403',
  messagingSenderId:'188014722362'
});

const byId=id=>document.getElementById(id);
const button=byId('fd-account-btn'),dialog=byId('fd-account-dialog');
const googleButton=byId('fd-login'),logoutButton=byId('fd-logout');
const closeButton=byId('fd-account-close'),status=byId('fd-account-status');
const account=byId('fd-account-label'),warning=byId('fd-account-warning');
const pwaNotice=byId('fd-standalone-notice'),emailForm=byId('fd-email-form');
const emailInput=byId('fd-auth-email'),passwordInput=byId('fd-auth-password');
const confirmationInput=byId('fd-auth-confirm');
const emailSignIn=byId('fd-email-login'),emailRegister=byId('fd-email-register');
const linkButton=byId('fd-email-link'),emailHelp=byId('fd-email-help');
const isIOS=/(iPad|iPhone|iPod)/.test(window.navigator?.userAgent||'') ||
  (window.navigator?.platform==='MacIntel'&&window.navigator?.maxTouchPoints>1);
const standalone=Boolean(isIOS&&(
  window.navigator?.standalone===true ||
  window.matchMedia?.('(display-mode: standalone)')?.matches
));

let auth=null,user=null,busy=false;

function setStatus(message,isError=false){
  if(!status)return;
  status.textContent=message;
  status.dataset.error=isError?'true':'false';
}
function helpMessage(){
  return standalone
   ?'홈 화면 앱에서는 Google 팝업 로그인이 완료되지 않을 수 있습니다. 이메일·비밀번호로 이 앱 안에서 로그인하세요. Firebase 콘솔에서 이메일/비밀번호 제공업체를 활성화해야 합니다.'
   :'Google 로그인 또는 이메일·비밀번호를 이용할 수 있습니다. Google로 로그인했다면 이메일 로그인 수단을 같은 계정에 연결할 수 있습니다.';
}
function showUser(next){
  user=next;
  const signedIn=!!next;
  if(googleButton)googleButton.hidden=signedIn||standalone;
  if(logoutButton)logoutButton.hidden=!signedIn;
  if(pwaNotice)pwaNotice.hidden=!standalone;
  if(account)account.textContent=next?(next.email||'로그인된 계정'):'로그인하지 않았습니다';
  if(button)button.textContent=signedIn?'👤 계정 확인됨':'👤 계정 로그인';

  const providers=next?.providerData?.map(x=>x.providerId)||[];
  const canLink=signedIn&&providers.includes('google.com')&&!providers.includes('password')&&!standalone;
  if(emailForm)emailForm.hidden=signedIn&&!canLink;
  if(emailSignIn)emailSignIn.hidden=signedIn;
  if(emailRegister)emailRegister.hidden=signedIn;
  if(linkButton)linkButton.hidden=!canLink;
  if(canLink&&emailInput)emailInput.value=next.email||'';
  if(emailHelp)emailHelp.textContent=canLink
    ?'Google 계정과 동일한 Firebase 사용자 ID로 홈 화면 앱에서도 로그인하려면, 아래 이메일과 새로운 비밀번호를 입력한 뒤 「이메일 로그인 연결」을 누르세요. 비밀번호를 새 계정으로 별도 가입하지 마세요.'
    :helpMessage();
  if(warning)warning.textContent='현재는 로그인 계정 확인 기능입니다. 운동·식단·체중 및 독립 IRON MODE 기록은 이 브라우저에만 저장됩니다. Firestore 동기화와 사용자별 데이터 분리는 아직 연결되지 않았습니다. 같은 기기에서 계정을 바꿔도 로컬 기록은 자동으로 분리되지 않으므로 공용 기기에서는 사용하지 마세요.';
  if(!busy)setStatus(signedIn?'Firebase 로그인 성공. 운동·식단·체중 기록은 아직 자동 동기화되지 않았습니다.':helpMessage());
}
function clearPasswords(){
  if(passwordInput)passwordInput.value='';
  if(confirmationInput)confirmationInput.value='';
}
function friendlyError(error){
  const code=error?.code||'';
  switch(code){
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':return 'Google 로그인이 취소되었습니다. 원래 기록은 유지됩니다.';
    case 'auth/popup-blocked':return 'Google 로그인 창이 차단되었습니다. 일반 Safari 탭에서 다시 시도하거나 이메일 로그인을 사용하세요.';
    case 'auth/unauthorized-domain':return 'Firebase에 FORMDAY 운영 도메인이 승인되어 있는지 확인해 주세요.';
    case 'auth/operation-not-allowed':return 'Firebase 콘솔 → Authentication → 로그인 방법에서 이메일/비밀번호를 사용 설정해야 합니다.';
    case 'auth/network-request-failed':return '네트워크 오류입니다. 기존 기록은 그대로 유지됩니다.';
    case 'auth/invalid-email':return '이메일 주소를 확인해 주세요.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':return 'Firebase 비밀번호 정책을 충족하지 않습니다. 더 안전한 비밀번호를 사용하세요.';
    case 'auth/email-already-in-use':return '이미 등록된 이메일입니다. 기존 Google 계정이 있다면 일반 Safari에서 Google로 로그인한 후 「이메일 로그인 연결」을 사용하세요.';
    case 'auth/provider-already-linked':return '이 계정에 이메일 로그인이 이미 연결되어 있습니다.';
    case 'auth/credential-already-in-use':return '이 인증 수단은 다른 계정에 연결되어 있어 자동으로 병합하지 않았습니다.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':return '이메일 또는 비밀번호가 일치하지 않습니다. 계정 정보를 다시 확인해 주세요.';
    case 'auth/too-many-requests':return '로그인 시도가 일시 제한됐습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/requires-recent-login':return '계정 보안을 위해 최근 로그인 인증이 필요합니다. 일반 Safari에서 Google 로그인 후 다시 연결해 주세요.';
    default:return '로그인 요청을 완료하지 못했습니다. 기존 브라우저 기록은 보존됩니다.';
  }
}
function setBusy(next){
  busy=next;
  for(const el of [googleButton,logoutButton,emailSignIn,emailRegister,linkButton])if(el)el.disabled=next;
}
function values(){
  const email=(emailInput?.value||'').trim();
  const password=passwordInput?.value||'';
  const confirmation=confirmationInput?.value||'';
  if(!email || !email.includes('@'))throw {userMessage:'올바른 이메일 주소를 입력해 주세요.'};
  if(password.length<6)throw {userMessage:'비밀번호는 6자 이상 입력해 주세요.'};
  return {email,password,confirmation};
}
async function withRequest(fn,pending){
  if(!auth||busy)return;
  setBusy(true);
  setStatus(pending);
  try{await fn();}
  catch(error){setStatus(error?.userMessage||friendlyError(error),true);}
  finally{setBusy(false);}
}
if(button&&dialog&&googleButton&&logoutButton&&closeButton&&status&&account&&
   emailForm&&emailInput&&passwordInput&&emailSignIn&&emailRegister&&linkButton&&confirmationInput){
  button.disabled=true;
  button.addEventListener('click',()=>{
    if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
  });
  closeButton.addEventListener('click',()=>{
    clearPasswords();
    dialog.close();
  });
  googleButton.addEventListener('click',()=>{
    if(standalone){
      setStatus('홈 화면 앱은 Google 팝업 로그인이 정상 완료되지 않을 수 있습니다. 이메일 로그인을 선택하거나 일반 Safari에서 Google 로그인 후 이메일 수단을 연결하세요.',true);
      return;
    }
    // Important: start popup synchronously in the user gesture.
    // Awaiting setPersistence() before opening a popup can lose transient activation.
    withRequest(async()=>{
      await signInWithPopup(auth,new GoogleAuthProvider());
      setStatus('Google 로그인 완료. 이 브라우저의 건강 기록은 아직 서버에 전송하지 않았습니다.');
    },'Google 로그인 창을 여는 중입니다. 창이 닫히지 않으면 일반 Safari에서 다시 시도해 주세요.');
  });
  emailSignIn.addEventListener('click',()=>{
    withRequest(async()=>{
      const {email,password}=values();
      await signInWithEmailAndPassword(auth,email,password);
      clearPasswords();
      setStatus('이메일 계정 로그인 완료. 기록은 아직 이 기기에만 저장됩니다.');
    },'이메일 로그인 중입니다.');
  });
  emailRegister.addEventListener('click',()=>{
    withRequest(async()=>{
      const {email,password,confirmation}=values();
      if(password!==confirmation)throw {userMessage:'비밀번호와 비밀번호 확인이 일치하지 않습니다.'};
      await createUserWithEmailAndPassword(auth,email,password);
      clearPasswords();
      setStatus('Firebase 계정을 만들었습니다. 기록의 자동 동기화는 아직 지원하지 않습니다.');
    },'새 Firebase 계정을 등록하고 있습니다.');
  });
  linkButton.addEventListener('click',()=>{
    withRequest(async()=>{
      if(!auth.currentUser||!auth.currentUser.providerData.some(x=>x.providerId==='google.com'))
        throw {userMessage:'Google 로그인 상태에서만 같은 계정에 이메일 로그인을 연결할 수 있습니다.'};
      const {email,password,confirmation}=values();
      if(email.toLowerCase()!==String(auth.currentUser.email||'').toLowerCase())
        throw {userMessage:'현재 로그인한 Google 계정과 같은 이메일을 입력해 주세요.'};
      if(password!==confirmation)throw {userMessage:'비밀번호와 확인 값이 일치하지 않습니다.'};
      await linkWithCredential(auth.currentUser,EmailAuthProvider.credential(email,password));
      clearPasswords();
      showUser(auth.currentUser);
      setStatus('현재 Google 계정에 이메일 로그인을 연결했습니다. 홈 화면 FORMDAY에서 같은 이메일·새 비밀번호로 로그인할 수 있습니다.');
    },'기존 Google 계정에 이메일 로그인을 연결하고 있습니다.');
  });
  logoutButton.addEventListener('click',()=>{
    withRequest(async()=>{
      await signOut(auth);
      clearPasswords();
      setStatus('Firebase 계정에서 로그아웃했습니다. 기기의 기록은 삭제되지 않았습니다.');
    },'로그아웃 중입니다.');
  });
  try{
    const app=initializeApp(firebaseConfig,'formday-auth');
    auth=getAuth(app);
    onAuthStateChanged(auth,showUser,()=>setStatus('로그인 상태를 읽을 수 없습니다. 기록은 그대로 유지됩니다.',true));
    button.disabled=false;
    showUser(auth.currentUser);
  }catch(error){
    button.disabled=true;
    setStatus('Firebase 로그인 모듈을 초기화할 수 없습니다. 기존 기록을 계속 사용할 수 있습니다.',true);
  }
}
