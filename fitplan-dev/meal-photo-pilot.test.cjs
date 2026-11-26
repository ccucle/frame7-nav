'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../fitplan',n),'utf8');
test('pilot uses same named Google app, existing owner path and no calendar writes',()=>{
 const src=read('meal-photo-pilot.js');
 assert.match(src,/initializeApp\(config,'formday-auth'\)/);
 assert.match(src,/getDocFromServer\(doc\(db,'users',id,'formday_sync','calendar'\)\)/);
 assert.doesNotMatch(src,/\b(setDoc|updateDoc|deleteDoc|runTransaction|localStorage|signInWithPopup|signOut)\b/);
 assert.match(src,/\.filter\(P\.eligible\)/);
 assert.match(src,/controller\?\.canLeave\(\)===false/);
 assert.match(src,/generation\+\+;uid=user\?\.uid/);
});
test('pilot HTML is explicit test, no tracking, and loads the validated photo component',()=>{
 const src=read('meal-photo-test.html');
 assert.match(src,/운영 시험/);
 assert.match(src,/noindex,nofollow/);
 assert.match(src,/id="load-meals"[^>]*disabled/);
 assert.match(src,/EXIF/);
 assert.match(src,/meal-photo\.js\?v=pilot1/);
 assert.match(src,/meal-photo-pilot\.js\?v=pilot2/);
 assert.doesNotMatch(src,/analytics|tracking|iframe/);
});
