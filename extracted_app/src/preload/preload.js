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

function blockExamShortcuts(e) {
  const target = e.target;
  const isEditable = isEditableElement(target);

  if (isEditable) {
    // Block F-keys and PrintScreen even in editable areas
    if (blockedFunctionKeys.has(e.key) || e.key === 'PrintScreen' || e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
    // Block dangerous Ctrl combos but allow copy/paste/undo/redo/select-all
    if ((e.ctrlKey || e.metaKey) && !['a', 'c', 'v', 'x', 'z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
    // Allow ALL plain keys and Alt keys in editable areas — do NOT block them
    return;
  }

  if (blockedFunctionKeys.has(e.key) || e.key === 'PrintScreen' || e.key === 'ContextMenu' || e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
}

window.addEventListener('keydown', blockExamShortcuts, true);
window.addEventListener('contextmenu', e => e.preventDefault());

contextBridge.exposeInMainWorld('examAPI', {
  // Auth
  validatePin:       (pin)     => ipcRenderer.invoke('validate-pin', pin),
  fetchExamSchedule: (pin)     => ipcRenderer.invoke('fetch-exam-schedule', pin),

  // Questions
  fetchQuestions:    (data)    => ipcRenderer.invoke('fetch-questions', data),

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
  analyzeFrame:      (payload) => ipcRenderer.invoke('analyze-frame', payload),
  ttsSpeak:          (payload) => ipcRenderer.invoke('tts-speak', payload),
  transcribeAudio:   (payload) => ipcRenderer.invoke('transcribe-audio', payload),
  exitApp:           () => ipcRenderer.invoke('exit-app'),
});
