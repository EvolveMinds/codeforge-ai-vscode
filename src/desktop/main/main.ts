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
  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
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
      title: 'Select Project or Engagement Directory'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      return workspaceMgr.setCurrentWorkspace(selectedPath);
    }
    return null;
  });

  // Reveal file in native OS file explorer
  ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.REVEAL_IN_EXPLORER, async (_: any, filePath: string) => {
    const ws = workspaceMgr.getCurrentWorkspace();
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : (ws ? path.join(ws.path, filePath) : path.resolve(filePath));
    shell.showItemInFolder(fullPath);
    return true;
  });

  buildAppMenu();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildAppMenu(): void {
  const template: any[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'Open Workspace Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (mainWindow) {
              const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: 'Open Project Folder'
              });
              if (!result.canceled && result.filePaths.length > 0) {
                workspaceMgr.setCurrentWorkspace(result.filePaths[0]);
                mainWindow.webContents.send(DESKTOP_CHANNELS.WORKSPACE.WATCH_EVENT, 'open', result.filePaths[0]);
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => { app.quit(); }
        }
      ]
    },
    {
      label: '&View',
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
      label: '&Terminal',
      submenu: [
        {
          label: 'New Terminal Session',
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => {
            terminalMgr.spawnSession();
          }
        }
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Documentation & Playbook',
          click: () => { shell.openExternal('https://github.com/EvolveMinds/codeforge-ai-vscode#readme'); }
        },
        {
          label: 'Evolve Mind Solutions Portal',
          click: () => { shell.openExternal('https://www.evolveminds.com.au/'); }
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
