/* FORMDAY Connect — MCP HTTP gateway. No credentials or OAuth issuer. */
import {createMcpHandler,McpServer} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {createDispatcher} from "./tools.mjs";
import {createUserScopedFirestoreReader,createFirebaseVerifier} from "./firebase-rest.mjs";
import {createUserScopedFirestoreCommitter} from './firebase-append.mjs';
import {APPEND_SCHEMAS,APPEND_DESCRIPTIONS,createAppendDispatcher} from './append.mjs';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const limit=z.number().int().min(1).max(150).optional();
const calendarFilter={from:date.optional(),to:date.optional(),limit};
const descriptions=Object.freeze({
 formday_status:"Check whether cloud records exist",
 formday_workouts:"Read completed and partial IRON MODE sessions",
 formday_routines:"Read planned strength routine targets and programs",
 formday_calendar:"Read calendar events without inventing recurrence",
 formday_meals:"Read recorded food entries",
 formday_weight_history:"Read completed bodyweight measurements"
});
export function buildReadOnlyServer(dispatch,appendDispatch=null){
 if(typeof dispatch!=="function")throw Error("Authorized dispatcher is required");
 const server=new McpServer({name:"formday-connect",version:"0.4.0"},
  {capabilities:{tools:{}}});
 const schemas={
  formday_status:{},
  formday_workouts:{...calendarFilter,includeUnfinished:z.boolean().optional()},
  formday_routines:{limit},
  formday_calendar:{...calendarFilter,includeSamples:z.boolean().optional()},
  formday_meals:{...calendarFilter},
  formday_weight_history:{...calendarFilter}
 };
 for(const [name,inputSchema] of Object.entries(schemas)){
  server.registerTool(name,{
   title:name.replace(/^formday_/,"FORMDAY · "),
   description:descriptions[name],inputSchema:z.object(inputSchema),
   annotations:{readOnlyHint:true,destructiveHint:false,
    idempotentHint:true,openWorldHint:false},
   _meta:{securitySchemes:[{type:"oauth2",scopes:["formday:read"]}]}
  },async(args)=>{
   const result=await dispatch(name,args||{});
   return {content:[{type:"text",text:JSON.stringify(result)}]};
  });
 }
 if(appendDispatch)for(const [name,inputSchema] of Object.entries(APPEND_SCHEMAS)){
  const commits=name==='formday_commit_append';
  server.registerTool(name,{description:APPEND_DESCRIPTIONS[name],inputSchema,
   annotations:{readOnlyHint:!commits,destructiveHint:false,idempotentHint:commits,openWorldHint:false},
   _meta:{securitySchemes:[{type:'oauth2',scopes:['formday:read','formday:append']}]}},
   async args=>({content:[{type:'text',text:JSON.stringify(await appendDispatch(name,args))}]}));
 }
 return server;
}
function unauthorized(metadataUrl){
 return new Response(JSON.stringify({error:"unauthorized"}),{
  status:401,headers:{
   "content-type":"application/json","cache-control":"no-store",
   "www-authenticate":'Bearer resource_metadata="'+metadataUrl+'"'
  }
 });
}
/**
 * authenticateRequest must validate ChatGPT OAuth access token (issuer, aud,
 * expiry and scope), bind the verified Firebase UID and return a fresh user
 * Firebase ID token. No default fallback; fail closed.
 */
export function createProtectedMcpHandler({authenticateRequest,baseUrl,fetchImpl=fetch,verifyFirebaseToken=null,
 enableAppend=false,previewCodec=null,clock=()=>Date.now()}={}){
 if(typeof authenticateRequest!=="function")
  throw Error("Verified OAuth token resolver required");
 const base=new URL(baseUrl);
 if(base.protocol!=="https:")throw Error("HTTPS MCP origin required");
 const metadataUrl=new URL("/.well-known/oauth-protected-resource",base).href;
 const verifyFirebase=verifyFirebaseToken||createFirebaseVerifier({fetchImpl});
 return async function handle(request){
  const origin=request.headers.get("origin");
  if(origin&&origin!==base.origin&&origin!=="https://chatgpt.com"&&
    origin!=="https://chat.openai.com")
    return new Response(null,{status:403});
  const authHeader=request.headers.get("authorization")||"";
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(authHeader))
    return unauthorized(metadataUrl);
  let identity;
  try{identity=await authenticateRequest(authHeader.slice(7),request);}
  catch{return unauthorized(metadataUrl);}
  if(!identity?.uid||!identity?.firebaseIdToken||!['formday:read','formday:read formday:append'].includes(identity.scope))
   return unauthorized(metadataUrl);
  let verified;
  try{
   verified=await verifyFirebase(identity.firebaseIdToken);
   if(verified.uid!==identity.uid)throw Error("OAuth principal does not match Firebase token");
  }catch{return unauthorized(metadataUrl);}
  const loader=createUserScopedFirestoreReader({
   principal:verified,fetchImpl
  });
  const dispatch=createDispatcher({verifiedUid:identity.uid,loadDocument:loader});
  const appendDispatch=enableAppend===true&&previewCodec&&identity.scope==='formday:read formday:append'?
   createAppendDispatcher({uid:identity.uid,scope:identity.scope,resource:base.origin+'/mcp',loadDocument:loader,
    commitDocument:createUserScopedFirestoreCommitter({principal:verified,fetchImpl}),codec:previewCodec,clock}):null;
  const mcp=createMcpHandler(()=>buildReadOnlyServer(dispatch,appendDispatch),{
   legacy:"stateless",maxRequestBodySize:65536
  });
  return mcp.fetch(request);
 };
}
