// src/main/main.js
const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const lockdown = require('./lockdown');
const apiHandler = require('./apiHandler');
const speechService = require('./speechService');

console.log('MAIN PROCESS: starting electron main');

let mainWindow = null;
let powerSaveId = null;
let examActive = false;
let examCompleted = false;

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
    if (permission === 'media') return callback(true);
    callback(false);
  });

  mainWindow.on('close', (e) => {
    if (examActive || examCompleted) e.preventDefault();
  });
}

// ─── Registered Handlers ─────────────────────────────────────

handleIPC('validate-pin', (_, pin) => apiHandler.validatePin(pin));
handleIPC('fetch-exam-schedule', (_, pin) => apiHandler.fetchExamSchedule(pin));
handleIPC('fetch-questions', (_, data) => apiHandler.generateQuestions(data));

handleIPC('start-exam', async () => {
  examActive = true;
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

handleIPC('submit-mcq', (_, p) => apiHandler.submitMCQ(p));
handleIPC('run-code', (_, p) => apiHandler.runCode(p));
handleIPC('submit-code', (_, p) => apiHandler.submitCode(p));
handleIPC('submit-interview', (_, p) => apiHandler.submitInterview(p));
handleIPC('check-exam-submission', (_, studentId, examId) => apiHandler.checkExamAlreadySubmitted(studentId, examId));
handleIPC('analyze-frame', (_, p) => apiHandler.analyzeFrame(p));

handleIPC('tts-speak', (_, p) => speechService.textToSpeech_espeak(p.text, p.lang));
handleIPC('transcribe-audio', (_, p) => speechService.speechToText_whisper(p.base64, p.mimeType));

handleIPC('navigate', async (_, page) => {
  const allowed = ['pin', 'confirmation', 'waiting', 'mcq', 'coding', 'interview', 'completed'];
  if (allowed.includes(page)) {
    mainWindow.loadFile(path.join(__dirname, `../renderer/pages/${page}.html`));
    return { success: true };
  }
  return { success: false };
});

// Session Management
let sessionStore = {};
handleIPC('set-session', (_, k, v) => { sessionStore[k] = v; return true; });
handleIPC('get-session', (_, k) => sessionStore[k] || null);
handleIPC('clear-session', () => { sessionStore = {}; return true; });
