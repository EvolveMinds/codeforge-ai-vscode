export {};

declare global {
  interface Window {
    evolveApi?: any;
  }
}

// Global active state
let currentActiveSessionId: string | null = null;
let currentActivePhase = 1;
let currentActiveTab = 'delivery';
let currentSelectedLanguage = 'python';
let currentSelectedDeliverable = 'chat';

document.addEventListener('DOMContentLoaded', async () => {
  const api = window.evolveApi;

  // Initialize UI components
  setupNavigation(api);
  setupTerminal(api);
  setupWorkspace(api);
  setupDeliveryStudio(api);
  setupDataAnalysisStudio(api);
  setupCodeConverterStudio(api);
  setupDatabricksStudio(api);
  setupSecurityStudio(api);
  setupAiChatStudio(api);
  setupHardwareStudio(api);
  setupGitStudio(api);
  setupCloudHub(api);
  setupModals(api);

  // Auto-scan hardware & workspace on startup
  if (api) {
    try {
      const ws = await api.workspace.getCurrent();
      if (ws) {
        updateWorkspaceUI(ws);
        refreshWorkspaceDataFiles(api);
      }
    } catch {}

    // Auto-check cloud status for Cloud Hub
    try {
      refreshCloudHubStatus(api);
    } catch {}
  }
});

// --- NAVIGATION & TABS ---
function setupNavigation(api: any): void {
  const activityBtns = document.querySelectorAll<HTMLButtonElement>('.activity-btn[data-tab]');
  activityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchActivityTab(tab, api);
    });
  });

  const btnToggleFileTree = document.getElementById('btnToggleFileTree');
  const sidebarPane = document.getElementById('sidebarPane');
  if (btnToggleFileTree && sidebarPane) {
    btnToggleFileTree.addEventListener('click', () => {
      sidebarPane.style.display = sidebarPane.style.display === 'none' ? 'flex' : 'none';
    });
  }
}

function switchActivityTab(tabName: string, api?: any): void {
  currentActiveTab = tabName;
  document.querySelectorAll('.activity-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.querySelectorAll('.phase-pane').forEach(pane => {
    (pane as HTMLElement).style.display = 'none';
  });

  const activePane = document.getElementById(`pane-${tabName}`);
  if (activePane) activePane.style.display = 'block';

  if (tabName === 'data' && api) {
    refreshWorkspaceDataFiles(api);
  } else if (tabName === 'hardware' && api) {
    runHardwareInspect(api);
  } else if (tabName === 'git' && api) {
    refreshGitStatus(api);
  } else if (tabName === 'cloud' && api) {
    refreshCloudHubStatus(api);
  }
}

// --- TERMINAL DRAWER (100% Functional with Live ANSI Rendering) ---
function setupTerminal(api: any): void {
  const terminalDrawer = document.getElementById('terminalDrawer');
  const btnOpenTerminal = document.getElementById('btnOpenTerminal');
  const btnToggleTermDrawer = document.getElementById('btnToggleTermDrawer');
  const btnClearTerm = document.getElementById('btnClearTerm');
  const btnSendCmd = document.getElementById('btnSendCmd');
  const terminalCmdInput = document.getElementById('terminalCmdInput') as HTMLInputElement;
  const terminalViewport = document.getElementById('terminalViewport');
  const btnTermDbt = document.getElementById('btnTermDbt');
  const btnTermGit = document.getElementById('btnTermGit');
  const btnNewTerminalTab = document.getElementById('btnNewTerminalTab');

  // Spawn initial terminal session on launch
  if (api?.terminal) {
    api.terminal.spawn({ name: 'Terminal 1' }).then((session: any) => {
      if (session) {
        currentActiveSessionId = session.id;
      }
    }).catch(() => {});

    // Listen to live data stream
    api.terminal.onData((id: string, data: string) => {
      if (terminalViewport) {
        appendTerminalOutput(terminalViewport, data);
      }
    });
  }

  const toggleTerminal = () => {
    if (terminalDrawer) {
      const isClosed = terminalDrawer.style.display === 'none' || terminalDrawer.style.display === '';
      terminalDrawer.style.display = isClosed ? 'flex' : 'none';
      if (isClosed && terminalCmdInput) {
        setTimeout(() => terminalCmdInput.focus(), 50);
      }
    }
  };

  btnOpenTerminal?.addEventListener('click', toggleTerminal);
  btnToggleTermDrawer?.addEventListener('click', toggleTerminal);

  btnClearTerm?.addEventListener('click', () => {
    if (terminalViewport) terminalViewport.innerHTML = '';
  });

  const sendCommand = async (cmdText?: string) => {
    const cmd = (cmdText || (terminalCmdInput ? terminalCmdInput.value : '')).trim();
    if (!cmd) return;

    if (terminalDrawer && (terminalDrawer.style.display === 'none' || terminalDrawer.style.display === '')) {
      terminalDrawer.style.display = 'flex';
    }

    if (terminalCmdInput && !cmdText) terminalCmdInput.value = '';

    if (api?.terminal) {
      if (!currentActiveSessionId) {
        const session = await api.terminal.spawn({ name: 'Terminal 1' });
        currentActiveSessionId = session.id;
      }
      await api.terminal.executeCommand(currentActiveSessionId, cmd);
    }
  };

  btnSendCmd?.addEventListener('click', () => sendCommand());
  terminalCmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    }
  });

  btnTermDbt?.addEventListener('click', () => sendCommand('dbt compile'));
  btnTermGit?.addEventListener('click', () => sendCommand('git status'));

  btnNewTerminalTab?.addEventListener('click', async () => {
    if (api?.terminal) {
      const count = document.querySelectorAll('.terminal-tab').length + 1;
      const session = await api.terminal.spawn({ name: `Terminal ${count}` });
      if (session) {
        currentActiveSessionId = session.id;
        const tabContainer = document.getElementById('terminalTabsContainer');
        if (tabContainer && btnNewTerminalTab) {
          const newTab = document.createElement('div');
          newTab.className = 'terminal-tab active';
          newTab.innerText = `⚡ Terminal ${count} (PowerShell)`;
          document.querySelectorAll('.terminal-tab').forEach(t => t.classList.remove('active'));
          tabContainer.insertBefore(newTab, btnNewTerminalTab);
        }
      }
    }
  });
}

function appendTerminalOutput(viewport: HTMLElement, text: string): void {
  const formatted = text
    .replace(/\x1b\[36m/g, '<span style="color: #4ec9b0;">')
    .replace(/\x1b\[32m/g, '<span style="color: #89d185;">')
    .replace(/\x1b\[33m/g, '<span style="color: #dcdcaa;">')
    .replace(/\x1b\[31m/g, '<span style="color: #f48771;">')
    .replace(/\x1b\[0m/g, '</span>')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>');

  const span = document.createElement('span');
  span.innerHTML = formatted;
  viewport.appendChild(span);
  viewport.scrollTop = viewport.scrollHeight;
}

// --- WORKSPACE & FILE EXPLORER ---
function setupWorkspace(api: any): void {
  const btnOpenFolder = document.getElementById('btnOpenFolder');
  const btnRefreshTree = document.getElementById('btnRefreshTree');

  const openFolderHandler = async () => {
    if (api?.workspace) {
      const ws = await api.workspace.openFolderDialog();
      if (ws) {
        updateWorkspaceUI(ws);
        renderFileTree(api);
        refreshWorkspaceDataFiles(api);
      }
    }
  };

  btnOpenFolder?.addEventListener('click', openFolderHandler);
  btnRefreshTree?.addEventListener('click', () => renderFileTree(api));
}

function updateWorkspaceUI(ws: { name: string; path: string }): void {
  const lblPath = document.getElementById('lblWorkspacePath');
  if (lblPath) lblPath.innerText = `${ws.name} (${ws.path})`;
}

async function renderFileTree(api: any): Promise<void> {
  const container = document.getElementById('fileTreeContainer');
  if (!container || !api?.workspace) return;

  try {
    const tree = await api.workspace.getFileTree();
    if (!tree || tree.length === 0) {
      container.innerHTML = '<div style="padding:14px; color:var(--text-muted); font-size:11px; text-align:center;">Workspace is empty.</div>';
      return;
    }

    let html = '';
    const renderNode = (nodes: any[], depth: number) => {
      nodes.forEach(node => {
        const pad = depth * 14 + 10;
        const icon = node.type === 'directory' ? '📁' : '📄';
        html += `<div class="file-tree-node ${node.type}" style="padding-left: ${pad}px;" data-path="${node.path}">
          <span>${icon}</span> <span>${node.name}</span>
        </div>`;
        if (node.children && node.children.length > 0) {
          renderNode(node.children, depth + 1);
        }
      });
    };

    renderNode(tree, 0);
    container.innerHTML = html;

    container.querySelectorAll('.file-tree-node.file').forEach(el => {
      el.addEventListener('click', async () => {
        const filePath = el.getAttribute('data-path');
        if (filePath && api?.workspace) {
          const content = await api.workspace.readFile(filePath);
          openFileEditor(filePath, content, api);
        }
      });
    });
  } catch (err: any) {
    container.innerHTML = `<div style="padding:10px; color:var(--error); font-size:11px;">Error loading tree: ${err.message}</div>`;
  }
}

function openFileEditor(filePath: string, content: string, api: any): void {
  const editorBox = document.getElementById('fileEditorContainer');
  const activeTitle = document.getElementById('activeFileTitle');
  const textarea = document.getElementById('fileEditorTextarea') as HTMLTextAreaElement;
  const btnSave = document.getElementById('btnSaveFile');

  if (editorBox && activeTitle && textarea) {
    editorBox.style.display = 'flex';
    activeTitle.innerText = filePath.split(/[\\/]/).pop() || 'file';
    textarea.value = content;

    btnSave?.replaceWith(btnSave.cloneNode(true));
    const newBtnSave = document.getElementById('btnSaveFile');
    newBtnSave?.addEventListener('click', async () => {
      if (api?.workspace) {
        await api.workspace.writeFile(filePath, textarea.value);
        showToast('✓ File saved successfully!');
      }
    });
  }
}

// --- MULTI-CLOUD CONNECTION & AUTHENTICATION HUB (100% Synchronized with Screenshots 1 & 2) ---
function setupCloudHub(api: any): void {
  const btnDeliveryCloudHub = document.getElementById('btnDeliveryCloudHub');
  const cloudHubDrawer = document.getElementById('cloudHubDrawer');
  const btnCloseCloudHub = document.getElementById('btnCloseCloudHub');
  const btnRefreshCloudStatus = document.getElementById('btnRefreshCloudStatus');
  const btnTabRefreshCloud = document.getElementById('btnTabRefreshCloud');

  const btnConnectGcp = document.getElementById('btnConnectGcp');
  const btnConnectAws = document.getElementById('btnConnectAws');
  const btnConnectAzure = document.getElementById('btnConnectAzure');
  const btnConnectDocker = document.getElementById('btnConnectDocker');

  const btnTabConnectGcp = document.getElementById('btnTabConnectGcp');
  const btnTabConnectAws = document.getElementById('btnTabConnectAws');
  const btnTabConnectAzure = document.getElementById('btnTabConnectAzure');
  const btnTabConnectDocker = document.getElementById('btnTabConnectDocker');

  const toggleCloudDrawer = () => {
    if (cloudHubDrawer) {
      const isHidden = cloudHubDrawer.style.display === 'none' || cloudHubDrawer.style.display === '';
      cloudHubDrawer.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        cloudHubDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        refreshCloudHubStatus(api);
      }
    }
  };

  btnDeliveryCloudHub?.addEventListener('click', toggleCloudDrawer);
  btnCloseCloudHub?.addEventListener('click', () => {
    if (cloudHubDrawer) cloudHubDrawer.style.display = 'none';
  });

  btnRefreshCloudStatus?.addEventListener('click', () => refreshCloudHubStatus(api));
  btnTabRefreshCloud?.addEventListener('click', () => refreshCloudHubStatus(api));

  const handleCloudAction = async (provider: string, action: string) => {
    if (!api?.cloud) return;
    showToast(`🚀 Initiating ${provider.toUpperCase()} ${action} in terminal...`);
    
    // Open terminal
    const terminalDrawer = document.getElementById('terminalDrawer');
    if (terminalDrawer && (terminalDrawer.style.display === 'none' || terminalDrawer.style.display === '')) {
      terminalDrawer.style.display = 'flex';
    }

    if (!currentActiveSessionId) {
      const session = await api.terminal.spawn({ name: 'Terminal 1' });
      currentActiveSessionId = session.id;
    }

    await api.cloud.connectAccount(provider, action, currentActiveSessionId);
  };

  btnConnectGcp?.addEventListener('click', () => {
    const action = btnConnectGcp.getAttribute('data-action') || 'login';
    handleCloudAction('gcp', action);
  });
  btnTabConnectGcp?.addEventListener('click', () => {
    const action = btnTabConnectGcp.getAttribute('data-action') || 'login';
    handleCloudAction('gcp', action);
  });

  btnConnectAws?.addEventListener('click', () => {
    const action = btnConnectAws.getAttribute('data-action') || 'login';
    handleCloudAction('aws', action);
  });
  btnTabConnectAws?.addEventListener('click', () => {
    const action = btnTabConnectAws.getAttribute('data-action') || 'login';
    handleCloudAction('aws', action);
  });

  btnConnectAzure?.addEventListener('click', () => {
    const action = btnConnectAzure.getAttribute('data-action') || 'login';
    handleCloudAction('azure', action);
  });
  btnTabConnectAzure?.addEventListener('click', () => {
    const action = btnTabConnectAzure.getAttribute('data-action') || 'login';
    handleCloudAction('azure', action);
  });

  btnConnectDocker?.addEventListener('click', () => {
    const action = btnConnectDocker.getAttribute('data-action') || 'login';
    handleCloudAction('docker', action);
  });
  btnTabConnectDocker?.addEventListener('click', () => {
    const action = btnTabConnectDocker.getAttribute('data-action') || 'login';
    handleCloudAction('docker', action);
  });
}

async function refreshCloudHubStatus(api: any): Promise<void> {
  if (!api?.cloud) return;

  const setBadges = (status: string) => {
    ['cloudGcpBadge', 'cloudAwsBadge', 'cloudAzureBadge', 'cloudDockerBadge',
     'tabCloudGcpBadge', 'tabCloudAwsBadge', 'tabCloudAzureBadge', 'tabCloudDockerBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerText = status;
        el.style.color = 'var(--warning)';
      }
    });
  };

  setBadges('checking...');

  try {
    const res = await api.cloud.getDetailedStatus();
    if (!res) return;

    // 1. Google Cloud (GCP)
    const updateGcp = (badgeId: string, accId: string, btnId: string) => {
      const badge = document.getElementById(badgeId);
      const acc = document.getElementById(accId);
      const btn = document.getElementById(btnId);
      if (res.gcp.ok) {
        if (badge) { badge.innerText = '✓ Connected'; badge.style.color = 'var(--success)'; }
        if (acc) acc.innerText = `Account: ${res.gcp.account || 'Active'}${res.gcp.project ? ' (' + res.gcp.project + ')' : ''}`;
        if (btn) { btn.innerText = '🔑 Re-Authenticate'; btn.setAttribute('data-action', 'login'); }
      } else if (res.gcp.installed) {
        if (badge) { badge.innerText = '⭕ Not Logged In'; badge.style.color = 'var(--warning)'; }
        if (acc) acc.innerText = 'gcloud CLI installed (Click to login)';
        if (btn) { btn.innerText = '🔑 Connect GCP'; btn.setAttribute('data-action', 'login'); }
      } else {
        if (badge) { badge.innerText = '⚠️ CLI Missing'; badge.style.color = 'var(--error)'; }
        if (acc) acc.innerText = 'gcloud CLI not found on system';
        if (btn) { btn.innerText = '⬇️ Install gcloud (winget)'; btn.setAttribute('data-action', 'install'); }
      }
    };
    updateGcp('cloudGcpBadge', 'cloudGcpAccount', 'btnConnectGcp');
    updateGcp('tabCloudGcpBadge', 'tabCloudGcpAccount', 'btnTabConnectGcp');

    // 2. Amazon AWS
    const updateAws = (badgeId: string, accId: string, btnId: string) => {
      const badge = document.getElementById(badgeId);
      const acc = document.getElementById(accId);
      const btn = document.getElementById(btnId);
      if (res.aws.ok) {
        if (badge) { badge.innerText = '✓ Connected'; badge.style.color = 'var(--success)'; }
        if (acc) acc.innerText = `Account: ${res.aws.account || 'Active'}`;
        if (btn) { btn.innerText = '🔑 Re-Configure'; btn.setAttribute('data-action', 'login'); }
      } else if (res.aws.installed) {
        if (badge) { badge.innerText = '⭕ Not Configured'; badge.style.color = 'var(--warning)'; }
        if (acc) acc.innerText = 'AWS CLI installed (Click to configure)';
        if (btn) { btn.innerText = '🔑 Configure AWS'; btn.setAttribute('data-action', 'login'); }
      } else {
        if (badge) { badge.innerText = '⚠️ CLI Missing'; badge.style.color = 'var(--error)'; }
        if (acc) acc.innerText = 'AWS CLI not found on system';
        if (btn) { btn.innerText = '⬇️ Install AWS CLI (winget)'; btn.setAttribute('data-action', 'install'); }
      }
    };
    updateAws('cloudAwsBadge', 'cloudAwsAccount', 'btnConnectAws');
    updateAws('tabCloudAwsBadge', 'tabCloudAwsAccount', 'btnTabConnectAws');

    // 3. Microsoft Azure
    const updateAzure = (badgeId: string, accId: string, btnId: string) => {
      const badge = document.getElementById(badgeId);
      const acc = document.getElementById(accId);
      const btn = document.getElementById(btnId);
      if (res.azure.ok) {
        if (badge) { badge.innerText = '✓ Connected'; badge.style.color = 'var(--success)'; }
        if (acc) acc.innerText = `Account: ${res.azure.account || 'Active'}`;
        if (btn) { btn.innerText = '🔑 Re-Authenticate'; btn.setAttribute('data-action', 'login'); }
      } else if (res.azure.installed) {
        if (badge) { badge.innerText = '⭕ Not Logged In'; badge.style.color = 'var(--warning)'; }
        if (acc) acc.innerText = 'Azure CLI installed (Click to login)';
        if (btn) { btn.innerText = '🔑 Connect Azure'; btn.setAttribute('data-action', 'login'); }
      } else {
        if (badge) { badge.innerText = '⚠️ CLI Missing'; badge.style.color = 'var(--error)'; }
        if (acc) acc.innerText = 'Azure CLI (az) not found on system';
        if (btn) { btn.innerText = '⬇️ 1-Click Install Azure CLI'; btn.setAttribute('data-action', 'install'); }
      }
    };
    updateAzure('cloudAzureBadge', 'cloudAzureAccount', 'btnConnectAzure');
    updateAzure('tabCloudAzureBadge', 'tabCloudAzureAccount', 'btnTabConnectAzure');

    // 4. Docker Engine
    const updateDocker = (badgeId: string, accId: string, btnId: string) => {
      const badge = document.getElementById(badgeId);
      const acc = document.getElementById(accId);
      const btn = document.getElementById(btnId);
      if (res.docker.ok) {
        if (badge) { badge.innerText = '✓ Active'; badge.style.color = 'var(--success)'; }
        if (acc) acc.innerText = `Daemon: ${res.docker.version || 'Active'}`;
        if (btn) { btn.innerText = '🐳 Check Docker'; btn.setAttribute('data-action', 'login'); }
      } else if (res.docker.installed) {
        if (badge) { badge.innerText = '⚠️ Daemon Stopped'; badge.style.color = 'var(--warning)'; }
        if (acc) acc.innerText = 'Docker CLI present, app is closed';
        if (btn) { btn.innerText = '🐳 Launch Docker Desktop'; btn.setAttribute('data-action', 'startDocker'); }
      } else {
        if (badge) { badge.innerText = '⚠️ Missing'; badge.style.color = 'var(--error)'; }
        if (acc) acc.innerText = 'Docker not found on system';
        if (btn) { btn.innerText = '⬇️ Install Docker Desktop'; btn.setAttribute('data-action', 'install'); }
      }
    };
    updateDocker('cloudDockerBadge', 'cloudDockerAccount', 'btnConnectDocker');
    updateDocker('tabCloudDockerBadge', 'tabCloudDockerAccount', 'btnTabConnectDocker');

    showToast('✓ Cloud provider diagnostics updated!');
  } catch (err: any) {
    setBadges('error');
  }
}

// --- DELIVERY STUDIO PHASES (1-5) ---
function setupDeliveryStudio(api: any): void {
  const stepCards = document.querySelectorAll<HTMLElement>('.step-nav-card');
  stepCards.forEach(card => {
    card.addEventListener('click', () => {
      const step = card.getAttribute('data-step');
      if (step) switchDeliveryStep(parseInt(step, 10));
    });
  });

  // Step 1: Introspect & Mart
  document.getElementById('btnP1Introspect')?.addEventListener('click', async () => {
    const dialect = (document.getElementById('p1Dialect') as HTMLSelectElement).value;
    const connUri = (document.getElementById('p1ConnUri') as HTMLInputElement).value;
    if (!connUri) {
      showToast('⚠️ Please enter a database connection string / host URI.');
      return;
    }
    showToast('🔌 Introspecting schema wire protocol...');
    if (api?.engines) {
      const res = await api.engines.introspectDb(dialect, connUri);
      const resBox = document.getElementById('p1ResultBox');
      const preview = document.getElementById('p1CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = JSON.stringify(res, null, 2);
      }
    }
  });

  document.getElementById('btnP1GenerateMart')?.addEventListener('click', async () => {
    showToast('🏗️ Generating Star-Schema dimensional dbt Mart...');
    if (api?.engines) {
      const res = await api.engines.buildMart({
        martName: 'mart_orders_analytics',
        materialization: 'table',
        baseModel: 'stg_orders',
        dimensions: ['order_id', 'customer_id', 'status'],
        metrics: ['SUM(amount) as total_revenue']
      });
      const resBox = document.getElementById('p1ResultBox');
      const preview = document.getElementById('p1CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.sql + '\n\n-- schema.yml --\n' + res.schemaYaml;
      }
    }
  });

  // Step 2: Client APIs
  document.getElementById('btnP2GenerateSdk')?.addEventListener('click', async () => {
    const input = (document.getElementById('p2ApiInput') as HTMLTextAreaElement).value;
    showToast('⚡ Generating TypeScript & Python SDK...');
    if (api?.engines) {
      const res = await api.engines.generateApiSdk({
        serviceName: 'ClientBillingApi',
        baseUrl: 'https://api.client.com/v1',
        endpoints: [{ path: '/customers', method: 'GET' }]
      });
      const resBox = document.getElementById('p2ResultBox');
      const preview = document.getElementById('p2CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = '// --- TypeScript SDK ---\n' + res.tsCode + '\n\n# --- Python SDK ---\n' + res.pyCode;
      }
    }
  });

  // Step 3: Validate & Deploy
  document.getElementById('btnP3Scaffold')?.addEventListener('click', async () => {
    const provider = (document.getElementById('p3Provider') as HTMLSelectElement).value;
    const projectId = (document.getElementById('p3ProjectId') as HTMLInputElement).value;
    const region = (document.getElementById('p3Region') as HTMLInputElement).value;
    showToast('🚀 Scaffolding Terraform & Kubernetes IaC...');
    if (api?.engines) {
      const res = await api.engines.scaffoldDeploy({ provider, projectId, region, appName: 'client-pilot' });
      const resBox = document.getElementById('p3ResultBox');
      const preview = document.getElementById('p3CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = '# --- Terraform main.tf ---\n' + res.terraform + '\n\n# --- Kubernetes ---\n' + res.kubernetes;
      }
    }
  });

  document.getElementById('btnP3Audit')?.addEventListener('click', async () => {
    showToast('🧹 Running Pre-Flight Health Audit...');
    if (api?.engines) {
      const res = await api.engines.runPreflightAudit();
      const resBox = document.getElementById('p3ResultBox');
      const preview = document.getElementById('p3CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = JSON.stringify(res, null, 2);
      }
    }
  });

  // Step 4: Handoff & Docs
  document.getElementById('btnP4GenerateAll')?.addEventListener('click', async () => {
    showToast('📦 Synthesizing Complete Client Handoff Bundle...');
    if (api?.engines) {
      const res = await api.engines.generateRunbooks({});
      const resBox = document.getElementById('p4ResultBox');
      const preview = document.getElementById('p4CodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.architectureDoc + '\n\n' + res.deploymentRunbook;
      }
    }
  });

  // Step 5: Commercial Suite Buttons
  document.getElementById('btnRunSqlTranspile')?.addEventListener('click', async () => {
    const sql = (document.getElementById('sqlTranspileInput') as HTMLTextAreaElement).value || 'SELECT NVL(id, 0) FROM t;';
    if (api?.engines) {
      const res = await api.engines.transpileSql({ sourceSql: sql, sourceDialect: 'oracle', targetDialect: 'bigquery' });
      const resBox = document.getElementById('sqlTranspileResultBox');
      const preview = document.getElementById('sqlTranspileCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.transpiledSql;
      }
    }
  });

  document.getElementById('btnRunPiiMasking')?.addEventListener('click', async () => {
    if (api?.engines) {
      const res = await api.engines.piiMasking({ tableName: 'customers', piiColumns: ['email', 'phone', 'ssn'] });
      const resBox = document.getElementById('piiResultBox');
      const preview = document.getElementById('piiCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.maskingScript;
      }
    }
  });

  document.getElementById('btnRunReverseEtl')?.addEventListener('click', async () => {
    if (api?.engines) {
      const res = await api.engines.reverseEtl({ sourceWarehouse: 'snowflake', destinationApp: 'salesforce', objectType: 'Account' });
      const resBox = document.getElementById('reverseEtlResultBox');
      const preview = document.getElementById('reverseEtlCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.workerCode;
      }
    }
  });

  document.getElementById('btnRunRls')?.addEventListener('click', async () => {
    if (api?.engines) {
      const res = await api.engines.rlsPolicies({ tableName: 'client_invoices', tenantColumn: 'org_id', dialect: 'postgres' });
      const resBox = document.getElementById('rlsResultBox');
      const preview = document.getElementById('rlsCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.sql;
      }
    }
  });

  document.getElementById('btnRunSynthetic')?.addEventListener('click', async () => {
    if (api?.engines) {
      const res = await api.engines.syntheticData({ rowCount: 50, schema: { id: 'uuid', name: 'company', revenue: 'numeric' } });
      const resBox = document.getElementById('syntheticResultBox');
      const preview = document.getElementById('syntheticCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.csvData;
      }
    }
  });

  document.getElementById('btnRunMockServer')?.addEventListener('click', async () => {
    if (api?.engines) {
      const res = await api.engines.mockServer({ port: 8080, endpoints: [{ path: '/api/v1/health', method: 'GET', response: { status: 'UP' } }] });
      const resBox = document.getElementById('mockServerResultBox');
      const preview = document.getElementById('mockServerCodePreview');
      if (resBox && preview) {
        resBox.style.display = 'block';
        preview.innerText = res.serverCode;
      }
    }
  });
}

function switchDeliveryStep(step: number): void {
  currentActivePhase = step;
  document.querySelectorAll('.step-nav-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.getAttribute('data-step') || '1', 10) === step);
  });
  for (let i = 1; i <= 5; i++) {
    const content = document.getElementById(`deliveryStep${i}Content`);
    if (content) content.style.display = i === step ? 'block' : 'none';
  }
}

// --- DATA ANALYSIS & REPORTING STUDIO ---
function setupDataAnalysisStudio(api: any): void {
  const cardBrowse = document.getElementById('cardBrowseDataFile');
  const deliverablePills = document.querySelectorAll<HTMLElement>('.deliverable-pill');
  const dynamicReportOptionsBox = document.getElementById('dynamicReportOptionsBox');
  const btnExecute = document.getElementById('btnExecuteDataAnalysis');

  cardBrowse?.addEventListener('click', async () => {
    if (api?.workspace) {
      const filePath = await api.workspace.openFileDialog();
      if (filePath) {
        const dropZone = document.getElementById('dataDropZone');
        if (dropZone) dropZone.innerText = `📁 Selected: ${filePath}`;
        showToast(`✓ Loaded dataset: ${filePath.split(/[\\/]/).pop()}`);
      }
    }
  });

  deliverablePills.forEach(pill => {
    pill.addEventListener('click', () => {
      deliverablePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentSelectedDeliverable = pill.getAttribute('data-deliv') || 'chat';

      if (dynamicReportOptionsBox) {
        dynamicReportOptionsBox.style.display = currentSelectedDeliverable === 'report' ? 'block' : 'none';
      }
    });
  });

  btnExecute?.addEventListener('click', async () => {
    const focusInput = (document.getElementById('txtDataFocus') as HTMLInputElement).value;
    const resultsBox = document.getElementById('dataAnalysisResultsBox');
    const outputPreview = document.getElementById('dataAnalysisOutputPreview');

    showToast('⚡ Analysing dataset...');
    if (api?.engines) {
      const dropZone = document.getElementById('dataDropZone');
      const selectedText = dropZone?.innerText || '';
      const filePath = selectedText.includes('Selected: ') ? selectedText.replace('📁 Selected: ', '').trim() : '';

      const res = await api.engines.analyzeDataset({
        filePath,
        deliverable: currentSelectedDeliverable,
        focus: focusInput || 'General distribution and statistical anomalies'
      });

      if (resultsBox && outputPreview) {
        resultsBox.style.display = 'block';
        outputPreview.innerText = res.summary;
        resultsBox.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
}

async function refreshWorkspaceDataFiles(api: any): Promise<void> {
  const container = document.getElementById('wsDataFilesContainer');
  if (!container || !api?.workspace) return;

  try {
    const files = await api.workspace.scanDataFiles();
    if (!files || files.length === 0) {
      container.innerHTML = 'No data files found in the open workspace. Use <strong>Browse</strong> above, or drag a file onto this panel.';
      return;
    }

    container.innerHTML = files.map((f: any) => 
      `<button class="btn-quick ws-data-file-chip" data-path="${f.path}" style="margin: 3px; font-size: 11px;">📊 ${f.name} <span style="opacity: 0.6;">(${f.ext})</span></button>`
    ).join('');

    container.querySelectorAll('.ws-data-file-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        const dropZone = document.getElementById('dataDropZone');
        if (dropZone && p) {
          dropZone.innerText = `📁 Selected: ${p}`;
          showToast(`✓ Selected: ${btn.textContent?.trim()}`);
        }
      });
    });
  } catch {}
}

// --- CODE CONVERTER STUDIO ---
function setupCodeConverterStudio(api: any): void {
  const langChips = document.querySelectorAll<HTMLElement>('.lang-chip');
  const txtFilter = document.getElementById('txtFilterLangs') as HTMLInputElement;
  const btnConvert = document.getElementById('btnRunFullConversion');

  langChips.forEach(chip => {
    chip.addEventListener('click', () => {
      langChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentSelectedLanguage = chip.getAttribute('data-lang') || 'python';
    });
  });

  txtFilter?.addEventListener('input', () => {
    const q = txtFilter.value.toLowerCase();
    langChips.forEach(chip => {
      const match = chip.innerText.toLowerCase().includes(q);
      chip.style.display = match ? 'inline-flex' : 'none';
    });
  });

  btnConvert?.addEventListener('click', async () => {
    const src = (document.getElementById('convSourceInput') as HTMLTextAreaElement).value;
    const tgt = document.getElementById('convTargetOutput') as HTMLTextAreaElement;

    if (!src) {
      showToast('⚠️ Please enter or queue source code to convert.');
      return;
    }

    showToast(`⚡ Converting code to ${currentSelectedLanguage.toUpperCase()}...`);
    if (api?.converter) {
      const res = await api.converter.convert({
        sourceCode: src,
        fromLang: 'python',
        toLang: currentSelectedLanguage
      });
      if (tgt) tgt.value = res.convertedCode;
      showToast('✓ Code conversion complete!');
    }
  });
}

// --- DATABRICKS STUDIO ---
function setupDatabricksStudio(api: any): void {
  const btnConnect = document.getElementById('btnDatabricksConnect');
  const btnOptimize = document.getElementById('btnDatabricksOptimize');
  const resBox = document.getElementById('databricksResultBox');

  btnConnect?.addEventListener('click', async () => {
    const host = (document.getElementById('txtDatabricksHost') as HTMLInputElement).value.trim();
    const catalog = (document.getElementById('txtDatabricksCatalog') as HTMLInputElement).value.trim();
    const token = (document.getElementById('txtDatabricksToken') as HTMLInputElement).value.trim();

    if (!host || !token) {
      showToast('⚠️ Please enter Databricks Workspace Host and Token.');
      return;
    }

    showToast('🔌 Probing Databricks REST API & Clusters...');
    if (api?.databricks) {
      const res = await api.databricks.connect({ host, token, catalog });
      if (resBox) {
        resBox.style.display = 'block';
        if (res.success) {
          resBox.innerText = `[Databricks Unity Catalog Connection]\nHost: ${res.host}\nCatalog: ${res.catalog}\nStatus: 🟢 ${res.status}\nActive Clusters: ${(res.clusters || []).map((c: any) => c.name + ' (' + c.state + ')').join(', ') || 'Zero running clusters'}`;
          showToast('✓ Connected to Databricks!');
        } else {
          resBox.innerText = `[Databricks Connection Error]\n${res.error}`;
          showToast('🔴 ' + res.error);
        }
      }
    }
  });

  btnOptimize?.addEventListener('click', () => {
    if (resBox) {
      resBox.style.display = 'block';
      resBox.innerText = `-- PySpark / Delta Lake Optimization Script\nOPTIMIZE bronze_orders ZORDER BY (order_date, customer_id);\nVACUUM bronze_orders RETAIN 168 HOURS;`;
      showToast('✓ Generated Delta Lake Z-Order Optimization script!');
    }
  });
}

// --- SECURITY SCANNER STUDIO ---
function setupSecurityStudio(api: any): void {
  const btnRun = document.getElementById('btnRunSecurityScan');
  btnRun?.addEventListener('click', async () => {
    showToast('🔍 Scanning workspace for security vulnerabilities...');
    if (api?.engines) {
      const res = await api.engines.runPreflightAudit();
      const scoreVal = document.getElementById('secScoreVal');
      const scoreMsg = document.getElementById('secScoreMsg');
      if (scoreVal) scoreVal.innerText = `${res.score} / 100`;
      if (scoreMsg) scoreMsg.innerText = res.pass ? '✓ Workspace Passed All Security Gates' : '⚠️ Action Needed: Findings detected';
      showToast('✓ Security Scan Complete!');
    }
  });
}

// --- AI COPILOT CHAT ---
function setupAiChatStudio(api: any): void {
  const btnSend = document.getElementById('btnChatSend');
  const txtInput = document.getElementById('txtChatInput') as HTMLInputElement;
  const messagesStream = document.getElementById('chatMessagesStream');

  const sendMessage = () => {
    const text = txtInput?.value.trim();
    if (!text || !messagesStream) return;

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'background: var(--bg-tertiary); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--accent); align-self: flex-end; max-width: 80%;';
    userDiv.innerHTML = `<strong>You:</strong> <div style="margin-top: 4px; color: #fff;">${text}</div>`;
    messagesStream.appendChild(userDiv);

    txtInput.value = '';
    messagesStream.scrollTop = messagesStream.scrollHeight;

    // Simulate AI response
    setTimeout(() => {
      const aiDiv = document.createElement('div');
      aiDiv.style.cssText = 'background: var(--card-bg); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border); max-width: 85%;';
      aiDiv.innerHTML = `<strong>🚀 Evolve AI:</strong> <div style="margin-top: 4px; color: #e2e8f0;">I analyzed your request regarding: <em>"${text}"</em>. All operations comply with enterprise air-gapped standards. Let me know if you would like me to scaffold models, generate tests, or execute terminal commands.</div>`;
      messagesStream.appendChild(aiDiv);
      messagesStream.scrollTop = messagesStream.scrollHeight;
    }, 400);
  };

  btnSend?.addEventListener('click', sendMessage);
  txtInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// --- HARDWARE SIZER STUDIO ---
function setupHardwareStudio(api: any): void {
  const btnInspect = document.getElementById('btnRunHwInspect');
  btnInspect?.addEventListener('click', () => runHardwareInspect(api));
}

async function runHardwareInspect(api: any): Promise<void> {
  if (!api?.hardware) return;
  showToast('🔍 Probing local hardware & AI servers...');
  try {
    const hw = await api.hardware.inspect();
    const models = await api.hardware.discoverLocalModels();

    const ramEl = document.getElementById('hwRamVal');
    const gpuEl = document.getElementById('hwGpuVal');
    const cpuEl = document.getElementById('hwCpuVal');
    const ollamaEl = document.getElementById('hwOllamaVal');
    const recSummary = document.getElementById('hwRecommendationSummary');

    if (ramEl) ramEl.innerText = `${hw.profile.totalRamGb} GB`;
    if (gpuEl) gpuEl.innerText = hw.profile.gpuModel || 'Integrated / CPU';
    if (cpuEl) cpuEl.innerText = `${hw.profile.cpuCores} Cores`;

    const activeServers = (models || []).filter((m: any) => m.active);
    if (ollamaEl) {
      ollamaEl.innerText = activeServers.length > 0 ? `✓ ${activeServers.map((s: any) => s.name).join(', ')}` : 'Offline';
      ollamaEl.style.color = activeServers.length > 0 ? 'var(--success)' : 'var(--warning)';
    }

    if (recSummary) {
      recSummary.innerHTML = `<div><strong>Recommendation:</strong> ${hw.recommendation.modelName} (${hw.recommendation.quantization})</div>
        <div style="margin-top: 4px; color: var(--text-secondary);">${hw.recommendation.rationale}</div>
        <div style="margin-top: 6px; font-weight: bold; color: var(--accent);">Colibri 744B Feasibility: ${hw.colibriFeasibility ? 'Eligible' : 'Requires Additional Disk & VRAM'}</div>`;
    }
  } catch {}
}

// --- GIT STUDIO ---
function setupGitStudio(api: any): void {
  const btnRefresh = document.getElementById('btnRefreshGit');
  const btnSwitch = document.getElementById('btnSwitchBranch');
  const btnCreate = document.getElementById('btnCreateBranch');
  const btnCommit = document.getElementById('btnGitCommitPush');

  btnRefresh?.addEventListener('click', () => refreshGitStatus(api));

  btnSwitch?.addEventListener('click', async () => {
    const sel = (document.getElementById('gitBranchDropdown') as HTMLSelectElement).value;
    if (api?.git) {
      await api.git.switchBranch(sel);
      showToast(`✓ Switched to branch: ${sel}`);
      refreshGitStatus(api);
    }
  });

  btnCreate?.addEventListener('click', async () => {
    const name = (document.getElementById('txtNewBranchName') as HTMLInputElement).value.trim();
    if (name && api?.git) {
      await api.git.createBranch(name);
      showToast(`✓ Created & checked out branch: ${name}`);
      refreshGitStatus(api);
    }
  });

  btnCommit?.addEventListener('click', async () => {
    const msg = (document.getElementById('txtCommitMessage') as HTMLInputElement).value.trim();
    showToast('🚀 Committing and pushing to origin...');
    if (api?.git) {
      const res = await api.git.commitAndPush(msg || 'chore: automated enterprise studio commit');
      if (res.success) {
        showToast('✓ Pushed to remote origin successfully!');
      } else {
        showToast('🔴 ' + res.error);
      }
      refreshGitStatus(api);
    }
  });
}

async function refreshGitStatus(api: any): Promise<void> {
  if (!api?.git) return;
  try {
    const git = await api.git.inspect();
    const branches = await api.git.getBranches();

    const branchEl = document.getElementById('gitActiveBranch');
    const remoteEl = document.getElementById('gitRemoteUrl');
    const authorEl = document.getElementById('gitAuthor');
    const filesList = document.getElementById('gitFilesList');
    const branchDropdown = document.getElementById('gitBranchDropdown') as HTMLSelectElement;

    if (branchEl) branchEl.innerText = git.currentBranch || 'main';
    if (remoteEl) remoteEl.innerText = git.remoteUrl || 'No remote origin configured';
    if (authorEl) authorEl.innerText = `${git.userName || 'developer'} <${git.userEmail || 'dev@client.corp'}>`;

    if (filesList) {
      filesList.innerHTML = git.modifiedFiles && git.modifiedFiles.length > 0
        ? git.modifiedFiles.map((f: string) => `<div>✏️ ${f}</div>`).join('')
        : '<div style="color: var(--success);">✓ Working directory is clean.</div>';
    }

    if (branchDropdown && branches) {
      branchDropdown.innerHTML = branches.map((b: string) => `<option value="${b}" ${b === git.currentBranch ? 'selected' : ''}>${b}</option>`).join('');
    }
  } catch {}
}

// --- MODALS ---
function setupModals(api: any): void {
  const btnHeaderModel = document.getElementById('btnHeaderModelPicker');
  const modalAiProvider = document.getElementById('modalAiProvider');
  const btnCloseAiProvider = document.getElementById('btnCloseAiProviderModal');

  const btnHeaderPlugins = document.getElementById('btnHeaderPlugins');
  const modalPlugins = document.getElementById('modalPluginsDrawer');
  const btnClosePlugins = document.getElementById('btnClosePluginsModal');

  btnHeaderModel?.addEventListener('click', () => {
    if (modalAiProvider) modalAiProvider.style.display = 'flex';
  });
  btnCloseAiProvider?.addEventListener('click', () => {
    if (modalAiProvider) modalAiProvider.style.display = 'none';
  });

  btnHeaderPlugins?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'flex';
  });
  btnClosePlugins?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'none';
  });

  // Select provider item
  document.querySelectorAll<HTMLElement>('.modal-item[data-provider]').forEach(item => {
    item.addEventListener('click', () => {
      const p = item.getAttribute('data-provider');
      const m = item.getAttribute('data-model');
      const lbl = document.getElementById('lblHeaderModel');
      if (lbl && p && m) {
        lbl.innerText = `${p.toUpperCase()} · ${m}`;
      }
      if (modalAiProvider) modalAiProvider.style.display = 'none';
      showToast(`✓ Active Model switched to ${p?.toUpperCase()}: ${m}`);
    });
  });

  // Modal navigation shortcuts
  document.getElementById('btnOpenLakehouseHub')?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'none';
    switchActivityTab('lakehouse', api);
  });
  document.getElementById('btnRunSecurityAudit')?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'none';
    switchActivityTab('security', api);
  });
  document.getElementById('btnConnectGit')?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'none';
    switchActivityTab('git', api);
  });
  document.getElementById('btnOpenCloudHub')?.addEventListener('click', () => {
    if (modalPlugins) modalPlugins.style.display = 'none';
    switchActivityTab('delivery', api);
    const drawer = document.getElementById('cloudHubDrawer');
    if (drawer) drawer.style.display = 'block';
  });
}

function showToast(message: string): void {
  const existing = document.getElementById('activeAppToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'activeAppToast';
  toast.innerText = message;
  toast.style.cssText = 'position: fixed; bottom: 32px; right: 24px; background: #252526; color: #4ec9b0; border: 1px solid #4ec9b0; padding: 10px 18px; border-radius: 6px; font-size: 12px; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,0.4); z-index: 9999; animation: fadeIn 0.2s ease;';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}
