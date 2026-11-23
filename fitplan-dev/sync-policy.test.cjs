'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../fitplan/sync-policy.js');
const old={remoteRevision:'r1',localRevision:'l1'};
const decide=(meta,localRevision,remoteRevision,local=true,remote=true)=>
 P.decide({meta,local,localRevision,remote,remoteRevision});
test('First real records require an explicit first upload',()=>{
 assert.equal(decide(null,'l1','',true,false),'first-upload');
 assert.equal(decide(null,'','r1',false,true),'download');
 assert.equal(decide(null,'l1','r1'),'review');
});
test('After pairing, changing only one side is directional',()=>{
 assert.equal(decide(old,'l1','r1'),'synced');
 assert.equal(decide(old,'l2','r1'),'push');
 assert.equal(decide(old,'l1','r2'),'download');
});
test('Two concurrent changes never select automatic overwrite',()=>{
 assert.equal(decide(old,'l2','r2'),'conflict');
 assert.equal(decide(old,'l1','',true,false),'server-missing');
});
test('Demo data and fresh empty IRON store are not user data',()=>{
 assert.equal(P.isUserData('calendar',{demo:true,events:[{isSample:true}],customFoods:[]},true),false);
 assert.equal(P.isUserData('calendar',{demo:false,events:[],customFoods:[]},true),true);
 assert.equal(P.isUserData('iron',{sessions:[],routines:[],programs:[]},false),false);
 assert.equal(P.isUserData('iron',{sessions:[],routines:[{}],programs:[]},true),true);
});
test('Documents must be typed and size-limited',()=>{
 assert.throws(()=>P.docValid({format:2,revision:'x',payload:'{}'}));
 assert.deepEqual(P.docValid({format:1,revision:'x',payload:'{}'}),{format:1,revision:'x',payload:'{}'});
});
test('Cloud calendar and iron snapshots remain separate kinds',()=>{
 assert.deepEqual(P.slots,['calendar','iron']);
});
