const { app, BrowserWindow, protocol, safeStorage, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
protocol.registerSchemesAsPrivileged([{ scheme: 's360-assets', privileges: { standard:true, secure:true, supportFetchAPI:true, corsEnabled:true } }]);
app.whenReady().then(async()=>{
  const fixture=nativeImage.createFromPath(path.join(__dirname,'portrait.jpg')).resize({width:320,height:240}).toJPEG(60);
  require('node:fs').writeFileSync(path.join(__dirname,'evidence.jpg'),fixture);
  assert.equal(safeStorage.isEncryptionAvailable(),true);
  const protectedAnswers=safeStorage.encryptString('sample answer draft');
  assert.equal(protectedAnswers.includes(Buffer.from('sample answer draft')),false);
  assert.equal(safeStorage.decryptString(protectedAnswers),'sample answer draft');
  const packageRoot=process.env.S360_PACKAGED_ASAR || path.resolve(__dirname,'..');
  require(path.join(packageRoot,'src/main/proctorAssets')).registerProctorAssets();
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try {
    await win.loadFile(path.join(__dirname,'proctor-runtime.html'));
    const worker=pathToFileURL(path.join(packageRoot,'src/renderer/scripts/proctor-worker.js')).href;
    const portrait=pathToFileURL(path.resolve(__dirname,'portrait.jpg')).href;
    const sample=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const worker=new Worker(${JSON.stringify(worker)});const timer=setTimeout(()=>reject(new Error('Model startup timeout')),60000);let frames=[],samples=[];
      worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
      worker.onmessage=async({data})=>{
        if(data.type==='error'){clearTimeout(timer);reject(new Error(data.message));}
        if(data.type==='ready'){
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#888';ctx.fillRect(0,0,640,480);
          const img=new Image();img.src=${JSON.stringify(portrait)};await img.decode();
          const one=document.createElement('canvas');one.width=img.width;one.height=img.height;one.getContext('2d').drawImage(img,0,0);
          const two=document.createElement('canvas');two.width=img.width*2;two.height=img.height;const ctx2=two.getContext('2d');ctx2.drawImage(img,0,0);ctx2.drawImage(img,img.width,0);
          frames=[canvas,one,two];const bitmap=await createImageBitmap(frames.shift());worker.postMessage({type:'frame',bitmap,timestamp:performance.now()},[bitmap]);
        }
        if(data.type==='sample'){samples.push(data);if(frames.length){const bitmap=await createImageBitmap(frames.shift());worker.postMessage({type:'frame',bitmap,timestamp:performance.now()},[bitmap]);}else{clearTimeout(timer);worker.terminate();resolve(samples);}}
      };worker.postMessage({type:'init'});
    })`);
    assert.equal(sample[0].faceCount,0);assert.equal(sample[0].phoneConfidence,0);
    assert.equal(sample[1].faceCount,1);assert.equal(sample[2].faceCount,2);
    console.log('PASS: real local models in Electron detect blank=0 faces, portrait=1 face and side-by-side portraits=2 faces.');
    win.destroy();app.exit(0);
  } catch(error){console.error('FAIL:',error.message);win.destroy();app.exit(1);}
});
