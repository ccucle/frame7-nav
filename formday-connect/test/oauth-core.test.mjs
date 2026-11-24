import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {createOAuthCore,makeOauthMetadata,makeProtectedResourceMetadata} from "../src/oauth-core.mjs";
import {createCredentialVault} from "../src/oauth-vault.mjs";

const ORIGIN="https://formday-connect-test.example";
const CLIENT="https://chatgpt.com/oauth/client.json";
const CALLBACK="https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER="a".repeat(60);
const SHA256=value=>createHash("sha256").update(value).digest("base64url");
const TOKEN="firebase-id-alice-"+("z".repeat(230));
const REFRESH="firebase-refresh-alice-"+("n".repeat(100));

function testStore(){
 const maps=Object.fromEntries(["flow","code","grant","access","refresh"].map(x=>[x,new Map()]));
 const put=(name)=>(key,val)=>{maps[name].set(key,val)};
 const get=(name)=>(key)=>maps[name].get(key)||null;
 const take=(name)=>(key)=>{const v=maps[name].get(key)||null;maps[name].delete(key);return v};
 return {
  durable:true,
  putFlow:put("flow"),getFlow:get("flow"),takeFlow:take("flow"),
  putCode:put("code"),getCode:get("code"),takeCode:take("code"),
  putGrant:put("grant"),getGrant:get("grant"),
  putAccess:put("access"),getAccess:get("access"),
  putRefresh:put("refresh"),getRefresh:get("refresh"),takeRefresh:take("refresh"),
  updateGrantCredential:(key,newCipher)=>{
   const previous=maps.grant.get(key);if(!previous)throw Error("unknown grant");
   maps.grant.set(key,{...previous,credentialCiphertext:newCipher});
  }
 };
}
function params(){
 return {response_type:"code",client_id:CLIENT,redirect_uri:CALLBACK,
  code_challenge_method:"S256",code_challenge:SHA256(VERIFIER),
  resource:ORIGIN+"/mcp",scope:"formday:read",
  state:"state-of-chatgpt-long-enough"};
}
function fixture(enableAppend=false){
 let now=Date.now();
 const oauth=createOAuthCore({
  origin:ORIGIN,store:testStore(),enableAppend,
  vault:createCredentialVault(randomBytes(32).toString("base64url")),
  verifyFirebaseIdToken:async value=>{
   if(!value.startsWith("firebase-id-alice-"))throw Error("not alice");
   return {uid:"firebaseAlice123"};
  },
  refreshFirebaseToken:async value=>{
   if(!value.startsWith("firebase-refresh-alice-"))throw Error("not owned");
   return {idToken:TOKEN,userId:"firebaseAlice123",refreshToken:value};
  },
  now:()=>now,
  fetchImpl:async url=>{
   assert.equal(url,CLIENT);
   return {ok:true,headers:{get:()=>null},json:async()=>({
    client_id:CLIENT,client_name:"ChatGPT",
    redirect_uris:[CALLBACK],
    token_endpoint_auth_methods_supported:["none"]
   })};
  }
 });
 return {oauth,shift:ms=>{now+=ms}};
}
async function authorize(oauth,scope='formday:read'){
 const began=await oauth.begin({...params(),scope});
 const result=await oauth.approve({
  requestId:began.requestId,csrf:began.csrf,
  idToken:TOKEN,refreshToken:REFRESH,approved:true
 });
 const callback=new URL(result.redirectTo);
 assert.equal(callback.origin,"https://chatgpt.com");
 assert.equal(callback.searchParams.get("state"),params().state);
 return callback.searchParams.get("code");
}
test("metadata advertises PKCE S256, CIMD and correct audience",()=>{
 const m=makeOauthMetadata(ORIGIN),r=makeProtectedResourceMetadata(ORIGIN);
 assert.deepEqual(m.code_challenge_methods_supported,["S256"]);
 assert.equal(m.client_id_metadata_document_supported,true);
 assert.deepEqual(m.token_endpoint_auth_methods_supported,["none"]);
 assert.deepEqual(r.authorization_servers,[ORIGIN]);
 assert.equal(r.resource,ORIGIN+"/mcp");
});
test('append requires explicit feature flag and fresh scoped consent; scope survives refresh',async()=>{
 const scope='formday:read formday:append';
 await assert.rejects(fixture().oauth.begin({...params(),scope}));
 const {oauth}=fixture(true),flow=await oauth.begin({...params(),scope});
 assert.equal((await oauth.inspectConsent(flow)).scope,scope);
 await assert.rejects(oauth.inspectConsent({...flow,csrf:'x'.repeat(43)}),/CSRF/);
 assert.ok(oauth.metadata.scopes_supported.includes('formday:append'));
 const code=await authorize(oauth,scope);
 const tokens=await oauth.exchangeCode({grant_type:'authorization_code',code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+'/mcp',code_verifier:VERIFIER});
 assert.equal(tokens.scope,scope);assert.equal((await oauth.authenticateBearer(tokens.access_token)).scope,scope);
 const renewed=await oauth.refresh({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:CLIENT});
 assert.equal(renewed.scope,scope);assert.equal((await oauth.authenticateBearer(renewed.access_token)).scope,scope);
});
test('enabling append never upgrades a read-only grant',async()=>{
 const {oauth}=fixture(true),code=await authorize(oauth);
 const tokens=await oauth.exchangeCode({grant_type:'authorization_code',code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+'/mcp',code_verifier:VERIFIER});
 await assert.rejects(oauth.refresh({grant_type:'refresh_token',refresh_token:tokens.refresh_token,
  client_id:CLIENT,scope:'formday:read formday:append'}),/scope mismatch/);
 assert.equal((await oauth.authenticateBearer(tokens.access_token)).scope,'formday:read');
});
test("auth code -> user-bound read-only bearer -> refresh",async()=>{
 const {oauth}=fixture();const code=await authorize(oauth);
 const result=await oauth.exchangeCode({
  grant_type:"authorization_code",code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+"/mcp",code_verifier:VERIFIER
 });
 assert.equal(result.scope,"formday:read");
 const authenticated=await oauth.authenticateBearer(result.access_token);
 assert.equal(authenticated.uid,"firebaseAlice123");
 assert.equal(authenticated.firebaseIdToken,TOKEN);
 const next=await oauth.refresh({
  grant_type:"refresh_token",refresh_token:result.refresh_token,client_id:CLIENT
 });
 assert.ok(next.access_token!==result.access_token);
 await assert.rejects(oauth.refresh({
  grant_type:"refresh_token",refresh_token:result.refresh_token,client_id:CLIENT
 }));
});
test("wrong OAuth client cannot invalidate the legitimate refresh token",async()=>{
 const {oauth}=fixture();
 const code=await authorize(oauth);
 const tokens=await oauth.exchangeCode({
  grant_type:"authorization_code",code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+"/mcp",code_verifier:VERIFIER
 });
 await assert.rejects(oauth.refresh({
  grant_type:"refresh_token",refresh_token:tokens.refresh_token,
  client_id:"https://chatgpt.com/oauth/other-client/client.json"
 }),/not valid for this OAuth client/);
 const renewed=await oauth.refresh({
  grant_type:"refresh_token",refresh_token:tokens.refresh_token,client_id:CLIENT
 });
 assert.ok(renewed.access_token);
});

test("authorization code cannot be exchanged twice",async()=>{
 const {oauth}=fixture();const code=await authorize(oauth);
 const input={grant_type:"authorization_code",code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+"/mcp",code_verifier:VERIFIER};
 await oauth.exchangeCode(input);
 await assert.rejects(oauth.exchangeCode(input),/expired or used/);
});
test("incorrect PKCE, client audience, or callback never yields a token",async()=>{
 const {oauth}=fixture();const code=await authorize(oauth);
 const base={grant_type:"authorization_code",code,client_id:CLIENT,
  redirect_uri:CALLBACK,resource:ORIGIN+"/mcp",code_verifier:VERIFIER};
 await assert.rejects(oauth.exchangeCode({...base,code_verifier:"z".repeat(60)}));
 await assert.rejects(oauth.exchangeCode({...base,resource:"https://evil.example/mcp"}));
 await assert.rejects(oauth.exchangeCode({...base,redirect_uri:"https://evil.example/callback"}));
});
test("explicit consent and same CSRF session are required",async()=>{
 const {oauth}=fixture();
 const begun=await oauth.begin(params());
 await assert.rejects(oauth.approve({
  ...begun,idToken:TOKEN,refreshToken:REFRESH,approved:false
 }),/consent/);
 await assert.rejects(oauth.approve({
  ...begun,csrf:"x".repeat(43),idToken:TOKEN,
  refreshToken:REFRESH,approved:true
 }),/CSRF/);
});
test("read-only scope, resource, and callbacks are strictly bound",async()=>{
 const {oauth}=fixture();
 await assert.rejects(oauth.begin({...params(),scope:"formday:write"}));
 await assert.rejects(oauth.begin({...params(),resource:"https://evil.example/mcp"}));
 await assert.rejects(oauth.begin({...params(),redirect_uri:"https://evil.example"}));
});
test("vault encrypts user refresh credentials and rejects tampering",async()=>{
 const vault=createCredentialVault(randomBytes(32).toString("base64url"));
 const enc=await vault.seal(REFRESH);
 assert.ok(!enc.includes(REFRESH));
 assert.equal(await vault.open(enc),REFRESH);
 const parts=enc.split(".");
 parts[3]=(parts[3][0]==="A"?"B":"A")+parts[3].slice(1);
 await assert.rejects(vault.open(parts.join(".")));
});
test("no volatile OAuth token storage and no insecure origin",()=>{
 const {oauth}=fixture();
 assert.ok(oauth);
 assert.throws(()=>createOAuthCore({origin:"http://local.example"}),/HTTPS/);
});

test('refresh rejects a different resource before consuming the token',async()=>{
 const {oauth}=fixture();
 const code=await authorize(oauth);
 const tokens=await oauth.exchangeCode({grant_type:'authorization_code',code,
  client_id:CLIENT,redirect_uri:CALLBACK,resource:ORIGIN+'/mcp',code_verifier:VERIFIER});
 await assert.rejects(oauth.refresh({grant_type:'refresh_token',refresh_token:tokens.refresh_token,
  client_id:CLIENT,resource:'https://other.example/mcp'}));
 assert.ok((await oauth.refresh({grant_type:'refresh_token',refresh_token:tokens.refresh_token,
  client_id:CLIENT,resource:ORIGIN+'/mcp'})).access_token);
});

test('refresh cannot request write scope',async()=>{
 const {oauth}=fixture();const code=await authorize(oauth);
 const tokens=await oauth.exchangeCode({grant_type:'authorization_code',code,
  client_id:CLIENT,redirect_uri:CALLBACK,resource:ORIGIN+'/mcp',code_verifier:VERIFIER});
 await assert.rejects(oauth.refresh({grant_type:'refresh_token',refresh_token:tokens.refresh_token,
  client_id:CLIENT,scope:'formday:write'}));
});
