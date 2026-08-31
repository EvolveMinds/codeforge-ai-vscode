/**
 * Evolve AI Enterprise Desktop Edition — Type-Safe IPC Channel Definitions
 */

export const DESKTOP_CHANNELS = {
  WORKSPACE: {
    OPEN_FOLDER_DIALOG: 'evolve:workspace:open-folder-dialog',
    OPEN_FILE_DIALOG: 'evolve:workspace:open-file-dialog',
    GET_CURRENT: 'evolve:workspace:get-current',
    GET_RECENT: 'evolve:workspace:get-recent',
    SET_CURRENT: 'evolve:workspace:set-current',
    GET_FILE_TREE: 'evolve:workspace:get-file-tree',
    SCAN_DATA_FILES: 'evolve:workspace:scan-data-files',
    READ_FILE: 'evolve:workspace:read-file',
    WRITE_FILE: 'evolve:workspace:write-file',
    CREATE_FILE: 'evolve:workspace:create-file',
    CREATE_DIR: 'evolve:workspace:create-dir',
    DELETE_ITEM: 'evolve:workspace:delete-item',
    RENAME_ITEM: 'evolve:workspace:rename-item',
    REVEAL_IN_EXPLORER: 'evolve:workspace:reveal-in-explorer',
    WATCH_EVENT: 'evolve:workspace:watch-event'
  },

  TERMINAL: {
    SPAWN: 'evolve:terminal:spawn',
    INPUT: 'evolve:terminal:input',
    EXECUTE_COMMAND: 'evolve:terminal:execute-command',
    RESIZE: 'evolve:terminal:resize',
    KILL: 'evolve:terminal:kill',
    LIST: 'evolve:terminal:list',
    DATA_EVENT: 'evolve:terminal:data-event',
    EXIT_EVENT: 'evolve:terminal:exit-event'
  },

  HARDWARE: {
    INSPECT: 'evolve:hardware:inspect',
    DISCOVER_LOCAL_MODELS: 'evolve:hardware:discover-local-models'
  },

  CONVERTER: {
    CONVERT: 'evolve:converter:convert',
    GET_LANGUAGES: 'evolve:converter:get-languages',
    DETECT_LANGUAGE: 'evolve:converter:detect-language',
    BROWSE_SOURCES: 'evolve:converter:browse-sources'
  },

  GIT: {
    INSPECT: 'evolve:git:inspect',
    GET_BRANCHES: 'evolve:git:get-branches',
    CREATE_BRANCH: 'evolve:git:create-branch',
    SWITCH_BRANCH: 'evolve:git:switch-branch',
    COMMIT_AND_PUSH: 'evolve:git:commit-and-push',
    CREATE_PR: 'evolve:git:create-pr'
  },

  CLOUD: {
    TEST_CONNECTION: 'evolve:cloud:test-connection',
    GET_DETAILED_STATUS: 'evolve:cloud:get-detailed-status',
    CONNECT_ACCOUNT: 'evolve:cloud:connect-account'
  },

  DATABRICKS: {
    CONNECT: 'evolve:databricks:connect',
    OPTIMIZE: 'evolve:databricks:optimize'
  },

  LICENSE: {
    GET_STATE: 'evolve:license:get-state',
    ACTIVATE_KEY: 'evolve:license:activate-key',
    GET_FINGERPRINT: 'evolve:license:get-fingerprint',
    EXPORT_CHALLENGE: 'evolve:license:export-challenge',
    IMPORT_OFFLINE_LICENSE: 'evolve:license:import-offline-license',
    GET_PROFILE: 'evolve:license:get-profile',
    SAVE_PROFILE: 'evolve:license:save-profile'
  },

  VAULT: {
    GET_SECRET: 'evolve:vault:get-secret',
    SET_SECRET: 'evolve:vault:set-secret',
    LIST_KEYS: 'evolve:vault:list-keys',
    DELETE_SECRET: 'evolve:vault:delete-secret'
  },

  UPDATER: {
    CHECK_UPDATE: 'evolve:updater:check-update',
    APPLY_OFFLINE_PATCH: 'evolve:updater:apply-offline-patch'
  },

  AI: {
    CHAT: 'evolve:ai:chat',
    GET_MODELS: 'evolve:ai:get-models',
    PULL_MODEL: 'evolve:ai:pull-model'
  },

  ENGINES: {
    TRANSPILE_SQL: 'evolve:engines:transpile-sql',
    PII_MASKING: 'evolve:engines:pii-masking',
    REVERSE_ETL: 'evolve:engines:reverse-etl',
    RLS_POLICIES: 'evolve:engines:rls-policies',
    SYNTHETIC_DATA: 'evolve:engines:synthetic-data',
    MOCK_SERVER: 'evolve:engines:mock-server',
    DATA_QUALITY: 'evolve:engines:data-quality',
    LOAD_TEST: 'evolve:engines:load-test',
    RAG_PIPELINE: 'evolve:engines:rag-pipeline',
    SIEM_AUDIT: 'evolve:engines:siem-audit',
    PRIVATE_SERVING: 'evolve:engines:private-serving',
    INTROSPECT_DB: 'evolve:engines:introspect-db',
    TEST_DB: 'evolve:engines:test-db',
    DETECT_DB: 'evolve:engines:detect-db',
    MAP_SCHEMA: 'evolve:engines:map-schema',
    BUILD_MART: 'evolve:engines:build-mart',
    DISCOVER_MART_RECIPES: 'evolve:engines:discover-mart-recipes',
    GENERATE_MART_PROMPT: 'evolve:engines:generate-mart-prompt',
    GENERATE_API_SDK: 'evolve:engines:generate-api-sdk',
    PARSE_CURL: 'evolve:engines:parse-curl',
    PARSE_OPENAPI: 'evolve:engines:parse-openapi',
    SCAFFOLD_DEPLOY: 'evolve:engines:scaffold-deploy',
    RUN_PREFLIGHT_AUDIT: 'evolve:engines:run-preflight-audit',
    GENERATE_RUNBOOKS: 'evolve:engines:generate-runbooks',
    ANALYZE_DATASET: 'evolve:engines:analyze-dataset'
  }
} as const;
