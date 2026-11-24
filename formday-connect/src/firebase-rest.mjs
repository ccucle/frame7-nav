/**
 * FORMDAY Connect: security-rules-aware Firestore REST reader.
 *
 * Unlike the Firebase Admin SDK, requests using verified Firebase Authentication
 * ID tokens are checked by the existing per-user Cloud Firestore Security Rules.
 *
 * This is a SERVER-SIDE module. Never accept uid/document path from tool input.
 * The OAuth server must authenticate a session and supply the Firebase ID token.
 */
import {createPublicKey,createVerify} from "node:crypto";

export const FIREBASE_PROJECT="healthy-df79f";
export const FIREBASE_CERTS_URL=
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const MAX_ID_TOKEN_SIZE=12000;
const MAX_FIRESTORE_RESPONSE=750000;
const UID_PATTERN=/^[A-Za-z0-9_-]{6,128}$/;
const FIRESTORE_BASE=
  "https://firestore.googleapis.com/v1/projects/healthy-df79f/databases/(default)/documents";
const allowedKinds=new Set(["calendar","iron"]);

function fail(message){throw new Error(message);}
function decode(value){
 try{return JSON.parse(Buffer.from(value,"base64url").toString("utf8"));}
 catch{fail("Firebase 인증 토큰 형식이 유효하지 않습니다.");}
}
function tokenParts(token){
 if(typeof token!=="string"||token.length>MAX_ID_TOKEN_SIZE||token.length<150)
  fail("Firebase 인증 토큰이 없거나 크기가 올바르지 않습니다.");
 const pieces=token.split(".");
 if(pieces.length!==3||!pieces.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))
  fail("Firebase 인증 토큰 형식이 올바르지 않습니다.");
 return {header:decode(pieces[0]),body:decode(pieces[1]),payload:pieces[0]+"."+pieces[1],
  signature:Buffer.from(pieces[2],"base64url")};
}
function certificateCache(fetchImpl){
 let cache=null,expiry=0;
 return async function certs(){
  if(cache&&Date.now()<expiry)return cache;
  const response=await fetchImpl(FIREBASE_CERTS_URL,{
   method:"GET",headers:{Accept:"application/json"},redirect:"error",
   signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)fail("Firebase 공개 인증키를 검증할 수 없습니다.");
  const body=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).length>30)fail("Firebase 인증키 응답이 올바르지 않습니다.");
  const maxAge=/max-age=(\d+)/i.exec(response.headers.get("cache-control")||"");
  const seconds=Math.max(60,Math.min(3600,Number(maxAge?.[1]||300)));
  cache=body;expiry=Date.now()+seconds*1000;
  return cache;
 };
}
/**
 * Verifies signature, issuer, aud, exp, iat, auth_time & UID.
 * The Firebase signing certificate provider is injected for deterministic tests.
 */
export function createFirebaseVerifier({fetchImpl=fetch,project=FIREBASE_PROJECT,
  clock=()=>Date.now(),certificates=null}={}){
 if(project!==FIREBASE_PROJECT)fail("Firebase 프로젝트가 일치하지 않습니다.");
 const certs=certificates||certificateCache(fetchImpl);
 return async function verifyFirebaseToken(token){
  const {header,body,payload,signature}=tokenParts(token);
  if(!header||header.alg!=="RS256"||typeof header.kid!=="string"||
    header.kid.length<1||header.kid.length>150)
    fail("Firebase 서명 알고리즘 또는 공개키 ID가 올바르지 않습니다.");
  const keys=await certs();
  if(!Object.prototype.hasOwnProperty.call(keys,header.kid))
    fail("Firebase 인증서에 없는 서명입니다.");
  let valid=false;
  try{
   const verification=createVerify("RSA-SHA256");
   verification.update(payload);
   verification.end();
   valid=verification.verify(createPublicKey(keys[header.kid]),signature);
  }catch{fail("Firebase 디지털 서명을 확인하지 못했습니다.");}
  if(!valid)fail("Firebase 인증 서명이 일치하지 않습니다.");
  const now=Math.floor(clock()/1000);
  if(body?.aud!==project||body?.iss!=="https://securetoken.google.com/"+project)
    fail("다른 Firebase 프로젝트에서 발행된 토큰입니다.");
  if(typeof body.sub!=="string"||!UID_PATTERN.test(body.sub)||
    !Number.isInteger(body.exp)||!Number.isInteger(body.iat)||
    !Number.isInteger(body.auth_time))
    fail("Firebase 사용자 인증 정보가 누락되었습니다.");
  if(body.exp<=now||body.iat>now+60||body.auth_time>now+60||body.iat<0)
    fail("Firebase 인증이 만료되었거나 시간이 유효하지 않습니다.");
  return {uid:body.sub,email:typeof body.email==="string"?body.email:"",token};
 };
}
function decodeFirestoreDocument(data){
 if(!data||typeof data!=="object"||!data.fields)
  fail("Firestore 응답이 올바르지 않습니다.");
 const f=data.fields;
 if(f.format?.integerValue!=="1"&&f.format?.integerValue!==1)
  fail("Firestore 문서의 format 값이 올바르지 않습니다.");
 if(typeof f.revision?.stringValue!=="string"||
   typeof f.payload?.stringValue!=="string")
  fail("Firestore 기록의 필수 필드가 없습니다.");
 return {format:1,revision:f.revision.stringValue,payload:f.payload.stringValue,
  ...(typeof data.updateTime==='string'?{updateTime:data.updateTime}:{})};
}
/**
 * A verified principal provides its authenticated uid + Firebase bearer token.
 * No account-wide service-account privileges are used.
 */
export function createUserScopedFirestoreReader({principal,fetchImpl=fetch}){
 if(!principal||!UID_PATTERN.test(principal.uid||"")||
   typeof principal.token!=="string"||principal.token.length<150)
  fail("검증된 Firebase 사용자 인증이 필요합니다.");
 return async function loadDocument(path){
  const prefix="users/"+principal.uid+"/formday_sync/";
  if(typeof path!=="string"||!path.startsWith(prefix)||
   !allowedKinds.has(path.slice(prefix.length))||path.includes("?"))
    fail("승인되지 않은 Firestore 읽기 경로입니다.");
  const url=FIRESTORE_BASE+"/"+path;
  const res=await fetchImpl(url,{
   method:"GET",
   headers:{Authorization:"Bearer "+principal.token,Accept:"application/json"},
   redirect:"error",
   signal:AbortSignal.timeout(10000)
  });
  if(res.status===404)return null;
  if(res.status===401||res.status===403)
   fail("Firestore에서 계정의 읽기 권한이 거부되었습니다.");
  if(!res.ok)fail("Firestore 조회에 실패했습니다.");
  const length=Number(res.headers.get("content-length")||0);
  if(length>MAX_FIRESTORE_RESPONSE)fail("클라우드 기록이 허용 용량을 초과했습니다.");
  const raw=await res.text();
  if(Buffer.byteLength(raw,"utf8")>MAX_FIRESTORE_RESPONSE)
   fail("클라우드 기록이 허용 용량을 초과했습니다.");
  let data;
  try{data=JSON.parse(raw);}catch{fail("Firestore 응답 JSON 오류");}
  return decodeFirestoreDocument(data);
 };
}
