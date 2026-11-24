/* Browser-only FORMDAY Google login + read-only consent for ChatGPT OAuth.
 * No Google/Firebase credential is included in URL or rendered to the DOM.
 * The user must click the explicit approval button; no auto consent.
 */
import {initializeApp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {initializeAuth,inMemoryPersistence,browserPopupRedirectResolver,GoogleAuthProvider,signInWithPopup,signOut}
 from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

const firebaseConfig={
 apiKey:"AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E",
 authDomain:"healthy-df79f.firebaseapp.com",
 projectId:"healthy-df79f",
 appId:"1:188014722362:web:8478b91792c6e0890ae403",
 messagingSenderId:"188014722362"
};
const button=document.getElementById("fd-oauth-approve");
const status=document.getElementById("fd-oauth-status");
const csrf=document.querySelector('meta[name="fd-oauth-csrf"]')?.content;
let busy=false,auth=null;
const explain=(value,error=false)=>{
 if(status){status.textContent=value;status.dataset.error=error?"true":"false";}
};
if(!/^[A-Za-z0-9_-]{40,128}$/.test(csrf||"")){
 button.disabled=true;explain("승인 정보가 만료됐습니다. ChatGPT에서 다시 연결해 주세요.",true);
}else{
 try{
  const app=initializeApp(firebaseConfig,"formday-connect-oauth");
  auth=initializeAuth(app,{persistence:inMemoryPersistence,
   popupRedirectResolver:browserPopupRedirectResolver});
 }catch(e){button.disabled=true;explain("Google 로그인 초기화에 실패했습니다.",true);}
}
button?.addEventListener("click",()=>{
 if(busy||!auth)return;
 busy=true;button.disabled=true;
 explain("Google 계정 인증 창을 열고 있습니다.");
 const provider=new GoogleAuthProvider();
 provider.setCustomParameters({prompt:"select_account"});
 // Call popup synchronously within the user click, without earlier await.
 let popup;
 try{popup=signInWithPopup(auth,provider);}
 catch{busy=false;button.disabled=false;explain("Google 로그인 창을 열지 못했습니다.",true);return;}
 popup.then(async result=>{
  const user=result.user;
  const idToken=await user.getIdToken(true);
  const refreshToken=user.refreshToken;
  if(typeof refreshToken!=="string"||!refreshToken)
   throw Error("Firebase refresh credential unavailable");
  explain("Google 인증 완료. FORMDAY 요청 권한을 확인하고 있습니다.");
  const res=await fetch("/oauth/complete",{
   method:"POST",credentials:"same-origin",redirect:"error",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({csrf,idToken,refreshToken,approved:true})
  });
  if(!res.ok)throw Error("사용자 인증 또는 승인 세션이 유효하지 않습니다");
  const data=await res.json();
  const callback=new URL(data.redirectTo);
  if(callback.protocol!=="https:"||callback.hostname!=="chatgpt.com")
   throw Error("승인된 ChatGPT 복귀 주소가 아닙니다");
  explain("요청한 권한을 승인했습니다. ChatGPT로 돌아갑니다.");
  await signOut(auth);
  window.location.assign(callback.href);
 }).catch(()=>{
  explain("Google 인증을 완료하지 못했습니다. ChatGPT에서 다시 연결해 주세요.",true);
 }).finally(async()=>{await signOut(auth).catch(()=>{});busy=false;button.disabled=false;});
});
