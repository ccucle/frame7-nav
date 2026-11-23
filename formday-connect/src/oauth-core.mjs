/* FORMDAY Connect OAuth 2.1 core — read scope only.
 * Logic requires an authenticated Firebase identity, durable atomically-consumed
 * code/refresh store, encrypted credential vault, strict ChatGPT CIMD metadata.
 * This module NEVER authorizes an arbitrary model-supplied Firebase UID.
 */
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";

const READ_SCOPE="formday:read";
const RESOURCE_PATH="/mcp";
const CIMD=/^https:\/\/chatgpt\.com\/oauth\/(?:client\.json|[A-Za-z0-9_-]{1,128}\/client\.json)$/;
const CODE_TTL=2*60*1000, FLOW_TTL=5*60*1000,ACCESS_TTL=30*60*1000;
const REFRESH_TTL=30*86400000;
const OPAQUE=/^[A-Za-z0-9_-]{40,128}$/;
const PKCE=/^[A-Za-z0-9_-]{43,128}$/;

function err(message){throw new Error(message);}
function check(ok,message){if(!ok)err(message);}
function secret(){return randomBytes(32).toString("base64url");}
function hash(value){return createHash("sha256").update(value).digest("base64url");}
function equal(a,b){
 if(typeof a!=="string"||typeof b!=="string")return false;
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function str(value,min,max){
 return typeof value==="string"&&value.length>=min&&value.length<=max;
}
function validateOrigin(origin){
 const u=new URL(origin);
 check(u.protocol==="https:"&&u.pathname==="/"&&u.search===""&&u.hash==="","HTTPS origin required");
 return u.origin;
}
function expectedRedirect(clientId,redirect){
 const u=new URL(redirect);
 check(u.protocol==="https:"&&u.hostname==="chatgpt.com"&&!u.port&&!u.search&&!u.hash,
   "Callback must be an exact ChatGPT HTTPS URL");
 if(clientId==="https://chatgpt.com/oauth/client.json")
  check(u.pathname==="/connector_platform_oauth_redirect","Wrong stable ChatGPT callback");
 else{
  const callbackId=clientId.split("/")[4];
  check(u.pathname==="/connector/oauth/"+callbackId,"Wrong callback for ChatGPT client");
 }
}
function validateAuthParams(params,origin){
 check(params?.response_type==="code","Authorization code flow required");
 const clientId=params?.client_id,redirect=params?.redirect_uri;
 check(str(clientId,35,250)&&CIMD.test(clientId),"Unrecognized ChatGPT CIMD client");
 check(str(redirect,25,300),"Missing redirect URI");
 expectedRedirect(clientId,redirect);
 check(params?.code_challenge_method==="S256"&&PKCE.test(params?.code_challenge||""),
   "PKCE S256 required");
 const resource=origin+RESOURCE_PATH;
 check(params?.resource===resource,"Incorrect protected resource");
 const scopes=String(params?.scope||"").split(/\s+/).filter(Boolean);
 check(scopes.includes(READ_SCOPE)&&scopes.length<=2&&
  scopes.every(x=>x===READ_SCOPE||x==="offline_access")&&
  new Set(scopes).size===scopes.length,"Read-only scope required");
 const state=params?.state||"";
 check(str(state,16,512),"CSRF state required");
 return {clientId,redirect,challenge:params.code_challenge,resource,scope:READ_SCOPE,state};
}
function validateId({uid,idToken,refreshToken}){
 check(str(uid,6,128)&&/^[A-Za-z0-9_-]+$/.test(uid),"Invalid Firebase principal");
 check(str(idToken,150,12000)&&str(refreshToken,20,12000),"Missing Firebase credentials");
}
/** Each store method must be durable across process restarts and atomic for take*. */
function checkStore(store){
 check(store?.durable===true,"OAuth requires durable, transactional token storage");
 for(const name of ["putFlow","takeFlow","putCode","getCode","takeCode",
   "putGrant","getGrant","putAccess","getAccess","putRefresh","getRefresh","takeRefresh","updateGrantCredential"]){
  check(typeof store?.[name]==="function","Durable OAuth store missing "+name);
 }
 if(store.volatile===true)err("Volatile token storage is prohibited outside of tests");
}
async function verifyClient(clientId,redirect,fetchImpl){
 let response;
 try{response=await fetchImpl(clientId,{
  method:"GET",headers:{Accept:"application/json"},redirect:"error",
  signal:AbortSignal.timeout(6000)
 });}catch{err("ChatGPT client metadata fetch failed");}
 check(response.ok,"ChatGPT client metadata unavailable");
 const size=Number(response.headers.get("content-length")||0);
 check(size<=7000,"Client metadata too large");
 const data=await response.json();
 check(data?.client_id===clientId&&typeof data.client_name==="string"&&
   Array.isArray(data.redirect_uris)&&data.redirect_uris.includes(redirect),
   "Client metadata does not authorize the redirect URI");
 const methods=data.token_endpoint_auth_methods_supported||
   [data.token_endpoint_auth_method].filter(Boolean);
 check(methods.includes("none"),"Client does not support PKCE public token exchange");
 return true;
}
export function makeOauthMetadata(origin){
 const base=validateOrigin(origin);
 return Object.freeze({
  issuer:base,authorization_endpoint:base+"/oauth/authorize",
  token_endpoint:base+"/oauth/token",
  response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
  code_challenge_methods_supported:["S256"],
  token_endpoint_auth_methods_supported:["none"],
  client_id_metadata_document_supported:true,
  scopes_supported:[READ_SCOPE,"offline_access"],
  authorization_response_iss_parameter_supported:false
 });
}
export function makeProtectedResourceMetadata(origin){
 const base=validateOrigin(origin);
 return Object.freeze({resource:base+RESOURCE_PATH,authorization_servers:[base],
  scopes_supported:[READ_SCOPE],resource_name:"FORMDAY Connect (read-only)"});
}
export function createOAuthCore({
 origin,store,vault,verifyFirebaseIdToken,refreshFirebaseToken,
 now=()=>Date.now(),fetchImpl=fetch
}={}){
 const base=validateOrigin(origin);
 checkStore(store);
 check(typeof vault?.seal==="function"&&typeof vault?.open==="function",
   "Encrypted credential vault missing");
 check(typeof verifyFirebaseIdToken==="function"&&
   typeof refreshFirebaseToken==="function","Firebase verification unavailable");
 async function begin(params){
  const parsed=validateAuthParams(params,base);
  await verifyClient(parsed.clientId,parsed.redirect,fetchImpl);
  const requestId=secret(),csrf=secret();
  await store.putFlow(hash(requestId),{
   ...parsed,csrfHash:hash(csrf),expiresAt:now()+FLOW_TTL
  });
  return {requestId,csrf,expiresAt:now()+FLOW_TTL};
 }
 async function approve({requestId,csrf,idToken,refreshToken,approved}){
  check(approved===true,"Explicit read-only consent required");
  check(OPAQUE.test(requestId||"")&&OPAQUE.test(csrf||""),
    "Invalid authorization session");
  // Atomic take; a repeated approval can never produce a second code.
  const flow=await store.takeFlow(hash(requestId));
  check(flow&&now()<flow.expiresAt&&equal(flow.csrfHash,hash(csrf)),
    "Authorization session expired or CSRF mismatch");
  const verified=await verifyFirebaseIdToken(idToken);
  const fresh=await refreshFirebaseToken(refreshToken);
  const freshVerified=await verifyFirebaseIdToken(fresh.idToken);
  check(verified?.uid===freshVerified?.uid&&verified?.uid===fresh.userId,
    "Firebase refresh token is not owned by the signed-in user");
  validateId({uid:verified.uid,idToken,refreshToken});
  const code=secret(),ciphertext=await vault.seal(fresh.refreshToken||refreshToken);
  await store.putCode(hash(code),{
   clientId:flow.clientId,redirect:flow.redirect,challenge:flow.challenge,
   resource:flow.resource,scope:flow.scope,uid:verified.uid,
   credentialCiphertext:ciphertext,expiresAt:now()+CODE_TTL
  });
  const to=new URL(flow.redirect);
  to.searchParams.set("code",code);
  to.searchParams.set("state",flow.state);
  return {redirectTo:to.href,expiresIn:120};
 }
 async function issue(grant){
  const grantId=secret();
  const access=secret(),refresh=secret();
  const record={id:grantId,uid:grant.uid,clientId:grant.clientId,
   scope:grant.scope,resource:grant.resource,credentialCiphertext:grant.credentialCiphertext,
   expiresAt:now()+REFRESH_TTL};
  await store.putGrant(hash(grantId),record);
  await store.putAccess(hash(access),{grantId:hash(grantId),expiresAt:now()+ACCESS_TTL});
  await store.putRefresh(hash(refresh),{grantId:hash(grantId),expiresAt:now()+REFRESH_TTL});
  return {access_token:access,token_type:"Bearer",expires_in:ACCESS_TTL/1000,
   refresh_token:refresh,scope:READ_SCOPE};
 }
 async function exchangeCode(params){
  check(params?.grant_type==="authorization_code","Wrong grant type");
  const {code,client_id:clientId,redirect_uri:redirect,code_verifier:verifier,
    resource}=params;
  check(OPAQUE.test(code||"")&&PKCE.test(verifier||""),"Invalid code or PKCE verifier");
  check(CIMD.test(clientId||""),"Invalid OAuth client");
  const record=await store.getCode(hash(code));
  check(record&&now()<record.expiresAt,"Authorization code expired or used");
  check(record.clientId===clientId&&record.redirect===redirect&&
    record.resource===resource,"OAuth code client, redirect or audience mismatch");
  const calculated=hash(verifier);
  check(equal(calculated,record.challenge),"PKCE verifier mismatch");
  const consumed=await store.takeCode(hash(code));
  check(consumed&&consumed.uid===record.uid,"Authorization code already used");
  return issue(consumed);
 }
 async function refresh(params){
  check(params?.grant_type==="refresh_token","Wrong grant type");
  const refreshToken=params?.refresh_token,clientId=params?.client_id;
  check(OPAQUE.test(refreshToken||"")&&CIMD.test(clientId||""),
    "Invalid refresh request");
  const key=hash(refreshToken);
  const record=await store.getRefresh(key);
  check(record&&record.expiresAt>now(),"Refresh token expired or used");
  const grant=await store.getGrant(record.grantId);
  check(grant&&grant.expiresAt>now()&&grant.clientId===clientId,
    "Refresh token not valid for this OAuth client");
  // An invalid client must not consume the rightful client's refresh token.
  const consumed=await store.takeRefresh(key);
  check(consumed&&consumed.grantId===record.grantId,
    "Refresh token already used");
  const currentRefresh=await vault.open(grant.credentialCiphertext);
  const latest=await refreshFirebaseToken(currentRefresh);
  const verified=await verifyFirebaseIdToken(latest.idToken);
  check(verified?.uid===grant.uid&&latest.userId===grant.uid,
    "Firebase account changed during renewal");
  const cipher=latest.refreshToken&&latest.refreshToken!==currentRefresh?
    await vault.seal(latest.refreshToken):grant.credentialCiphertext;
  if(cipher!==grant.credentialCiphertext)
   await store.updateGrantCredential(record.grantId,cipher);
  return issue({...grant,credentialCiphertext:cipher});
 }
 async function authenticateBearer(accessToken,expectedResource=base+RESOURCE_PATH){
  check(OPAQUE.test(accessToken||""),"Missing OAuth bearer token");
  const access=await store.getAccess(hash(accessToken));
  check(access&&access.expiresAt>now(),"OAuth access token expired");
  const grant=await store.getGrant(access.grantId);
  check(grant&&grant.expiresAt>now()&&grant.resource===expectedResource&&
    grant.scope===READ_SCOPE,"Insufficient OAuth scope or audience");
  const previousRefresh=await vault.open(grant.credentialCiphertext);
  const current=await refreshFirebaseToken(previousRefresh);
  const verified=await verifyFirebaseIdToken(current.idToken);
  check(verified?.uid===grant.uid&&current.userId===grant.uid,
    "OAuth and Firebase account mismatch");
  if(current.refreshToken&&current.refreshToken!==previousRefresh)
   await store.updateGrantCredential(access.grantId,await vault.seal(current.refreshToken));
  return {uid:grant.uid,firebaseIdToken:current.idToken,scope:READ_SCOPE};
 }
 return Object.freeze({begin,approve,exchangeCode,refresh,authenticateBearer,
  metadata:makeOauthMetadata(base),protectedResource:makeProtectedResourceMetadata(base)});
}
