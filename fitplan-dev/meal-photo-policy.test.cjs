const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../fitplan/meal-photo-policy.js');
const event={id:'meal-abc',date:'2026-11-25',type:'meal',repeat:'none',completed:true,isSample:false};
const x='a'.repeat(64),y='b'.repeat(64);
test('only real single completed meals',()=>{
  assert.equal(P.eligible(event),true);
  assert.equal(P.eligible({...event,isSample:true}),false);
  assert.equal(P.eligible({...event,completed:false}),false);
  assert.equal(P.eligible({...event,repeat:'daily'}),false);
  assert.equal(P.eligible({...event,date:'2026-02-30'}),false);
});
test('exact target, never duplicate or wrong date',()=>{
  assert.equal(P.checkTarget({events:[event]},event.id,event.date),event);
  assert.throws(()=>P.checkTarget({events:[event,event]},event.id,event.date));
  assert.throws(()=>P.checkTarget({events:[event]},event.id,'2026-11-24'));
  assert.throws(()=>P.checkTarget({events:[]},'../bad',event.date));
});
test('file size, supported type and signature',()=>{
  const jpeg=new Uint8Array(12);jpeg.set([255,216,255]);
  assert.equal(P.checkBytes(jpeg,'image/jpeg'),true);
  assert.throws(()=>P.checkBytes(jpeg,'image/png'));
  assert.throws(()=>P.checkBytes(jpeg,'image/svg+xml'));
  assert.throws(()=>P.checkBytes(new Uint8Array(P.MAX_BYTES+1),'image/jpeg'));
  assert.throws(()=>P.checkBytes(new Uint8Array(1),'image/jpeg'));
});
test('idempotent writes and stale replace/delete protection',()=>{
  assert.equal(P.decide(null,null,x),'write');
  assert.equal(P.decide(x,null,x),'unchanged');
  assert.equal(P.decide(x,x,y),'write');
  assert.equal(P.decide(x,x,null),'delete');
  assert.equal(P.decide(null,x,null),'unchanged');
  assert.throws(()=>P.decide(x,null,y));
  assert.throws(()=>P.decide(y,x,null));
  assert.throws(()=>P.decide('invalid',null,x));
});
