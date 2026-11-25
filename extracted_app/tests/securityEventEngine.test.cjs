const test = require('node:test');
const assert = require('node:assert/strict');
const { SecurityPolicyEngine, Action } = require('../src/main/securityEventEngine');
function fixture() { let time = 0; const engine = new SecurityPolicyEngine({ now: () => time }); return { engine, at(value, event) { time = value; return engine.ingest(event); } }; }
test('counts the first qualifying phone frame and suppresses duplicate frames during cooldown', () => {
  const f = fixture(); const event = { type: 'PHONE_DETECTED', active: true, confidence: .9, metadata: { faceCount: 1 } };
  const result=f.at(0,event); assert.equal(result.action,Action.WARNING); assert.equal(result.event.category,'OBJECT'); assert.equal(result.event.severity,'HIGH');
  assert.equal(f.at(400,event).action,Action.IGNORE); assert.equal(f.at(900,event).action,Action.IGNORE);
  assert.equal(f.at(1400,event).action,Action.IGNORE);
});
test('event-specific major policy auto-submits only after persistent grouped incidents', () => {
  const f=fixture(); let action; for (const start of [0,9000,18000]) { f.at(start,{type:'MULTIPLE_FACES',active:true,confidence:.95,metadata:{faceCount:2}}); action=f.at(start+450,{type:'MULTIPLE_FACES',active:true,confidence:.95,metadata:{faceCount:2}}).action; }
  assert.equal(action,Action.AUTO_SUBMIT); assert.equal(f.engine.snapshot().riskScore,75);
});
test('short head movement is ignored but persistent movement is advisory', () => {
  const f=fixture(); f.at(0,{type:'HEAD_ROTATION',active:true,confidence:.9,metadata:{yaw:.5}}); assert.equal(f.at(1000,{type:'HEAD_ROTATION',active:true,confidence:.9,metadata:{yaw:.5}}).action,Action.IGNORE);
  assert.equal(f.at(2000,{type:'HEAD_ROTATION',active:true,confidence:.9,metadata:{yaw:.5}}).action,Action.ADVISORY);
});
test('camera transition is high risk while uncertain identity mismatch remains advisory', () => {
  const f=fixture(); f.at(0,{type:'CAMERA_DISCONNECTED',active:true,confidence:1,metadata:{}}); const camera=f.at(5100,{type:'CAMERA_DISCONNECTED',active:true,confidence:1,metadata:{}}); assert.equal(camera.action,Action.HIGH_RISK);
  f.at(6000,{type:'IDENTITY_MISMATCH',active:true,confidence:.95,metadata:{}}); f.at(7000,{type:'IDENTITY_MISMATCH',active:true,confidence:.95,metadata:{}}); assert.equal(f.at(8100,{type:'IDENTITY_MISMATCH',active:true,confidence:.95,metadata:{}}).action,Action.ADVISORY);
});
