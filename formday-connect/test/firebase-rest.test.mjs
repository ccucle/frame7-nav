import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createSign} from "node:crypto";
import {createFirebaseVerifier,createUserScopedFirestoreReader,FIREBASE_PROJECT}
  from "../src/firebase-rest.mjs";

const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const certMap={"dev-key":publicKey.export({type:"spki",format:"pem"})};
const now=Date.now();
const unix=Math.floor(now/1000);
function jwt(overrides={}){
 const header={alg:"RS256",kid:"dev-key"};
 const body={iss:"https://securetoken.google.com/"+FIREBASE_PROJECT,
  aud:FIREBASE_PROJECT,sub:"u1234567",iat:unix-10,exp:unix+3600,auth_time:unix-120,
  email:"example@gmail.com",...overrides};
 const content=Buffer.from(JSON.stringify(header)).toString("base64url")+"."+
  Buffer.from(JSON.stringify(body)).toString("base64url");
 const signer=createSign("RSA-SHA256");signer.update(content);signer.end();
 return content+"."+signer.sign(privateKey).toString("base64url");
}
const verifier=()=>createFirebaseVerifier({clock:()=>now,certificates:async()=>certMap});
test("valid Firebase RS256 token binds verified uid and project",async()=>{
 const result=await verifier()(jwt());
 assert.equal(result.uid,"u1234567");
 assert.equal(result.email,"example@gmail.com");
});
test("unverified or expired Firebase tokens are refused",async()=>{
 await assert.rejects(verifier()(jwt({aud:"another-project"})));
 await assert.rejects(verifier()(jwt({iss:"https://securetoken.google.com/another-project"})));
 await assert.rejects(verifier()(jwt({exp:unix-100})));
 await assert.rejects(verifier()(jwt({auth_time:unix+1000})));
 await assert.rejects(verifier()(jwt({sub:"../../admin"})));
});
test("altering JWT payload without resigning is rejected",async()=>{
 const source=jwt().split(".");
 const tampered=JSON.parse(Buffer.from(source[1],"base64url").toString());
 tampered.sub="anotherUser";
 const token=source[0]+"."+Buffer.from(JSON.stringify(tampered)).toString("base64url")+"."+source[2];
 await assert.rejects(verifier()(token),/서명/);
});
test("Firestore only sees two documents under verified principal",async()=>{
 const calls=[];
 const token=jwt();
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  return {status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({
   fields:{format:{integerValue:"1"},revision:{stringValue:"r1"},payload:{stringValue:"{}"}}
  })};
 };
 const reader=createUserScopedFirestoreReader({
  principal:{uid:"u1234567",token},fetchImpl
 });
 const result=await reader("users/u1234567/formday_sync/calendar");
 assert.equal(result.revision,"r1");
 assert.equal(calls[0].options.method,"GET");
 assert.equal(calls[0].options.headers.Authorization,"Bearer "+token);
 assert.equal(calls.length,1);
 await assert.rejects(reader("users/anotherUser/formday_sync/calendar"));
 await assert.rejects(reader("users/u1234567/formday_sync/other"));
 await assert.rejects(reader("users/u1234567/formday_sync/calendar?mask=*"));
 assert.equal(calls.length,1);
});
test("Firestore 404 is an absent document; 403 is authorization failure",async()=>{
 const principal={uid:"u1234567",token:jwt()};
 const absent=createUserScopedFirestoreReader({
  principal,fetchImpl:async()=>({status:404,ok:false,headers:{get:()=>null}})
 });
 assert.equal(await absent("users/u1234567/formday_sync/iron"),null);
 const denied=createUserScopedFirestoreReader({
  principal,fetchImpl:async()=>({status:403,ok:false,headers:{get:()=>null}})
 });
 await assert.rejects(denied("users/u1234567/formday_sync/iron"),/권한/);
});
