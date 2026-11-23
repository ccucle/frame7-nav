import {createServer} from "node:http";
import {Readable} from "node:stream";

async function handleRequest(req,res,origin,app){
 const base=new URL(origin);
 if(req.headers.host!==base.host||!req.url?.startsWith("/")||req.url.startsWith("//")){
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
export function createFormdayHttpServer({origin,app}){
 const server=createServer((req,res)=>{void handleRequest(req,res,origin,app);});
 server.requestTimeout=25000;server.headersTimeout=20000;
 return server;
}
