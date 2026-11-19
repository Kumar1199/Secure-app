// src/main/main.js
const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ProctorPolicy } = require('./proctorPolicy');
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
protocol.registerSchemesAsPrivileged([{ scheme: 's360-assets', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function pendingFile() { return path.join(app.getPath('userData'), 'pending-proctored-exam.bin'); }
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
  const finalPayload = { ...payload, proctorReport: proctor.report() };
  if (forced || proctor.terminated) finalPayload.submissionReason = 'proctor_limit';
  submitting = (async () => {
    if (finalPayload.submissionReason === 'proctor_limit') preserveForcedDraft(type, finalPayload);
    const method = type === 'mcq' ? 'submitMCQ' : 'submitCode';
    const result = finalPayload.submissionReason === 'proctor_limit'
      ? await apiHandler.submitForced(type, finalPayload) : await apiHandler[method](finalPayload);
    if (result?.success) { submitted = result; try { fs.unlinkSync(pendingFile()); } catch {} }
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
      devTools: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/pin.html'));

  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' && webContents === mainWindow.webContents && webContents.getURL().startsWith('file://')) return callback(true);
    callback(false);
  });

  mainWindow.on('close', (e) => {
    if (examActive || examCompleted) e.preventDefault();
  });
}

// ─── Registered Handlers ─────────────────────────────────────

handleIPC('validate-pin', async (_, pin) => {
  const result = await apiHandler.validatePin(pin);
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
  examActive = true;
  if (mainWindow && !mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  lockdown.start(mainWindow);
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
  return { success: true };
});

handleIPC('end-exam', async () => {
  examActive = false;
  examCompleted = true;
  return { success: true };
});

handleIPC('exit-app', async () => {
  examActive = false;
  examCompleted = false;
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
    if (result.action === 'submit') evidenceReviewUntil = Date.now() + 120000;
  }
  if (result.action === 'submit') result.reviewUntil = evidenceReviewUntil;
  if (result.action === 'submit' && lastDraft) {
    void submitProtected(lastDraft.type, lastDraft.payload, true).then(value => mainWindow?.webContents.send('proctor-submitted', value)).catch(error => mainWindow?.webContents.send('proctor-submitted', { success: false, message: error.message }));
  }
  return result;
});
handleIPC('proctor-focus', (_, focused) => { if (examActive) proctor.record(focused ? 'window_focused' : 'window_unfocused', { advisory: true }); return true; });
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
