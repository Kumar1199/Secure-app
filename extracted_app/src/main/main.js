// src/main/main.js
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const lockdown = require('./lockdown');
const apiHandler = require('./apiHandler');
const speechService = require('./speechService');

console.log('MAIN PROCESS: starting electron main');

let mainWindow = null;
let powerSaveId = null;
let examActive = false;
let examCompleted = false;

// ─── Single Instance Lock ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('MAIN PROCESS: another instance is already running and prevented startup. Close the existing app before launching again.');
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
app.on('ready', () => console.log('MAIN PROCESS: ready event'));
app.on('before-quit', (e) => {
  if (examActive || examCompleted) {
    console.log('MAIN PROCESS: prevented quit during exam or completion screen');
    e.preventDefault();
  }
});
app.on('will-quit', () => console.log('MAIN PROCESS: will-quit'));
app.on('quit', () => console.log('MAIN PROCESS: quit'));

process.on('uncaughtException', (err) => {
  console.error('MAIN PROCESS: uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('MAIN PROCESS: unhandledRejection', reason);
});

app.whenReady().then(() => {
  console.log('MAIN PROCESS: app.whenReady');
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}).catch(err => {
  console.error('MAIN PROCESS: app.whenReady error', err);
});

app.on('window-all-closed', () => {
  console.log('MAIN PROCESS: window-all-closed', { examActive, examCompleted, platform: process.platform });
  if (examActive || examCompleted) return; // prevent close during exam or completion screen
  if (process.platform !== 'darwin') app.quit();
});

// ─── Create Main Window ───────────────────────────────────────
function createWindow() {
  console.log('MAIN PROCESS: createWindow start');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    frame: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: false,
    fullscreen: false,
    kiosk: false,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  mainWindow.on('close', () => console.log('MAIN PROCESS: mainWindow close event'));
  mainWindow.on('closed', () => console.log('MAIN PROCESS: mainWindow closed'));
  mainWindow.on('unresponsive', () => console.log('MAIN PROCESS: mainWindow unresponsive'));
  mainWindow.webContents.on('render-process-gone', (event, details) => console.log('MAIN PROCESS: render-process-gone', details));
  mainWindow.webContents.on('crashed', () => console.log('MAIN PROCESS: webContents crashed'));
  mainWindow.on('ready-to-show', () => console.log('MAIN PROCESS: mainWindow ready-to-show'));

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/pin.html'));
  console.log('MAIN PROCESS: window loaded pin page');

  // Grant media permission for proctoring camera and microphone requests
  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('MAIN PROCESS: permission request', permission);
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Prevent external navigation
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = `file://${path.join(__dirname, '../renderer')}`;
    if (!url.startsWith(appUrl)) e.preventDefault();
  });

  mainWindow.webContents.on('new-window', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Block devtools
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.on('close', (e) => {
    if (examActive || examCompleted) {
      e.preventDefault();
    }
  });

  mainWindow.on('blur', () => {
    if (examActive || examCompleted) {
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  });
}

// ─── IPC: PIN Validation ───────────────────────────────────────
ipcMain.handle('validate-pin', async (_, pin) => {
  return await apiHandler.validatePin(pin);
});

// ─── IPC: Fetch Exam Schedule ──────────────────────────────────
ipcMain.handle('fetch-exam-schedule', async (_, pin) => {
  return await apiHandler.fetchExamSchedule(pin);
});

// ─── IPC: Fetch & Generate Questions ──────────────────────────
ipcMain.handle('fetch-questions', async (_, examData) => {
  return await apiHandler.generateQuestions(examData);
});

// ─── IPC: Start Exam Lockdown ──────────────────────────────────
ipcMain.handle('start-exam', async () => {
  examActive = true;
  lockdown.start(mainWindow);
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
  return { success: true };
});

// ─── IPC: End Exam Lockdown ────────────────────────────────────
ipcMain.handle('end-exam', async () => {
  examActive = false;
  examCompleted = true;
  return { success: true };
});

ipcMain.handle('exit-app', async () => {
  try {
    examActive = false;
    examCompleted = false;
    lockdown.stop(mainWindow);
    if (powerSaveId !== null) {
      powerSaveBlocker.stop(powerSaveId);
      powerSaveId = null;
    }
  } catch (e) {
    console.error('MAIN PROCESS: exit-app cleanup failed', e);
  }
  app.quit();
  return { success: true };
});

// ─── IPC: Submit MCQ Result ────────────────────────────────────
ipcMain.handle('submit-mcq', async (_, payload) => {
  return await apiHandler.submitMCQ(payload);
});

// ─── IPC: Run Code ─────────────────────────────────────────────
ipcMain.handle('run-code', async (_, payload) => {
  return await apiHandler.runCode(payload);
});

// ─── IPC: Submit Code Result ───────────────────────────────────
ipcMain.handle('submit-code', async (_, payload) => {
  return await apiHandler.submitCode(payload);
});

// ─── IPC: Submit Interview Result ─────────────────────────────
ipcMain.handle('submit-interview', async (_, payload) => {
  return await apiHandler.submitInterview(payload);
});
// ─── IPC: Offline TTS / STT ──────────────────────────────────────
ipcMain.handle('tts-speak', async (_, payload) => {
  return await speechService.textToSpeech_espeak(payload.text, payload.lang);
});
ipcMain.handle('transcribe-audio', async (_, payload) => {
  return await speechService.speechToText_whisper(payload.base64, payload.mimeType);
});
// ─── IPC: Analyze Interview Frame ─────────────────────────────
ipcMain.handle('analyze-frame', async (_, payload) => {
  return await apiHandler.analyzeFrame(payload);
});

// ─── IPC: Navigate to page ────────────────────────────────────
ipcMain.handle('navigate', async (_, page) => {
  const allowed = ['pin', 'confirmation', 'waiting', 'mcq', 'coding', 'interview', 'completed'];
  if (allowed.includes(page)) {
    mainWindow.loadFile(path.join(__dirname, `../renderer/pages/${page}.html`));
    return { success: true };
  }
  return { success: false };
});

// ─── IPC: Store session data ───────────────────────────────────
let sessionStore = {};
ipcMain.handle('set-session', (_, key, value) => {
  sessionStore[key] = value;
  return true;
});
ipcMain.handle('get-session', (_, key) => {
  return sessionStore[key] || null;
});
ipcMain.handle('clear-session', () => {
  sessionStore = {};
  return true;
});
