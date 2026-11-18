const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, '../../../.student-delete-check/node_modules/playwright'));
const { ProctorPolicy } = require('../src/main/proctorPolicy');
const { sanitizeEvidence } = require('../src/main/proctorEvidence');
(async () => {
 const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
 try {
  for (const type of (process.env.PROCTOR_UI_CASE ? [process.env.PROCTOR_UI_CASE] : ['mcq','coding','interview'])) {
   const page = await browser.newPage(); page.setDefaultTimeout(25000);
   await page.clock.install();
   let clock=0,lastDraft,forced=0,navigated=null;const errors=[];
   const policy=new ProctorPolicy({now:()=>clock,confirmationMs:1000,repeatMs:2500});
   page.on('pageerror',error=>errors.push(error.message));
   await page.exposeFunction('__observe',sample=>{clock+=1000;const result=policy.observe(sample);if(result.event?.type==='confirmed_incident')result.event.evidence=sanitizeEvidence(sample.evidence);return result;});
   await page.exposeFunction('__draft',(kind,payload)=>{lastDraft={kind,payload};return {success:true};});
   await page.exposeFunction('__force',()=>{forced++;return {success:true,data:{submissionId:'test-submission'}};});
   await page.exposeFunction('__navigate',target=>{navigated=target;return {success:true};});
   await page.route(/^https?:/,route=>route.abort());
   await page.addInitScript(({type})=>{
    const student={rollNumber:'TEST01',name:'Proctor Test',examType:type.toUpperCase(),subject:'Test',difficulty:'medium',duration:3600};
    const schedule={id:'test-exam',startTime:new Date(Date.now()-10000).toISOString(),endTime:new Date(Date.now()+3600000).toISOString()};
    const questions=type==='coding'?{problem:{title:'Test problem',description:'Test',testCases:[]}}:{questions:[{id:1,question:'Test question',options:['A','B'],correct:1,expectedKeyPoints:[]}]};
    window.examAPI={getSession:async key=>({student,schedule,questions,pin:'123456'})[key],setSession:async()=>true,checkExamSubmission:async()=>({success:true,data:{alreadySubmitted:false}}),
     proctorState:async()=>({strikes:0,terminated:false}),onProctorSubmitted:()=>()=>{},proctorObserve:sample=>window.__observe(sample),proctorDraft:(kind,payload)=>window.__draft(kind,payload),proctorForceSubmit:()=>window.__force(),proctorFocus:async()=>true,
     endExam:async()=>({success:true}),navigate:target=>window.__navigate(target),exitApp:()=>window.__navigate('closed'),ttsSpeak:async()=>({success:false}),transcribeAudio:async()=>({success:false})};
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');let draw;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async constraints=>{
     if(!constraints.video)throw new Error('No microphone used in this test.');
     draw=setInterval(()=>{ctx.fillStyle='#999';ctx.fillRect(0,0,640,480);},40);return canvas.captureStream(15);
    }});
    window.Worker=class {
     postMessage(message){
      if(message.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),10);
      else {this.frames=(this.frames||0)+1;message.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'sample',faceCount:this.frames>6&&type!=='coding'?2:1,phoneConfidence:this.frames>6&&type==='coding'?0.95:0,headDirection:'forward',regions:[{type:type==='coding'?'phone':'face',x:0.1,y:0.1,width:0.5,height:0.6,score:0.95}]}}),10);}
     }
     terminate(){this.onmessage=null;}
    };
    speechSynthesis.speak=()=>{};
   },{type});
   await page.goto(pathToFileURL(path.resolve(__dirname,`../src/renderer/pages/${type}.html`)).href);
   await page.locator('#s360-consent-box').check();await page.locator('#s360-camera-button').click();
   await page.locator('#s360-gate').waitFor({state:'hidden'});
   await page.evaluate(kind=>{if(kind==='mcq')answers[0]=1;else if(kind==='coding')document.getElementById('cta').value='print(42)';else document.getElementById('answerBox').value='My current interview answer';},type);
   await page.locator('#s360-badge').filter({hasText:'1/2 warnings'}).waitFor();
   assert.ok((await page.locator('#s360-warning').innerText()).includes('Warning 1 of 2'));
   assert.equal(await page.locator('#s360-warning img').count(),1);assert.equal(await page.locator('#s360-warning svg rect').count(),1);
   await page.locator('#s360-badge').filter({hasText:'2/2 warnings'}).waitFor();
   await page.getByRole('heading',{name:'Third incident: evidence review'}).waitFor();
   assert.equal(forced,0);assert.equal(await page.locator('#s360-gate img').count(),1);assert.equal(await page.locator('#s360-gate svg rect').count(),1);
   assert.ok((await page.locator('#s360-close-countdown').innerText()).includes('Exam will close in 60 seconds'));
   assert.equal(await page.locator('#s360-gate section').evaluate(section=>section.lastElementChild.id),'s360-close-countdown');
   const footerBox=await page.locator('#s360-close-countdown').boundingBox();assert.ok(footerBox.y>=0&&footerBox.y+footerBox.height<=page.viewportSize().height);
   await page.clock.fastForward(58000);assert.equal(forced,0);
   await page.clock.fastForward(3000);
   await page.waitForFunction(()=>document.querySelector('#s360-status').textContent.includes('automatically submitted'));
   for(let i=0;i<20&&!navigated;i++)await new Promise(resolve=>setTimeout(resolve,50));
   assert.equal(forced,1);assert.equal(navigated,'closed');assert.equal(policy.strikes,3);assert.equal(lastDraft.kind,type);
   assert.equal(policy.events.filter(event=>event.type==='confirmed_incident'&&event.evidence?.image).length,3);
   if(type==='mcq')assert.equal(lastDraft.payload.answers[0],1);
   if(type==='coding')assert.equal(lastDraft.payload.code,'print(42)');
   if(type==='interview')assert.equal(lastDraft.payload.responses[0].answer,'My current interview answer');
   assert.deepEqual(errors,[]);
   console.log(`PASS: ${type} camera consent, preflight, two visible warnings, third-incident submission and preservation of the latest answer draft.`);
   await page.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
