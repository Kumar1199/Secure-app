// src/main/apiHandler.js
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../config/config');
const store = require('./firestoreStore');

// ─── Helpers ──────────────────────────────────────────────────
function httpPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };

    const req = lib.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData) }); }
        catch { resolve({ status: res.statusCode, data: responseData }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers
    };

    const req = lib.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData) }); }
        catch { resolve({ status: res.statusCode, data: responseData }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function runLocalPython(code, stdin) {
  try {
    const result = spawnSync('python', ['-u', '-c', code], {
      input: stdin || '',
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    if (result.error && result.error.code === 'ENOENT') return null;

    return {
      success: true,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      status: result.status === 0 ? { id: 3, description: 'Accepted' } : { id: 1, description: 'Runtime Error' },
      time: '0.01',
      memory: 0
    };
  } catch (err) {
    return null;
  }
}

function runMockC(code) {
  const stringMatch = code.match(/printf\s*\(\s*"([^"]*)"/);
  if (stringMatch) {
    return {
      success: true,
      stdout: stringMatch[1],
      stderr: '',
      status: { id: 3, description: 'Accepted' },
      time: '0.01',
      memory: 0
    };
  }

  return {
    success: true,
    stdout: '',
    stderr: 'C compilation fallback is not available locally. Please use a working C compiler endpoint or Judge0.',
    status: { id: 6, description: 'Internal Error' },
    time: '0.00',
    memory: 0
  };
}

async function tryCompilerPaths(baseUrl, payload) {
  const paths = ['', '/run', '/execute', '/compile', '/api/run', '/api/compile', '/api/v1/run', '/api/v1/compile'];
  let lastError = null;
  for (const path of paths) {
    const url = baseUrl.replace(/\/$/, '') + path;
    try {
      const res = await httpPost(url, payload);
      if (res && (res.status === 200 || res.status === 201)) {
        return { success: true, url, response: res };
      }
      lastError = `Compiler endpoint ${url} returned ${res.status}: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`;
    } catch (err) {
      lastError = `Compiler endpoint ${url} error: ${err.message}`;
    }
  }
  return { success: false, error: lastError || 'Compiler endpoint unavailable' };
}

function parseDurationValue(value) {
  if (!value && value !== 0) return null;
  const raw = String(value).trim();
  const secondsMatch = raw.match(/(\d+\.?\d*)\s*(s|sec|second)/i);
  if (secondsMatch) return Math.round(parseFloat(secondsMatch[1]));
  const minutesMatch = raw.match(/(\d+\.?\d*)\s*(m|min|minute|minutes)/i);
  if (minutesMatch) return Math.round(parseFloat(minutesMatch[1]) * 60);
  const hoursMatch = raw.match(/(\d+\.?\d*)\s*(h|hr|hour|hours)/i);
  if (hoursMatch) return Math.round(parseFloat(hoursMatch[1]) * 3600);
  const numberMatch = raw.match(/^(\d+)$/);
  if (numberMatch) {
    const n = parseInt(numberMatch[1], 10);
    return n <= 720 ? n * 60 : n;
  }
  const parts = raw.split(/\s+/);
  const first = parseFloat(parts[0]);
  if (!Number.isFinite(first)) return null;
  return first <= 720 ? Math.round(first * 60) : Math.round(first);
}

function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const normalized = { ...schedule };

  normalized.startTime = normalized.startTime || normalized.start_time || normalized.startDate || normalized.start_date || normalized.start || normalized.examStart || (normalized.date && normalized.time ? `${normalized.date} ${normalized.time}` : null) || normalized.time;
  normalized.endTime = normalized.endTime || normalized.end_time || normalized.endDate || normalized.end_date || normalized.end || normalized.examEnd;

  const parsedDuration = parseDurationValue(normalized.duration || normalized.durationSeconds || normalized.durationMinutes || normalized.duration_min || normalized.duration_mins || normalized.duration_minute);
  normalized.duration = parsedDuration || null;

  if (!normalized.startTime && normalized.date && normalized.time) {
    normalized.startTime = `${normalized.date} ${normalized.time}`;
  }

  if (normalized.startTime && !normalized.endTime && normalized.duration) {
    const startDate = new Date(normalized.startTime);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime() + normalized.duration * 1000);
      normalized.endTime = endDate.toISOString();
    }
  }

  if (normalized.startTime && !normalized.endTime && normalized.startTime.includes('T') && normalized.duration) {
    const startDate = new Date(normalized.startTime);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime() + normalized.duration * 1000);
      normalized.endTime = endDate.toISOString();
    }
  }

  return normalized;
}

function normalizeStudent(student, rollNo, invite, exam) {
  const normalized = { ...(student || {}) };
  normalized.rollNumber = normalized.rollNumber || normalized.rollNo || rollNo || normalized.id || '';
  normalized.rollNo = normalized.rollNo || normalized.rollNumber;
  normalized.name = normalized.name || normalized.studentName || normalized.fullName || invite?.name || invite?.studentName || 'Student';
  normalized.examType = normalized.examType || invite?.examType || invite?.type || invite?.exam || exam?.examType || exam?.type || exam?.exam || 'MCQ';
  normalized.difficulty = normalized.difficulty || invite?.difficulty || exam?.difficulty || 'medium';
  normalized.subject = normalized.subject || invite?.subject || exam?.subject || exam?.title || exam?.department || 'General';
  normalized.duration = normalized.duration || parseDurationValue(exam?.duration) || parseDurationValue(invite?.duration) || null;
  normalized.questionCount = normalized.questionCount || exam?.questionCount || invite?.questionCount || 10;
  normalized.description = normalized.description || exam?.description || invite?.description || '';
  return normalized;
}

// ─── Gemini API Call ──────────────────────────────────────────
async function callGemini(prompt, imageBase64 = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`;

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({
      inline_data: { mime_type: 'image/jpeg', data: imageBase64 }
    });
  }

  const body = { contents: [{ parts }] };
  const result = await httpPost(url, body);

  if (result.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return result.data.candidates[0].content.parts[0].text;
  }
  throw new Error('Gemini API error: ' + JSON.stringify(result.data));
}

// ─── 1. Validate PIN ──────────────────────────────────────────
async function validatePin(pin) {
  try {
    // Try Firestore first (examInvites -> student -> exam)
    const invite = await store.getInviteByCode(pin);
    if (invite) {
      const examId = invite.examId || invite.exam || invite.exam_id;
      const rollNo = invite.rollNo || invite.rollNo || invite.roll_no || invite.rollnumber || invite.rollNumber;
      const student = rollNo ? await store.getStudentByRoll(rollNo) : null;
      const exam = examId ? await store.getExamById(examId) : null;

      return {
        success: true,
        student: normalizeStudent(student || { rollNo, name: invite.name || invite.studentName }, rollNo, invite, exam),
        schedule: normalizeSchedule(exam) || normalizeSchedule(invite) || null,
        invite
      };
    }

    // Fallback to existing HTTP / Power Automate flow
    const baseUrl = config.WEB_APP_BASE_URL && !config.WEB_APP_BASE_URL.includes('YOUR_')
      ? config.WEB_APP_BASE_URL.replace(/\/+$/, '')
      : null;

    if (baseUrl) {
      const res = await httpPost(`${baseUrl}/validate-pin`, { code: pin });
      if (res.status === 200 && res.data) {
        if (res.data.success) {
          return {
            success: true,
            student: res.data.student || res.data,
            schedule: res.data.schedule || res.data.examSchedule || null
          };
        }
        if (res.data.student) {
          return {
            success: true,
            student: res.data.student,
            schedule: res.data.schedule || res.data.examSchedule || null
          };
        }
        return { success: false, message: res.data.message || 'Invalid PIN' };
      }
    }

    // MOCK fallback
    if (config.POWERAUTOMATE.VALIDATE_PIN && config.POWERAUTOMATE.VALIDATE_PIN.startsWith('YOUR_')) {
      const mockMap = {
        '123456': { name: 'Test Student', rollNo: 'CS2021001', rollNumber: 'CS2021001', examType: 'MCQ', difficulty: 'medium', subject: 'Data Structures', duration: 3600, pinUsed: false },
        '222222': { name: 'Coder Student', rollNo: 'CS2021002', rollNumber: 'CS2021002', examType: 'CODING', difficulty: 'medium', subject: 'Algorithms', duration: 3600, pinUsed: false },
        '333333': { name: 'Interview Student', rollNo: 'CS2021003', rollNumber: 'CS2021003', examType: 'INTERVIEW', difficulty: 'easy', subject: 'System Design', duration: 3600, pinUsed: false }
      };
      if (mockMap[pin]) return { success: true, student: normalizeStudent(mockMap[pin], mockMap[pin].rollNo, null, null), schedule: null };
      return { success: false, message: 'Invalid PIN. Try 123456, 222222 or 333333.' };
    }

    const res = await httpPost(config.POWERAUTOMATE.VALIDATE_PIN, { pin });
    if (res.status === 200 && res.data.success) {
      return res.data;
    }
    return { success: false, message: res.data?.message || 'Invalid PIN' };
  } catch (err) {
    return { success: false, message: 'Network / Firestore error: ' + err.message };
  }
}

// ─── 2. Fetch Exam Schedule ───────────────────────────────────
async function fetchExamSchedule(pin) {
  try {
    const baseUrl = config.WEB_APP_BASE_URL && !config.WEB_APP_BASE_URL.includes('YOUR_')
      ? config.WEB_APP_BASE_URL.replace(/\/+$/, '')
      : null;

    if (baseUrl) {
      const res = await httpPost(`${baseUrl}/exam-schedule`, { pin });
      if (res.status === 200 && res.data) {
        if (res.data.success) {
          return res.data.schedule || res.data;
        }
        return { success: false, message: res.data.message || 'Unable to fetch schedule' };
      }
    }

    if (config.POWERAUTOMATE.EXAM_SCHEDULE.startsWith('YOUR_')) {
      // Mock: exam starts 10 seconds from now for testing
      const start = new Date(Date.now() + 10000).toISOString();
      const end = new Date(Date.now() + 3600000).toISOString(); // 1 hour
      return { success: true, startTime: start, endTime: end, duration: 3600 };
    }

    const res = await httpPost(config.POWERAUTOMATE.EXAM_SCHEDULE, { pin });
    return res.data;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 3. Generate Questions via Gemini ─────────────────────────
async function generateQuestions(examData) {
  const { examId, examType, difficulty, subject, questionCount, description, studentId, studentName } = examData;
  const studentLabel = studentName ? `${studentName} (${studentId || 'ID unknown'})` : studentId || 'a student';

  try {
    if (config.CACHE_GENERATED_QUESTIONS && examId) {
      const cached = await store.getGeneratedQuestions(examId);
      if (cached && cached.payload) {
        return { success: true, type: examType, ...cached.payload };
      }
    }

    let prompt = '';
    let parsed = null;

    if (examType === 'MCQ') {
      prompt = `You are an exam question generator. Generate exactly ${questionCount || 10} multiple choice questions for a ${difficulty} level exam on "${subject}" for ${studentLabel}.
${description ? `Faculty description: ${description}` : ''}

Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "questions": [
    {
      "id": 1,
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0
    }
  ]
}
The "correct" field is the 0-based index of the correct option. Make sure questions are unique and appropriate for ${difficulty} difficulty. Ensure the set is individualized and different from standard generic practice questions.`;

      const response = await callGemini(prompt);
      const clean = response.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
      if (config.CACHE_GENERATED_QUESTIONS && examId) {
        await store.saveGeneratedQuestions(examId, parsed);
      }
      return { success: true, type: 'MCQ', ...parsed };

    } else if (examType === 'CODING') {
      prompt = `You are a coding exam question generator. Generate 1 coding problem for a ${difficulty} level exam on "${subject}" for ${studentLabel}.
${description ? `Faculty description: ${description}` : ''}

Return ONLY valid JSON, no markdown:
{
  "problem": {
    "title": "Problem Title",
    "description": "Full problem statement",
    "inputFormat": "Input format description",
    "outputFormat": "Output format description",
    "constraints": "Constraints",
    "examples": [
      { "input": "example input", "output": "expected output", "explanation": "why" }
    ],
    "testCases": [
      { "input": "test input 1", "expectedOutput": "expected output 1" },
      { "input": "test input 2", "expectedOutput": "expected output 2" },
      { "input": "test input 3", "expectedOutput": "expected output 3" },
      { "input": "test input 4", "expectedOutput": "expected output 4" },
      { "input": "test input 5", "expectedOutput": "expected output 5" }
    ],
    "suggestedLanguages": ["c", "cpp", "java", "python"]
  }
}`;

      const response = await callGemini(prompt);
      const clean = response.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
      if (config.CACHE_GENERATED_QUESTIONS && examId) {
        await store.saveGeneratedQuestions(examId, parsed);
      }
      return { success: true, type: 'CODING', ...parsed };

    } else if (examType === 'INTERVIEW') {
      prompt = `You are an interview question generator. Generate ${questionCount || 5} interview questions for a ${difficulty} level interview on "${subject}" for ${studentLabel}.
${description ? `Faculty description: ${description}` : ''}

Return ONLY valid JSON, no markdown:
{
  "questions": [
    {
      "id": 1,
      "question": "Interview question text?",
      "expectedKeyPoints": ["key point 1", "key point 2", "key point 3"],
      "followUp": "Optional follow-up question"
    }
  ]
}`;

      const response = await callGemini(prompt);
      const clean = response.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
      if (config.CACHE_GENERATED_QUESTIONS && examId) {
        await store.saveGeneratedQuestions(examId, parsed);
      }
      return { success: true, type: 'INTERVIEW', ...parsed };
    }

    return { success: false, message: 'Unknown exam type' };
  } catch (err) {
    return { success: false, message: 'Question generation failed: ' + err.message };
  }
}

// ─── 4. Run Code via Judge0 ───────────────────────────────────
async function runCode({ code, language, stdin }) {
  try {
    const langKey = language.toLowerCase();
    let compilerError = null;

    // If a custom compiler endpoint exists for this language, use it
    if (langKey === 'python' && config.COMPILERS && config.COMPILERS.python) {
      const result = await tryCompilerPaths(config.COMPILERS.python, { code, stdin: stdin || '' });
      if (result.success) {
        const res = result.response;
        return { success: true, stdout: res.data.stdout || res.data.output || '', stderr: res.data.stderr || '' };
      }
      compilerError = result.error;
    }

    if (langKey === 'c' && config.COMPILERS && config.COMPILERS.c) {
      const result = await tryCompilerPaths(config.COMPILERS.c, { code, stdin: stdin || '' });
      if (result.success) {
        const res = result.response;
        return { success: true, stdout: res.data.stdout || res.data.output || '', stderr: res.data.stderr || '' };
      }
      compilerError = result.error;
    }

    // Fallback to Judge0 if configured
    const langId = config.LANGUAGE_IDS[langKey];
    if (!langId) return { success: false, message: 'Unsupported language' };

    if (!config.JUDGE0_API_KEY) {
      // No Judge0 key configured: try local fallback engines before failing.
      if (langKey === 'python') {
        const local = runLocalPython(code, stdin);
        if (local) return local;
      }
      if (langKey === 'c') {
        const local = runMockC(code);
        if (local) return local;
      }

      return {
        success: false,
        stdout: '',
        stderr: compilerError || 'No code execution engine configured. Set JUDGE0_API_KEY or COMPILERS in config/config.js.',
        status: { id: 6, description: 'Internal Error' },
        time: '0.00',
        memory: 0
      };
    }

    const submitHeaders = {
      'X-RapidAPI-Key': config.JUDGE0_API_KEY,
      'X-RapidAPI-Host': config.JUDGE0_HOST
    };

    const submission = await httpPost(
      `${config.JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
      {
        source_code: code,
        language_id: langId,
        stdin: stdin || '',
        cpu_time_limit: 5,
        memory_limit: 128000
      },
      submitHeaders
    );

    if (submission.data && submission.data.token) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await httpGet(
        `${config.JUDGE0_URL}/submissions/${submission.data.token}?base64_encoded=false`,
        submitHeaders
      );
      return { success: true, ...result.data };
    }

    return { success: false, message: 'Submission failed' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 5. Run All Test Cases ────────────────────────────────────
async function submitCode({ studentId, pin, code, language, testCases, examId }) {
  try {
    const results = [];
    let passed = 0;

    for (const tc of testCases) {
      const result = await runCode({ code, language, stdin: tc.input });
      const actualOutput = (result.stdout || '').trim();
      const expectedOutput = (tc.expectedOutput || '').trim();
      const isPass = actualOutput === expectedOutput && result.status?.id === 3;

      results.push({
        input: tc.input,
        expected: expectedOutput,
        actual: actualOutput,
        passed: isPass,
        time: result.time,
        status: result.status?.description
      });

      if (isPass) passed++;
    }

    const payload = {
      studentId, pin,
      examId: examId || null,
      totalCases: testCases.length,
      passedCases: passed,
      allPassed: passed === testCases.length,
      language,
      results,
      submittedAt: new Date().toISOString()
    };

    if (!config.POWERAUTOMATE.SUBMIT_CODE.startsWith('YOUR_')) {
      await httpPost(config.POWERAUTOMATE.SUBMIT_CODE, payload);
    }

    const saved = await store.saveSubmission({ type: 'code', examId: examId || null, ...payload });
    return { success: true, submissionId: saved.id, ...payload };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 6. Submit MCQ Result ─────────────────────────────────────
async function submitMCQ({ studentId, pin, answers, questions, timeTaken, examId }) {
  try {
    let score = 0;
    const detailed = questions.map((q, i) => {
      const isCorrect = answers[i] === q.correct;
      if (isCorrect) score++;
      return {
        questionId: q.id,
        question: q.question,
        selectedOption: answers[i],
        correctOption: q.correct,
        isCorrect
      };
    });

    const payload = {
      studentId, pin,
      examId: examId || null,
      totalQuestions: questions.length,
      correctAnswers: score,
      percentage: Math.round((score / questions.length) * 100),
      detailed,
      timeTaken,
      submittedAt: new Date().toISOString()
    };

    if (!config.POWERAUTOMATE.SUBMIT_MCQ.startsWith('YOUR_')) {
      await httpPost(config.POWERAUTOMATE.SUBMIT_MCQ, payload);
    }

    const saved = await store.saveSubmission({ type: 'mcq', ...payload });
    return { success: true, submissionId: saved.id, ...payload };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 7. Analyze Interview Frame via Gemini Vision ─────────────
async function analyzeFrame({ frameBase64, question, answerSoFar }) {
  try {
    const prompt = `You are a proctoring AI analyzing a student during an interview exam.
Current question: "${question}"
Student's answer so far: "${answerSoFar || 'not yet spoken'}"

Analyze the image for:
1. Face visibility (is student present and facing camera?)
2. Eye movement (focused on screen or looking away?)
3. Suspicious behavior (multiple people, phone, notes, etc.)
4. Expressions (confident, nervous, confused?)
5. Gestures/body language

Return ONLY JSON, no markdown:
{
  "faceVisible": true/false,
  "eyesFocused": true/false,
  "suspiciousBehavior": true/false,
  "suspiciousReason": "description if suspicious",
  "expression": "confident/nervous/confused/neutral",
  "attention": "high/medium/low",
  "proctorAlert": true/false,
  "alertReason": "reason if alert"
}`;

    const response = await callGemini(prompt, frameBase64);
    const clean = response.replace(/```json|```/g, '').trim();
    return { success: true, analysis: JSON.parse(clean) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 8. Submit Interview Result ───────────────────────────────
async function submitInterview({ studentId, pin, examId, responses, proctorLog, overallAnalysis }) {
  try {
    // Ask Gemini to evaluate interview performance
    const evalPrompt = `You are an expert interviewer evaluating a student's interview performance.

Interview responses:
${responses.map((r, i) => `Q${i+1}: ${r.question}\nAnswer: ${r.answer}`).join('\n\n')}

Proctor observations: ${JSON.stringify(proctorLog)}

Evaluate and return ONLY JSON:
{
  "overallScore": 0-100,
  "communicationScore": 0-100,
  "technicalScore": 0-100,
  "confidenceScore": 0-100,
  "summary": "2-3 sentence overall evaluation",
  "strengths": ["strength1", "strength2"],
  "improvements": ["improvement1", "improvement2"],
  "recommendation": "hire/consider/reject",
  "proctorConcerns": "any suspicious behavior noted"
}`;

    let evaluation = null;
    try {
      const evalResponse = await callGemini(evalPrompt);
      const clean = evalResponse.replace(/```json|```/g, '').trim();
      evaluation = JSON.parse(clean);
    } catch (e) {
      evaluation = { overallScore: 0, summary: 'Evaluation failed', error: e.message };
    }

    const payload = {
      studentId, pin,
      examId: examId || null,
      responses,
      evaluation,
      proctorLog,
      submittedAt: new Date().toISOString()
    };

    if (!config.POWERAUTOMATE.SUBMIT_INTERVIEW.startsWith('YOUR_')) {
      await httpPost(config.POWERAUTOMATE.SUBMIT_INTERVIEW, payload);
    }

    const saved = await store.saveSubmission({ type: 'interview', ...payload });
    return { success: true, submissionId: saved.id, ...payload };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Check if exam already submitted ─────────────────────────
async function checkExamAlreadySubmitted(studentId, examId) {
  try {
    const existing = await store.checkExamSubmission(studentId, examId);
    return existing ? { alreadySubmitted: true, submission: existing } : { alreadySubmitted: false };
  } catch (err) {
    return { alreadySubmitted: false, error: err.message };
  }
}

module.exports = {
  validatePin,
  fetchExamSchedule,
  generateQuestions,
  checkExamAlreadySubmitted,
  runCode,
  submitCode,
  submitMCQ,
  analyzeFrame,
  submitInterview
};
