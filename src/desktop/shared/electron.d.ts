/**
 * Ambient type declarations for Electron in Evolve AI Desktop
 */

declare module 'electron' {
  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
    quit(): void;
    getPath(name: string): string;
  };

  export class BrowserWindow {
    constructor(options?: any);
    loadFile(filePath: string): Promise<void>;
    loadURL(url: string): Promise<void>;
    webContents: {
      send(channel: string, ...args: any[]): void;
      openDevTools(): void;
    };
    on(event: string, listener: (...args: any[]) => void): void;
    isDestroyed(): boolean;
    close(): void;
    static getAllWindows(): BrowserWindow[];
  }

  export const dialog: {
    showOpenDialog(browserWindow: any, options: any): Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessageBox(options: any): Promise<{ response: number; checkboxChecked: boolean }>;
  };

  export const ipcMain: {
    handle(channel: string, listener: (event: any, ...args: any[]) => any): void;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, ...args: any[]): void;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    removeListener(channel: string, listener: (event: any, ...args: any[]) => void): void;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: any): void;
  };

  export const Menu: {
    buildFromTemplate(template: any[]): any;
    setApplicationMenu(menu: any): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(fullPath: string): void;
  };
}
