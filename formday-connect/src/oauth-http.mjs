/* FORMDAY Connect OAuth 2.1 HTTP routes. Only mount with durable core.
 * Authorization/refresh tokens never appear in URLs or logs.
 */
import {timingSafeEqual} from "node:crypto";
const FLOW="fd_oauth_flow",CSRF="fd_oauth_csrf",OPAQUE=/^[A-Za-z0-9_-]{40,128}$/;
const CSP="default-src 'none'; script-src 'self' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://healthy-df79f.firebaseapp.com; frame-src https://healthy-df79f.firebaseapp.com; style-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const cookie=(request,name)=>(request.headers.get("cookie")||"").split(/;\s*/).find(v=>v.startsWith(name+"="))?.slice(name.length+1)||null;
const setCookie=(name,value)=>name+"="+value+"; Path=/oauth; Max-Age=300; HttpOnly; Secure; SameSite=Lax";
const response=(payload,status=200,headers={})=>new Response(JSON.stringify(payload),{status,headers:{
 "content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer",...headers}});
const failure=(reason,status=400)=>response({error:"invalid_request",description:String(reason).slice(0,140)},status);
const same=(a,b)=>{if(typeof a!=="string"||typeof b!=="string")return false;
 const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
function htmlConsent(csrf,scope){
 if(!OPAQUE.test(csrf))throw Error("Invalid consent CSRF");
 return ['<!doctype html><html lang="ko"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="fd-oauth-csrf" content="'+csrf+'">',
  '<meta name="robots" content="noindex,nofollow">',
  '<title>FORMDAY Connect Google 승인</title>',
  '<link rel="stylesheet" href="/oauth/style.css"></head><body><main>',
  '<h1>FORMDAY Connect</h1>',
  scope==='formday:read formday:append'?
   '<p>ChatGPT가 운동·식단·체중·캘린더 기록을 읽고, 요청한 <b>루틴 일정·프로그램·식단을 추가</b>하도록 승인합니다.</p><p>기존 항목 수정·삭제 권한은 부여하지 않습니다.</p>':
   '<p>ChatGPT가 운동·식단·체중·캘린더 기록을 <b>읽기만</b> 하도록 승인합니다.</p><p>허용: 읽기·코칭 | 금지: 기록 추가·수정·삭제</p>',
  '<button id="fd-oauth-approve">Google 계정으로 로그인하고 승인</button>',
  '<p id="fd-oauth-status" role="status">Google 계정을 선택해 주세요.</p>',
  '<p>기존 FORMDAY에서 사용한 Google 계정을 선택해 주세요. 다른 계정으로 처음 로그인하면 Firebase 사용자 계정이 생성될 수 있습니다.</p>',
  '</main><script type="module" src="/oauth/consent.js"></script></body></html>'].join("");
}
const CSS="body{margin:0;background:#10141b;color:#f1f4f8;font:15px system-ui,sans-serif} main{max-width:520px;margin:9vh auto;padding:24px;line-height:1.8}button{width:100%;min-height:50px;background:#e43644;color:white;border:0;border-radius:10px;padding:12px;font-weight:800}p{color:#bcc9d6}#fd-oauth-status{overflow-wrap:anywhere}";
export function createOauthHttpRoutes({core,origin,consentScript}={}){
 if(!core||typeof core.begin!=="function"||typeof core.approve!=="function"||
  typeof core.exchangeCode!=="function"||typeof core.refresh!=="function")
  throw Error("OAuth core is incomplete");
 const base=new URL(origin);
 if(base.protocol!=="https:")throw Error("HTTPS origin required");
 if(typeof consentScript!=="string"||consentScript.length<100)
  throw Error("Google login script is missing");
 return async function handle(request){
  const u=new URL(request.url);
  if(u.origin!==base.origin)return failure("Untrusted hostname",403);
  if(request.method==="GET"&&u.pathname==="/.well-known/oauth-protected-resource")
   return response(core.protectedResource);
  if(request.method==="GET"&&u.pathname==="/.well-known/oauth-authorization-server")
   return response(core.metadata);
  if(request.method==="GET"&&u.pathname==="/oauth/consent.js")
   return new Response(consentScript,{headers:{"content-type":"text/javascript",
    "cache-control":"no-store","content-security-policy":CSP}});
  if(request.method==="GET"&&u.pathname==="/oauth/style.css")
   return new Response(CSS,{headers:{"content-type":"text/css","cache-control":"no-store"}});
  if(request.method==="GET"&&u.pathname==="/oauth/authorize"){
   try{
    const result=await core.begin(Object.fromEntries(u.searchParams));
    const h=new Headers({"location":"/oauth/consent","cache-control":"no-store"});
    h.append("set-cookie",setCookie(FLOW,result.requestId));
    h.append("set-cookie",setCookie(CSRF,result.csrf));
    return new Response(null,{status:303,headers:h});
   }catch{return failure("Authorization request rejected");}
  }
  if(request.method==="GET"&&u.pathname==="/oauth/consent"){
   const flow=cookie(request,FLOW),csrf=cookie(request,CSRF);
   if(!OPAQUE.test(flow||"")||!OPAQUE.test(csrf||""))return failure("Authorization session expired",401);
   let consent;
   try{consent=await core.inspectConsent({requestId:flow,csrf});}
   catch{return failure('Authorization session expired',401);}
   return new Response(htmlConsent(csrf,consent.scope),{headers:{"content-type":"text/html; charset=utf-8",
    "cache-control":"no-store","referrer-policy":"no-referrer",
    "content-security-policy":CSP}});
  }
  if(request.method==="POST"&&u.pathname==="/oauth/complete"){
   if(request.headers.get("origin")!==base.origin)return failure("Untrusted Origin",403);
   const flow=cookie(request,FLOW),csrf=cookie(request,CSRF);
   if(!OPAQUE.test(flow||"")||!OPAQUE.test(csrf||""))return failure("Missing authorization session",401);
   const raw=await request.text();
   if(raw.length>35000)return failure("Request too large",413);
   let body;
   try{body=JSON.parse(raw);}catch{return failure("Malformed consent body");}
   if(!same(body?.csrf,csrf))return failure("CSRF mismatch",403);
   try{
    const result=await core.approve({requestId:flow,csrf:body.csrf,
     idToken:body.idToken,refreshToken:body.refreshToken,approved:body.approved===true});
    return response({redirectTo:result.redirectTo});
   }catch{return failure("Consent could not be completed");}
  }
  if(request.method==="POST"&&u.pathname==="/oauth/token"){
   const raw=await request.text();
   if(raw.length>8000)return failure("Token request too large",413);
   const args=Object.fromEntries(new URLSearchParams(raw));
   try{
    const data=args.grant_type==="authorization_code"?await core.exchangeCode(args):
      args.grant_type==="refresh_token"?await core.refresh(args):null;
    return data?response(data):failure("Grant type not supported");
   }catch{return failure("OAuth token request rejected");}
  }
  return failure("Not found",404);
 };
}
