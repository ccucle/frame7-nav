'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Exercise the Google-only flow deployed since v0.5.2 without real accounts.
const script=fs.readFileSync(path.join(__dirname,'../fitplan/cloud-auth.js'),'utf8')
 .replace(/^import .* from 'https:\/\/www\.gstatic\.com\/firebasejs\/[^']+';\n/gm,'');
const ids=['fd-account-btn','fd-account-dialog','fd-login','fd-logout','fd-account-close',
 'fd-account-status','fd-account-label','fd-account-warning','fd-standalone-notice'];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup({ios=true,standalone=true,popupError=null,initializationError=false}={}){
 const elements=Object.fromEntries(ids.map(id=>[id,{
  id,hidden:false,disabled:false,textContent:'',dataset:{},open:false,handlers:{},
  addEventListener(type,fn){this.handlers[type]=fn;},
  showModal(){this.open=true;},close(){this.open=false;}
 }]));
 const auth={currentUser:null},timers=new Map();
 const navigator={standalone,userAgent:ios?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)':'Mozilla/5.0 (Macintosh)',platform:ios?'iPhone':'MacIntel',maxTouchPoints:ios?5:0};
 let onChange,opened=0,signedout=0,parameters;
 const imports={
  window:{navigator,matchMedia:()=>({matches:standalone}),
   setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id)},
  navigator,document:{getElementById:id=>elements[id]||null},
  initializeApp:()=>{if(initializationError)throw Error('initialization failed');return {};},
  getAuth:()=>auth,
  GoogleAuthProvider:class{setCustomParameters(value){parameters=value;}},
  signInWithPopup:a=>{
   opened++;
   if(popupError)return Promise.reject({code:popupError});
   a.currentUser={email:'google@example.test',providerData:[{providerId:'google.com'}]};
   onChange(a.currentUser);
   return Promise.resolve({user:a.currentUser});
  },
  signOut:a=>{signedout++;a.currentUser=null;onChange(null);return Promise.resolve();},
  onAuthStateChanged:(_a,fn)=>{onChange=fn;fn(auth.currentUser);}
 };
 new Function(...Object.keys(imports),script)(...Object.values(imports));
 return {elements,auth,timers,stats:()=>({opened,signedout,parameters})};
}
test('iOS home-screen flow keeps Google available and never opens a popup automatically',()=>{
 const {elements:e,stats}=setup();
 assert.equal(e['fd-login'].hidden,false);
 assert.equal(e['fd-account-btn'].disabled,false);
 assert.equal(e['fd-standalone-notice'].hidden,false);
 assert.equal(stats().opened,0);
});
test('Google popup starts synchronously on click, prevents duplicate requests and updates account guidance',async()=>{
 const {elements:e,stats,timers}=setup();
 e['fd-login'].handlers.click();
 assert.equal(stats().opened,1);
 assert.deepEqual(stats().parameters,{prompt:'select_account'});
 e['fd-login'].handlers.click();
 assert.equal(stats().opened,1);
 await flush();
 assert.equal(e['fd-account-label'].textContent,'google@example.test');
 assert.equal(e['fd-login'].hidden,true);
 assert.equal(e['fd-logout'].hidden,false);
 assert.equal(e['fd-login'].disabled,false);
 assert.equal(timers.size,0);
 assert.match(e['fd-account-warning'].textContent,/기기 동기화/);
 assert.doesNotMatch(e['fd-account-warning'].textContent,/아직 연결되지|브라우저에만/);
});
test('blocked Google popup reports an error and unlocks sign-in',async()=>{
 const {elements:e}=setup({popupError:'auth/popup-blocked'});
 e['fd-login'].handlers.click();await flush();
 assert.match(e['fd-account-status'].textContent,/팝업이 차단/);
 assert.equal(e['fd-account-status'].dataset.error,'true');
 assert.equal(e['fd-login'].disabled,false);
 assert.equal(e['fd-login'].hidden,false);
});
test('Safari and desktop keep Google sign-in available without the iOS standalone notice',()=>{
 for(const config of [{ios:true,standalone:false},{ios:false,standalone:true}]){
  const {elements:e}=setup(config);
  assert.equal(e['fd-login'].hidden,false);
  assert.equal(e['fd-standalone-notice'].hidden,true);
 }
});
test('sign-out changes account state without claiming to delete device records',async()=>{
 const {elements:e,stats}=setup();
 e['fd-login'].handlers.click();await flush();
 e['fd-logout'].handlers.click();await flush();
 assert.equal(stats().signedout,1);
 assert.equal(e['fd-login'].hidden,false);
 assert.equal(e['fd-logout'].hidden,true);
 assert.match(e['fd-account-status'].textContent,/기기의 운동 기록은 유지/);
});
test('initialization failure leaves login disabled without claiming success',()=>{
 const {elements:e}=setup({initializationError:true});
 assert.equal(e['fd-account-btn'].disabled,true);
 assert.match(e['fd-account-status'].textContent,/초기화하지 못했습니다/);
});
test('authentication has no direct Firestore, record-storage, billing or password-creation operation',()=>{
 assert.doesNotMatch(script,/\b(?:getFirestore|setDoc|updateDoc|localStorage|initializeAnalytics|setPersistence|linkBillingAccount|signInWithEmailAndPassword|createUserWithEmailAndPassword|linkWithCredential)\b/);
 assert.match(script,/signInWithPopup/);
});
