// src/preload/preload.js
const { contextBridge, ipcRenderer } = require('electron');

const blockedFunctionKeys = new Set(Array.from({ length: 12 }, (_, i) => `F${i + 1}`));

function isEditableElement(target) {
  if (!target) return false;
  try {
    // 'textarea' matches all textareas regardless of type attribute
    // 'input' matches all inputs (text, number, etc)
    if (target.matches('textarea, input, [contenteditable="true"], [contenteditable=""]')) return true;
    if (target.isContentEditable) return true;
  } catch(e) {}
  return false;
}

function reportSecurity(type, metadata = {}) { ipcRenderer.invoke('security-activity', type, metadata).catch(() => {}); }
function blockExamShortcuts(e) {
  const target = e.target;
  const isEditable = isEditableElement(target);

  if (isEditable) {
    // Block F-keys and PrintScreen even in editable areas
    if (blockedFunctionKeys.has(e.key) || e.key === 'PrintScreen' || e.key === 'Escape') {
      reportSecurity('PROHIBITED_SHORTCUT', { key: e.key, editable: true });
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
    // Block dangerous Ctrl combos but allow copy/paste/undo/redo/select-all
    if ((e.ctrlKey || e.metaKey) && !['a', 'c', 'v', 'x', 'z', 'y'].includes(e.key.toLowerCase())) {
      reportSecurity('PROHIBITED_SHORTCUT', { key: e.key, editable: true });
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
    // Allow ALL plain keys and Alt keys in editable areas — do NOT block them
    return;
  }

  if (blockedFunctionKeys.has(e.key) || e.key === 'PrintScreen' || e.key === 'ContextMenu' || e.key === 'Escape') {
    reportSecurity('PROHIBITED_SHORTCUT', { key: e.key, editable: false });
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    reportSecurity('PROHIBITED_SHORTCUT', { key: e.key, editable: false });
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
}

window.addEventListener('keydown', blockExamShortcuts, true);
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('copy', () => reportSecurity('CLIPBOARD_ATTEMPT', { operation: 'copy' }), true);
window.addEventListener('cut', () => reportSecurity('CLIPBOARD_ATTEMPT', { operation: 'cut' }), true);
window.addEventListener('paste', () => reportSecurity('CLIPBOARD_ATTEMPT', { operation: 'paste' }), true);

contextBridge.exposeInMainWorld('examAPI', {
  // Auth
  validatePin:       (pin)     => ipcRenderer.invoke('validate-pin', pin),
  fetchExamSchedule: (pin)     => ipcRenderer.invoke('fetch-exam-schedule', pin),

  // Questions
  fetchQuestions:    (data)    => ipcRenderer.invoke('fetch-questions', data),
  saveExamCheckin:   (payload) => ipcRenderer.invoke('save-exam-checkin', payload),

  // Exam control
  startExam:         ()        => ipcRenderer.invoke('start-exam'),
  endExam:           ()        => ipcRenderer.invoke('end-exam'),

  // Navigation
  navigate:          (page)    => ipcRenderer.invoke('navigate', page),

  // Session
  setSession:        (k, v)    => ipcRenderer.invoke('set-session', k, v),
  getSession:        (k)       => ipcRenderer.invoke('get-session', k),
  clearSession:      ()        => ipcRenderer.invoke('clear-session'),

  // Submissions
  submitMCQ:         (payload) => ipcRenderer.invoke('submit-mcq', payload),
  runCode:           (payload) => ipcRenderer.invoke('run-code', payload),
  submitCode:        (payload) => ipcRenderer.invoke('submit-code', payload),
  submitInterview:   (payload) => ipcRenderer.invoke('submit-interview', payload),
  ttsSpeak:          (payload) => ipcRenderer.invoke('tts-speak', payload),
  transcribeAudio:   (payload) => ipcRenderer.invoke('transcribe-audio', payload),
  checkExamSubmission: (studentId, examId) => ipcRenderer.invoke('check-exam-submission', studentId, examId),
  exitApp:           () => ipcRenderer.invoke('exit-app'),
  proctorState:      () => ipcRenderer.invoke('proctor-state'),
  proctorDraft:      (type, payload) => ipcRenderer.invoke('proctor-draft', type, payload),
  proctorObserve:    sample => ipcRenderer.invoke('proctor-observe', sample),
  proctorSimulate:   sample => ipcRenderer.invoke('proctor-simulate', sample),
  proctorFocus:      focused => ipcRenderer.invoke('proctor-focus', focused),
  proctorForceSubmit: () => ipcRenderer.invoke('proctor-force-submit'),
  securityActivity: (type, metadata) => ipcRenderer.invoke('security-activity', type, metadata),
  onProctorSubmitted: callback => {
    const listener = (_, result) => callback(result);
    ipcRenderer.on('proctor-submitted', listener);
    return () => ipcRenderer.removeListener('proctor-submitted', listener);
  },
});
