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

test("Authenticated MCP client can initialize, list six read-only tools, and call status",async()=>{
 const firebaseIdToken="synthetic-firebase-"+("a".repeat(250));
 const calendarBody={schemaVersion:3,revision:"rev1",events:[],settings:{}};
 const firestore={
  fields:{format:{integerValue:"1"},revision:{stringValue:"rev1"},
   payload:{stringValue:JSON.stringify(calendarBody)}}
 };
 const paths=[];
 const fetchImpl=async(target,opts)=>{
  paths.push(String(target));
  if(String(target).endsWith("/calendar"))
   return {ok:true,status:200,headers:new Headers(),
    text:async()=>JSON.stringify(firestore)};
  if(String(target).endsWith("/iron"))
   return {ok:false,status:404,headers:new Headers()};
  throw Error("Unexpected network access");
 };
 const handle=createProtectedMcpHandler({
  baseUrl,fetchImpl,
  authenticateRequest:async token=>{
   assert.equal(token,"test-oauth-access");
   return {uid:"unitTestUser9",firebaseIdToken};
  },
  verifyFirebaseToken:async token=>{
   assert.equal(token,firebaseIdToken);
   return {uid:"unitTestUser9",token};
  }
 });
 function rpc(method,params,id){
  return new Request(url,{method:"POST",headers:{
   "content-type":"application/json",
   "accept":"application/json, text/event-stream",
   "authorization":"Bearer test-oauth-access",
   "origin":baseUrl
  },body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
 }
 const init=await handle(rpc("initialize",{
  protocolVersion:"2025-06-18",
  capabilities:{},
  clientInfo:{name:"formday-test-client",version:"1.0.0"}
 },1));
 assert.equal(init.status,200,await init.text());
 const toolsResponse=await handle(rpc("tools/list",{},2));
 const toolsText=await toolsResponse.text();
 assert.equal(toolsResponse.status,200,toolsText);
 assert.match(toolsText,/formday_status/);
 assert.match(toolsText,/formday_workouts/);
 assert.match(toolsText,/formday_weight_history/);
 assert.match(toolsText,/formday:read/);
 const statusResponse=await handle(rpc("tools/call",{
  name:"formday_status",arguments:{}
 },3));
 const statusText=await statusResponse.text();
 assert.equal(statusResponse.status,200,statusText);
 assert.match(statusText,/calendar/);
 assert.ok(paths.every(p=>p.startsWith(
  "https://firestore.googleapis.com/v1/projects/healthy-df79f/databases/")));
});
