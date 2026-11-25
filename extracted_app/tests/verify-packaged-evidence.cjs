const asar=require('@electron/asar');
const path=require('node:path');
const root=path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar');
const main=asar.extractFile(root,path.join('src','main','main.js')).toString();
const ui=asar.extractFile(root,path.join('src','renderer','scripts','exam-proctor.js')).toString();
const validation=asar.extractFile(root,path.join('src','main','proctorEvidence.js')).toString();
if(!main.includes('evidenceReviewUntil = Date.now() + 120000') || !ui.includes('Third incident: evidence review') || !validation.includes('sanitizeEvidence'))throw new Error('Evidence changes are missing from the packaged app.');
console.log('PASS: packaged app contains evidence validation, incident snapshots and enforced 120-second review.');
