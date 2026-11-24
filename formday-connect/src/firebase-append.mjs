/* User-token REST commit, bounded to two owner documents. No Admin fallback. */
const base='https://firestore.googleapis.com/v1/projects/healthy-df79f/databases/(default)/documents';
export function createUserScopedFirestoreCommitter({principal,fetchImpl=fetch}){
 if(!/^[A-Za-z0-9_-]{6,128}$/.test(principal?.uid||'')||typeof principal?.token!=='string'||principal.token.length<150)
  throw Error('Verified Firebase principal required');
 return async function commitDocument(path,next,updateTime){
  const prefix='users/'+principal.uid+'/formday_sync/';
  if(!['calendar','iron'].some(kind=>path===prefix+kind))throw Error('Unapproved write path');
  if(next?.format!==1||typeof next.payload!=='string'||Buffer.byteLength(next.payload,'utf8')>550000||
   !/^[A-Za-z0-9_-]{1,100}$/.test(next.revision)||JSON.parse(next.payload).revision!==next.revision||
   typeof updateTime!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(updateTime))
   throw Error('Invalid conditional write');
  let response;
  try{response=await fetchImpl(base+':commit',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+principal.token,'content-type':'application/json'},
   body:JSON.stringify({writes:[{
    update:{name:base.slice('https://firestore.googleapis.com/v1/'.length)+'/'+path,fields:{
     format:{integerValue:'1'},revision:{stringValue:next.revision},payload:{stringValue:next.payload}}},
    updateMask:{fieldPaths:['format','revision','payload']},
    updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],
    currentDocument:{updateTime}
   }]})
  });}catch{throw Error('Save outcome unknown; retry the SAME previewToken');}
  if(response.status===409||response.status===412)throw Error('Cloud records changed; create a new preview');
  if(response.status===401||response.status===403)throw Error('Firestore write permission denied');
  if(!response.ok)throw Error('Save not confirmed; retry the SAME previewToken');
  return {committed:true};
 };
}
