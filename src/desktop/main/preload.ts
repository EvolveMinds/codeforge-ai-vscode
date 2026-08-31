/**
 * Evolve AI Enterprise Desktop Edition — Secure Context Isolation Preload Bridge
 */

import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_CHANNELS } from '../shared/eventChannels';

const desktopApi = {
  // --- WORKSPACE APIS ---
  workspace: {
    openFolderDialog: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.OPEN_FOLDER_DIALOG),
    getCurrent: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_CURRENT),
    getRecent: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_RECENT),
    setCurrent: (folderPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.SET_CURRENT, folderPath),
    getFileTree: (dirPath?: string, maxDepth?: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_FILE_TREE, dirPath, maxDepth),
    readFile: (filePath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.READ_FILE, filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.WRITE_FILE, filePath, content),
    createFile: (filePath: string, content: string = '') => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.CREATE_FILE, filePath, content),
    createDir: (dirPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.CREATE_DIR, dirPath),
    deleteItem: (targetPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.DELETE_ITEM, targetPath),
    renameItem: (oldPath: string, newPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.RENAME_ITEM, oldPath, newPath),
    revealInExplorer: (filePath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.REVEAL_IN_EXPLORER, filePath),
    onWatchEvent: (callback: (event: string, filename: string) => void) => {
      const handler = (_: any, evt: string, file: string) => callback(evt, file);
      ipcRenderer.on(DESKTOP_CHANNELS.WORKSPACE.WATCH_EVENT, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.WORKSPACE.WATCH_EVENT, handler);
    }
  },

  // --- TERMINAL APIS ---
  terminal: {
    spawn: (options?: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.SPAWN, options),
    input: (id: string, data: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.INPUT, id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.RESIZE, id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.KILL, id),
    list: () => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.LIST),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: any, id: string, data: string) => callback(id, data);
      ipcRenderer.on(DESKTOP_CHANNELS.TERMINAL.DATA_EVENT, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.TERMINAL.DATA_EVENT, handler);
    },
    onExit: (callback: (id: string, code: number) => void) => {
      const handler = (_: any, id: string, code: number) => callback(id, code);
      ipcRenderer.on(DESKTOP_CHANNELS.TERMINAL.EXIT_EVENT, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.TERMINAL.EXIT_EVENT, handler);
    }
  },

  // --- HARDWARE & LOCAL AI APIS ---
  hardware: {
    inspect: () => ipcRenderer.invoke(DESKTOP_CHANNELS.HARDWARE.INSPECT),
    discoverLocalModels: () => ipcRenderer.invoke(DESKTOP_CHANNELS.HARDWARE.DISCOVER_LOCAL_MODELS)
  },

  // --- POLYGLOT CONVERTER APIS ---
  converter: {
    getLanguages: () => ipcRenderer.invoke(DESKTOP_CHANNELS.CONVERTER.GET_LANGUAGES),
    convert: (req: { sourceCode: string; fromLang: string; toLang: string; fidelity?: string }) => 
      ipcRenderer.invoke(DESKTOP_CHANNELS.CONVERTER.CONVERT, req)
  },

  // --- GIT & BRANCH STUDIO APIS ---
  git: {
    inspect: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.INSPECT),
    getBranches: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.GET_BRANCHES),
    createBranch: (branchName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.CREATE_BRANCH, branchName),
    switchBranch: (branchName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.SWITCH_BRANCH, branchName),
    commitAndPush: (commitMessage: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.COMMIT_AND_PUSH, commitMessage),
    createPr: (prInfo: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.CREATE_PR, prInfo)
  },

  // --- MULTI-CLOUD CONNECT APIS ---
  cloud: {
    testConnection: (provider: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.CLOUD.TEST_CONNECTION, provider)
  },

  // --- LICENSE & IDENTITY APIS ---
  license: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_STATE),
    activateKey: (key: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.ACTIVATE_KEY, key),
    getFingerprint: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_FINGERPRINT),
    exportChallenge: (userId: string, orgName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.EXPORT_CHALLENGE, userId, orgName),
    importOfflineLicense: (filePath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.IMPORT_OFFLINE_LICENSE, filePath),
    getProfile: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_PROFILE),
    saveProfile: (profile: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.SAVE_PROFILE, profile)
  },

  // --- SECRET VAULT APIS ---
  vault: {
    getSecret: (key: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.GET_SECRET, key),
    setSecret: (key: string, val: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.SET_SECRET, key, val),
    listKeys: () => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.LIST_KEYS),
    deleteSecret: (key: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.DELETE_SECRET, key)
  },

  // --- UPDATER APIS ---
  updater: {
    checkUpdate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.UPDATER.CHECK_UPDATE),
    applyOfflinePatch: (patchPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.UPDATER.APPLY_OFFLINE_PATCH, patchPath)
  },

  // --- ENTERPRISE & FDE CORE ENGINES ---
  engines: {
    transpileSql: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.TRANSPILE_SQL, req),
    piiMasking: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PII_MASKING, req),
    reverseEtl: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.REVERSE_ETL, req),
    rlsPolicies: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.RLS_POLICIES, req),
    syntheticData: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.SYNTHETIC_DATA, req),
    mockServer: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.MOCK_SERVER, req),
    dataQuality: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.DATA_QUALITY, req),
    loadTest: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.LOAD_TEST, req),
    ragPipeline: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.RAG_PIPELINE, req),
    siemAudit: (event: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.SIEM_AUDIT, event),
    privateServing: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PRIVATE_SERVING, config),
    introspectDb: (dialect: string, connUri: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.INTROSPECT_DB, dialect, connUri),
    mapSchema: (rawColumns: any[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.MAP_SCHEMA, rawColumns),
    buildMart: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.BUILD_MART, config),
    generateApiSdk: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.GENERATE_API_SDK, config),
    parseCurl: (curlStr: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PARSE_CURL, curlStr),
    parseOpenApi: (openApiStr: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PARSE_OPENAPI, openApiStr),
    scaffoldDeploy: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.SCAFFOLD_DEPLOY, config),
    runPreflightAudit: (dirPath?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.RUN_PREFLIGHT_AUDIT, dirPath),
    generateRunbooks: (state: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.GENERATE_RUNBOOKS, state)
  }
};

contextBridge.exposeInMainWorld('evolveApi', desktopApi);

export type DesktopApiType = typeof desktopApi;
