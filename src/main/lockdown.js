// src/main/lockdown.js
const { globalShortcut, app } = require('electron');

const BLOCKED_SHORTCUTS = [
  // IMPORTANT: NO 'Win+<letter>' or 'Win+<digit>' shortcuts here!
  // Windows RegisterHotKey() with MOD_WIN causes the bare letter/digit to also
  // be swallowed by Windows, breaking normal typing in the editor.
  // Kiosk + fullscreen mode already prevents most Win+key actions natively.

  // Safe to register — these use multiple modifiers, no bare key side effects
  'Alt+F4', 'Alt+Tab', 'Alt+Shift+Tab',
  'Ctrl+Shift+Escape',

  // Function keys — safe, no letter keys involved
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',

  // Dev tools — Ctrl+Shift combos are safe
  'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C',
  'Ctrl+Shift+U', 'Ctrl+U', 'Ctrl+F12',

  // NOTE: Ctrl+C/V/X/A/Z/Y intentionally NOT here
  // globalShortcut blocks them OS-wide including inside the editor
  // Handled at renderer level in preload.js instead

  // Screenshot — safe multi-key combos only
  'PrintScreen', 'Ctrl+PrintScreen', 'Alt+PrintScreen',
  'Shift+PrintScreen',

  // Navigation — safe Ctrl combos
  'Ctrl+W', 'Ctrl+T', 'Ctrl+N',
  'Ctrl+Plus', 'Ctrl+Minus', 'Ctrl+=', 'Ctrl+0',

  // AI/system tools — safe Ctrl+Shift combos only
  'Alt+Space',
  'Ctrl+Shift+A',
  'Ctrl+Shift+S', 'Ctrl+P', 'Ctrl+Shift+P',

  // Virtual desktop — Ctrl+Win combos (safe — Ctrl modifier prevents bare key issue)
  'Ctrl+Win+D', 'Ctrl+Win+F4',
  'Ctrl+Win+Left', 'Ctrl+Win+Right', 'Ctrl+Win+Up', 'Ctrl+Win+Down',

  // Misc
  'Ctrl+Escape', 'Ctrl+Alt+Tab', 'Alt+Escape',
];

let isLocked = false;
let focusInterval = null;
let win = null;
let blurHandler = null;

function start(mainWindow) {
  win = mainWindow;
  isLocked = true;

  // Kiosk mode
  mainWindow.setKiosk(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setFullScreen(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setResizable(false);
  mainWindow.setMovable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setClosable(false);
  mainWindow.setSkipTaskbar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.focus();

  // Register all blocked shortcuts globally
  BLOCKED_SHORTCUTS.forEach(shortcut => {
    try {
      globalShortcut.register(shortcut, () => {});
    } catch (e) {
      // Some shortcuts may not be registerable on all systems
    }
  });

  // Restore OS-level focus ONLY when window has actually lost it (e.g. Alt+Tab attempt)
  // NEVER call win.focus() when window is already focused — it resets document.activeElement
  // back to body, which silently kills textarea keyboard input every 500ms
  focusInterval = setInterval(() => {
    if (isLocked && win && !win.isDestroyed() && !win.isFocused()) {
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.focus();
    }
  }, 1000);

  // Restore focus only after confirmed blur (delay avoids fighting with DOM focus)
  blurHandler = () => {
    setTimeout(() => {
      if (isLocked && win && !win.isDestroyed() && !win.isFocused()) {
        win.focus();
      }
    }, 150);
  };
  app.on('browser-window-blur', blurHandler);

  console.log('[LOCKDOWN] Exam lockdown ACTIVE');
}

function stop(mainWindow) {
  isLocked = false;
  win = null;

  mainWindow.setKiosk(false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setFullScreen(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setResizable(false);
  mainWindow.setMovable(false);
  mainWindow.setMinimizable(true);
  mainWindow.setClosable(true);
  mainWindow.setSkipTaskbar(false);

  globalShortcut.unregisterAll();
  if (blurHandler) {
    app.removeListener('browser-window-blur', blurHandler);
    blurHandler = null;
  }

  if (focusInterval) {
    clearInterval(focusInterval);
    focusInterval = null;
  }

  console.log('[LOCKDOWN] Exam lockdown RELEASED');
}

function enforce(mainWindow) {
  if (isLocked) {
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.setFullScreen(true);
  }
}

module.exports = { start, stop, enforce };
