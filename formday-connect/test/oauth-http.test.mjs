import test from "node:test";
import assert from "node:assert/strict";
import {createOauthHttpRoutes} from "../src/oauth-http.mjs";
const base="https://formday.example";
const secret="x".repeat(43),csrf="z".repeat(43);
const identityHeader=secret+"; Path=/oauth";
function fakeCore(){
 let approved=0,issued=0;
 return {
  metadata:{issuer:base,code_challenge_methods_supported:["S256"]},
  protectedResource:{resource:base+"/mcp",authorization_servers:[base]},
  begin:async()=>({requestId:secret,csrf}),
  inspectConsent:async()=>({scope:'formday:read'}),
  approve:async value=>{assert.equal(value.csrf,csrf);approved++;return {
   redirectTo:"https://chatgpt.com/connector_platform_oauth_redirect?code=TEST&state=STATE"};},
  exchangeCode:async()=>{issued++;return {access_token:"fake",token_type:"Bearer"};},
  refresh:async()=>({access_token:"renewed",token_type:"Bearer"}),
  counts:()=>({approved,issued})
 };
}
const req=(path,options={})=>new Request(base+path,options);
test('consent wording comes from stored flow; expired flows cannot display an approval page',async()=>{
 const core=fakeCore();core.inspectConsent=async()=>({scope:'formday:read formday:append'});
 const handle=createOauthHttpRoutes({core,origin:base,consentScript:'a'.repeat(200)});
 const headers={cookie:'fd_oauth_flow='+secret+'; fd_oauth_csrf='+csrf};
 const html=await (await handle(req('/oauth/consent?scope=formday:read',{headers}))).text();
 assert.match(html,/루틴 일정·프로그램·식단을 추가/);assert.doesNotMatch(html,/읽기만/);
 core.inspectConsent=async()=>{throw Error('expired');};
 assert.equal((await handle(req('/oauth/consent',{headers}))).status,401);
});
test("OAuth discovery metadata is readable without private records",async()=>{
 const core=fakeCore(),handle=createOauthHttpRoutes({core,origin:base,consentScript:"a".repeat(200)});
 const a=await handle(req("/.well-known/oauth-authorization-server"));
 const b=await handle(req("/.well-known/oauth-protected-resource"));
 assert.equal(a.status,200);assert.equal((await a.json()).issuer,base);
 assert.equal((await b.json()).resource,base+"/mcp");
});
test("authorize sets secure SameSite HttpOnly cookies and redirects to consent",async()=>{
 const core=fakeCore(),handle=createOauthHttpRoutes({core,origin:base,consentScript:"a".repeat(200)});
 const response=await handle(req("/oauth/authorize?test=1"));
 assert.equal(response.status,303);
 assert.equal(response.headers.get("location"),"/oauth/consent");
 const cookies=response.headers.getSetCookie();
 assert.equal(cookies.length,2);
 for(const cookie of cookies){
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
  assert.match(cookie,/Secure/);
 }
});
test("consent cannot be approved without valid cookie, origin, and CSRF",async()=>{
 const core=fakeCore(),handle=createOauthHttpRoutes({core,origin:base,consentScript:"a".repeat(200)});
 const url="/oauth/complete";
 const body=JSON.stringify({csrf,idToken:"token",refreshToken:"refresh",approved:true});
 const plain=await handle(req(url,{method:"POST",body,
  headers:{"content-type":"application/json","origin":base}}));
 assert.equal(plain.status,401);
 const cookie="fd_oauth_flow="+secret+"; fd_oauth_csrf="+csrf;
 const foreign=await handle(req(url,{method:"POST",body,
  headers:{"cookie":cookie,"origin":"https://evil.example"}}));
 assert.equal(foreign.status,403);
 const invalid=await handle(req(url,{method:"POST",
  body:JSON.stringify({csrf:"bad",approved:true}),
  headers:{"cookie":cookie,"origin":base}}));
 assert.equal(invalid.status,403);
 assert.equal(core.counts().approved,0);
});
test("authorized user consent returns ChatGPT redirect without token leaks",async()=>{
 const core=fakeCore(),handle=createOauthHttpRoutes({core,origin:base,consentScript:"a".repeat(200)});
 const cookie="fd_oauth_flow="+secret+"; fd_oauth_csrf="+csrf;
 const response=await handle(req("/oauth/complete",{method:"POST",
  headers:{"origin":base,"cookie":cookie,"content-type":"application/json"},
  body:JSON.stringify({csrf,idToken:"token",refreshToken:"refresh",approved:true})
 }));
 assert.equal(response.status,200);
 assert.ok((await response.json()).redirectTo.startsWith("https://chatgpt.com/"));
 assert.equal(core.counts().approved,1);
});
test("token endpoint delegates code exchange and hides errors",async()=>{
 const core=fakeCore(),handle=createOauthHttpRoutes({core,origin:base,consentScript:"a".repeat(200)});
 const response=await handle(req("/oauth/token",{method:"POST",
  body:new URLSearchParams({grant_type:"authorization_code",code:"test"}),
  headers:{"content-type":"application/x-www-form-urlencoded"}
 }));
 assert.equal(response.status,200);
 assert.equal((await response.json()).token_type,"Bearer");
 assert.equal(core.counts().issued,1);
});

test('consent CSP permits only the configured Firebase auth iframe',async()=>{
 const handle=createOauthHttpRoutes({core:fakeCore(),origin:base,consentScript:'a'.repeat(200)});
 const result=await handle(req('/oauth/consent',{headers:{cookie:'fd_oauth_flow='+secret+'; fd_oauth_csrf='+csrf}}));
 assert.match(result.headers.get('content-security-policy'),/frame-src https:\/\/healthy-df79f\.firebaseapp\.com/);
});

test('authorization and consent failures never expose internal exception text',async()=>{
 const core=fakeCore();
 core.begin=core.approve=async()=>{throw Error('PRIVATE_CREDENTIAL_SENTINEL');};
 const handle=createOauthHttpRoutes({core,origin:base,consentScript:'a'.repeat(200)});
 const begin=await handle(req('/oauth/authorize'));
 assert.doesNotMatch(await begin.text(),/PRIVATE_CREDENTIAL/);
 const complete=await handle(req('/oauth/complete',{method:'POST',headers:{origin:base,
  cookie:'fd_oauth_flow='+secret+'; fd_oauth_csrf='+csrf},body:JSON.stringify({csrf,approved:true})}));
 assert.doesNotMatch(await complete.text(),/PRIVATE_CREDENTIAL/);
});
