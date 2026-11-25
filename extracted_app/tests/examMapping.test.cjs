const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('PIN lookup preserves the assigned exam, type, title and duration for Electron',async()=>{
 for(const [examType,expected]of [['MCQ','MCQ'],['Coding','CODING'],['Mixed','MIXED']]){
  const module={exports:{}};const exam={id:'assigned-exam',title:'Assigned title',examType,date:'2099-12-01',time:'10:00',duration:'1.5 Hours'};
  const apiRequire=require('node:module').createRequire(path.join(__dirname,'../src/main/apiHandler.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/apiHandler.js'),'utf8'),{module,exports:module.exports,console,Buffer,setTimeout,require(name){if(name==='./firestoreStore')return{getInviteByCode:async()=>({rollNo:'ASSIGNED01',examId:exam.id}),getStudentByRoll:async()=>({name:'Assigned student'}),getExamById:async()=>exam};if(name==='../../config/config')return{};return apiRequire(name);}});
  const result=await module.exports.validatePin('123456');assert.equal(result.success,true);assert.equal(result.data.student.rollNumber,'ASSIGNED01');assert.equal(result.data.student.examType,expected);assert.equal(result.data.student.subject,'Assigned title');assert.equal(result.data.schedule.id,exam.id);assert.equal(result.data.schedule.duration,5400);assert.equal(new Date(result.data.schedule.endTime)-new Date(result.data.schedule.startTime),5400000);
 }
});
