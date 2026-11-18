// Compatibility adapter: the Electron client communicates with the server API;
// MongoDB credentials and database access stay on the server.
const https = require('https');
const http = require('http');
const config = require('../../config/config');

let examToken = null;
let activeExam = null;

function request(action, body, token = examToken) {
  const base = config.WEB_APP_BASE_URL;
  if (!base) throw new Error('STUDENT360_API_BASE_URL is not configured.');
  const endpoint = new URL(base);
  const [route, ...params] = action.split('&');
  endpoint.searchParams.set('path', route);
  for (const [key,value] of new URLSearchParams(params.join('&'))) endpoint.searchParams.set(key,value);
  const lib = endpoint.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = lib.request(endpoint, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      timeout: 120000
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(text); } catch { data = {}; }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(data.error || data.message || `API request failed (${res.statusCode}).`));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('API request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getInviteByCode(code) {
  const result = await request('exam/validate-pin', { pin: code }, null);
  if (!result.success) return null;
  examToken = result.token;
  activeExam = result;
  return result.invite || { id: code, rollNo: result.student?.rollNumber, examId: result.schedule?._id || result.schedule?.id, ...result.student };
}

async function getStudentByRoll(rollNo) {
  return activeExam?.student ? { rollNo, name: activeExam.student.name } : null;
}

async function getExamById(examId) {
  return activeExam?.schedule || null;
}

async function getGeneratedQuestions(examId) {
  const result = await request('mongo', { collection: 'generated_questions', operation: 'get', id: examId });
  return result.document || null;
}

async function saveGeneratedQuestions(examId, payload) {
  await request('mongo', { collection: 'generated_questions', operation: 'upsert', id: examId, data: { examId, payload, createdAt: new Date().toISOString() } });
  return true;
}

async function saveSubmission(payload) {
  return request('mongo', { collection: 'exam_submissions', operation: 'insert', data: payload });
}

async function checkExamSubmission(studentId, examId) {
  const result = await request('mongo', { collection: 'exam_submissions', operation: 'list', filters: [{ field: 'studentId', value: studentId }, { field: 'examId', value: examId }] });
  return result.documents?.[0] || null;
}

async function getQuestionBank(examId) {
  const result = await request('exam/questions&examId=' + encodeURIComponent(examId));
  return result.bank;
}
function usesQuestionBank() { return activeExam?.schedule?.questionSource === 'csv'; }
async function runUploadedCode(payload) { return request('exam/run-code', payload); }
async function saveExamCheckin(payload) { return request('exam/checkin', payload); }
module.exports = { getQuestionBank, usesQuestionBank, runUploadedCode, saveExamCheckin, getInviteByCode, getStudentByRoll, getExamById, getGeneratedQuestions, saveGeneratedQuestions, saveSubmission, checkExamSubmission };
