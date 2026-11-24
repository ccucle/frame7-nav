import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseRefresh} from '../src/firebase-refresh.mjs';

const credential='synthetic-refresh-token-for-tests';
const sample={id_token:'a'.repeat(200),refresh_token:credential,user_id:'testUser123',project_id:'188014722362'};
function refreshWith(payload){
 return createFirebaseRefresh({apiKey:'synthetic-public-api-key',fetchImpl:async(url,options)=>{
  assert.equal(new URL(url).hostname,'securetoken.googleapis.com');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.ok(!url.includes(credential));
  assert.equal(new URLSearchParams(options.body).get('refresh_token'),credential);
  return new Response(JSON.stringify(payload));
 }});
}
test('Firebase Secure Token accepts the configured numeric project number',async()=>{
 assert.equal((await refreshWith(sample)(credential)).userId,'testUser123');
});
test('Firebase Secure Token rejects other projects and malformed responses',async()=>{
 for(const change of [{project_id:'999999999'},{id_token:''},{refresh_token:''},{user_id:'../user'}])
  await assert.rejects(refreshWith({...sample,...change})(credential));
});
