import test from "node:test";
import assert from "node:assert/strict";
import {createProtectedMcpHandler} from "../src/mcp-gateway.mjs";

const baseUrl="https://formday-connect.example";
const url=baseUrl+"/mcp";
const request=(token=null,origin=null)=>{
 const headers={Accept:"application/json, text/event-stream"};
 if(token)headers.Authorization="Bearer "+token;
 if(origin)headers.Origin=origin;
 return new Request(url,{method:"GET",headers});
};
test("MCP endpoint rejects requests without a bearer token",async()=>{
 const handle=createProtectedMcpHandler({
  authenticateRequest:async()=>{throw Error("should never be called");},
  verifyFirebaseToken:async()=>{throw Error("never");},baseUrl
 });
 const response=await handle(request());
 assert.equal(response.status,401);
 assert.match(response.headers.get("www-authenticate"),/oauth-protected-resource/);
});
test("MCP endpoint rejects cross-origin web requests",async()=>{
 const handle=createProtectedMcpHandler({
  authenticateRequest:async()=>{throw Error("should never be called");},
  verifyFirebaseToken:async()=>{throw Error("never");},baseUrl
 });
 const response=await handle(request("some-valid-looking-token","https://evil.example"));
 assert.equal(response.status,403);
});
test("MCP endpoint rejects bearer tokens that fail authorization verification",async()=>{
 const handle=createProtectedMcpHandler({
  authenticateRequest:async()=>{throw Error("oauth-invalid");},
  verifyFirebaseToken:async()=>{throw Error("never");},baseUrl
 });
 assert.equal((await handle(request("test-token"))).status,401);
});
test("MCP endpoint checks Firebase ID token belongs to OAuth user",async()=>{
 const handle=createProtectedMcpHandler({
  authenticateRequest:async()=>({uid:"legitimateUser99",firebaseIdToken:"some-firebase-token"}),
  verifyFirebaseToken:async()=>({uid:"differentUser45",token:"some-firebase-token"}),
  baseUrl
 });
 const response=await handle(request("test-token"));
 assert.equal(response.status,401);
});
test("Gateway fails closed unless OAuth authorization adapter is installed",()=>{
 assert.throws(()=>createProtectedMcpHandler({baseUrl}),/OAuth/);
 assert.throws(()=>createProtectedMcpHandler({
  baseUrl:"http://insecure.example",authenticateRequest:async()=>{}
 }),/HTTPS/);
});
