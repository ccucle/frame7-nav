'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../fitplan/cloud-auth.js'),'utf8')
 .replace(/import \{initializeApp\} from [^\n]+\n/,'')
 .replace(/import \{[\s\S]*?\} from 'https:\/\/www\.gstatic\.com\/firebasejs\/13\.4\.0\/firebase-auth\.js';\n/,'');
const ids=[
 'fd-account-btn','fd-account-dialog','fd-login','fd-logout','fd-account-close',
 'fd-account-status','fd-account-label','fd-account-warning','fd-standalone-notice',
 'fd-email-form','fd-auth-email','fd-auth-password','fd-auth-confirm',
 'fd-email-login','fd-email-register','fd-email-link','fd-email-help'
];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup({ios=true,standalone=true}={}){
 const elements=Object.fromEntries(ids.map(id=>[id,{
   id,hidden:false,disabled:false,value:'',textContent:'',dataset:{},open:false,handlers:{},
   addEventListener(type,fn){this.handlers[type]=fn;},
   showModal(){this.open=true;},close(){this.open=false;}
 }]));
 const auth={currentUser:null};
 let onChange,opened=0,linked=0,registered=0,signedin=0;
 const imports={
  window:{
    navigator:{
      standalone,userAgent:ios?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)':'Mozilla/5.0 (Macintosh)',
      platform:ios?'iPhone':'MacIntel',maxTouchPoints:ios?5:0
    },matchMedia:()=>({matches:standalone})
  },
  document:{getElementById:id=>elements[id]||null},
  initializeApp:()=>({}),getAuth:()=>auth,
  GoogleAuthProvider:class{},
  signInWithPopup:async a=>{opened++;a.currentUser={email:'google@example.test',providerData:[{providerId:'google.com'}]};onChange(a.currentUser);},
  signOut:async a=>{a.currentUser=null;onChange(null);},
  onAuthStateChanged:(_a,fn)=>{onChange=fn;fn(auth.currentUser);},
  signInWithEmailAndPassword:async(a,email)=>{signedin++;a.currentUser={email,providerData:[{providerId:'password'}]};onChange(a.currentUser);},
  createUserWithEmailAndPassword:async(a,email)=>{registered++;a.currentUser={email,providerData:[{providerId:'password'}]};onChange(a.currentUser);},
  EmailAuthProvider:{credential:(email,password)=>({email,password})},
  linkWithCredential:async(user,credential)=>{linked++;user.providerData.push({providerId:'password'});return {user};}
 };
 new Function(...Object.keys(imports),script)(...Object.values(imports));
 return {elements,auth,stats:()=>({opened,linked,registered,signedin})};
}
test('iOS installed web app avoids Google popup and shows email alternative',()=>{
 const {elements:e,stats}=setup();
 assert.equal(e['fd-login'].hidden,true);
 assert.equal(e['fd-email-form'].hidden,false);
 assert.equal(e['fd-standalone-notice'].hidden,false);
 assert.equal(stats().opened,0);
});
test('installed iOS web app can sign in with email/password',async()=>{
 const {elements:e,stats}=setup();
 e['fd-auth-email'].value='person@example.test';
 e['fd-auth-password'].value='example-password';
 e['fd-email-login'].handlers.click();await flush();
 assert.equal(stats().signedin,1);
 assert.equal(e['fd-account-label'].textContent,'person@example.test');
 assert.match(e['fd-account-status'].textContent,/동기화되지/);
});
test('email registration requires matching confirmation and explicit click',async()=>{
 const {elements:e,stats}=setup();
 e['fd-auth-email'].value='new@example.test';
 e['fd-auth-password'].value='example-password';
 e['fd-auth-confirm'].value='not-the-same';
 e['fd-email-register'].handlers.click();await flush();
 assert.equal(stats().registered,0);
 assert.match(e['fd-account-status'].textContent,/일치하지/);
 e['fd-auth-confirm'].value='example-password';
 e['fd-email-register'].handlers.click();await flush();
 assert.equal(stats().registered,1);
});
test('Safari Google login can link password to the same Firebase user instead of creating new user',async()=>{
 const {elements:e,stats}=setup({ios:true,standalone:false});
 assert.equal(e['fd-login'].hidden,false);
 e['fd-login'].handlers.click();await flush();
 assert.equal(stats().opened,1);
 assert.equal(e['fd-email-link'].hidden,false);
 assert.equal(e['fd-email-register'].hidden,true);
 e['fd-auth-email'].value='google@example.test';
 e['fd-auth-password'].value='strong-new-password';
 e['fd-auth-confirm'].value='strong-new-password';
 e['fd-email-link'].handlers.click();await flush();
 assert.equal(stats().linked,1);
 assert.equal(stats().registered,0);
 assert.match(e['fd-account-status'].textContent,/연결했습니다/);
});
test('desktop standalone does not unnecessarily hide Google sign-in',()=>{
 const {elements:e}=setup({ios:false,standalone:true});
 assert.equal(e['fd-login'].hidden,false);
});
test('login module has no direct Firestore, record storage or billing operations',()=>{
 assert.doesNotMatch(script,/\b(?:getFirestore|setDoc|updateDoc|localStorage|initializeAnalytics|setPersistence|linkBillingAccount)\b/);
 assert.match(script,/signInWithEmailAndPassword/);
 assert.match(script,/signInWithPopup/);
});
