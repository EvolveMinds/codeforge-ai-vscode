/**
 * Evolve AI Enterprise Desktop Edition — Main Electron Application Entrypoint
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { DESKTOP_CHANNELS } from '../shared/eventChannels';
import { DesktopWorkspaceManager } from './workspaceManager';
import { DesktopTerminalManager } from './terminalManager';
import { DesktopLicenseAuth } from './licenseAuth';
import { DesktopSecretVault } from './secretVault';
import { DesktopUpdater } from './updater';
import { DesktopIpcHandlers } from './ipcHandlers';

let mainWindow: BrowserWindow | null = null;

// Determine if running in portable mode
function getStorageDirectory(): string {
  const exeDir = path.dirname(app.getPath('exe'));
  const portableDataDir = path.join(exeDir, 'data');
  const portableFlag = path.join(exeDir, 'portable');

  if (fs.existsSync(portableFlag) || fs.existsSync(portableDataDir)) {
    if (!fs.existsSync(portableDataDir)) {
      try { fs.mkdirSync(portableDataDir, { recursive: true }); } catch {}
    }
    return portableDataDir;
  }

  return path.join(os.homedir(), '.evolve');
}

function resolveRendererPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'renderer', 'index.html'),
    path.join(__dirname, '..', '..', '..', 'src', 'desktop', 'renderer', 'index.html'),
    path.join(__dirname, '..', '..', 'src', 'desktop', 'renderer', 'index.html'),
    path.join(process.cwd(), 'src', 'desktop', 'renderer', 'index.html'),
    path.join(process.cwd(), 'out', 'desktop', 'renderer', 'index.html')
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  return path.join(__dirname, '..', 'renderer', 'index.html');
}

const storageDir = getStorageDirectory();
const workspaceMgr = new DesktopWorkspaceManager(storageDir);
const terminalMgr = new DesktopTerminalManager();
const licenseAuth = new DesktopLicenseAuth(storageDir);
const secretVault = new DesktopSecretVault(storageDir);
const updater = new DesktopUpdater(storageDir);

const ipcHandlers = new DesktopIpcHandlers({
  workspaceMgr,
  terminalMgr,
  licenseAuth,
  secretVault,
  updater
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#1e1e1e',
    title: 'Evolve AI Enterprise Delivery Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Load renderer
  const rendererPath = resolveRendererPath();
  mainWindow.loadFile(rendererPath);

  // Wire terminal stream events to renderer
  terminalMgr.onData((id, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DESKTOP_CHANNELS.TERMINAL.DATA_EVENT, id, data);
    }
  });

  terminalMgr.onExit((id, code) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DESKTOP_CHANNELS.TERMINAL.EXIT_EVENT, id, code);
    }
  });

  // Wire workspace file watch events to renderer
  workspaceMgr.onWatchEvent((event, filename) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DESKTOP_CHANNELS.WORKSPACE.WATCH_EVENT, event, filename);
    }
  });

  // Custom folder picker IPC handler using Electron dialog
  ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.OPEN_FOLDER_DIALOG, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project or Engagement Workspace'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return workspaceMgr.setCurrentWorkspace(result.filePaths[0]);
    }
    return null;
  });

  buildAppMenu();
}

function buildAppMenu(): void {
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Workspace Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (mainWindow) {
              const res = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory', 'createDirectory'],
                title: 'Open Workspace Folder'
              });
              if (!res.canceled && res.filePaths.length > 0) {
                workspaceMgr.setCurrentWorkspace(res.filePaths[0]);
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save Active File',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('evolve:shortcut:save');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal Tab',
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => {
            terminalMgr.spawnSession({ name: 'Terminal' });
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Enterprise Documentation & Playbook',
          click: () => shell.openExternal('https://www.evolveminds.com.au/')
        },
        {
          label: 'Check for Updates...',
          click: async () => {
            const res = await updater.checkForUpdates();
            dialog.showMessageBox({
              type: 'info',
              title: 'Evolve AI Updates',
              message: res.updateAvailable
                ? `Update available: v${res.latestVersion} (Current: v${res.currentVersion})`
                : `You are up to date! (v${res.currentVersion})`,
              detail: res.releaseNotes || 'Your rule templates and engines are running the latest signature.'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'About Evolve AI Enterprise Edition',
          click: () => {
            const lic = licenseAuth.getLicenseState();
            dialog.showMessageBox({
              type: 'info',
              title: 'About Evolve AI Enterprise Edition',
              message: 'Evolve AI Enterprise Desktop Edition',
              detail: `Version: 2.19.1\nOrganization: ${lic.organization}\nPlan: ${lic.plan.toUpperCase()}\nStatus: ${lic.isLicensed ? 'Active (' + lic.daysRemaining + ' days left)' : 'Community Mode'}\nBuilt by Evolve Mind Solutions Pty Ltd`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Register all IPC handlers
ipcHandlers.registerAll(ipcMain);

// App Lifecycle
app.whenReady().then(() => {
  // Check for CLI folder argument
  for (const arg of process.argv) {
    if (arg && !arg.startsWith('-') && !arg.endsWith('.js') && !arg.includes('electron') && fs.existsSync(arg)) {
      try {
        if (fs.statSync(arg).isDirectory()) {
          workspaceMgr.setCurrentWorkspace(arg);
          break;
        }
      } catch {}
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  terminalMgr.dispose();
  workspaceMgr.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
