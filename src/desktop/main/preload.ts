/**
 * Evolve AI Enterprise Desktop Edition — Secure Context Isolation Preload Bridge
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { DESKTOP_CHANNELS } from '../shared/eventChannels';

const desktopApi = {
  // --- WORKSPACE APIS ---
  workspace: {
    openFolderDialog: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.OPEN_FOLDER_DIALOG),
    selectFolderDialog: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.SELECT_FOLDER_DIALOG),
    openFileDialog: (opts?: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.OPEN_FILE_DIALOG, opts),
    getCurrent: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_CURRENT),
    getRecent: () => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_RECENT),
    setCurrent: (folderPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.SET_CURRENT, folderPath),
    getFileTree: (dirPath?: string, maxDepth?: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.GET_FILE_TREE, dirPath, maxDepth),
    scanDataFiles: (dirPath?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.WORKSPACE.SCAN_DATA_FILES, dirPath),
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
    executeCommand: (id: string, cmd: string, cwd?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.TERMINAL.EXECUTE_COMMAND, id, cmd, cwd),
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
    convert: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.CONVERTER.CONVERT, req),
    detectLanguage: (payload: { code: string; fileName?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.CONVERTER.DETECT_LANGUAGE, payload),
    browseSources: (mode: 'files' | 'folder') => ipcRenderer.invoke(DESKTOP_CHANNELS.CONVERTER.BROWSE_SOURCES, mode)
  },

  // --- GIT & BRANCH STUDIO APIS ---
  git: {
    inspect: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.INSPECT),
    getBranches: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.GET_BRANCHES),
    createBranch: (branchName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.CREATE_BRANCH, branchName),
    switchBranch: (branchName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.SWITCH_BRANCH, branchName),
    commitAndPush: (commitMessage: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.COMMIT_AND_PUSH, commitMessage),
    createPr: (prInfo: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.CREATE_PR, prInfo),
    init: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.INIT),
    setRemote: (url: string, name?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.SET_REMOTE, url, name),
    connectHttps: (payload: { remoteUrl: string; username: string; token: string; remoteName?: string }) =>
      ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.CONNECT_HTTPS, payload),
    testRemote: (url?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.TEST_REMOTE, url),
    setConfig: (config: { name?: string; email?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.SET_CONFIG, config),
    sync: () => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.SYNC),
    stage: (files?: string[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.STAGE, files),
    commit: (message: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.COMMIT, message),
    push: (branch?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.PUSH, branch),
    pull: (branch?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.PULL, branch),
    stash: (action: 'save' | 'pop') => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.STASH, action),
    getLog: (limit?: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.GET_LOG, limit)
  },

  // --- MULTI-CLOUD CONNECT APIS ---
  cloud: {
    testConnection: (provider: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.CLOUD.TEST_CONNECTION, provider),
    getDetailedStatus: () => ipcRenderer.invoke(DESKTOP_CHANNELS.CLOUD.GET_DETAILED_STATUS),
    connectAccount: (provider: string, action: string, sessionId?: string) => 
      ipcRenderer.invoke(DESKTOP_CHANNELS.CLOUD.CONNECT_ACCOUNT, provider, action, sessionId)
  },

  // --- DATABRICKS STUDIO APIS ---
  databricks: {
    connect: (config: { host: string; token: string; catalog?: string }) => 
      ipcRenderer.invoke(DESKTOP_CHANNELS.DATABRICKS.CONNECT, config)
  },

  // --- LICENSE & IDENTITY APIS ---
  license: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_STATE),
    activateKey: (key: string, userEmail?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.ACTIVATE_KEY, key, userEmail),
    deactivate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.DEACTIVATE),
    generateTrialKey: (orgName?: string, days?: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GENERATE_TRIAL_KEY, orgName, days),
    getFingerprint: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_FINGERPRINT),
    exportChallenge: (userId: string, orgName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.EXPORT_CHALLENGE, userId, orgName),
    importOfflineLicense: (filePath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.IMPORT_OFFLINE_LICENSE, filePath),
    getProfile: () => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.GET_PROFILE),
    saveProfile: (profile: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.LICENSE.SAVE_PROFILE, profile)
  },

  // --- VAULT APIS ---
  vault: {
    getSecret: (key: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.GET_SECRET, key),
    setSecret: (key: string, val: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.SET_SECRET, key, val),
    listKeys: () => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.LIST_KEYS),
    deleteSecret: (key: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.VAULT.DELETE_SECRET, key)
  },

  // --- UPDATER APIS ---
  updater: {
    checkUpdate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.UPDATER.CHECK_UPDATE),
    getVersion: () => ipcRenderer.invoke(DESKTOP_CHANNELS.UPDATER.GET_VERSION),
    applyOfflinePatch: (patchPath: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.UPDATER.APPLY_OFFLINE_PATCH, patchPath)
  },

  // --- LOCAL AI & LLM INFERENCE APIS ---
  ai: {
    chat: (req: { prompt: string; history?: any[]; model?: string; system?: string }) => 
      ipcRenderer.invoke(DESKTOP_CHANNELS.AI.CHAT, req),
    getModels: () => ipcRenderer.invoke(DESKTOP_CHANNELS.AI.GET_MODELS),
    pullModel: (modelName: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.AI.PULL_MODEL, modelName)
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
    introspectDb: (dialect: any, connUri?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.INTROSPECT_DB, dialect, connUri),
    testDb: (opts: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.TEST_DB, opts),
    detectDb: () => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.DETECT_DB),
    mapSchema: (rawColumns: any[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.MAP_SCHEMA, rawColumns),
    buildMart: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.BUILD_MART, config),
    discoverMartRecipes: (baseModel: string, allTables: any[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.DISCOVER_MART_RECIPES, baseModel, allTables),
    generateMartFromPrompt: (prompt: string, allTables: any[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.GENERATE_MART_PROMPT, prompt, allTables),
    generateApiSdk: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.GENERATE_API_SDK, config),
    parseCurl: (curlStr: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PARSE_CURL, curlStr),
    parseOpenApi: (openApiStr: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.PARSE_OPENAPI, openApiStr),
    scaffoldDeploy: (config: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.SCAFFOLD_DEPLOY, config),
    runPreflightAudit: (dirPath?: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.RUN_PREFLIGHT_AUDIT, dirPath),
    cleanTemporaryFiles: (files?: string[]) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.CLEAN_TEMPORARY_FILES, files),
    savePreflightReport: (report: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.SAVE_PREFLIGHT_REPORT, report),
    generateRunbooks: (state: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.GENERATE_RUNBOOKS, state),
    analyzeDataset: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.ANALYZE_DATASET, req),
    frameHypothesisQuestions: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.FRAME_HYPOTHESIS_QUESTIONS, req),
    discoverSchemaGraph: (opts?: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.DISCOVER_SCHEMA_GRAPH, opts),
    queryTableSample: (opts: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.ENGINES.QUERY_TABLE_SAMPLE, opts)
  },

  // --- FDE ENGAGEMENT CONTEXT & DISCOVERY ---
  fde: {
    getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GET_STATE),
    saveDiscovery: (discoveryData: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SAVE_DISCOVERY, discoveryData),
    savePhaseState: (req: { key: string; data: any; merge?: boolean }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SAVE_PHASE_STATE, req),
    setStudioMode: (mode: 'DEMO' | 'LIVE') => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SET_STUDIO_MODE, mode),
    calculateRoi: (params: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.CALCULATE_ROI, params),
    generateTopology: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GENERATE_TOPOLOGY, req),
    generatePocPack: (data: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GENERATE_POC_PACK, data),
    evaluateRuleVsModel: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.EVALUATE_RULE_VS_MODEL, req),
    scaffoldLadderLevel: (req: { level: number; config?: any }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SCAFFOLD_LADDER_LEVEL, req),
    scaffoldMcpToolServer: (req?: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SCAFFOLD_MCP_TOOL_SERVER, req),
    runGoldenBenchmark: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.RUN_GOLDEN_BENCHMARK, req),
    exportBenchmarkReport: (data: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.EXPORT_BENCHMARK_REPORT, data),
    exportBenchmarkRunner: (req: { format: 'jest' | 'pytest'; suiteName?: string; cases: any[] }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.EXPORT_BENCHMARK_RUNNER, req),
    generateBenchmarkCases: (req: { prompt: string; domain?: string; count?: number }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GENERATE_BENCHMARK_CASES, req),
    verifyGroundedness: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.VERIFY_GROUNDEDNESS, req),
    aiAnalyzeRawAsk: (req: { rawAsk: string; archetype?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.AI_ANALYZE_RAW_ASK, req),
    aiGenerateTopology: (req: { rawAsk: string; reframedGoal: string; archetype?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.AI_GENERATE_TOPOLOGY, req),
    aiEditTopology: (req: { instruction: string; diagram: string; mode: 'future' | 'legacy'; model?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.AI_EDIT_TOPOLOGY, req),
    previewDiscovery: (data: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.PREVIEW_DISCOVERY, data),
    revealPath: (p: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.REVEAL_PATH, p),
    snapshotScopeVersion: (req: { message: string; data: any }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SNAPSHOT_SCOPE_VERSION, req),
    getScopeVersions: () => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GET_SCOPE_VERSIONS),
    restoreScopeVersion: (versionId: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.RESTORE_SCOPE_VERSION, versionId),
    exportClientAlignmentMemo: (data: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.EXPORT_CLIENT_ALIGNMENT_MEMO, data),
    setArchitectureTarget: (req: { level: number; rationale?: string; latencyBudget?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.SET_ARCHITECTURE_TARGET, req),
    analyzeWorkspaceArchitecture: () => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.ANALYZE_WORKSPACE_ARCHITECTURE),
    testTargetConnection: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.TEST_TARGET_CONNECTION, req),
    logHitlAction: (req: any) => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.LOG_HITL_ACTION, req),
    getHitlLog: () => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.GET_HITL_LOG),
    clearHitlLog: () => ipcRenderer.invoke(DESKTOP_CHANNELS.FDE.CLEAR_HITL_LOG)
  },

  // --- DISPLAY SCALE & ZOOM APIS ---
  zoom: {
    getZoomFactor: () => webFrame.getZoomFactor(),
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    getZoomLevel: () => webFrame.getZoomLevel(),
    setZoomLevel: (level: number) => webFrame.setZoomLevel(level),
    onZoomIn: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('evolve:zoom:in', handler);
      return () => ipcRenderer.removeListener('evolve:zoom:in', handler);
    },
    onZoomOut: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('evolve:zoom:out', handler);
      return () => ipcRenderer.removeListener('evolve:zoom:out', handler);
    },
    onZoomReset: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('evolve:zoom:reset', handler);
      return () => ipcRenderer.removeListener('evolve:zoom:reset', handler);
    }
  },

  // --- SYSTEM & OS UTILITIES ---
  system: {
    openExternal: (url: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.SYSTEM.OPEN_EXTERNAL, url),
    copyToClipboard: (text: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.SYSTEM.COPY_TO_CLIPBOARD, text),
    savePdf: (opts: { html: string; filename?: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.SYSTEM.SAVE_PDF, opts),
    printHtml: (opts: { html: string }) => ipcRenderer.invoke(DESKTOP_CHANNELS.SYSTEM.PRINT_HTML, opts)
  }
};

contextBridge.exposeInMainWorld('evolveApi', desktopApi);

export type DesktopApiType = typeof desktopApi;
