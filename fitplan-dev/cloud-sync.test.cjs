'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../fitplan/core.js');
const I=require('../fitplan/iron-store.js');
const P=require('../fitplan/sync-policy.js');
const prefix='formday_cloud_sync_v1:';
const key=kind=>kind==='calendar'?C.STORE:I.KEY;
const user=uid=>({uid,email:uid+'@example.test'});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function calendar(revision,weight=80){
 return C.normalizeState({revision,settings:{...C.defaults},events:[{
  id:'weight-record',date:'2026-11-24',start:'07:00',end:'07:05',type:'weight',title:'체중',repeat:'none',completed:true,detail:{weight,bodyfat:null}
 }]});
}
function iron(revision,name='루틴'){
 return {...I.createRoutine(I.empty(),name,[I.newExercise('벤치프레스')]).next,revision};
}
const fixture=(kind,revision)=>kind==='calendar'?calendar(revision):iron(revision);
function snapshot(value){
 return {exists:()=>value!==null,data:()=>value===null?undefined:{format:1,revision:value.revision,payload:JSON.stringify(value)},
  metadata:{fromCache:false,hasPendingWrites:false}};
}
function boot(initial={}){
 const map=new Map(Object.entries(initial)),writes=[],reads=[],transactions=[],subscriptions=[],nodes=new Map();
 let authListener,timerId=0;const timers=new Map();
 const storage={getItem:k=>map.get(k)??null,setItem(k,value){writes.push([k,value]);map.set(k,String(value));}};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',dataset:{},addEventListener(){},showModal(){},close(){}});
  return nodes.get(id);
 };
 const document={hidden:false,getElementById:node};
 const bridge={canCloudApply:()=>true,cloudReload:()=>true};
 const context=vm.createContext({document,localStorage:storage,console,Date,TextEncoder,
  FormdaySyncPolicy:P,FormdayCore:C,FormdayIronStore:I,FormdayBridge:bridge,FormdayIndependent:bridge,
  addEventListener(){},confirm:()=>true,
  setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval(){},
  getApps:()=>[],initializeApp:()=>({}),getAuth:()=>({}),getFirestore:()=>({}),
  onAuthStateChanged:(_,callback)=>{authListener=callback;},
  doc:(_, ...parts)=>({path:parts.join('/')}),serverTimestamp:()=>({mockTimestamp:true}),
  onSnapshot(ref,options,next,error){
   const entry={ref,next,error,unsubscribed:false};subscriptions.push(entry);
   return ()=>{entry.unsubscribed=true;};
  },
  getDocFromServer(ref){const pending=deferred();reads.push({ref,...pending});return pending.promise;},
  runTransaction(_,callback){const pending=deferred();transactions.push({callback,...pending,reads:[],writes:[]});return pending.promise;}
 });
 context.window=context;
 const source=fs.readFileSync(require.resolve('../fitplan/cloud-sync.js'),'utf8')
  .replace(/^import\s+\{[\s\S]*?\}\s+from\s+'[^']+';\s*/gm,'');
 vm.runInContext(source+'\nwindow.__syncTest={download,upload,prepareMerge,applyMerge,chooseMerge,review:kind=>reviews[kind],view:kind=>({working:slots[kind].working,remote:slots[kind].remote,issues:slots[kind].issues}),schedule};',context);
 function attempt(transaction){
  return transaction.callback({get(ref){const pending=deferred();transaction.reads.push({ref,...pending});return pending.promise;},
   set(ref,value){transaction.writes.push({ref,value});}});
 }
 function emit(kind,value){
  const subscription=subscriptions.filter(s=>!s.unsubscribed&&s.ref.path.endsWith('/'+kind)).at(-1);
  assert.ok(subscription);subscription.next(snapshot(value));
 }
 return {api:context.__syncTest,login:authListener,map,writes,reads,transactions,subscriptions,attempt,emit,timers,
  status:()=>node('fd-sync-status').textContent};
}

test('same-account downloads still apply and pair both validated stores',async()=>{
 for(const kind of P.slots){
  const h=boot();h.login(user('A'));
  const pending=h.api.download(kind);
  assert.equal(h.reads[0].ref.path,'users/A/formday_sync/'+kind);
  h.reads[0].resolve(snapshot(fixture(kind,'remote-A')));await pending;
  assert.ok(h.map.get(key(kind)));
  assert.equal(h.map.get(prefix+'owner:'+kind),'A');
  assert.equal(JSON.parse(h.map.get(prefix+'A:'+kind)).remoteRevision,'remote-A');
  assert.equal(h.api.view(kind).working,false);
  assert.equal(h.api.view(kind).issues,'');
 }
});
test('a delayed download after logout cannot write records, ownership or an error',async()=>{
 for(const kind of P.slots){
  const h=boot();h.login(user('A'));
  const pending=h.api.download(kind);h.login(null);
  const status=h.status();
  h.reads[0].resolve(snapshot(fixture(kind,'old-A')));await pending;
  assert.equal(h.writes.length,0);
  assert.equal(h.api.view(kind).remote,null);
  assert.equal(h.api.view(kind).issues,'');
  assert.equal(h.status(),status);
 }
});
test('an old-account download cannot apply data or clear the new account busy flag',async()=>{
 for(const kind of P.slots){
  const h=boot();h.login(user('A'));
  const oldRequest=h.api.download(kind);
  h.login(user('B'));const currentRequest=h.api.download(kind);
  assert.equal(h.reads[1].ref.path,'users/B/formday_sync/'+kind);
  h.reads[0].resolve(snapshot(fixture(kind,'old-A')));await oldRequest;
  assert.equal(h.writes.length,0);
  assert.equal(h.api.view(kind).working,true);
  assert.equal(h.api.view(kind).remote,null);
  h.reads[1].resolve(snapshot(fixture(kind,'current-B')));await currentRequest;
  assert.equal(h.map.get(prefix+'owner:'+kind),'B');
  assert.equal(JSON.parse(h.map.get(prefix+'B:'+kind)).remoteRevision,'current-B');
  assert.equal(h.map.has(prefix+'A:'+kind),false);
 }
});
test('relogging the same uid invalidates earlier downloads and subscription callbacks',async()=>{
 const h=boot();h.login(user('A'));
 const oldRequest=h.api.download('calendar');
 const oldSubscription=h.subscriptions.find(s=>s.ref.path.endsWith('/calendar'));
 h.login(null);h.login(user('A'));
 oldSubscription.next(snapshot(calendar('stale-subscription')));
 oldSubscription.error(Error('stale subscription error'));
 h.reads[0].resolve(snapshot(calendar('stale-request')));await oldRequest;
 assert.equal(h.writes.length,0);
 assert.equal(h.api.view('calendar').remote,null);
 assert.equal(h.api.view('calendar').issues,'');
 assert.equal(h.reads.length,1,'old subscription must not start a new download');
});
test('same-account uploads still use the owner path and pair successfully',async()=>{
 for(const kind of P.slots){
  const data=fixture(kind,'local-A'),h=boot({[key(kind)]:JSON.stringify(data)});
  h.login(user('A'));h.emit(kind,null);
  const pending=h.api.upload(kind,true),tx=h.transactions[0];
  const attempt=h.attempt(tx);tx.reads[0].resolve(snapshot(null));await attempt;
  assert.equal(tx.writes.length,1);
  assert.equal(tx.writes[0].ref.path,'users/A/formday_sync/'+kind);
  tx.resolve();await pending;
  assert.equal(h.map.get(prefix+'owner:'+kind),'A');
  assert.equal(JSON.parse(h.map.get(prefix+'A:'+kind)).remoteRevision,'local-A');
  assert.equal(h.api.view(kind).working,false);
  assert.equal(h.api.view(kind).issues,'');
 }
});
test('logout or an account change during a transaction read prevents its write',async()=>{
 for(const replacement of [null,user('B')]){
  const data=calendar('local-A'),h=boot({[C.STORE]:JSON.stringify(data)});
  h.login(user('A'));h.emit('calendar',null);
  const pending=h.api.upload('calendar',true),tx=h.transactions[0];
  const attempt=h.attempt(tx);h.login(replacement);
  tx.reads[0].resolve(snapshot(null));
  let failure;try{await attempt;}catch(e){failure=e;}
  assert.match(failure?.message||'',/계정 연결이 변경/);
  tx.reject(failure);await pending;
  assert.equal(tx.writes.length,0);
  assert.equal(h.writes.length,0);
  assert.equal(h.api.view('calendar').remote,null);
  assert.equal(h.api.view('calendar').issues,'');
 }
});
test('an old upload completion cannot pair records or clear a new download in progress',async()=>{
 const h=boot({[C.STORE]:JSON.stringify(calendar('local-A'))});
 h.login(user('A'));h.emit('calendar',null);
 const oldUpload=h.api.upload('calendar',true),tx=h.transactions[0];
 const attempt=h.attempt(tx);tx.reads[0].resolve(snapshot(null));await attempt;
 h.login(user('B'));const currentDownload=h.api.download('calendar',true);
 tx.resolve();await oldUpload;
 assert.equal(h.writes.length,0);
 assert.equal(h.api.view('calendar').working,true);
 assert.equal(h.api.view('calendar').remote,null);
 assert.equal(h.api.view('calendar').issues,'');
 h.reads[0].resolve(snapshot(calendar('remote-B',75)));await currentDownload;
 assert.equal(h.map.get(prefix+'owner:calendar'),'B');
 assert.equal(JSON.parse(h.map.get(C.STORE)).events[0].detail.weight,75);
});
test('transaction retries after relogin are rejected before reading or writing',async()=>{
 const h=boot({[C.STORE]:JSON.stringify(calendar('local-A'))});
 h.login(user('A'));h.emit('calendar',null);
 const pending=h.api.upload('calendar',true),tx=h.transactions[0];
 h.login(null);h.login(user('A'));
 let failure;try{await h.attempt(tx);}catch(e){failure=e;}
 assert.match(failure?.message||'',/계정 연결이 변경/);
 assert.equal(tx.reads.length,0);assert.equal(tx.writes.length,0);
 tx.reject(failure);await pending;
 assert.equal(h.writes.length,0);
 assert.equal(h.api.view('calendar').issues,'');
});
test('a late rejection does not replace the new account status or synchronization state',async()=>{
 const h=boot();h.login(user('A'));const oldRequest=h.api.download('calendar');
 h.login(user('B'));const currentRequest=h.api.download('calendar');
 const status=h.status();
 h.reads[0].reject(Error('old account network error'));await oldRequest;
 assert.equal(h.status(),status);
 assert.equal(h.api.view('calendar').issues,'');
 assert.equal(h.api.view('calendar').working,true);
 h.reads[1].resolve(snapshot(calendar('remote-B')));await currentRequest;
});

test('explicit conflict merge preserves both originals, checks the remote revision and resumes syncing',async()=>{
 const base=iron('base');
 const l={...I.createRoutine(base,'기기 루틴',[I.newExercise('벤치프레스')]).next,revision:'local2'};
 const r={...I.createRoutine(base,'서버 루틴',[I.newExercise('스쿼트')]).next,revision:'remote2'};
 const h=boot({[I.KEY]:JSON.stringify(l),[prefix+'A:iron']:JSON.stringify({version:1,localRevision:'base',remoteRevision:'base',updatedAt:'2026-11-24T00:00:00Z'})});
 h.login(user('A'));h.emit('iron',r);
 const prep=h.api.prepareMerge('iron');h.reads[0].resolve(snapshot(r));await prep;
 assert.equal(h.api.review('iron').result.next.routines.length,3);
 const apply=h.api.applyMerge('iron'),tx=h.transactions[0];
 const attempt=h.attempt(tx);tx.reads[0].resolve(snapshot(r));await attempt;
 assert.equal(tx.writes.length,1);
 assert.equal(JSON.parse(tx.writes[0].value.payload).routines.length,3);
 const backup=JSON.parse(h.map.get(I.KEY+'_merge_backup_A'));
 assert.deepEqual(backup.local,l);assert.deepEqual(backup.remote,r);
 tx.resolve();await apply;
 assert.equal(JSON.parse(h.map.get(I.KEY)).routines.length,3);
 assert.equal(JSON.parse(h.map.get(prefix+'A:iron')).remoteRevision,tx.writes[0].value.revision);
 assert.equal(h.api.review('iron'),null);
});
test('same content repairs metadata without overwriting local or remote records',async()=>{
 const l=iron('local2'),r={...I.copy(l),revision:'remote2'};
 const h=boot({[I.KEY]:JSON.stringify(l),[prefix+'A:iron']:JSON.stringify({version:1,localRevision:'old',remoteRevision:'old',updatedAt:'2026-11-24T00:00:00Z'})});
 h.login(user('A'));h.emit('iron',r);
 const prep=h.api.prepareMerge('iron');h.reads[0].resolve(snapshot(r));await prep;
 const apply=h.api.applyMerge('iron'),tx=h.transactions[0],attempt=h.attempt(tx);
 tx.reads[0].resolve(snapshot(r));await attempt;assert.equal(tx.writes.length,0);
 tx.resolve();await apply;
 assert.equal(h.map.get(I.KEY),JSON.stringify(l));
 assert.equal(JSON.parse(h.map.get(prefix+'A:iron')).remoteRevision,'remote2');
});
test('changed server after review blocks merge before any overwrite',async()=>{
 const l=iron('local2'),r=iron('remote2'),h=boot({[I.KEY]:JSON.stringify(l)});
 h.login(user('A'));h.emit('iron',r);
 const prep=h.api.prepareMerge('iron');h.reads[0].resolve(snapshot(r));await prep;
 const apply=h.api.applyMerge('iron'),tx=h.transactions[0],attempt=h.attempt(tx);
 tx.reads[0].resolve(snapshot(iron('remote3')));
 let failure;try{await attempt;}catch(e){failure=e;}
 assert.match(failure.message,/서버 기록이 변경/);assert.equal(tx.writes.length,0);
 tx.reject(failure);await apply;
 assert.equal(h.map.get(I.KEY),JSON.stringify(l));
});

test('repeated merge retains earlier recovery pairs and does not overwrite them',async()=>{
 const l=iron('local2'),r=iron('remote2');
 const old={version:1,local:iron('old-local'),remote:iron('old-remote'),localRevision:'old-local',remoteRevision:'old-remote',savedAt:'2026-11-24T00:00:00Z'};
 const h=boot({[I.KEY]:JSON.stringify(l),[I.KEY+'_merge_backup_A']:JSON.stringify(old)});
 h.login(user('A'));h.emit('iron',r);
 const prep=h.api.prepareMerge('iron');h.reads[0].resolve(snapshot(r));await prep;
 const apply=h.api.applyMerge('iron'),tx=h.transactions[0],attempt=h.attempt(tx);
 tx.reads[0].resolve(snapshot(r));await attempt;tx.resolve();await apply;
 const archived=JSON.parse(h.map.get(I.KEY+'_merge_backup_A'));
 assert.deepEqual(archived.local,l);assert.deepEqual(archived.remote,r);
 assert.deepEqual(archived.history,[old]);
});
test('merge rejects a local edit made while awaiting the transaction read',async()=>{
 const l=iron('local2'),r=iron('remote2'),h=boot({[I.KEY]:JSON.stringify(l)});
 h.login(user('A'));h.emit('iron',r);
 const prep=h.api.prepareMerge('iron');h.reads[0].resolve(snapshot(r));await prep;
 const apply=h.api.applyMerge('iron'),tx=h.transactions[0],attempt=h.attempt(tx);
 const changed={...I.copy(l),revision:'local3'};h.map.set(I.KEY,JSON.stringify(changed));
 tx.reads[0].resolve(snapshot(r));
 let failure;try{await attempt;}catch(e){failure=e;}
 assert.match(failure.message,/기기의 기록이 변경/);assert.equal(tx.writes.length,0);tx.reject(failure);await apply;
 assert.equal(h.map.get(I.KEY),JSON.stringify(changed));
});
