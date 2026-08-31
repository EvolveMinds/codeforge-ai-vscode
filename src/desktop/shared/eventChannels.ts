/**
 * Evolve AI Enterprise Desktop Edition — Type-Safe IPC Channel Constants
 */

export const DESKTOP_CHANNELS = {
  WORKSPACE: {
    OPEN_FOLDER_DIALOG: 'workspace:openFolderDialog',
    GET_CURRENT: 'workspace:getCurrent',
    GET_RECENT: 'workspace:getRecent',
    SET_CURRENT: 'workspace:setCurrent',
    GET_FILE_TREE: 'workspace:getFileTree',
    READ_FILE: 'workspace:readFile',
    WRITE_FILE: 'workspace:writeFile',
    CREATE_FILE: 'workspace:createFile',
    CREATE_DIR: 'workspace:createDir',
    DELETE_ITEM: 'workspace:deleteItem',
    RENAME_ITEM: 'workspace:renameItem',
    REVEAL_IN_EXPLORER: 'workspace:revealInExplorer',
    WATCH_EVENT: 'workspace:watchEvent'
  },
  TERMINAL: {
    SPAWN: 'terminal:spawn',
    INPUT: 'terminal:input',
    RESIZE: 'terminal:resize',
    KILL: 'terminal:kill',
    LIST: 'terminal:list',
    DATA_EVENT: 'terminal:dataEvent',
    EXIT_EVENT: 'terminal:exitEvent'
  },
  LICENSE: {
    GET_STATE: 'license:getState',
    ACTIVATE_KEY: 'license:activateKey',
    GET_FINGERPRINT: 'license:getFingerprint',
    EXPORT_CHALLENGE: 'license:exportChallenge',
    IMPORT_OFFLINE_LICENSE: 'license:importOfflineLicense',
    GET_PROFILE: 'license:getProfile',
    SAVE_PROFILE: 'license:saveProfile'
  },
  VAULT: {
    GET_SECRET: 'vault:getSecret',
    SET_SECRET: 'vault:setSecret',
    LIST_KEYS: 'vault:listKeys',
    DELETE_SECRET: 'vault:deleteSecret'
  },
  UPDATER: {
    CHECK_UPDATE: 'updater:checkUpdate',
    APPLY_OFFLINE_PATCH: 'updater:applyOfflinePatch'
  },
  ENGINES: {
    INTROSPECT_DB: 'engine:introspectDb',
    TEST_DB_CONN: 'engine:testDbConn',
    MAP_SCHEMA: 'engine:mapSchema',
    BUILD_MART: 'engine:buildMart',
    GENERATE_API_SDK: 'engine:generateApiSdk',
    PARSE_CURL: 'engine:parseCurl',
    PARSE_OPENAPI: 'engine:parseOpenApi',
    SCAFFOLD_DEPLOY: 'engine:scaffoldDeploy',
    RUN_PREFLIGHT_AUDIT: 'engine:runPreflightAudit',
    GENERATE_RUNBOOKS: 'engine:generateRunbooks',
    TRANSPILE_SQL: 'engine:transpileSql',
    PII_MASKING: 'engine:piiMasking',
    REVERSE_ETL: 'engine:reverseEtl',
    RLS_POLICIES: 'engine:rlsPolicies',
    SYNTHETIC_DATA: 'engine:syntheticData',
    MOCK_SERVER: 'engine:mockServer',
    DATA_QUALITY: 'engine:dataQuality',
    LOAD_TEST: 'engine:loadTest',
    RAG_PIPELINE: 'engine:ragPipeline',
    SIEM_AUDIT: 'engine:siemAudit',
    PRIVATE_SERVING: 'engine:privateServing'
  }
} as const;
