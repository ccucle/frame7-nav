/* FORMDAY Connect HTTPS-backed Node server. Fails closed on missing secrets.
 * Only the Render reverse proxy terminates TLS, so FORMDAY_CONNECT_ORIGIN must
 * be the real public HTTPS origin. No OAuth state is written to disk.
 */
import {createServer} from "node:http";
import {Readable} from "node:stream";
import {readFileSync} from "node:fs";
import {initializeApp,cert} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {createFirestoreOAuthStore} from "./oauth-firestore-store.mjs";
import {createFormdayRuntime} from "./server-runtime.mjs";

function required(name){
 const v=process.env[name];
 if(!v||!v.trim())throw Error("Missing required server config: "+name);
 return v;
}
function configure(){
 const account=JSON.parse(required("FORMDAY_CONNECT_FIREBASE_SERVICE_ACCOUNT_JSON"));
 if(account.project_id!=="healthy-df79f")
  throw Error("Unexpected Firebase project");
 const firebase=initializeApp({
  credential:cert(account),projectId:"healthy-df79f"
 },"formday-connect-oauth");
 const consentScript=readFileSync(
  new URL("./oauth-consent-browser.mjs",import.meta.url),"utf8");
 const origin=required("FORMDAY_CONNECT_ORIGIN");
 return {origin,app:createFormdayRuntime({
  origin,oauthStore:createFirestoreOAuthStore(getFirestore(firebase)),
  oauthEncryptionKey:required("FORMDAY_OAUTH_ENCRYPTION_KEY"),
  firebaseApiKey:required("FORMDAY_FIREBASE_WEB_API_KEY"),
  consentScript
 })};
}
async function handleRequest(req,res,origin,app){
 const base=new URL(origin);
 if(req.headers.host!==base.host||!req.url?.startsWith("/")){
  res.writeHead(403);res.end();return;
 }
 const url=new URL(req.url,base);
 if(req.method==="GET"&&url.pathname==="/health"){
  res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
  res.end('{"ready":true}');return;
 }
 try{
  const buffers=[];let size=0;
  for await (const part of req){
   size+=part.length;
   if(size>65536){res.writeHead(413);res.end();return;}
   buffers.push(Buffer.from(part));
  }
  const headers=new Headers();
  for(const [k,v] of Object.entries(req.headers)){
   if(Array.isArray(v))for(const item of v)headers.append(k,item);
   else if(v!==undefined)headers.set(k,String(v));
  }
  const init={method:req.method||"GET",headers};
  if(init.method!=="GET"&&init.method!=="HEAD")
   init.body=Buffer.concat(buffers);
  const answer=await app.fetch(new Request(url.href,init));
  const output={};
  for(const [k,v]of answer.headers)
   if(k!=="set-cookie")output[k]=v;
  if(answer.headers.has("set-cookie"))
   output["set-cookie"]=answer.headers.getSetCookie();
  res.writeHead(answer.status,output);
  if(!answer.body){res.end();return;}
  for await(const chunk of Readable.fromWeb(answer.body)){
   if(!res.write(chunk))await new Promise(r=>res.once("drain",r));
  }
  res.end();
 }catch{
  if(!res.headersSent)res.writeHead(500,{"cache-control":"no-store"});
  res.end();
 }
}
const {origin,app}=configure();
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid port");
const server=createServer((req,res)=>{void handleRequest(req,res,origin,app);});
server.requestTimeout=25000;server.headersTimeout=26000;
server.listen(port,"0.0.0.0");
