const test = require('node:test');
const assert = require('node:assert/strict');
const { ProctorPolicy } = require('../src/main/proctorPolicy');
function fixture() {
  let clock = 0; const policy = new ProctorPolicy({ now: () => clock });
  const observe = (time, changes = {}) => { clock = time; return policy.observe({ cameraState: 'live', detectorReady: true, faceCount: 1, phoneConfidence: 0, headDirection: 'forward', brightness: 120, ...changes }); };
  return { policy, observe };
}
test('single/noisy frames and very low phone confidence never count as incidents', () => {
  const {policy,observe}=fixture();
  observe(0,{faceCount:2});observe(1000);observe(2000);
  for(let time=3000;time<30000;time+=1000)observe(time,{phoneConfidence:0.31});
  assert.equal(policy.strikes,0);
});
test('a sustained partial-phone confidence is treated as a phone observation', () => {
  const {policy,observe}=fixture(); let event;
  for(let time=0;time<=1800;time+=450) { const result=observe(time,{phoneConfidence:0.36}); if(result.event) event=result.event; }
  assert.equal(policy.strikes,1); assert.equal(event?.reasons?.[0],'phone_detected');
});
test('phone and multiple faces share a counter, with two warnings then one termination', () => {
  const {policy,observe}=fixture();let actions=[];
  for(let time=0;time<=43000;time+=1000){const result=observe(time,{faceCount:2,phoneConfidence:0.92});if(result.event?.type==='confirmed_incident')actions.push(result.action);}
  assert.deepEqual(actions,['warning','warning','submit']);assert.equal(policy.strikes,3);
  assert.equal(observe(44000,{phoneConfidence:0.99}).action,'submit');assert.equal(policy.strikes,3);
  assert.equal(policy.report().events.filter(e=>e.type==='confirmed_incident').length,3);
});
test('missing face receives the same confirmed warning policy as phones and multiple faces', () => {
  const {policy,observe}=fixture();let result;
  for(let time=0;time<=9000;time+=1000)result=observe(time,{faceCount:0});
  assert.equal(result.cameraBlocked,true);assert.equal(policy.strikes,2);
  assert.equal(policy.report().events.find(event=>event.type==='confirmed_incident').reasons[0],'no_face');
  assert.equal(observe(10000).cameraBlocked,false);
});
for (const pair of [['headDirection','eyeDirection'], ['headDirection','headDirection'], ['eyeDirection','eyeDirection'], ['eyeDirection','headDirection']]) {
  test('two distinct movements produce one warning: ' + pair.join(' then '), () => {
    const {policy,observe} = fixture();
    let time = 0;
    const frame = changes => observe(time += 450, {eyeDirection:'forward', ...changes});
    for (let i=0;i<20;i++) frame({[pair[0]]:'left'});
    assert.equal(policy.strikes,0);
    assert.equal(policy.snapshot().pendingMovement,true);
    frame({}); frame({});
    for (let i=0;i<3;i++) frame({[pair[1]]:'right'});
    assert.equal(policy.strikes,1);
    assert.deepEqual(policy.report().events[0].reasons,['movement_pair']);
    assert.equal(policy.snapshot().pendingMovement,false);
  });
}
test('overlapping phone and movement signals preserve the immediate warning and third-incident evidence', () => {
  const {policy,observe}=fixture();
  const both = {headDirection:'left', eyeDirection:'right'};
  for (const time of [0,450,900]) observe(time,both);
  assert.equal(policy.strikes,1);
  const phone = observe(1350,{...both, phoneConfidence:.32});
  assert.equal(phone.action,'warning');
  assert.equal(phone.event.strike,2);
  observe(1800,{faceCount:2});
  const final=observe(2250,{faceCount:2});
  assert.equal(final.action,'submit');
  assert.deepEqual(final.event.reasons,['multiple_faces']);
  assert.equal(policy.report().events.length,3);
});
test('movement observations outside the pairing window do not combine', () => {
  const {policy,observe}=fixture();
  for (const time of [0,450,900]) observe(time,{headDirection:'left'});
  for (const time of [16000,16450,16900]) observe(time,{eyeDirection:'right'});
  assert.equal(policy.strikes,0);
  assert.equal(policy.snapshot().pendingMovement,true);
});
test('camera outages reset partial confirmation', () => {
  const {policy,observe}=fixture();observe(0,{faceCount:2});observe(450,{cameraState:'unavailable'});
  observe(900,{faceCount:2});assert.equal(policy.strikes,0);
  assert.equal(observe(1350,{faceCount:2}).action,'warning');
  assert.throws(()=>observe(6000,{faceCount:NaN}));
});
