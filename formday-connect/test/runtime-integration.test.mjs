import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {createFormdayRuntime} from '../src/server-runtime.mjs';
import {createFirestoreOAuthStore} from '../src/oauth-firestore-store.mjs';
import {createFormdayHttpServer} from '../src/node-http.mjs';
import {FIREBASE_CERTS_URL} from '../src/firebase-rest.mjs';

const origin='https://formday-integration.example';
const client='https://chatgpt.com/oauth/test-callback/client.json';
const redirect='https://chatgpt.com/connector/oauth/test-callback';
const verifier='a'.repeat(50)+'.~_-';
const uid='syntheticUser123';
const firebaseRefresh='synthetic-firebase-refresh-credential';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});

// In-memory transactional double ONLY for this test. This is not a live
// Firestore integration, a security-rules test, or proof of durable storage.
function databaseDouble(){
 const docs=new Map();let queue=Promise.resolve();
 const snapshot=path=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 return {
  collection(name){
   assert.equal(name,'formday_connect_oauth');
   return {doc:key=>({path:key,async create(record){
    assert.ok(!docs.has(key));docs.set(key,structuredClone(record));
   },async get(){return snapshot(key);}})};
  },
  runTransaction(fn){
   const run=queue.then(async()=>{
    const changes=[];
    const result=await fn({get:async ref=>snapshot(ref.path),
     delete:ref=>changes.push(()=>docs.delete(ref.path)),
     update:(ref,patch)=>changes.push(()=>docs.set(ref.path,{...docs.get(ref.path),...patch}))});
    changes.forEach(change=>change());return result;
   });
   queue=run.catch(()=>{});return run;
  }
 };
}
async function fixture(t,enableAppend=false){
 let now=Date.parse('2026-11-24T01:00:00Z');
 let refreshedUid=uid;
 const calls=[];
 function token(user=uid){
  const seconds=Math.floor(now/1000);
  const body={iss:'https://securetoken.google.com/healthy-df79f',aud:'healthy-df79f',
   sub:user,iat:seconds-10,auth_time:seconds-60,exp:seconds+3600};
  const data=[{alg:'RS256',kid:'synthetic-key'},body].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
 }
 const calendar={schemaVersion:3,revision:'c1',events:[
  {id:'meal1',date:'2026-11-23',type:'meal',title:'아침',completed:true,detail:{items:[{food:{name:'달걀'},grams:60}]}},
  {id:'weight1',date:'2026-11-23',type:'weight',title:'체중',completed:true,detail:{weight:82.4}},
  {id:'plan1',date:'2026-11-24',type:'workout',title:'상체 운동',completed:false},
  {id:'sample1',date:'2026-11-23',type:'meal',title:'sample',isSample:true,completed:true}
 ]};
 const iron={version:1,revision:'i1',programs:[],routines:[{id:'r1',name:'상체',exercises:[]}],
  sessions:[{id:'s1',date:'2026-11-23',label:'벤치프레스',status:'COMPLETED',exercises:[{name:'벤치프레스',sets:[
   {weight:60,reps:10,done:true,warmup:false},{weight:20,reps:15,done:true,warmup:true}]}]}]};
 const fetchImpl=async(target,options={})=>{
  const url=String(target);calls.push({url,method:options.method});
  if(url===client)return Response.json({client_id:client,client_name:'ChatGPT',redirect_uris:[redirect],token_endpoint_auth_method:'none'});
  if(url===FIREBASE_CERTS_URL)return Response.json({'synthetic-key':publicKey.export({type:'spki',format:'pem'})});
  if(url.startsWith('https://securetoken.googleapis.com/v1/token?')){
   assert.equal(options.method,'POST');
   assert.equal(new URLSearchParams(options.body).get('refresh_token'),firebaseRefresh);
   return Response.json({id_token:token(refreshedUid),refresh_token:firebaseRefresh,user_id:refreshedUid,project_id:'188014722362'});
  }
  const prefix='https://firestore.googleapis.com/v1/projects/healthy-df79f/databases/(default)/documents/users/'+uid+'/formday_sync/';
  assert.ok(url.startsWith(prefix),'Unexpected outbound request');
  assert.equal(options.method,'GET');
  assert.match(options.headers.Authorization,/^Bearer ey/);
  const kind=url.slice(prefix.length);assert.ok(['calendar','iron'].includes(kind));
  const data=kind==='calendar'?calendar:iron;
  return Response.json({fields:{format:{integerValue:'1'},revision:{stringValue:data.revision},payload:{stringValue:JSON.stringify(data)}}});
 };
 const app=createFormdayRuntime({origin,enableAppend,oauthStore:createFirestoreOAuthStore(databaseDouble()),
  oauthEncryptionKey:randomBytes(32).toString('base64url'),firebaseApiKey:'synthetic-public-api-key',
  consentScript:'// synthetic script; no Google browser login occurs in this test.\n'.repeat(3),fetchImpl,clock:()=>now});
 const server=createFormdayHttpServer({origin,app});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 async function send(path,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
   const request=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,
    headers:{host:new URL(origin).host,...headers}},response=>{
     const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({
      status:response.statusCode,headers:response.headers,text:Buffer.concat(chunks).toString()}));
    });
   request.on('error',reject);request.end(body);
  });
 }
 async function login(scope='formday:read offline_access'){
  const query=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect,
   code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),
   scope,resource:origin+'/mcp',state:'synthetic-chatgpt-state'});
  const started=await send('/oauth/authorize?'+query);assert.equal(started.status,303,started.text);
  const cookies=started.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');
  const consent=await send('/oauth/consent',{headers:{cookie:cookies}});
  assert.equal(consent.status,200);
  if(scope.includes('formday:append'))assert.match(consent.text,/루틴 일정·프로그램·식단을 추가/);
  const csrf=/name="fd-oauth-csrf" content="([^"]+)"/.exec(consent.text)[1];
  const approved=await send('/oauth/complete',{method:'POST',headers:{origin,cookie:cookies,'content-type':'application/json'},
   body:JSON.stringify({csrf,idToken:token(),refreshToken:firebaseRefresh,approved:true})});
  assert.equal(approved.status,200,approved.text);
  assert.ok(!approved.text.includes(firebaseRefresh));
  const callback=new URL(JSON.parse(approved.text).redirectTo);
  assert.equal(callback.origin+callback.pathname,redirect);
  assert.equal(callback.searchParams.get('state'),'synthetic-chatgpt-state');
  const body=new URLSearchParams({grant_type:'authorization_code',code:callback.searchParams.get('code'),
   client_id:client,redirect_uri:redirect,code_verifier:verifier,resource:origin+'/mcp'}).toString();
  const exchange=await send('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  assert.equal(exchange.status,200,exchange.text);
  return {tokens:JSON.parse(exchange.text),exchangeBody:body};
 }
 const rpc=(access,method,params={},id=1)=>send('/mcp',{method:'POST',headers:{
  authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},
  body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
 return {send,login,rpc,calls,shift:ms=>{now+=ms;},changeUser:()=>{refreshedUid='otherSyntheticUser';}};
}
function rpcJson(response){
 assert.equal(response.status,200,response.text);
 if(response.text.startsWith('{'))return JSON.parse(response.text);
 const line=response.text.split('\n').find(x=>x.startsWith('data: '));
 assert.ok(line,response.text);return JSON.parse(line.slice(6));
}
test('loopback HTTP OAuth with signed synthetic Firebase tokens reads all four data domains via actual MCP',async t=>{
 const f=await fixture(t);
 const metadata=await f.send('/.well-known/oauth-protected-resource');
 assert.equal(JSON.parse(metadata.text).resource,origin+'/mcp');
 assert.equal((await f.send('/mcp')).status,401);
 const {tokens,exchangeBody}=await f.login();
 assert.equal((await f.send('/oauth/token',{method:'POST',body:exchangeBody})).status,400);
 rpcJson(await f.rpc(tokens.access_token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'integration',version:'1'}}));
 const listed=rpcJson(await f.rpc(tokens.access_token,'tools/list')).result.tools;
 assert.equal(listed.length,6);assert.ok(listed.every(x=>x.annotations.readOnlyHint));
 const results={};
 for(const name of listed.map(x=>x.name)){
  const args=['formday_status','formday_routines'].includes(name)?{}:{from:'2026-11-22',to:'2026-11-24'};
  const result=rpcJson(await f.rpc(tokens.access_token,'tools/call',{name,arguments:args})).result;
  assert.ok(!result.isError,JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes(firebaseRefresh));
  results[name]=JSON.parse(result.content[0].text);
 }
 assert.equal(results.formday_workouts.records[0].totalVolumeKg,600);
 assert.equal(results.formday_meals.records[0].items[0].name,'달걀');
 assert.equal(results.formday_meals.total,1);
 assert.equal(results.formday_weight_history.records[0].kilograms,82.4);
 assert.ok(results.formday_calendar.records.some(x=>x.id==='plan1'));
 assert.ok(f.calls.filter(x=>x.url.includes('firestore.googleapis.com')).every(x=>x.method==='GET'));
 const denied=rpcJson(await f.rpc(tokens.access_token,'tools/call',{name:'formday_delete',arguments:{}}));
 assert.ok(denied.error||denied.result?.isError);
 f.changeUser();assert.equal((await f.rpc(tokens.access_token,'tools/list')).status,401);
});
test('loopback HTTP rejects expired bearer, rotates refresh, rejects reuse and foreign host',async t=>{
 const f=await fixture(t);const {tokens}=await f.login();
 f.shift(31*60*1000);
 assert.equal((await f.rpc(tokens.access_token,'tools/list')).status,401);
 const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client,resource:origin+'/mcp'}).toString();
 const next=await f.send('/oauth/token',{method:'POST',body});assert.equal(next.status,200,next.text);
 rpcJson(await f.rpc(JSON.parse(next.text).access_token,'tools/list'));
 assert.equal((await f.send('/oauth/token',{method:'POST',body})).status,400);
 assert.equal((await f.send('/health',{headers:{host:'untrusted.example'}})).status,403);
 assert.equal((await f.send('//untrusted.example/health')).status,403);
 assert.equal((await f.send('/oauth/token',{method:'POST',body:'x'.repeat(70000)})).status,413);
});

test('loopback OAuth append consent reaches the protected MCP runtime without upgrading read grants',async t=>{
 const f=await fixture(t,true);
 const read=await f.login();
 assert.equal(rpcJson(await f.rpc(read.tokens.access_token,'tools/list')).result.tools.length,6);
 const write=await f.login('formday:read formday:append offline_access');
 assert.equal(write.tokens.scope,'formday:read formday:append');
 assert.equal(rpcJson(await f.rpc(write.tokens.access_token,'tools/list')).result.tools.length,10);
 assert.equal(rpcJson(await f.rpc(read.tokens.access_token,'tools/list')).result.tools.length,6);
});
