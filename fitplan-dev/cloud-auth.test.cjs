'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../fitplan/cloud-auth.js'),'utf8')
  .split('\n').filter(line=>!line.startsWith('import {')).join('\n');

function env(){
  const els=new Map();
  const get=id=>{
    if(!els.has(id))els.set(id,{id,disabled:false,hidden:false,textContent:'',dataset:{},open:false,listeners:{},
      addEventListener(type,cb){this.listeners[type]=cb;},
      showModal(){this.open=true;},
      close(){this.open=false;}
    });
    return els.get(id);
  };
  let listener=null;
  const auth={currentUser:null};
  const fns={
    document:{getElementById:get},
    initializeApp:cfg=>({cfg}),
    getAuth:()=>auth,
    GoogleAuthProvider:class{},
    signInWithPopup:async a=>{a.currentUser={email:'test@example.invalid'};listener(a.currentUser);},
    signOut:async a=>{a.currentUser=null;listener(null);},
    onAuthStateChanged:(_a,fn)=>{listener=fn;fn(auth.currentUser);},
    setPersistence:async()=>{},
    browserLocalPersistence:{}
  };
  vm.runInNewContext(source,fns,{filename:'cloud-auth.js'});
  return {get,auth};
}
test('Google login UI is available without modifying any FORMDAY record',()=>{
  const {get}=env();
  assert.equal(get('fd-account-btn').disabled,false);
  assert.match(get('fd-account-label').textContent,/로그인하지/);
  assert.match(get('fd-account-warning').textContent,/자동 동기화/);
  get('fd-account-btn').listeners.click();
  assert.equal(get('fd-account-dialog').open,true);
});
test('login, logout and local-only warning behave independently of cloud database',async()=>{
  const {get}=env();
  await get('fd-login').listeners.click();
  assert.equal(get('fd-account-label').textContent,'test@example.invalid');
  assert.equal(get('fd-login').hidden,true);
  assert.match(get('fd-account-status').textContent,/브라우저/);
  await get('fd-logout').listeners.click();
  assert.match(get('fd-account-label').textContent,/로그인하지/);
  assert.match(get('fd-account-status').textContent,/기존 기록은 그대로/);
});
test('no Firebase Firestore API or localStorage operations are referenced in auth-only pilot',()=>{
  assert.doesNotMatch(source,/\b(?:getFirestore|collection|setDoc|updateDoc|addDoc|deleteDoc|localStorage)\b/);
  assert.doesNotMatch(source,/\b(?:getAnalytics|firebase-storage|functions\.httpsCallable)\b/);
  assert.match(source,/signInWithPopup/);
});
