// Main-process source of truth for Electron application integrity; it does not claim OS-wide control.
class ApplicationIntegrityMonitor {
  constructor({ emit, active = () => false } = {}) { this.emit = emit; this.active = active; this.last = new Map(); }
  report(type, metadata = {}, cooldown = 1500) { if (!this.active()) return null; const now = Date.now(); if (now - (this.last.get(type) || -Infinity) < cooldown) return null; this.last.set(type, now); return this.emit(type, metadata); }
  attach(window) {
    window.on('blur', () => this.report('WINDOW_FOCUS_LOST', { source: 'main_window' }));
    window.on('minimize', () => this.report('WINDOW_MINIMIZED', { source: 'main_window' }));
    window.on('close', () => this.report('WINDOW_CLOSE_ATTEMPT', { source: 'main_window' }));
    window.on('leave-full-screen', () => this.report('FULLSCREEN_EXIT', { source: 'main_window' }));
    window.webContents.on('before-input-event', (event, input) => { if (input.key === 'F12' || input.control && input.shift && input.key.toLowerCase() === 'i') { event.preventDefault(); this.report('DEVTOOLS_ATTEMPT', { key: input.key }); } });
    window.webContents.setWindowOpenHandler(() => { this.report('NAVIGATION_BLOCKED', { kind: 'new_window' }); return { action: 'deny' }; });
    window.webContents.on('will-navigate', event => { event.preventDefault(); this.report('NAVIGATION_BLOCKED', { kind: 'navigation' }); });
    window.webContents.on('render-process-gone', (_, details) => this.report('RENDERER_CRASH', { reason: details.reason, exitCode: details.exitCode }));
  }
}
module.exports = { ApplicationIntegrityMonitor };
