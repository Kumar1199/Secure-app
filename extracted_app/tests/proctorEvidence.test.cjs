const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {sanitizeEvidence}=require('../src/main/proctorEvidence');
const image='data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'evidence.jpg')).toString('base64');
test('bounded JPEG evidence retains the source frame and normalized detection regions',()=>{
 const evidence=sanitizeEvidence({image,capturedAt:new Date().toISOString(),regions:[{type:'face',x:0.1,y:0.1,width:0.5,height:0.5},{type:'phone',x:0.8,y:0.7,width:0.4,height:0.6,score:0.98}]});
 assert.equal(evidence.image,image);assert.ok(evidence.width<=640&&evidence.height<=480);assert.equal(evidence.regions.length,2);assert.ok(evidence.regions[1].width<=0.21);
});
test('rejects remote URLs, non-JPEG images, malformed and oversized evidence',()=>{
 assert.equal(sanitizeEvidence({image:'https://example.test/image.jpg'}),null);
 assert.equal(sanitizeEvidence({image:'data:image/svg+xml;base64,PHN2Zz4='}),null);
 assert.equal(sanitizeEvidence({image:'data:image/jpeg;base64,YWJj'}),null);
 assert.equal(sanitizeEvidence({image:'data:image/jpeg;base64,'+'A'.repeat(180001)}),null);
});
