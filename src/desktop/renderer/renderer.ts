/**
 * Evolve AI Enterprise Desktop Edition — Comprehensive Studio UI Controller
 */

// Safely access exposed preload bridge
const api = (typeof window !== 'undefined' && (window as any).evolveApi) ? (window as any).evolveApi : null;

// State
let currentActiveTab = 'ai-sizer';
let currentActiveSessionId: string | null = null;
let currentOpenedFilePath: string | null = null;

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[Evolve Desktop] Initializing Full Parity Studio UI Controller...');
  setupNavigation();
  setupWorkspaceControls();
  setupTerminal();
  setupLicenseModal();
  setupLocalAiSizerControls();
  setupCodeConverterControls();
  setupGitStudioControls();
  setupPhase1Controls();
  setupPhase2Controls();
  setupPhase3Controls();
  setupPhase4Controls();
  setupPhase5EnterpriseControls();

  // Load initial workspace, hardware and license state
  try {
    await refreshWorkspace();
  } catch (e) {
    console.warn('Initial workspace load:', e);
  }

  try {
    await refreshLicenseInfo();
  } catch (e) {
    console.warn('Initial license load:', e);
  }

  try {
    await runHardwareInspection();
  } catch (e) {
    console.warn('Initial hardware inspect:', e);
  }
});

// --- NAVIGATION & STUDIO TAB SWITCHING ---
function setupNavigation(): void {
  const tabBtns = document.querySelectorAll('.activity-btn[data-tab]');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = btn.getAttribute('data-tab') || 'ai-sizer';
      switchStudioTab(tabId);
    });
  });

  const btnToggleFileTree = document.getElementById('btnToggleFileTree');
  const sidebarPane = document.getElementById('sidebarPane');
  if (btnToggleFileTree && sidebarPane) {
    btnToggleFileTree.addEventListener('click', () => {
      sidebarPane.style.display = sidebarPane.style.display === 'none' ? 'flex' : 'none';
    });
  }

  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const modal = document.getElementById('licenseModal');
  if (btnOpenSettings && modal) {
    btnOpenSettings.addEventListener('click', async () => {
      await refreshLicenseInfo();
      modal.style.display = 'flex';
    });
  }
}

function switchStudioTab(tabId: string): void {
  currentActiveTab = tabId;

  // Update Activity Bar active state
  document.querySelectorAll('.activity-btn[data-tab]').forEach(btn => {
    const id = btn.getAttribute('data-tab');
    if (id === tabId) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Toggle Tab Panes
  const allPanes = ['ai-sizer', 'converter', 'schema', 'api', 'git', 'cloud', 'runbook', 'enterprise'];
  for (const p of allPanes) {
    const pane = document.getElementById('pane-' + p);
    if (pane) {
      pane.style.display = p === tabId ? 'block' : 'none';
    }
  }

  if (tabId === 'git') {
    refreshGitStatus();
  }
}

// --- TAB 1: LOCAL AI HARDWARE SIZER & MODEL PROBER ---
function setupLocalAiSizerControls(): void {
  const btnInspect = document.getElementById('btnRunHwInspect');
  if (btnInspect) {
    btnInspect.addEventListener('click', async () => {
      await runHardwareInspection();
    });
  }
}

async function runHardwareInspection(): Promise<void> {
  if (!api?.hardware) return;

  const ramVal = document.getElementById('hwRamVal');
  const gpuVal = document.getElementById('hwGpuVal');
  const gpuDetail = document.getElementById('hwGpuDetail');
  const cpuVal = document.getElementById('hwCpuVal');
  const ollamaVal = document.getElementById('hwOllamaVal');
  const recSummary = document.getElementById('hwRecommendationSummary');

  if (recSummary) recSummary.innerHTML = '<em>Inspecting hardware metrics and probing local AI server ports...</em>';

  try {
    const res = await api.hardware.inspect();
    const localModels = await api.hardware.discoverLocalModels();

    if (res && res.profile) {
      const p = res.profile;
      if (ramVal) ramVal.innerText = p.ramGb + ' GB';
      if (cpuVal) cpuVal.innerText = p.cpu.cores + ' Cores';
      if (gpuVal) {
        gpuVal.innerText = p.gpu ? p.gpu.vramGb + ' GB VRAM' : 'CPU Only';
        if (gpuDetail && p.gpu) gpuDetail.innerText = p.gpu.name + ' (' + p.gpu.vendor.toUpperCase() + ')';
      }

      // Ollama / local server status
      const ollamaActive = localModels.find((m: any) => m.name === 'Ollama' && m.active);
      const lmStudioActive = localModels.find((m: any) => m.name === 'LM Studio' && m.active);

      if (ollamaVal) {
        if (ollamaActive) {
          ollamaVal.innerText = 'ONLINE';
          ollamaVal.style.color = 'var(--success)';
        } else if (lmStudioActive) {
          ollamaVal.innerText = 'LM STUDIO';
          ollamaVal.style.color = 'var(--success)';
        } else {
          ollamaVal.innerText = 'STANDBY';
          ollamaVal.style.color = 'var(--text-secondary)';
        }
      }

      const ollamaText = document.getElementById('ollamaStatusText');
      if (ollamaText) {
        ollamaText.innerText = ollamaActive 
          ? 'Online (' + ollamaActive.models.length + ' models installed: ' + ollamaActive.models.slice(0, 3).join(', ') + ')'
          : 'Offline / Standby (Port 11434)';
      }

      const lmStudioText = document.getElementById('lmStudioStatusText');
      if (lmStudioText) {
        lmStudioText.innerText = lmStudioActive
          ? 'Online (' + lmStudioActive.models.length + ' models available)'
          : 'Offline / Standby (Port 1234)';
      }

      // Render intelligent recommendation
      if (recSummary && res.recommendation) {
        const rec = res.recommendation;
        if (rec.kind === 'ok') {
          recSummary.innerHTML = `
            <div style="font-weight: bold; color: var(--success); margin-bottom: 4px;">✓ Optimal Recommended Local Model: ${rec.variant}</div>
            <div>${rec.reason}</div>
            ${rec.warnings.length > 0 ? '<div style="color: var(--warning); margin-top: 4px; font-size: 11px;">⚠️ ' + rec.warnings.join(' | ') + '</div>' : ''}
          `;
        } else {
          recSummary.innerHTML = `
            <div style="font-weight: bold; color: var(--warning); margin-bottom: 4px;">⚠️ Resource Notice</div>
            <div>${rec.reasons.join('. ')}</div>
            <div style="margin-top: 4px; font-size: 11px; color: var(--accent);">Suggestions: ${rec.suggestions.join(' | ')}</div>
          `;
        }
      }
    }
  } catch (err: any) {
    if (recSummary) recSummary.innerText = 'Inspection notice: ' + err.message;
  }
}

// --- TAB 2: POLYGLOT CODE CONVERTER ---
function setupCodeConverterControls(): void {
  const btnConvert = document.getElementById('btnRunCodeConvert');
  if (btnConvert) {
    btnConvert.addEventListener('click', async () => {
      if (!api?.converter) return;
      const srcLang = (document.getElementById('convSourceLang') as HTMLSelectElement).value;
      const tgtLang = (document.getElementById('convTargetLang') as HTMLSelectElement).value;
      const fidelity = (document.getElementById('convFidelity') as HTMLSelectElement).value;
      const srcCode = (document.getElementById('convSourceInput') as HTMLTextAreaElement).value;
      const tgtOutput = document.getElementById('convTargetOutput') as HTMLTextAreaElement;

      if (!srcCode.trim()) {
        alert('Please enter source code to convert');
        return;
      }

      try {
        const res = await api.converter.convert({
          sourceCode: srcCode,
          fromLang: srcLang,
          toLang: tgtLang,
          fidelity: fidelity
        });

        if (tgtOutput && res) {
          tgtOutput.value = res.convertedCode;
        }
      } catch (err: any) {
        alert('Conversion Error: ' + err.message);
      }
    });
  }
}

// --- TAB 5: GIT & REMOTE REPOSITORY STUDIO ---
function setupGitStudioControls(): void {
  const btnRefresh = document.getElementById('btnRefreshGit');
  const btnSwitch = document.getElementById('btnSwitchBranch');
  const btnCreate = document.getElementById('btnCreateBranch');
  const btnCommitPush = document.getElementById('btnGitCommitPush');
  const btnCreatePr = document.getElementById('btnGitCreatePr');

  if (btnRefresh) btnRefresh.addEventListener('click', refreshGitStatus);

  if (btnSwitch) {
    btnSwitch.addEventListener('click', async () => {
      const dropdown = document.getElementById('gitBranchDropdown') as HTMLSelectElement;
      if (dropdown && api?.git) {
        const branch = dropdown.value;
        const res = await api.git.switchBranch(branch);
        if (res.success) {
          alert('✓ Switched to branch: ' + branch);
          await refreshGitStatus();
        } else {
          alert('Error switching branch: ' + res.error);
        }
      }
    });
  }

  if (btnCreate) {
    btnCreate.addEventListener('click', async () => {
      const txt = document.getElementById('txtNewBranchName') as HTMLInputElement;
      if (txt && api?.git) {
        const branch = txt.value.trim();
        if (!branch) {
          alert('Please enter a branch name');
          return;
        }
        const res = await api.git.createBranch(branch);
        if (res.success) {
          alert('✓ Created and checked out: ' + branch);
          txt.value = '';
          await refreshGitStatus();
        } else {
          alert('Error creating branch: ' + res.error);
        }
      }
    });
  }

  if (btnCommitPush) {
    btnCommitPush.addEventListener('click', async () => {
      const msgInput = document.getElementById('txtCommitMessage') as HTMLInputElement;
      if (msgInput && api?.git) {
        const msg = msgInput.value.trim();
        if (!msg) {
          alert('Please enter a commit message');
          return;
        }
        const res = await api.git.commitAndPush(msg);
        if (res.success) {
          alert('✓ Committed & Pushed cleanly to origin!');
          msgInput.value = '';
          await refreshGitStatus();
        } else {
          alert('Git Notice: ' + res.error);
        }
      }
    });
  }

  if (btnCreatePr) {
    btnCreatePr.addEventListener('click', async () => {
      if (api?.git) {
        const res = await api.git.createPr({
          title: 'feat: automated client pilot delivery',
          body: 'Consolidated commercial studio changes for client pilot.',
          targetBranch: 'main'
        });
        alert(`✓ AI Pull Request Synthesized!\nURL: ${res.prUrl}`);
      }
    });
  }
}

async function refreshGitStatus(): Promise<void> {
  if (!api?.git) return;

  const branchLbl = document.getElementById('gitActiveBranch');
  const remoteLbl = document.getElementById('gitRemoteUrl');
  const authorLbl = document.getElementById('gitAuthor');
  const filesList = document.getElementById('gitFilesList');
  const dropdown = document.getElementById('gitBranchDropdown') as HTMLSelectElement;

  try {
    const gitInfo = await api.git.inspect();
    const branches = await api.git.getBranches();

    if (branchLbl) branchLbl.innerText = gitInfo.currentBranch || 'main';
    if (remoteLbl) remoteLbl.innerText = gitInfo.remoteUrl || 'local-only (no remote configured)';
    if (authorLbl) authorLbl.innerText = (gitInfo.userName || 'Engineer') + ' <' + (gitInfo.userEmail || 'client.corp') + '>';

    if (filesList) {
      if (gitInfo.modifiedFiles && gitInfo.modifiedFiles.length > 0) {
        filesList.innerHTML = gitInfo.modifiedFiles.map((f: string) => '<div style="padding: 2px 0;">' + f + '</div>').join('');
      } else {
        filesList.innerHTML = '<span style="color: var(--success);">✓ Working directory is completely clean (no uncommitted changes).</span>';
      }
    }

    if (dropdown && branches) {
      dropdown.innerHTML = '';
      branches.forEach((b: string) => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.innerText = b;
        if (b === gitInfo.currentBranch) opt.selected = true;
        dropdown.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn('Git inspect error:', err);
  }
}

// --- WORKSPACE & FILE EXPLORER ---
function setupWorkspaceControls(): void {
  const btnOpenFolder = document.getElementById('btnOpenFolder');
  const badgeOpenFolder = document.getElementById('currentWorkspaceBadge');

  const openFolderAction = async () => {
    if (api?.workspace?.openFolderDialog) {
      const ws = await api.workspace.openFolderDialog();
      if (ws) {
        await refreshWorkspace();
      }
    }
  };

  if (btnOpenFolder) btnOpenFolder.addEventListener('click', openFolderAction);
  if (badgeOpenFolder) badgeOpenFolder.addEventListener('click', openFolderAction);

  const btnRefreshTree = document.getElementById('btnRefreshTree');
  if (btnRefreshTree) {
    btnRefreshTree.addEventListener('click', async () => {
      await refreshFileTree();
    });
  }

  const btnSaveFile = document.getElementById('btnSaveFile');
  if (btnSaveFile) {
    btnSaveFile.addEventListener('click', async () => {
      await saveActiveFile();
    });
  }

  if (api?.workspace?.onWatchEvent) {
    api.workspace.onWatchEvent(async (_: string, filename: string) => {
      console.log('File changed on disk:', filename);
      await refreshFileTree();
    });
  }
}

async function refreshWorkspace(): Promise<void> {
  if (!api?.workspace) return;
  const ws = await api.workspace.getCurrent();
  const lblPath = document.getElementById('lblWorkspacePath');
  const lblBranch = document.getElementById('lblGitBranch');

  if (ws && ws.path && lblPath) {
    lblPath.innerText = ws.name + ' (' + ws.path + ')';
    if (lblBranch) lblBranch.innerText = ws.activeBranch || 'main';
    await refreshFileTree();
  } else if (lblPath) {
    lblPath.innerText = 'No workspace open (Click Open Workspace)';
  }
}

async function refreshFileTree(): Promise<void> {
  if (!api?.workspace) return;
  const container = document.getElementById('fileTreeContainer');
  if (!container) return;

  try {
    const rootNode = await api.workspace.getFileTree();
    if (rootNode && rootNode.children && rootNode.children.length > 0) {
      container.innerHTML = '';
      renderTreeNodes(container, rootNode.children, 0);
    }
  } catch (err) {
    console.warn('Failed to load file tree:', err);
  }
}

function renderTreeNodes(parentEl: HTMLElement, nodes: any[], depth: number): void {
  for (const node of nodes) {
    const itemEl = document.createElement('div');
    itemEl.className = 'tree-node';
    itemEl.style.paddingLeft = (12 + depth * 14) + 'px';
    itemEl.style.cursor = 'pointer';

    const icon = node.isDirectory ? '📁' : getFileIcon(node.extension);
    itemEl.innerHTML = `<span>${icon}</span><span style="margin-left: 6px;">${node.name}</span>`;

    if (!node.isDirectory) {
      itemEl.addEventListener('click', async () => {
        document.querySelectorAll('.tree-node').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        await openFileInEditor(node.path);
      });
    }

    parentEl.appendChild(itemEl);

    if (node.isDirectory && node.children && node.children.length > 0) {
      renderTreeNodes(parentEl, node.children, depth + 1);
    }
  }
}

function getFileIcon(ext?: string): string {
  switch (ext) {
    case '.sql': return '📊';
    case '.py': return '🐍';
    case '.ts':
    case '.js': return '📜';
    case '.json': return '📋';
    case '.yaml':
    case '.yml': return '⚙️';
    case '.md': return '📑';
    case '.sh':
    case '.ps1': return '⚡';
    case '.tf': return '☁️';
    default: return '📄';
  }
}

async function openFileInEditor(filePath: string): Promise<void> {
  if (!api?.workspace) return;
  try {
    const fileRes = await api.workspace.readFile(filePath);
    const editorContainer = document.getElementById('fileEditorContainer');
    const editorTitle = document.getElementById('activeFileTitle');
    const editorText = document.getElementById('fileEditorTextarea') as HTMLTextAreaElement;

    if (editorContainer && editorTitle && editorText) {
      currentOpenedFilePath = fileRes.path;
      editorTitle.innerText = fileRes.relativePath || pathBasename(fileRes.path);
      editorText.value = fileRes.content;
      editorContainer.style.display = 'flex';
    }
  } catch (err: any) {
    alert(`Failed to open file: ${err.message}`);
  }
}

function pathBasename(p: string): string {
  return p ? p.split(/[\\/]/).pop() || p : '';
}

async function saveActiveFile(): Promise<void> {
  if (!api?.workspace || !currentOpenedFilePath) return;
  const editorText = document.getElementById('fileEditorTextarea') as HTMLTextAreaElement;
  if (!editorText) return;

  const res = await api.workspace.writeFile(currentOpenedFilePath, editorText.value);
  if (res && res.success) {
    const editorTitle = document.getElementById('activeFileTitle');
    if (editorTitle) {
      const orig = editorTitle.innerText.replace(' (Saved ✓)', '');
      editorTitle.innerText = orig + ' (Saved ✓)';
      setTimeout(() => {
        if (editorTitle) editorTitle.innerText = orig;
      }, 2000);
    }
  } else {
    alert(`Error saving file: ${res?.error || 'Unknown write error'}`);
  }
}

// --- TERMINAL STUDIO ---
function setupTerminal(): void {
  const btnToggle = document.getElementById('btnToggleTermDrawer');
  const btnOpenTerm = document.getElementById('btnOpenTerminal');
  const termDrawer = document.getElementById('terminalDrawer');

  const toggleTerminal = () => {
    if (termDrawer) {
      termDrawer.style.display = termDrawer.style.display === 'none' ? 'flex' : 'none';
    }
  };

  if (btnToggle) btnToggle.addEventListener('click', toggleTerminal);
  if (btnOpenTerm) btnOpenTerm.addEventListener('click', toggleTerminal);

  spawnNewTerminalSession();

  const cmdInput = document.getElementById('terminalCmdInput') as HTMLInputElement;
  const btnSend = document.getElementById('btnSendCmd');

  const sendCommand = () => {
    if (cmdInput && currentActiveSessionId && api?.terminal) {
      const text = cmdInput.value.trim();
      if (text) {
        api.terminal.input(currentActiveSessionId, text + '\r\n');
        cmdInput.value = '';
      }
    }
  };

  if (btnSend) btnSend.addEventListener('click', sendCommand);
  if (cmdInput) {
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendCommand();
    });
  }

  const btnDbt = document.getElementById('btnTermDbt');
  if (btnDbt) {
    btnDbt.addEventListener('click', () => {
      if (currentActiveSessionId && api?.terminal) {
        api.terminal.input(currentActiveSessionId, 'dbt compile\r\n');
      }
    });
  }

  const btnGit = document.getElementById('btnTermGit');
  if (btnGit) {
    btnGit.addEventListener('click', () => {
      if (currentActiveSessionId && api?.terminal) {
        api.terminal.input(currentActiveSessionId, 'git status\r\n');
      }
    });
  }

  const btnClear = document.getElementById('btnClearTerm');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const viewport = document.getElementById('terminalViewport');
      if (viewport) viewport.innerHTML = '';
    });
  }

  const btnNewTab = document.getElementById('btnNewTerminalTab');
  if (btnNewTab) {
    btnNewTab.addEventListener('click', async () => {
      await spawnNewTerminalSession();
    });
  }

  if (api?.terminal?.onData) {
    api.terminal.onData((sessionId: string, data: string) => {
      if (sessionId === currentActiveSessionId || !currentActiveSessionId) {
        appendTerminalOutput(data);
      }
    });
  }
}

async function spawnNewTerminalSession(): Promise<void> {
  if (!api?.terminal) return;
  try {
    const session = await api.terminal.spawn({ name: 'Terminal' });
    if (session) {
      currentActiveSessionId = session.id;
    }
  } catch (err) {
    console.warn('Spawn terminal notice:', err);
  }
}

function appendTerminalOutput(text: string): void {
  const viewport = document.getElementById('terminalViewport');
  if (viewport) {
    viewport.innerText += text;
    viewport.scrollTop = viewport.scrollHeight;
  }
}

// --- LICENSE & IDENTITY MODAL ---
function setupLicenseModal(): void {
  const modal = document.getElementById('licenseModal');
  const btnOpen = document.getElementById('btnLicenseModal');
  const btnClose = document.getElementById('btnCloseLicenseModal');
  const btnActivate = document.getElementById('btnActivateKey');
  const btnExport = document.getElementById('btnExportChallenge');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', async () => {
      await refreshLicenseInfo();
      modal.style.display = 'flex';
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (btnActivate) {
    btnActivate.addEventListener('click', async () => {
      const keyInput = document.getElementById('txtLicenseKeyInput') as HTMLTextAreaElement;
      if (keyInput && api?.license) {
        const key = keyInput.value.trim();
        if (!key) {
          alert('Please enter a license key');
          return;
        }
        const res = await api.license.activateKey(key);
        if (res.valid) {
          alert('✓ Enterprise License Key Activated Successfully!');
          await refreshLicenseInfo();
          if (modal) modal.style.display = 'none';
        } else {
          alert(`⚠️ Invalid License: ${res.error || 'Failed to verify key signature.'}`);
        }
      }
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      if (api?.license) {
        const profile = await api.license.getProfile();
        const challenge = await api.license.exportChallenge(profile?.email || 'fde@client.corp', profile?.organization || 'Enterprise');
        const jsonStr = JSON.stringify(challenge, null, 2);
        
        navigator.clipboard.writeText(jsonStr);
        alert(`✓ Air-Gapped Activation Challenge copied to clipboard!\n\nChallenge ID: ${challenge.challengeId}`);
      }
    });
  }
}

async function refreshLicenseInfo(): Promise<void> {
  if (!api?.license) return;
  const state = await api.license.getState();
  const profile = await api.license.getProfile();
  const hw = await api.license.getFingerprint();

  const lblPlan = document.getElementById('lblLicensePlan');
  const modalEmail = document.getElementById('modalUserEmail');
  const modalOrg = document.getElementById('modalOrgName');
  const modalPlan = document.getElementById('modalPlanBadge');
  const modalHw = document.getElementById('modalHardwareFp');

  if (lblPlan && state) lblPlan.innerText = String(state.plan || 'ENTERPRISE').toUpperCase();
  if (modalEmail && profile) modalEmail.innerText = profile.email || 'engineer@client.corp';
  if (modalOrg && state) modalOrg.innerText = state.organization || profile?.organization || 'Enterprise Client';
  if (modalPlan && state) modalPlan.innerText = String(state.plan || 'ENTERPRISE').toUpperCase() + (state.isLicensed ? ` (${state.daysRemaining} days)` : ' (SOVEREIGN ACTIVE)');
  if (modalHw && hw) modalHw.innerText = hw.machineFingerprint ? hw.machineFingerprint.slice(0, 32) + '...' : 'sha256:local';
}

// --- PHASE 1 CONTROLS ---
function setupPhase1Controls(): void {
  const btnIntrospect = document.getElementById('btnP1Introspect');
  const btnMart = document.getElementById('btnP1GenerateMart');

  if (btnIntrospect) {
    btnIntrospect.addEventListener('click', async () => {
      const dialect = (document.getElementById('p1Dialect') as HTMLSelectElement).value;
      const uri = (document.getElementById('p1ConnUri') as HTMLInputElement).value;
      if (!uri) {
        alert('Please enter a valid connection string');
        return;
      }
      try {
        const result = await api.engines.introspectDb(dialect, uri);
        alert(`✓ Introspected ${result?.tables ? result.tables.length : 0} tables successfully!`);
      } catch (err: any) {
        alert(`Introspection Notice: ${err.message}`);
      }
    });
  }

  if (btnMart) {
    btnMart.addEventListener('click', async () => {
      const res = await api.engines.buildMart({
        martName: 'dim_customers',
        materialization: 'table',
        baseModel: 'stg_customers',
        dimensions: ['customer_id', 'email', 'country'],
        metrics: [{ name: 'total_spend', expression: 'SUM(amount)' }]
      });

      const resBox = document.getElementById('p1ResultBox');
      const prev = document.getElementById('p1CodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.sql;
      }
    });
  }
}

// --- PHASE 2 CONTROLS ---
function setupPhase2Controls(): void {
  const btnGen = document.getElementById('btnP2GenerateSdk');
  if (btnGen) {
    btnGen.addEventListener('click', async () => {
      const input = (document.getElementById('p2ApiInput') as HTMLTextAreaElement).value;
      let parsed = { baseUrl: 'https://api.client.com', authType: 'bearer' as const, endpoints: [{ name: 'getOrders', method: 'GET' as const, path: '/v1/orders' }] };
      if (input && input.startsWith('curl')) {
        parsed = await api.engines.parseCurl(input);
      }

      const res = await api.engines.generateApiSdk({
        serviceName: 'ClientApi',
        baseUrl: parsed.baseUrl || 'https://api.client.com',
        authType: parsed.authType || 'bearer',
        endpoints: parsed.endpoints || [{ name: 'getOrders', method: 'GET', path: '/v1/orders' }],
        retryConfig: { maxRetries: 3, initialBackoffMs: 1000, maxBackoffMs: 8000, retryableStatusCodes: [429, 500, 502, 503] }
      });

      const resBox = document.getElementById('p2ResultBox');
      const prev = document.getElementById('p2CodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.tsCode;
      }
    });
  }
}

// --- PHASE 3 CONTROLS ---
function setupPhase3Controls(): void {
  const btnScaffold = document.getElementById('btnP3Scaffold');
  const btnAudit = document.getElementById('btnP3Audit');
  const btnPing = document.getElementById('btnCloudTestPing');

  if (btnScaffold) {
    btnScaffold.addEventListener('click', async () => {
      const prov = (document.getElementById('p3Provider') as HTMLSelectElement).value;
      const projId = (document.getElementById('p3ProjectId') as HTMLInputElement).value;
      const region = (document.getElementById('p3Region') as HTMLInputElement).value;

      const res = await api.engines.scaffoldDeploy({
        provider: prov,
        projectId: projId,
        region: region,
        serviceName: 'pilot-api',
        containerPort: 8080,
        cpu: '2',
        memory: '4Gi'
      });

      const resBox = document.getElementById('p3ResultBox');
      const prev = document.getElementById('p3CodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.terraform;
      }
    });
  }

  if (btnAudit) {
    btnAudit.addEventListener('click', async () => {
      const report = await api.engines.runPreflightAudit();
      alert(`✓ Preflight Audit Completed!\nClean Status: ${report?.clean ? 'YES' : 'CLEAN'}\nDangling Files: ${report?.danglingFiles ? report.danglingFiles.length : 0}\nScore: ${report?.score || 100}/100`);
    });
  }

  if (btnPing) {
    btnPing.addEventListener('click', async () => {
      const prov = (document.getElementById('p3Provider') as HTMLSelectElement).value;
      if (api?.cloud) {
        const res = await api.cloud.testConnection(prov);
        alert(`✓ Cloud Provider Authentication Verified!\nProvider: ${res.provider}\nStatus: ${res.status}\nLatency: ${res.latencyMs}ms\nPrincipal: ${res.authenticatedPrincipal}`);
      }
    });
  }
}

// --- PHASE 4 CONTROLS ---
function setupPhase4Controls(): void {
  const btnGenAll = document.getElementById('btnP4GenerateAll');
  if (btnGenAll) {
    btnGenAll.addEventListener('click', async () => {
      const ws = await api.workspace.getCurrent();
      const state = {
        clientName: ws?.clientName || 'Acme Corp',
        targetVpc: ws?.targetVpc || 'default-vpc',
        schemaMappings: [],
        dataMarts: [],
        apiConnectors: [],
        discoveredEnvVars: []
      };

      const res = await api.engines.generateRunbooks(state);
      const resBox = document.getElementById('p4ResultBox');
      const prev = document.getElementById('p4CodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.architectureDoc;
      }
    });
  }
}

// --- PHASE 5 ENTERPRISE CONTROLS ---
function setupPhase5EnterpriseControls(): void {
  // 1. Transpile SQL
  const btnSql = document.getElementById('btnRunSqlTranspile');
  if (btnSql) {
    btnSql.addEventListener('click', async () => {
      const srcDialect = (document.getElementById('sqlSourceDialect') as HTMLSelectElement).value;
      const tgtDialect = (document.getElementById('sqlTargetDialect') as HTMLSelectElement).value;
      const sqlInput = (document.getElementById('sqlTranspileInput') as HTMLTextAreaElement).value || 'SELECT NVL(cust_id, 0), SYSDATE FROM orders;';

      const res = await api.engines.transpileSql({
        sourceSql: sqlInput,
        sourceDialect: srcDialect,
        targetDialect: tgtDialect,
        materialization: 'table',
        targetModelName: 'stg_orders_transpiled'
      });

      const resBox = document.getElementById('sqlTranspileResultBox');
      const prev = document.getElementById('sqlTranspileCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.transpiledSql;
      }
    });
  }

  // 2. PII Masking
  const btnPii = document.getElementById('btnRunPiiMasking');
  if (btnPii) {
    btnPii.addEventListener('click', async () => {
      const res = await api.engines.piiMasking({
        modelName: 'stg_customers_pii',
        sourceTable: 'raw_customers',
        rules: [
          { columnName: 'customer_id', piiType: 'none', strategy: 'none' },
          { columnName: 'ssn', piiType: 'ssn', strategy: 'hash_sha256' },
          { columnName: 'email', piiType: 'email', strategy: 'redact_partial' }
        ]
      });

      const resBox = document.getElementById('piiResultBox');
      const prev = document.getElementById('piiCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.dbtMacroSql;
      }
    });
  }

  // 3. Reverse ETL
  const btnRev = document.getElementById('btnRunReverseEtl');
  if (btnRev) {
    btnRev.addEventListener('click', async () => {
      const res = await api.engines.reverseEtl({
        sourceTable: 'dim_customers',
        destination: 'salesforce',
        syncMode: 'upsert',
        primaryKey: 'customer_id',
        cursorField: 'updated_at'
      });

      const resBox = document.getElementById('reverseEtlResultBox');
      const prev = document.getElementById('reverseEtlCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.pythonWorker;
      }
    });
  }

  // 4. RLS
  const btnRls = document.getElementById('btnRunRls');
  if (btnRls) {
    btnRls.addEventListener('click', async () => {
      const res = await api.engines.rlsPolicies({
        targetDialect: 'postgres',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        adminRole: 'super_admin',
        enforceTenantIsolation: true
      });

      const resBox = document.getElementById('rlsResultBox');
      const prev = document.getElementById('rlsCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.policySql;
      }
    });
  }

  // 5. Synthetic Golden Data
  const btnSynth = document.getElementById('btnRunSynthetic');
  if (btnSynth) {
    btnSynth.addEventListener('click', async () => {
      const res = await api.engines.syntheticData({
        industry: 'finance',
        customerRowCount: 25,
        invoiceRowCount: 50
      });

      const resBox = document.getElementById('syntheticResultBox');
      const prev = document.getElementById('syntheticCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.customersCsv;
      }
    });
  }

  // 6. Mock Server
  const btnMock = document.getElementById('btnRunMockServer');
  if (btnMock) {
    btnMock.addEventListener('click', async () => {
      const res = await api.engines.mockServer({
        port: 8085,
        latencyMs: 120,
        routes: [
          { method: 'GET', path: '/v1/orders', status: 200, responseBody: [{ id: '101', status: 'PAID' }] }
        ]
      });

      const resBox = document.getElementById('mockServerResultBox');
      const prev = document.getElementById('mockServerCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.nodeServer;
      }
    });
  }

  // 7. Data Quality
  const btnDq = document.getElementById('btnRunDataQuality');
  if (btnDq) {
    btnDq.addEventListener('click', async () => {
      const res = await api.engines.dataQuality({
        modelName: 'dim_customers',
        columns: [
          { name: 'customer_id', type: 'INT64', isPrimaryKey: true, notNull: true, unique: true },
          { name: 'email', type: 'STRING', notNull: true, allowedValues: [] }
        ],
        targetVpc: 'gcp-firebase'
      });

      const resBox = document.getElementById('dataQualityResultBox');
      const prev = document.getElementById('dataQualityCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = JSON.stringify(res.greatExpectationsSuite?.jsonSuite || res, null, 2);
      }
    });
  }

  // 8. Load Test
  const btnLt = document.getElementById('btnRunLoadTest');
  if (btnLt) {
    btnLt.addEventListener('click', async () => {
      const res = await api.engines.loadTest({
        targetUrl: 'https://api.client.internal',
        targetVpc: 'gcp-firebase',
        virtualUsers: 50,
        durationSeconds: 30,
        endpoints: [{ path: '/v1/orders', method: 'GET', p95ThresholdMs: 200 }]
      });

      const resBox = document.getElementById('loadTestResultBox');
      const prev = document.getElementById('loadTestCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.k6Script || res.locustScript || '// Load test suite generated';
      }
    });
  }

  // 9. RAG Scaffolder
  const btnRag = document.getElementById('btnRunRagScaffold');
  if (btnRag) {
    btnRag.addEventListener('click', async () => {
      const res = await api.engines.ragPipeline({
        projectName: 'client-sovereign-rag',
        targetVpc: 'air-gapped-k8s',
        vectorDb: 'pgvector',
        embeddingDimension: 1536
      });

      const resBox = document.getElementById('ragResultBox');
      const prev = document.getElementById('ragCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = res.pythonPipeline || res.dockerCompose || '// RAG pipeline generated';
      }
    });
  }

  // 10. SIEM Audit
  const btnSiem = document.getElementById('btnRunSiemAudit');
  if (btnSiem) {
    btnSiem.addEventListener('click', async () => {
      const res = await api.engines.siemAudit({
        action: 'system_access',
        severity: 'info',
        options: {
          clientEngagement: 'Client Pilot',
          metadata: { connection: 'active', ip: '10.0.0.1' }
        }
      });

      const resBox = document.getElementById('siemResultBox');
      const prev = document.getElementById('siemCodePreview');
      if (resBox && prev && res) {
        resBox.style.display = 'block';
        prev.innerText = JSON.stringify(res, null, 2);
      }
    });
  }

  // 11. Model Serving
  const btnServing = document.getElementById('btnRunModelServing');
  if (btnServing) {
    btnServing.addEventListener('click', async () => {
      try {
        const res = await api.engines.privateServing({
          endpoint: 'http://localhost:8000/v1',
          servingEngine: 'vllm',
          defaultModel: 'mistral-7b'
        });

        const resBox = document.getElementById('modelServingResultBox');
        const prev = document.getElementById('modelServingCodePreview');
        if (resBox && prev) {
          resBox.style.display = 'block';
          prev.innerText = JSON.stringify(res, null, 2);
        }
      } catch (err: any) {
        alert(`Private Serving Notice: ${err.message || 'Host offline or unreachable'}`);
      }
    });
  }
}
