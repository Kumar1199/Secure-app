const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {ApplicationIntegrityMonitor}=require('../src/main/applicationIntegrityMonitor');
test('fullscreen, focus, close and renderer failures are emitted once per cooldown',()=>{
 let active=true;const events=[];const monitor=new ApplicationIntegrityMonitor({active:()=>active,emit:(type,metadata)=>events.push({type,metadata})});
 const win=new EventEmitter();win.webContents=new EventEmitter();win.webContents.setWindowOpenHandler=fn=>{win.open=fn};monitor.attach(win);
 win.emit('blur');win.emit('blur');win.emit('leave-full-screen');win.emit('close');win.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1});
 assert.deepEqual(events.map(e=>e.type),['WINDOW_FOCUS_LOST','FULLSCREEN_EXIT','WINDOW_CLOSE_ATTEMPT','RENDERER_CRASH']);
 active=false;win.emit('minimize');assert.equal(events.length,4);
});
test('new window and devtools shortcuts are blocked by main-process monitor',()=>{
 const events=[];const monitor=new ApplicationIntegrityMonitor({active:()=>true,emit:type=>events.push(type)});const win=new EventEmitter();win.webContents=new EventEmitter();win.webContents.setWindowOpenHandler=fn=>{win.open=fn};monitor.attach(win);
 assert.equal(win.open().action,'deny');let blocked=false;win.webContents.emit('before-input-event',{preventDefault(){blocked=true;}},{key:'F12',control:false,shift:false});assert.equal(blocked,true);assert.deepEqual(events,['NAVIGATION_BLOCKED','DEVTOOLS_ATTEMPT']);
});
