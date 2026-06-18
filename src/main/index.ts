import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  Tray,
  Menu,
  screen,
  shell,
  nativeImage,
  safeStorage,
  systemPreferences,
  dialog,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, exec, execFile } from 'child_process';
import { generateText, generateTextStream } from '../shared/ai-service';
import { resolvePrompt } from '../tools/rephrase';
import { IPC_CHANNELS, AppSettings, GenerateRequest } from '../shared/types';
import { fetchJiraActivity } from '../shared/data-sources/jira';
import { fetchGitHubActivity } from '../shared/data-sources/github';
import { loadSettings, saveSettings, serviceEndpointPath, writeServiceEndpoint } from './store';
import { startRephraseServer, RephraseServer } from './rephrase-server';
import { installRephraseQuickAction } from './quick-action';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: AppSettings;
let rephraseServer: RephraseServer | null = null;
let previousClipboard = '';
let previousApp = '';
let previousFocusEditable = true;
// Show the "enable Automation" guidance at most once per session.
let automationWarningShown = false;

const isMac = process.platform === 'darwin';

// macOS accessibility roles that accept typed/pasted text.
const EDITABLE_AX_ROLES = ['AXTextField', 'AXTextArea', 'AXComboBox', 'AXSearchField'];

function logFilePath(): string {
  return path.join(app.getPath('userData'), 'logs.log');
}

// Lightweight file logger so failures are diagnosable on machines without a
// console attached (i.e. a normal packaged install).
function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath(), line);
  } catch {
    // Logging is best-effort; never let it break the app.
  }
  console.log(message);
}

function createWindow(): BrowserWindow {
  const { x, y } = screen.getCursorScreenPoint();

  const win = new BrowserWindow({
    width: 480,
    height: 600,
    x: x - 240,
    y: y + 10,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  return win;
}

function openPrivacyPane(anchor: string): void {
  // x-apple.systempreferences URLs open the specific Privacy & Security pane.
  shell
    .openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`)
    .catch(() => {
      // Fall back to opening System Settings at all if the deep link fails.
      shell.openExternal('x-apple.systempreferences:').catch(() => undefined);
    });
}

function showPermissionsHelp(): void {
  const detail = isMac
    ? 'AIBuddy needs two macOS permissions to read your selection and paste results:\n\n' +
      '1. Accessibility — System Settings > Privacy & Security > Accessibility > enable AIBuddy.\n' +
      '2. Automation — System Settings > Privacy & Security > Automation > AIBuddy > enable "System Events".\n\n' +
      'After changing these, fully quit and reopen AIBuddy.'
    : 'AIBuddy uses xdotool to read your selection and paste results. Make sure xdotool is installed.';

  const buttons = isMac
    ? ['Open Accessibility', 'Open Automation', 'Close']
    : ['Close'];

  dialog
    .showMessageBox({
      type: 'info',
      title: 'AIBuddy Permissions',
      message: 'Permissions needed',
      detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    })
    .then(({ response }) => {
      if (!isMac) return;
      if (response === 0) openPrivacyPane('Privacy_Accessibility');
      else if (response === 1) openPrivacyPane('Privacy_Automation');
    })
    .catch(() => undefined);
}

function warnAutomationOnce(): void {
  if (automationWarningShown || !isMac) return;
  automationWarningShown = true;
  dialog
    .showMessageBox({
      type: 'warning',
      title: 'AIBuddy needs Automation permission',
      message: "AIBuddy couldn't capture your selected text",
      detail:
        'macOS blocked AIBuddy from controlling "System Events". The palette still ' +
        'opened, but to capture and paste text automatically, enable AIBuddy under ' +
        'System Settings > Privacy & Security > Automation (and Accessibility), then ' +
        'restart AIBuddy.',
      buttons: ['Open Automation Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) openPrivacyPane('Privacy_Automation');
    })
    .catch(() => undefined);
}

function createTray(): void {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromBuffer(Buffer.alloc(0));
    } else {
      trayIcon = trayIcon.resize({ width: 18, height: 18 });
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('AIBuddy');

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Show AIBuddy',
      click: () => showToolPalette(),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('show-settings');
          mainWindow.show();
        }
      },
    },
    {
      label: 'Permissions Help',
      click: () => showPermissionsHelp(),
    },
    ...(isMac
      ? [
          {
            label: 'Add Right-Click Rephrase…',
            click: () => {
              installRephraseService().then((result) => {
                dialog
                  .showMessageBox({
                    type: result.ok ? 'info' : 'error',
                    title: 'AIBuddy',
                    message: result.ok ? 'Right-click Rephrase installed' : 'Install failed',
                    detail: result.message,
                    buttons: ['OK'],
                  })
                  .catch(() => undefined);
              });
            },
          },
        ]
      : []),
    {
      label: 'Open Logs',
      click: () => {
        shell.openPath(logFilePath()).catch(() => undefined);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function registerShortcut(): void {
  globalShortcut.unregisterAll();

  const shortcut = settings.globalShortcut || 'CommandOrControl+Shift+K';
  let registered = false;
  try {
    registered = globalShortcut.register(shortcut, () => {
      showToolPalette();
    });
  } catch (err) {
    log(`Error registering shortcut "${shortcut}": ${String(err)}`);
  }

  if (registered) {
    log(`Registered global shortcut: ${shortcut}`);
  } else {
    log(`Failed to register shortcut: ${shortcut}`);
    dialog
      .showMessageBox({
        type: 'warning',
        title: 'AIBuddy shortcut unavailable',
        message: `Couldn't register the shortcut "${shortcut}"`,
        detail:
          'Another app may already be using it. Open Settings from the AIBuddy ' +
          'tray icon and choose a different shortcut.',
        buttons: ['OK'],
      })
      .catch(() => undefined);
  }
}

// Detect the frontmost app and whether its focused element accepts text. Must
// run while the other app is still frontmost (before we show our window).
function detectFrontmostTarget(): void {
  previousApp = '';
  previousFocusEditable = true;
  if (!isMac) return;

  try {
    const output = execSync(
      `osascript -e 'tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set elementRole to ""
        try
          set elementRole to value of attribute "AXRole" of (value of attribute "AXFocusedUIElement" of frontApp)
        end try
        return appName & "\n" & elementRole
      end tell'`,
      { timeout: 3000 }
    ).toString();
    const [appName = '', role = ''] = output.split('\n');
    previousApp = appName.trim();
    const trimmedRole = role.trim();
    // Default to allowing paste unless we positively detect a non-editable target.
    previousFocusEditable = trimmedRole ? EDITABLE_AX_ROLES.includes(trimmedRole) : true;
  } catch (err) {
    log(`Frontmost detection failed: ${String(err)}`);
  }
}

// Capture the user's current selection by simulating copy. Returns the selected
// text, or '' if capture failed or there was no selection. Never throws.
function captureSelection(): string {
  previousClipboard = clipboard.readText();
  const sentinel = '\x00__AIBUDDY_SENTINEL__';
  clipboard.writeText(sentinel);

  try {
    if (isMac) {
      execSync(
        `osascript -e 'tell application "System Events" to keystroke "c" using command down'`,
        { timeout: 3000 }
      );
    } else {
      execSync('xdotool key ctrl+c', { timeout: 3000 });
    }
  } catch (err) {
    log(`Selection copy failed: ${String(err)}`);
    // Restore the clipboard and signal failure so the palette opens empty.
    clipboard.writeText(previousClipboard);
    warnAutomationOnce();
    return '';
  }

  // Give the target app a moment to place the selection on the clipboard.
  const start = Date.now();
  while (Date.now() - start < 500) {
    // Busy-wait briefly; keystroke delivery is async but fast.
    if (clipboard.readText() !== sentinel) break;
  }

  const currentClipboard = clipboard.readText();
  const selectedText = currentClipboard === sentinel ? '' : currentClipboard;

  // Restore the user's clipboard immediately so the sentinel never lingers.
  clipboard.writeText(previousClipboard);

  return selectedText;
}

function showToolPalette(): void {
  // Order matters: detect + capture while the *other* app is frontmost, then
  // open our window. Capture is fully guarded so the palette ALWAYS appears,
  // even when macOS blocks the automation.
  detectFrontmostTarget();
  const selectedText = captureSelection();

  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
  mainWindow = createWindow();

  const { x, y } = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint({ x, y });
  const bounds = display.workArea;

  let winX = x - 240;
  let winY = y + 10;

  if (winX + 480 > bounds.x + bounds.width) winX = bounds.x + bounds.width - 490;
  if (winX < bounds.x) winX = bounds.x + 10;
  if (winY + 600 > bounds.y + bounds.height) winY = y - 610;

  mainWindow.setPosition(winX, winY);

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('selected-text', selectedText, previousFocusEditable);
    }
  });
}

function aiConfig() {
  return {
    provider: settings.provider,
    openaiApiKey: settings.openaiApiKey,
    anthropicApiKey: settings.anthropicApiKey,
    openaiModel: settings.openaiModel,
    anthropicModel: settings.anthropicModel,
    claudeCodePath: settings.claudeCodePath,
    claudeCodeModel: settings.claudeCodeModel,
    cursorEndpoint: settings.cursorEndpoint,
    cursorApiKey: settings.cursorApiKey,
    cursorModel: settings.cursorModel,
  };
}

async function handleGenerate(
  _event: Electron.IpcMainInvokeEvent,
  request: GenerateRequest
): Promise<string> {
  return generateText(request.systemPrompt, request.userContent, aiConfig());
}

async function handleGenerateStream(
  event: Electron.IpcMainInvokeEvent,
  request: GenerateRequest
): Promise<string> {
  return generateTextStream(request.systemPrompt, request.userContent, aiConfig(), (delta) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC_CHANNELS.GENERATE_STREAM_CHUNK, delta);
    }
  });
}

async function handlePasteResult(
  _event: Electron.IpcMainInvokeEvent,
  text: string
): Promise<void> {
  clipboard.writeText(text);

  if (mainWindow) {
    mainWindow.hide();
  }

  try {
    if (isMac && previousApp) {
      exec(
        `osascript -e '
          tell application "${previousApp}" to activate
          delay 0.5
          tell application "System Events" to keystroke "v" using command down
        '`,
        (err) => {
          if (err) {
            log(`Auto-paste failed: ${String(err)}`);
            warnAutomationOnce();
          }
        }
      );
    } else if (!isMac) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      exec('xdotool key ctrl+v', (err) => {
        if (err) log(`Auto-paste failed: ${String(err)}`);
      });
    }
  } catch (err) {
    log(`Auto-paste error: ${String(err)}`);
  }

  setTimeout(() => {
    clipboard.writeText(previousClipboard);
  }, 2000);
}

// A small, non-focusable "Rephrasing…" popover shown near the cursor while the
// right-click Quick Action waits on the AI — like macOS's "Look Up" popover. It
// must never take focus, or it would steal the selection the Service replaces.
let toastWindow: BrowserWindow | null = null;
let toastBusyCount = 0;
let toastSafetyTimer: NodeJS.Timeout | null = null;

const TOAST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:default;
    -webkit-user-select:none;user-select:none;
    font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;}
  .card{display:flex;align-items:center;gap:10px;height:100%;box-sizing:border-box;
    padding:0 16px;border-radius:12px;
    background:rgba(28,29,36,0.94);border:1px solid rgba(255,255,255,0.10);
    color:#ececef;font-size:13px;font-weight:550;letter-spacing:-0.01em;
    -webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);}
  .spinner{flex:none;width:14px;height:14px;border-radius:50%;
    border:2px solid rgba(255,255,255,0.22);border-top-color:#818cf8;
    animation:spin .7s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="card"><div class="spinner"></div><span>Rephrasing…</span></div>
</body></html>`;

// Pre-warm a hidden popover at startup. Building a BrowserWindow + loading its
// HTML costs ~100-300ms, so doing it lazily made the popover feel laggy; with a
// warm window, showing it is just a reposition + showInactive (instant).
function createToastWindow(): void {
  if (!isMac || toastWindow) return;
  toastWindow = new BrowserWindow({
    width: 168,
    height: 52,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: true,
    show: false,
    type: 'panel',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(TOAST_HTML));
}

interface Anchor {
  kind: 'elem' | 'win';
  x: number;
  y: number;
  w: number;
  h: number;
}

// Locate where to show the popover via Accessibility, NEVER the mouse:
//   1. the focused text element (where the selection is), else
//   2. the frontmost window (we then show at its bottom-center).
// Returns null only if AX is entirely unavailable. AX uses the same top-left,
// y-down screen coordinates as Electron.
function selectionAnchor(): Promise<Anchor | null> {
  return new Promise((resolve) => {
    if (!isMac) return resolve(null);
    execFile(
      'osascript',
      [
        '-e', 'tell application "System Events"',
        '-e', 'set frontApp to first application process whose frontmost is true',
        '-e', 'try',
        '-e', 'set el to value of attribute "AXFocusedUIElement" of frontApp',
        '-e', 'set p to value of attribute "AXPosition" of el',
        '-e', 'set s to value of attribute "AXSize" of el',
        '-e', 'if (item 1 of s) > 0 and (item 2 of s) > 0 then return "elem," & ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of s) as string) & "," & ((item 2 of s) as string)',
        '-e', 'end try',
        '-e', 'try',
        '-e', 'set w to value of attribute "AXFocusedWindow" of frontApp',
        '-e', 'set p to value of attribute "AXPosition" of w',
        '-e', 'set s to value of attribute "AXSize" of w',
        '-e', 'return "win," & ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of s) as string) & "," & ((item 2 of s) as string)',
        '-e', 'end try',
        '-e', 'try',
        '-e', 'set w to item 1 of (windows of frontApp)',
        '-e', 'set p to value of attribute "AXPosition" of w',
        '-e', 'set s to value of attribute "AXSize" of w',
        '-e', 'return "win," & ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of s) as string) & "," & ((item 2 of s) as string)',
        '-e', 'end try',
        '-e', 'return "none"',
        '-e', 'end tell',
      ],
      { timeout: 1500 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const out = stdout.trim();
        const m = /^(elem|win),(.+)$/.exec(out);
        if (!m) return resolve(null);
        const n = m[2].split(',').map((v) => parseFloat(v));
        if (n.length === 4 && n.every((v) => Number.isFinite(v)) && n[2] > 0 && n[3] > 0) {
          resolve({ kind: m[1] as Anchor['kind'], x: n[0], y: n[1], w: n[2], h: n[3] });
        } else {
          resolve(null);
        }
      }
    );
  });
}

async function showRephraseToast(): Promise<void> {
  toastBusyCount += 1;
  if (!toastWindow) createToastWindow();
  if (!toastWindow) return;

  const [width, height] = toastWindow.getSize();
  const anchor = await selectionAnchor();
  if (toastBusyCount <= 0 || !toastWindow) return; // hidden again while we queried

  let winX: number;
  let winY: number;
  let area: Electron.Rectangle;

  if (anchor && anchor.kind === 'elem') {
    // Just above the focused text element, horizontally centered on it.
    area = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
    winX = anchor.x + anchor.w / 2 - width / 2;
    winY = anchor.y - height - 8;
    if (winY < area.y + 8) winY = anchor.y + anchor.h + 8; // below if no room above
  } else if (anchor && anchor.kind === 'win') {
    // Bottom-center of the frontmost window.
    area = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
    winX = anchor.x + anchor.w / 2 - width / 2;
    winY = anchor.y + anchor.h - height - 16;
  } else {
    // Last resort: bottom-center of the primary display. Never the mouse.
    area = screen.getPrimaryDisplay().workArea;
    winX = area.x + area.width / 2 - width / 2;
    winY = area.y + area.height - height - 60;
  }

  // Keep it on-screen.
  if (winX < area.x + 8) winX = area.x + 8;
  if (winX + width > area.x + area.width) winX = area.x + area.width - width - 8;
  if (winY < area.y + 8) winY = area.y + 8;
  if (winY + height > area.y + area.height) winY = area.y + area.height - height - 8;

  toastWindow.setPosition(Math.round(winX), Math.round(winY));
  // showInactive keeps focus (and the selection) in the source app.
  toastWindow.showInactive();

  // Safety net: never let the popover linger if a request hangs.
  if (toastSafetyTimer) clearTimeout(toastSafetyTimer);
  toastSafetyTimer = setTimeout(() => hideRephraseToast(true), 120000);
}

function hideRephraseToast(force = false): void {
  toastBusyCount = force ? 0 : Math.max(0, toastBusyCount - 1);
  if (toastBusyCount > 0) return;

  if (toastSafetyTimer) {
    clearTimeout(toastSafetyTimer);
    toastSafetyTimer = null;
  }
  toastWindow?.hide();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Simulate ⌘V in the frontmost app (the app the right-click Service ran from).
// Returns false if it failed — typically a missing Accessibility/Automation grant.
function pasteClipboard(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 10000 },
      (err) => {
        if (err) {
          log(`Paste keystroke failed: ${String(err)}`);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

// Full right-click rephrase flow, run entirely in the main process: show the
// popover, rephrase, then paste the result over the selection with ⌘V. We paste
// ourselves instead of letting macOS "replace selected text" because that path
// wipes the field in Slack when the selection contains a @mention pill.
//
// Data-loss guarantee: we only ever paste NON-EMPTY text. On any failure or an
// empty model reply we fall back to the original selection (a no-op replace), so
// the user's text can never be wiped.
async function rephraseAndPaste(selectedText: string): Promise<void> {
  if (!isMac || !selectedText.trim()) return;

  showRephraseToast();
  const savedClipboard = clipboard.readText();
  try {
    let out = selectedText; // default: paste the original back (safe no-op)
    try {
      const systemPrompt = resolvePrompt(settings.defaultRephraseTone, settings.tonePrompts);
      const result = await generateText(systemPrompt, selectedText.trim(), aiConfig());
      if (result && result.trim()) out = result;
    } catch (err) {
      log(`Rephrase generation failed: ${String(err)}`);
    }

    clipboard.writeText(out);
    await sleep(60);
    const pasted = await pasteClipboard();
    if (!pasted) warnAutomationOnce();

    // Restore the user's clipboard once the paste has settled.
    setTimeout(() => clipboard.writeText(savedClipboard), 1500);
  } finally {
    hideRephraseToast();
  }
}

function installRephraseService() {
  return installRephraseQuickAction(serviceEndpointPath());
}

function setupIPC(): void {
  ipcMain.handle(IPC_CHANNELS.GENERATE_TEXT, handleGenerate);
  ipcMain.handle(IPC_CHANNELS.INSTALL_REPHRASE_SERVICE, () => installRephraseService());
  ipcMain.handle(IPC_CHANNELS.GENERATE_TEXT_STREAM, handleGenerateStream);

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_TEXT, () => {
    return clipboard.readText();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_SETTINGS, (_event, newSettings: AppSettings) => {
    settings = newSettings;
    saveSettings(settings);
    registerShortcut();
  });

  ipcMain.handle(IPC_CHANNELS.PASTE_RESULT, handlePasteResult);

  ipcMain.on(IPC_CHANNELS.HIDE_WINDOW, () => {
    if (mainWindow) {
      mainWindow.hide();
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.FETCH_JIRA_ACTIVITY, async () => {
    return fetchJiraActivity({
      baseUrl: settings.jiraBaseUrl,
      email: settings.jiraEmail,
      apiToken: settings.jiraApiToken,
    });
  });

  ipcMain.handle(IPC_CHANNELS.FETCH_GITHUB_ACTIVITY, async () => {
    return fetchGitHubActivity({
      token: settings.githubToken,
    });
  });
}

app.name = 'AIBuddy';

app.whenReady().then(() => {
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      log(
        '[Security] No system keyring available (backend: basic_text). API keys will NOT be encrypted at rest.'
      );
    }
  }

  // Check Accessibility status WITHOUT forcing the system prompt. Passing `true`
  // here re-pops the OS dialog on every launch when macOS sees the app as
  // untrusted (common for unsigned/translocated builds). We instead guide the
  // user only when text capture actually fails (warnAutomationOnce) and via the
  // tray's Permissions Help.
  if (isMac) {
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      log(`Accessibility trusted: ${trusted}`);
    } catch (err) {
      log(`Accessibility check failed: ${String(err)}`);
    }
  }

  settings = loadSettings();

  // Local rephrase endpoint that backs the macOS right-click Quick Action.
  startRephraseServer({
    rephraseAndPaste,
    log,
  })
    .then((server) => {
      rephraseServer = server;
      writeServiceEndpoint(server.port, server.token);
    })
    .catch((err) => log(`Failed to start rephrase service: ${String(err)}`));

  createTray();
  registerShortcut();
  setupIPC();
  createToastWindow();

  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  rephraseServer?.close();
  if (toastWindow) {
    toastWindow.destroy();
    toastWindow = null;
  }
});

app.on('window-all-closed', () => {
  // Keep app running in system tray
});

if (process.platform === 'darwin') {
  app.dock?.hide();
}
