/* FORMDAY Connect integration: owner-only Google OAuth + MCP.
 * This is a factory, NOT a public server entry point. Must inject a durable
 * atomic OAuth store and valid HTTPS origin before it can run.
 */
import {createFirebaseVerifier} from "./firebase-rest.mjs";
import {createFirebaseRefresh} from "./firebase-refresh.mjs";
import {createCredentialVault} from "./oauth-vault.mjs";
import {createOAuthCore} from "./oauth-core.mjs";
import {createOauthHttpRoutes} from "./oauth-http.mjs";
import {createProtectedMcpHandler} from "./mcp-gateway.mjs";
import {createPreviewCodec} from './append.mjs';

export function createFormdayRuntime({
 origin,oauthStore,oauthEncryptionKey,firebaseApiKey,consentScript,
 fetchImpl=fetch,clock=()=>Date.now(),enableAppend=false
}={}){
 if(typeof origin!=="string"||!origin.startsWith("https://"))
  throw Error("FORMDAY OAuth HTTPS origin must be configured");
 if(!oauthStore||oauthStore.durable!==true)
  throw Error("FORMDAY OAuth requires an actual durable transactional store");
 const vault=createCredentialVault(oauthEncryptionKey);
 const verify=createFirebaseVerifier({fetchImpl,clock});
 const refresh=createFirebaseRefresh({apiKey:firebaseApiKey,fetchImpl});
 const core=createOAuthCore({
  origin,store:oauthStore,vault,verifyFirebaseIdToken:verify,
  refreshFirebaseToken:refresh,now:clock,fetchImpl,enableAppend
 });
 const oauthRoutes=createOauthHttpRoutes({core,origin,consentScript});
 const mcp=createProtectedMcpHandler({
  baseUrl:origin,fetchImpl,enableAppend,clock,
  previewCodec:enableAppend===true?createPreviewCodec(oauthEncryptionKey):null,
  authenticateRequest:async token=>core.authenticateBearer(token,origin+"/mcp"),
  verifyFirebaseToken:verify
 });
 return Object.freeze({
  async fetch(request){
   const url=new URL(request.url);
   if(url.origin!==new URL(origin).origin)
    return new Response("invalid host",{status:403});
   if(url.pathname==="/mcp")return mcp(request);
   return oauthRoutes(request);
  }
 });
}
