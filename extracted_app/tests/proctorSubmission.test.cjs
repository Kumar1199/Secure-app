const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { ProctorPolicy } = require('../src/main/proctorPolicy');

test('third incident uses one submission promise, retains protected answers on failure, and retries once', async () => {
  let clock = 0, wallClock = Date.now(), resolveSubmission; const handlers = {}, files = new Map(), requests = [], timers = [];
  const fakeFs = {
    mkdirSync() {}, writeFileSync(name, data) { files.set(name, data); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(name) { files.delete(name); }, existsSync(name) { return files.has(name); }, readFileSync(name) { return files.get(name); },
  };
  const app = { requestSingleInstanceLock: () => true, on() {}, getPath: () => '/test-data', whenReady: () => ({ then: () => ({ catch() {} }) }) };
  const electron = { app, ipcMain: { handle(name, fn) { handlers[name] = fn; } }, protocol: { registerSchemesAsPrivileged() {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('protected:' + text), decryptString: bytes => bytes.toString().slice(10) },
    powerSaveBlocker: { start: () => 1, stop() {} }, screen: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main/main.js'), 'utf8');
  const context = {
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'fs') return fakeFs;
      if (name === 'crypto') return { randomUUID: () => '00000000-0000-4000-8000-000000000001' };
      if (name === 'path') return path;
      if (name === './proctorPolicy') return { ProctorPolicy: class extends ProctorPolicy { constructor() { super({ now: () => clock }); } } };
      if (name === './applicationIntegrityMonitor') return { ApplicationIntegrityMonitor: class { constructor() {} attach() {} } };
      if (name === './proctorEvidence') return require('../src/main/proctorEvidence');
      if (name === './apiHandler') return {
        startExamSession: async () => ({ success:true, data:{ session:{ sessionId:'session:test' }, heartbeatIntervalMs:15000 } }),
        heartbeat: async () => ({ success:true, data:{ session:{ sessionId:'session:test' } } }),
        syncSecurityEvents: async () => ({ success:true, data:{ accepted:[] } }),
        submitForced(type,payload) { requests.push({type,payload}); return new Promise(resolve => { resolveSubmission = resolve; }); }
      };
      if (name === './speechService') return {};
      if (name === './lockdown') return { start() {}, stop() {} };
      throw new Error('Unexpected dependency: ' + name);
  }, __dirname: path.resolve(__dirname,'../src/main'), console: { log() {}, error() {} }, Buffer, Date:{now:()=>wallClock}, setTimeout: (fn,ms) => { timers.push({fn,ms}); }, setInterval: (fn,ms) => { timers.push({fn,ms}); return timers.length; }, clearInterval() {}, process: { exit() {} },
  };
  vm.runInNewContext(source, context);
  const hasPending = () => [...files.keys()].some(key => String(key).endsWith('pending-proctored-exam.bin'));
  const pendingValue = () => files.get([...files.keys()].find(key => String(key).endsWith('pending-proctored-exam.bin')));
  const call = (name,...args) => handlers[name]({},...args);
  await call('start-exam');
  await call('proctor-draft','coding',{studentId:'TEST01',examId:'exam-test',code:'unsaved current code',language:'python'});
  const evidence={image:'data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'evidence.jpg')).toString('base64'),capturedAt:new Date().toISOString(),regions:[{type:'face',x:0.1,y:0.1,width:0.5,height:0.6}]};
  for(clock=0;clock<=43000;clock+=1000)await call('proctor-observe',{cameraState:'live',detectorReady:true,faceCount:2,phoneConfidence:0.95,evidence});
  const duplicate=call('proctor-force-submit');
  assert.equal(requests.length,1);
  assert.equal(hasPending(),true);await new Promise(setImmediate);
  assert.equal(requests[0].payload.code,'unsaved current code');
  assert.equal(requests[0].payload.proctorReport.events.filter(event=>event.type==='confirmed_incident'&&event.evidence?.image===evidence.image).length,3);
  assert.equal(requests[0].payload.proctorReport.strikes,3);assert.equal(requests[0].payload.submissionReason,'proctor_limit');
  assert.ok(pendingValue().toString().startsWith('protected:'));
  resolveSubmission({success:false,message:'offline'});await duplicate;
  assert.equal(hasPending(),true);
  const retry=call('proctor-force-submit');assert.equal(requests.length,2);
  resolveSubmission({success:true,data:{submissionId:'saved'}});assert.equal((await retry).success,true);
  assert.equal(hasPending(),false);assert.equal((await call('proctor-force-submit')).success,true);assert.equal(requests.length,2);
});

test('forced coding and interview submission bypass external grading and preserve answers', async () => {
  const saved = [];
  const source = fs.readFileSync(path.resolve(__dirname,'../src/main/apiHandler.js'),'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, console, setTimeout,
    require(name) {
      if (name === './firestoreStore') return { saveSubmission: async data => { saved.push(data); return { id: 'saved' }; } };
      if (name === '../../config/config') return {};
      return require(name);
    },
  });
  assert.equal((await module.exports.submitForced('coding',{code:'',studentId:'TEST01',examId:'exam-test'})).success,true);
  assert.equal((await module.exports.submitForced('interview',{responses:[{answer:'Current draft'}]})).success,true);
  assert.equal(saved[0].code,'');assert.equal(saved[0].evaluationPending,true);assert.equal(saved[1].responses[0].answer,'Current draft');
});
