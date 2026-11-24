/* FORMDAY Connect: durable OAuth token store on Firestore.
 * This adapter uses the FIREBASE ADMIN SDK only for OAuth metadata, never
 * user workout/meal/weight records. The separate user-token REST reader
 * continues to enforce the existing Firestore Security Rules.
 *
 * WARNING: Firebase Admin bypasses Security Rules. Supply a dedicated,
 * trusted server identity, restrict IAM where practical, and NEVER expose
 * its credential or these collections to the browser.
 */
const COLLECTION="formday_connect_oauth";
const KEY=/^[A-Za-z0-9_-]{40,90}$/;
const NAME=new Set(["flow","code","grant","access","refresh"]);
const MAX_RECORD_BYTES=18000;
function check(value,why){if(!value)throw Error(why);}
function valueLength(record){
 return Buffer.byteLength(JSON.stringify(record),"utf8");
}
export function createFirestoreOAuthStore(db){
 check(db&&typeof db.collection==="function"&&typeof db.runTransaction==="function",
  "Firestore Admin transactional client required");
 const collection=db.collection(COLLECTION);
 function ref(type,key){
  check(NAME.has(type)&&typeof key==="string"&&KEY.test(key),
   "Invalid OAuth storage key");
  return collection.doc(type+"_"+key);
 }
 async function put(type,key,record){
  check(record&&typeof record==="object"&&!Array.isArray(record)&&
   valueLength(record)<=MAX_RECORD_BYTES,"OAuth token record invalid or oversized");
  await ref(type,key).create(record);
 }
 async function get(type,key){
  const snapshot=await ref(type,key).get();
  return snapshot.exists?snapshot.data():null;
 }
 async function take(type,key){
  const doc=ref(type,key);
  return db.runTransaction(async tx=>{
   const snapshot=await tx.get(doc);
   if(!snapshot.exists)return null;
   tx.delete(doc);
   return snapshot.data();
  });
 }
 async function updateGrantCredential(key,ciphertext){
  check(typeof ciphertext==="string"&&ciphertext.startsWith("v1.")&&
   ciphertext.length<16000,"Encrypted grant credential invalid");
  const doc=ref("grant",key);
  return db.runTransaction(async tx=>{
   const snapshot=await tx.get(doc);
   if(!snapshot.exists)throw Error("OAuth grant expired");
   const prev=snapshot.data();
   tx.update(doc,{credentialCiphertext:ciphertext});
   return true;
  });
 }
 const result={
  durable:true,
  putFlow:(k,v)=>put("flow",k,v),
  getFlow:k=>get("flow",k),
  takeFlow:k=>take("flow",k),
  putCode:(k,v)=>put("code",k,v),
  getCode:k=>get("code",k),
  takeCode:k=>take("code",k),
  putGrant:(k,v)=>put("grant",k,v),
  getGrant:k=>get("grant",k),
  putAccess:(k,v)=>put("access",k,v),
  getAccess:k=>get("access",k),
  putRefresh:(k,v)=>put("refresh",k,v),
  getRefresh:k=>get("refresh",k),
  takeRefresh:k=>take("refresh",k),
  updateGrantCredential
 };
 return Object.freeze(result);
}
