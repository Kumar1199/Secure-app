// src/main/main.js
const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ProctorPolicy } = require('./proctorPolicy');
const { ApplicationIntegrityMonitor } = require('./applicationIntegrityMonitor');
const { sanitizeEvidence } = require('./proctorEvidence');
const lockdown = require('./lockdown');
const apiHandler = require('./apiHandler');
const speechService = require('./speechService');

console.log('MAIN PROCESS: starting electron main');

let mainWindow = null;
let powerSaveId = null;
let examActive = false;
let examCompleted = false;
let proctor = new ProctorPolicy();
let lastDraft = null, submitting = null, submitted = null;
let evidenceReviewUntil = 0;
let integrityMonitor;
let secureSession = null, heartbeatTimer = null, syncingEvents = false;
protocol.registerSchemesAsPrivileged([{ scheme: 's360-assets', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function pendingFile() { return path.join(app.getPath('userData'), 'pending-proctored-exam.bin'); }
function eventQueueFile() { return path.join(app.getPath('userData'), 'pending-security-events.bin'); }
function secretValueFile(name) { return path.join(app.getPath('userData'), name); }
function encryptedRead(filename, fallback) { try { return safeStorage.isEncryptionAvailable() && fs.existsSync(filename) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(filename))) : fallback; } catch { return fallback; } }
function encryptedWrite(filename, value) { if (!safeStorage.isEncryptionAvailable()) return false; fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(filename + '.tmp', safeStorage.encryptString(JSON.stringify(value))); fs.renameSync(filename + '.tmp', filename); return true; }
function stableDeviceId() { const filename = secretValueFile('exam-device-id.bin'); const saved = encryptedRead(filename, null); if (typeof saved?.id === 'string' && /^[A-Za-z0-9._:-]{16,160}$/.test(saved.id)) return saved.id; const id = `electron:${crypto.randomUUID()}`; encryptedWrite(filename, { id }); return id; }
function queueSecurityEvent(type, metadata = {}, source = 'electron') {
  if (!secureSession?.sessionId) return;
  const event = { eventId: `event:${crypto.randomUUID()}`, type, timestamp: new Date().toISOString(), confidence: Number(metadata.confidence) || 0, metadata: { ...metadata, source } };
  const queue = encryptedRead(eventQueueFile(), []); queue.push(event); encryptedWrite(eventQueueFile(), queue.slice(-1000)); void syncSecurityEvents();
}
async function syncSecurityEvents() {
  if (syncingEvents || !secureSession?.sessionId) return;
  const queue = encryptedRead(eventQueueFile(), []); if (!Array.isArray(queue) || !queue.length) return;
  syncingEvents = true;
  try { const result = await apiHandler.syncSecurityEvents(secureSession.sessionId, secureSession.deviceId, queue.slice(0, 100)); if (result?.success) { const terminal = new Set([...(result.data?.accepted || []), ...(result.data?.rejected || [])]); encryptedWrite(eventQueueFile(), queue.filter(item => !terminal.has(item.eventId))); } }
  finally { syncingEvents = false; }
}
async function sendHeartbeat() {
  if (!secureSession?.sessionId || !examActive) return;
  const result = await apiHandler.heartbeat(secureSession.sessionId, secureSession.deviceId);
  if (result?.success) { secureSession = { ...secureSession, ...result.data?.session }; void syncSecurityEvents(); }
}
function stopHeartbeat() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; }
function preserveForcedDraft(type, payload) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure local answer storage is unavailable. Keep the app open and retry submission.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const filename = pendingFile();
  fs.writeFileSync(filename + '.tmp', safeStorage.encryptString(JSON.stringify({ type, payload })));
  fs.renameSync(filename + '.tmp', filename);
}
async function submitProtected(type, payload, forced = false) {
  if (submitted) return submitted;
  if (submitting) return submitting;
  const finalPayload = { ...payload, ...(secureSession?.sessionId ? { sessionId: secureSession.sessionId } : {}), proctorReport: proctor.report() };
  if (forced || proctor.terminated) finalPayload.submissionReason = 'proctor_limit';
  submitting = (async () => {
    if (finalPayload.submissionReason === 'proctor_limit') preserveForcedDraft(type, finalPayload);
    const method = type === 'mcq' ? 'submitMCQ' : 'submitCode';
    const result = finalPayload.submissionReason === 'proctor_limit'
      ? await apiHandler.submitForced(type, finalPayload) : await apiHandler[method](finalPayload);
    if (result?.success) { submitted = result; stopHeartbeat(); try { fs.unlinkSync(pendingFile()); } catch {} }
    return result;
  })();
  try { return await submitting; } finally { submitting = null; }
}

/**
 * A+ Grade IPC Handler Wrapper
 * Automatically logs and catches errors to prevent main process crashes
 */
function handleIPC(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    // In production, only the one trusted SecureExam renderer may invoke privileged APIs.
    if (mainWindow && event?.sender && event.sender !== mainWindow.webContents) return { success: false, message: 'Untrusted IPC sender.' };
    console.log(`IPC: [${channel}] request received`);
    try {
      const result = await handler(event, ...args);
      return result;
    } catch (err) {
      console.error(`IPC: [${channel}] error:`, err.message);
      return { success: false, message: 'Internal Server Error: ' + err.message };
    }
  });
}

// ─── Single Instance Lock ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.focus();
    if (examActive || examCompleted) lockdown.enforce(mainWindow);
  }
});

// ─── App Ready ────────────────────────────────────────────────
app.whenReady().then(() => {
  require('./proctorAssets').registerProctorAssets();
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}).catch(err => {
  console.error('MAIN PROCESS: Initialization failed:', err);
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width, height,
    minWidth: width, minHeight: height,
    frame: true, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/pin.html'));
  integrityMonitor = new ApplicationIntegrityMonitor({ active: () => examActive, emit: (type, metadata) => {
    const result = proctor.securityEvent(type, metadata);
    queueSecurityEvent(type, metadata, 'application_integrity');
    if (result.action === 'submit' && lastDraft) void submitProtected(lastDraft.type, lastDraft.payload, true).then(value => mainWindow?.webContents.send('proctor-submitted', value));
    return result;
  }});
  integrityMonitor.attach(mainWindow);

  const ses = mainWindow.webContents.session;
  const trustedLocalRenderer = webContents => webContents === mainWindow.webContents && webContents.getURL().startsWith('file://');
  // Both checks are required by Chromium/Electron across Windows versions:
  // the check handler prevents a second post-check-in prompt from being
  // rejected while the request handler resolves the actual media request.
  ses.setPermissionCheckHandler((webContents, permission) => permission === 'media' && trustedLocalRenderer(webContents));
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' && trustedLocalRenderer(webContents)) return callback(true);
    callback(false);
  });

  mainWindow.on('close', (e) => {
    if (examActive || examCompleted) e.preventDefault();
  });
}

// ─── Registered Handlers ─────────────────────────────────────

handleIPC('validate-pin', async (_, pin) => {
  const result = await apiHandler.validatePin(pin);
  if (result?.success) { secureSession = null; stopHeartbeat(); }
  if (result?.success && fs.existsSync(pendingFile())) {
    try {
      const pending = JSON.parse(safeStorage.decryptString(fs.readFileSync(pendingFile())));
      if (pending.payload.studentId === result.data.student.rollNumber && pending.payload.examId === result.data.invite?.examId) {
        const saved = await apiHandler.submitForced(pending.type, pending.payload);
        if (saved?.success) { fs.unlinkSync(pendingFile()); return { success: false, message: 'Your previous automatic submission has now been saved. This exam cannot be retaken.' }; }
        return { success: false, message: 'Your previous submission is pending. Check the connection and retry this PIN.' };
      }
      return { success: false, message: 'A previous automatic submission is pending. Retry that exam PIN before starting another exam.' };
    } catch { return { success: false, message: 'A protected exam submission needs recovery. Contact the administrator.' }; }
  }
  return result;
});
handleIPC('fetch-exam-schedule', (_, pin) => apiHandler.fetchExamSchedule(pin));
handleIPC('fetch-questions', (_, data) => apiHandler.generateQuestions(data));
handleIPC('save-exam-checkin', (_, payload) => apiHandler.saveExamCheckin(payload));

handleIPC('start-exam', async () => {
  if (!examActive) { proctor = new ProctorPolicy(); lastDraft = null; submitting = null; submitted = null; evidenceReviewUntil = 0; }
  if (!secureSession?.sessionId) {
    const deviceId = stableDeviceId(); const started = await apiHandler.startExamSession(deviceId);
    if (!started?.success) return started;
    secureSession = { ...started.data?.session, deviceId };
    const interval = Math.max(5000, Number(started.data?.heartbeatIntervalMs || 15000));
    stopHeartbeat(); heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, interval); void syncSecurityEvents();
  }
  examActive = true;
  if (mainWindow && !mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  lockdown.start(mainWindow);
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
  return { success: true };
});

handleIPC('end-exam', async () => {
  examActive = false;
  stopHeartbeat();
  examCompleted = true;
  return { success: true };
});

handleIPC('exit-app', async () => {
  examActive = false;
  examCompleted = false;
  stopHeartbeat();
  lockdown.stop(mainWindow);
  if (powerSaveId !== null) powerSaveBlocker.stop(powerSaveId);
  app.quit();
  return { success: true };
});

handleIPC('proctor-state', () => proctor.report());
handleIPC('proctor-draft', (_, type, payload) => {
  if (!examActive || !['mcq','coding'].includes(type)) return { success: false };
  if (!proctor.terminated) lastDraft = { type, payload };
  return { success: true };
});
handleIPC('proctor-observe', (_, sample) => {
  if (!examActive || submitted) return { ...proctor.snapshot(), inactive: true };
  const result = proctor.observe(sample);
  if (result.event?.type === 'confirmed_incident') {
    result.event.evidence = sanitizeEvidence(sample.evidence);
    result.event.evidenceMissing = !result.event.evidence;
    if (result.event.securityEvent) {
      result.event.securityEvent.evidenceId = result.event.evidence ? result.event.securityEvent.eventId : null;
      result.event.securityEvent.metadata = { ...result.event.securityEvent.metadata, faceCount: result.event.faceCount, detectedObjects: result.event.reasons, riskScore: result.riskScore, applicationState: 'exam_active' };
    }
    if (result.action === 'submit') evidenceReviewUntil = Date.now() + 120000;
  }
  if (result.event?.securityEvent) queueSecurityEvent(result.event.securityEvent.type, result.event.securityEvent.metadata || {}, 'camera');
  if (result.action === 'submit') result.reviewUntil = evidenceReviewUntil;
  if (result.action === 'submit' && lastDraft) {
    void submitProtected(lastDraft.type, lastDraft.payload, true).then(value => mainWindow?.webContents.send('proctor-submitted', value)).catch(error => mainWindow?.webContents.send('proctor-submitted', { success: false, message: error.message }));
  }
  return result;
});
handleIPC('proctor-focus', (_, focused) => { if (examActive && !focused) { proctor.securityEvent('WINDOW_FOCUS_LOST', { applicationState: 'exam_active' }); queueSecurityEvent('WINDOW_FOCUS_LOST', { applicationState: 'exam_active' }); } return true; });
handleIPC('security-activity', (_, type, metadata = {}) => {
  const allowed = new Set(['CLIPBOARD_ATTEMPT','PROHIBITED_SHORTCUT','CODE_LARGE_INSERT','CODE_RAPID_CHANGE','CODE_RUN','NETWORK_OFFLINE','NETWORK_RESTORED','SESSION_DUPLICATE']);
  if (!examActive || !allowed.has(type) || !metadata || typeof metadata !== 'object') return { success: false };
  const result = proctor.securityEvent(type, { ...metadata, applicationState: 'exam_active' }); queueSecurityEvent(type, { ...metadata, applicationState: 'exam_active' }); return { success: true, result };
});
handleIPC('proctor-simulate', (_, sample) => {
  if (app.isPackaged === true || process.env.S360_PROCTOR_SIMULATION !== '1') return { success: false, error: 'Simulation mode is disabled.' };
  if (!examActive) return { success: false, error: 'Start an exam before injecting an event.' };
  return { success: true, result: proctor.observe({ cameraState: 'live', detectorReady: true, faceCount: 1, phoneConfidence: 0, headDirection: 'forward', eyeDirection: 'forward', brightness: 120, ...sample }) };
});
handleIPC('proctor-force-submit', () => lastDraft ? submitProtected(lastDraft.type, lastDraft.payload, true) : { success: false, message: 'No answer draft is available.' });
handleIPC('submit-mcq', (_, p) => submitProtected('mcq', p));
handleIPC('run-code', (_, p) => apiHandler.runCode(p));
handleIPC('submit-code', (_, p) => submitProtected('coding', p));
handleIPC('check-exam-submission', (_, studentId, examId) => apiHandler.checkExamAlreadySubmitted(studentId, examId));

handleIPC('tts-speak', (_, p) => speechService.textToSpeech_espeak(p.text, p.lang));
handleIPC('transcribe-audio', (_, p) => speechService.speechToText_whisper(p.base64, p.mimeType));

handleIPC('navigate', async (_, page) => {
  const allowed = ['pin', 'confirmation', 'waiting', 'mcq', 'coding', 'completed'];
  if (allowed.includes(page)) {
    await mainWindow.loadFile(path.join(__dirname, `../renderer/pages/${page}.html`));
    if (examActive && ['mcq', 'coding'].includes(page)) lockdown.enforce(mainWindow);
    return { success: true };
  }
  return { success: false };
});

// Session Management
let sessionStore = {};
handleIPC('set-session', (_, k, v) => { sessionStore[k] = v; return true; });
handleIPC('get-session', (_, k) => sessionStore[k] || null);
handleIPC('clear-session', () => { sessionStore = {}; return true; });
