import test from "node:test";
import assert from "node:assert/strict";
import {createFirestoreOAuthStore} from "../src/oauth-firestore-store.mjs";

function fakeFirestore(){
 const data=new Map();
 const collection=prefix=>({doc:id=>{
  const path=prefix+"/"+id;
  return {
   path,
   async create(record){
    if(data.has(path))throw Error("Document already exists");
    data.set(path,structuredClone(record));
   },
   async get(){return {exists:data.has(path),data:()=>structuredClone(data.get(path))};}
  };
 }});
 const db={
  collection,
  async runTransaction(fn){
   const mutations=[];
   const tx={
    get:async ref=>({exists:data.has(ref.path),
      data:()=>structuredClone(data.get(ref.path))}),
    delete:ref=>mutations.push(()=>data.delete(ref.path)),
    update:(ref,changes)=>mutations.push(()=>
      data.set(ref.path,{...data.get(ref.path),...changes}))
   };
   const result=await fn(tx);
   for(const change of mutations)change();
   return result;
  }
 };
 return {db,data};
}
const key="A".repeat(43);
test("Firestore OAuth store is durable and permits only five known token kinds",async()=>{
 const {db,data}=fakeFirestore();
 const store=createFirestoreOAuthStore(db);
 assert.equal(store.durable,true);
 await store.putFlow(key,{expiresAt:123,scope:"formday:read"});
 assert.equal((await store.takeFlow(key)).scope,"formday:read");
 assert.equal(await store.takeFlow(key),null);
 assert.equal(data.size,0);
});
test("Refresh token and authorization code are one-time consumable",async()=>{
 const store=createFirestoreOAuthStore(fakeFirestore().db);
 await store.putRefresh(key,{grantId:key,expiresAt:123});
 assert.equal((await store.takeRefresh(key)).grantId,key);
 assert.equal(await store.takeRefresh(key),null);
 await store.putCode(key,{clientId:"chatgpt",expiresAt:123});
 assert.equal((await store.getCode(key)).clientId,"chatgpt");
 assert.equal((await store.takeCode(key)).clientId,"chatgpt");
 assert.equal(await store.getCode(key),null);
});
test("Encrypted user grant can be updated without reading workout records",async()=>{
 const {db,data}=fakeFirestore();
 const store=createFirestoreOAuthStore(db);
 await store.putGrant(key,{credentialCiphertext:"v1."+("B".repeat(80)),uid:"someUser123"});
 await store.updateGrantCredential(key,"v1."+("C".repeat(80)));
 assert.equal((await store.getGrant(key)).credentialCiphertext,
  "v1."+("C".repeat(80)));
 assert.ok([...data.keys()].every(path=>path.startsWith("formday_connect_oauth/")));
});
test("Key injection and unauthorized paths cannot be requested",async()=>{
 const store=createFirestoreOAuthStore(fakeFirestore().db);
 await assert.rejects(store.getAccess("../../users/other"));
 await assert.rejects(store.getGrant("short"));
 await assert.rejects(store.putFlow("wrong/key",{expiresAt:123}));
});
