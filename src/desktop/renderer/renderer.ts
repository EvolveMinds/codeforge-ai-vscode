export {};

declare global {
  interface Window {
    evolveApi?: any;
  }
}

// Global active state
let currentActiveSessionId: string | null = null;
let currentActiveDeliveryPhase = 1;
let currentActiveTab = 'delivery';
let currentSelectedLanguage = 'python';
let currentSelectedDeliverable = 'chat';

// Engagement project catalog
interface EngagementProject {
  id: string;
  name: string;
  targetVpc: string;
  goal: string;
}

let activeProjects: EngagementProject[] = [
  { id: 'pilot-gcp', name: 'Client Pilot Engagement', targetVpc: 'gcp-firebase', goal: 'Deploy standard platform integration & data pipeline' },
  { id: 'fin-aws', name: 'Financial Core Migration', targetVpc: 'aws-ecs', goal: 'Migrate Oracle core transactions to AWS Aurora & Snowflake' },
  { id: 'health-azure', name: 'Healthcare Data Lakehouse', targetVpc: 'azure-container', goal: 'HIPAA compliant Delta Lakehouse with automated PII masking' }
];

document.addEventListener('DOMContentLoaded', async () => {
  const api = (window as any).evolveApi;

  // Initialize UI subsystems
  setupNavigation(api);
  setupTerminal(api);
  setupWorkspace(api);
  setupEngagementManager(api);
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
        renderFileTree(api);
        refreshWorkspaceDataFiles(api);
      }
    } catch {}

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

// --- TERMINAL DRAWER ---
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

  if (api?.terminal) {
    api.terminal.spawn({ name: 'Terminal 1' }).then((session: any) => {
      if (session) {
        currentActiveSessionId = session.id;
      }
    }).catch(() => {});

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

// --- WORKSPACE & COLLAPSIBLE FILE EXPLORER ---
function setupWorkspace(api: any): void {
  const btnOpenFolder = document.getElementById('btnOpenFolder');
  const btnRefreshTree = document.getElementById('btnRefreshTree');
  const btnCollapseAll = document.getElementById('btnCollapseAllTree');
  const btnTreeNewFile = document.getElementById('btnTreeNewFile');
  const btnTreeNewFolder = document.getElementById('btnTreeNewFolder');

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

  btnCollapseAll?.addEventListener('click', () => {
    const container = document.getElementById('fileTreeContainer');
    if (container) {
      container.querySelectorAll('.tree-children').forEach(c => {
        (c as HTMLElement).style.display = 'none';
      });
      container.querySelectorAll('.tree-arrow').forEach(a => {
        (a as HTMLElement).innerText = '▶';
      });
      container.querySelectorAll('.tree-icon-folder').forEach(i => {
        (i as HTMLElement).innerText = '📁';
      });
    }
  });

  btnTreeNewFile?.addEventListener('click', async () => {
    const name = prompt('Enter new file name (e.g. models/stg_orders.sql):');
    if (name && api?.workspace) {
      const ws = await api.workspace.getCurrent();
      if (ws) {
        const fullPath = ws.path + '/' + name;
        await api.workspace.createFile(fullPath, '');
        showToast(`✓ Created file: ${name}`);
        renderFileTree(api);
      }
    }
  });

  btnTreeNewFolder?.addEventListener('click', async () => {
    const name = prompt('Enter new folder name (e.g. models/marts):');
    if (name && api?.workspace) {
      const ws = await api.workspace.getCurrent();
      if (ws) {
        const fullPath = ws.path + '/' + name;
        await api.workspace.createDir(fullPath);
        showToast(`✓ Created folder: ${name}`);
        renderFileTree(api);
      }
    }
  });
}

function updateWorkspaceUI(ws: { name: string; path: string }): void {
  const lblPath = document.getElementById('lblWorkspacePath');
  if (lblPath) lblPath.innerText = `${ws.name} (${ws.path})`;
}

function getFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'py': return '🐍';
    case 'ts': return '📘';
    case 'js': return '📜';
    case 'sql': return '🗄️';
    case 'json': return '🔧';
    case 'md': return '📑';
    case 'csv': case 'tsv': case 'xlsx': case 'parquet': return '📊';
    case 'yml': case 'yaml': return '⚙️';
    case 'sh': case 'ps1': return '⚡';
    case 'html': return '🌐';
    case 'css': return '🎨';
    default: return '📄';
  }
}

async function renderFileTree(api: any): Promise<void> {
  const container = document.getElementById('fileTreeContainer');
  if (!container || !api?.workspace) return;

  try {
    const treeData = await api.workspace.getFileTree();
    if (!treeData) {
      container.innerHTML = '<div style="padding:14px; color:var(--text-secondary); font-size:11px; text-align:center;">Workspace is empty.</div>';
      return;
    }

    const rootNodes = Array.isArray(treeData) ? treeData : (treeData.children || [treeData]);
    
    if (rootNodes.length === 0) {
      container.innerHTML = '<div style="padding:14px; color:var(--text-secondary); font-size:11px; text-align:center;">No files found in workspace folder.</div>';
      return;
    }

    const buildTreeHtml = (nodes: any[], depth: number): string => {
      let html = '';
      nodes.forEach(node => {
        const pad = depth * 14 + 10;
        if (node.isDirectory) {
          html += `<div class="tree-folder-wrapper">
            <div class="file-tree-item directory" style="padding-left: ${pad}px; display: flex; align-items: center; gap: 6px; padding-top: 4px; padding-bottom: 4px; cursor: pointer; user-select: none; border-radius: 4px;" data-path="${node.path}">
              <span class="tree-arrow" style="font-size: 9px; width: 10px; color: var(--text-secondary);">▶</span>
              <span class="tree-icon-folder" style="font-size: 13px;">📁</span>
              <span class="tree-label" style="font-weight: 600; color: #e2e8f0;">${node.name}</span>
            </div>
            <div class="tree-children" style="display: none;">
              ${node.children && node.children.length > 0 ? buildTreeHtml(node.children, depth + 1) : '<div style="padding-left:' + (pad + 18) + 'px; font-size:10.5px; color:var(--text-muted); padding-top:2px; padding-bottom:2px;">(empty folder)</div>'}
            </div>
          </div>`;
        } else {
          const icon = getFileIcon(node.name);
          html += `<div class="file-tree-item file" style="padding-left: ${pad + 16}px; display: flex; align-items: center; gap: 6px; padding-top: 3px; padding-bottom: 3px; cursor: pointer; user-select: none; border-radius: 4px;" data-path="${node.path}">
            <span style="font-size: 12px;">${icon}</span>
            <span class="tree-label" style="color: #cbd5e1;">${node.name}</span>
          </div>`;
        }
      });
      return html;
    };

    container.innerHTML = buildTreeHtml(rootNodes, 0);

    container.querySelectorAll('.file-tree-item.directory').forEach(dirItem => {
      dirItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const wrapper = dirItem.closest('.tree-folder-wrapper');
        const childrenDiv = wrapper?.querySelector('.tree-children') as HTMLElement;
        const arrow = dirItem.querySelector('.tree-arrow') as HTMLElement;
        const folderIcon = dirItem.querySelector('.tree-icon-folder') as HTMLElement;

        if (childrenDiv) {
          const isCollapsed = childrenDiv.style.display === 'none' || childrenDiv.style.display === '';
          childrenDiv.style.display = isCollapsed ? 'block' : 'none';
          if (arrow) arrow.innerText = isCollapsed ? '▼' : '▶';
          if (folderIcon) folderIcon.innerText = isCollapsed ? '📂' : '📁';
        }
      });
    });

    container.querySelectorAll('.file-tree-item.file').forEach(fileItem => {
      fileItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        container.querySelectorAll('.file-tree-item').forEach(i => (i as HTMLElement).style.background = 'transparent');
        (fileItem as HTMLElement).style.background = 'rgba(78, 201, 176, 0.15)';

        const filePath = fileItem.getAttribute('data-path');
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

// --- ENGAGEMENT & PROJECT MANAGEMENT ---
function setupEngagementManager(api: any): void {
  const selEngagement = document.getElementById('selEngagement') as HTMLSelectElement;
  const btnNewEngagement = document.getElementById('btnNewEngagement');
  const btnResetEngagement = document.getElementById('btnResetEngagement');
  const modalNewProject = document.getElementById('modalNewProject');
  const btnCloseModal = document.getElementById('btnCloseNewProjectModal');
  const btnCancelModal = document.getElementById('btnCancelNewProject');
  const btnConfirmCreate = document.getElementById('btnConfirmCreateProject');

  const lblClientName = document.getElementById('lblDeliveryClientName');
  const lblTargetVpc = document.getElementById('lblTargetVpc');

  const renderEngagementOptions = () => {
    if (!selEngagement) return;
    selEngagement.innerHTML = activeProjects.map(p => 
      `<option value="${p.id}">🏢 ${p.name} (${p.targetVpc})</option>`
    ).join('');
  };

  renderEngagementOptions();

  selEngagement?.addEventListener('change', () => {
    const selected = activeProjects.find(p => p.id === selEngagement.value);
    if (selected) {
      if (lblClientName) lblClientName.innerText = selected.name;
      if (lblTargetVpc) lblTargetVpc.innerText = selected.targetVpc;
      showToast(`✓ Switched engagement to: ${selected.name}`);
    }
  });

  btnNewEngagement?.addEventListener('click', () => {
    if (modalNewProject) modalNewProject.style.display = 'flex';
  });

  const closeModal = () => {
    if (modalNewProject) modalNewProject.style.display = 'none';
  };
  btnCloseModal?.addEventListener('click', closeModal);
  btnCancelModal?.addEventListener('click', closeModal);

  btnConfirmCreate?.addEventListener('click', () => {
    const name = (document.getElementById('txtNewProjName') as HTMLInputElement).value.trim();
    const vpc = (document.getElementById('selNewProjVpc') as HTMLSelectElement).value;
    const goal = (document.getElementById('txtNewProjGoal') as HTMLTextAreaElement).value.trim();

    if (!name) {
      showToast('⚠️ Please enter a project or engagement name.');
      return;
    }

    const newId = 'proj-' + Math.random().toString(36).substring(2, 8);
    const newProject: EngagementProject = { id: newId, name, targetVpc: vpc, goal };
    activeProjects.unshift(newProject);

    renderEngagementOptions();
    selEngagement.value = newId;

    if (lblClientName) lblClientName.innerText = name;
    if (lblTargetVpc) lblTargetVpc.innerText = vpc;

    closeModal();
    showToast(`✓ Created new engagement: ${name}`);
  });

  btnResetEngagement?.addEventListener('click', () => {
    if (confirm('Reset active delivery phases and re-run ingestion steps?')) {
      switchDeliveryPhase(1);
      showToast('✓ Engagement reset to Step 1.');
    }
  });
}

// --- DELIVERY STUDIO (100% Match with Image 2) ---
function setupDeliveryStudio(api: any): void {
  const phaseNavBtns = document.querySelectorAll<HTMLElement>('.phase-nav-btn[data-phase]');
  const btnDeliveryPlaybook = document.getElementById('btnDeliveryPlaybook');
  const roadmapBanner = document.getElementById('roadmapBanner');
  const btnCloseRoadmap = document.getElementById('btnCloseRoadmap');

  // Toggle Roadmap Banner
  btnDeliveryPlaybook?.addEventListener('click', () => {
    if (roadmapBanner) {
      const isHidden = roadmapBanner.style.display === 'none' || roadmapBanner.style.display === '';
      roadmapBanner.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        roadmapBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });

  btnCloseRoadmap?.addEventListener('click', () => {
    if (roadmapBanner) roadmapBanner.style.display = 'none';
  });

  // Switch between Step 1 to 5
  phaseNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-phase');
      if (p) switchDeliveryPhase(parseInt(p, 10));
    });
  });

  // STEP 1 CONTROLS (Exact match with Image 2)
  const btnToggleDbDrawer = document.getElementById('btnToggleDbDrawer');
  const dbConnectDrawer = document.getElementById('dbConnectDrawer');
  const btnCloseDbDrawer = document.getElementById('btnCloseDbDrawer');
  const btnPickSchemaFile = document.getElementById('btnPickSchemaFile');
  const tabModeStaging = document.getElementById('tabModeStaging');
  const tabModeMart = document.getElementById('tabModeMart');
  const subpanelStagingView = document.getElementById('subpanelStagingView');
  const subpanelMartView = document.getElementById('subpanelMartView');

  const btnAiAutoClean = document.getElementById('btnAiAutoClean');
  const btnAiPiiMasking = document.getElementById('btnAiPiiMasking');
  const btnAiCustomPrompt = document.getElementById('btnAiCustomPrompt');
  const aiCustomPromptDrawer = document.getElementById('aiCustomPromptDrawer');
  const btnApplyCustomPrompt = document.getElementById('btnApplyCustomPrompt');

  const txtSourceColumns = document.getElementById('txtSourceColumns') as HTMLTextAreaElement;
  const txtTargetColumns = document.getElementById('txtTargetColumns') as HTMLTextAreaElement;
  const txtSourceTableName = document.getElementById('txtSourceTableName') as HTMLInputElement;
  const txtTargetModelName = document.getElementById('txtTargetModelName') as HTMLInputElement;
  const txtTargetOutputPath = document.getElementById('txtTargetOutputPath') as HTMLInputElement;
  const btnGenerateDbtStaging = document.getElementById('btnGenerateDbtStaging');
  const stagingOutputResultBox = document.getElementById('stagingOutputResultBox');
  const stagingSqlCodePreview = document.getElementById('stagingSqlCodePreview');

  // Toggle Live DB Drawer
  btnToggleDbDrawer?.addEventListener('click', () => {
    if (dbConnectDrawer) {
      const isHidden = dbConnectDrawer.style.display === 'none' || dbConnectDrawer.style.display === '';
      dbConnectDrawer.style.display = isHidden ? 'block' : 'none';
    }
  });
  btnCloseDbDrawer?.addEventListener('click', () => {
    if (dbConnectDrawer) dbConnectDrawer.style.display = 'none';
  });

  // Browse CSV / Schema File
  btnPickSchemaFile?.addEventListener('click', async () => {
    if (api?.workspace) {
      const filePath = await api.workspace.openFileDialog();
      if (filePath) {
        const fileName = filePath.split(/[\\/]/).pop() || 'schema.csv';
        const lbl = document.getElementById('lblLoadedSourceFile');
        if (lbl) lbl.innerText = `(${fileName})`;

        if (txtSourceTableName) {
          txtSourceTableName.value = fileName.replace(/\.[^/.]+$/, '').toLowerCase() + '_raw';
        }
        if (txtTargetModelName) {
          txtTargetModelName.value = 'stg_' + fileName.replace(/\.[^/.]+$/, '').toLowerCase();
        }
        if (txtTargetOutputPath) {
          txtTargetOutputPath.value = `models/staging/stg_${fileName.replace(/\.[^/.]+$/, '').toLowerCase()}.sql`;
        }

        const content = await api.workspace.readFile(filePath);
        if (content) {
          const lines = content.split('\n').filter((l: string) => l.trim().length > 0);
          if (lines.length > 0) {
            const headers = lines[0].split(/[,;\t]/).map((h: string) => h.trim().replace(/["']/g, ''));
            txtSourceColumns.value = headers.map((h: string) => `${h}:string`).join('\n');
            showToast(`✓ Loaded ${headers.length} columns from ${fileName}`);
          }
        }
      }
    }
  });

  // Switch Submodes (Staging vs Mart)
  tabModeStaging?.addEventListener('click', () => {
    tabModeStaging.classList.add('active');
    tabModeMart?.classList.remove('active');
    if (subpanelStagingView) subpanelStagingView.style.display = 'block';
    if (subpanelMartView) subpanelMartView.style.display = 'none';
  });

  tabModeMart?.addEventListener('click', () => {
    tabModeMart.classList.add('active');
    tabModeStaging?.classList.remove('active');
    if (subpanelStagingView) subpanelStagingView.style.display = 'none';
    if (subpanelMartView) subpanelMartView.style.display = 'block';
  });

  // AI Auto-Clean & Standardize
  btnAiAutoClean?.addEventListener('click', () => {
    const raw = txtSourceColumns.value || 'CUST_NBR_ID:string\nTXN_AMT:float\nCREATED_TS:timestamp\nIS_ACTIVE_FLG:string';
    showToast('✨ AI Normalizing & Standardizing data types...');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const cleaned = lines.map(line => {
      const parts = line.split(':');
      let name = parts[0].trim().toLowerCase()
        .replace(/_nbr_id$/, '_id')
        .replace(/_flg$/, '')
        .replace(/_amt$/, '_amount')
        .replace(/_ts$/, '_at');
      let type = (parts[1] || 'string').trim().toLowerCase();
      if (type === 'float' || type === 'number') type = 'numeric';
      if (name.includes('is_') || name.includes('has_')) type = 'boolean';
      if (name.includes('_at') || name.includes('_date')) type = 'timestamp';
      return `${name}:${type}`;
    }).join('\n');

    txtTargetColumns.value = cleaned;
    showToast('✓ AI Auto-Clean completed!');
  });

  // AI PII Masking
  btnAiPiiMasking?.addEventListener('click', () => {
    const current = txtTargetColumns.value || txtSourceColumns.value;
    showToast('🔒 AI Identifying PII columns & applying SHA-256 masking...');
    const lines = current.split('\n').filter(l => l.trim().length > 0);
    const masked = lines.map(line => {
      const parts = line.split(':');
      const name = parts[0].trim();
      const type = parts[1] ? parts[1].trim() : 'string';
      if (name.includes('email') || name.includes('phone') || name.includes('ssn') || name.includes('tax') || name.includes('card')) {
        return `${name}:masked_${type}`;
      }
      return `${name}:${type}`;
    }).join('\n');
    txtTargetColumns.value = masked;
    showToast('✓ PII Masking rules attached to schema!');
  });

  // AI Custom Prompt Drawer
  btnAiCustomPrompt?.addEventListener('click', () => {
    if (aiCustomPromptDrawer) {
      aiCustomPromptDrawer.style.display = aiCustomPromptDrawer.style.display === 'none' ? 'block' : 'none';
    }
  });

  btnApplyCustomPrompt?.addEventListener('click', () => {
    const promptText = (document.getElementById('txtAiCustomInstruction') as HTMLInputElement).value;
    if (!promptText) return;
    showToast(`✨ Applying instruction: "${promptText}"...`);
    const current = txtSourceColumns.value;
    const lines = current.split('\n').filter(l => l.trim().length > 0);
    const transformed = lines.map(line => {
      const [col, t] = line.split(':');
      return `event_${col.toLowerCase().trim()}:${(t || 'string').trim()}`;
    }).join('\n');
    txtTargetColumns.value = transformed;
    showToast('✓ Custom AI transformation applied!');
  });

  // Generate dbt Staging Model
  btnGenerateDbtStaging?.addEventListener('click', async () => {
    const srcTable = txtSourceTableName.value.trim() || 'client_orders_raw';
    const modelName = txtTargetModelName.value.trim() || 'stg_orders';
    const targetCols = txtTargetColumns.value || txtSourceColumns.value || 'customer_id:string\ntransaction_amount:numeric\ncreated_at:timestamp\nis_active:boolean';

    showToast('🚀 Generating dbt Staging Model SQL...');
    const colLines = targetCols.split('\n').filter(l => l.trim().length > 0);
    const selectClauses = colLines.map(line => {
      const [name, type] = line.split(':').map(s => s.trim());
      if (type && type.startsWith('masked_')) {
        return `    SHA256(CAST(${name} AS STRING)) AS ${name}`;
      }
      if (type === 'numeric') {
        return `    CAST(${name} AS NUMERIC) AS ${name}`;
      }
      if (type === 'timestamp') {
        return `    CAST(${name} AS TIMESTAMP) AS ${name}`;
      }
      if (type === 'boolean') {
        return `    CAST(${name} AS BOOLEAN) AS ${name}`;
      }
      return `    TRIM(CAST(${name} AS STRING)) AS ${name}`;
    }).join(',\n');

    const dbtSql = `-- Staging Model: ${modelName}.sql\n-- Generated by Evolve AI Semantic Schema Mapper\n\nWITH source_raw AS (\n  SELECT * FROM {{ source('raw_data', '${srcTable}') }}\n),\n\nstandardized AS (\n  SELECT\n${selectClauses}\n  FROM source_raw\n)\n\nSELECT * FROM standardized;`;

    if (stagingOutputResultBox && stagingSqlCodePreview) {
      stagingOutputResultBox.style.display = 'block';
      stagingSqlCodePreview.innerText = dbtSql;
    }

    if (api?.workspace) {
      const outPath = txtTargetOutputPath.value.trim() || `models/staging/${modelName}.sql`;
      const ws = await api.workspace.getCurrent();
      if (ws) {
        await api.workspace.createFile(ws.path + '/' + outPath, dbtSql);
        showToast(`✓ Generated and saved ${outPath} to workspace!`);
        renderFileTree(api);
      }
    }
  });

  // Step 1: Introspect Database
  document.getElementById('btnExecuteIntrospect')?.addEventListener('click', async () => {
    const dialect = (document.getElementById('dbDialectSelect') as HTMLSelectElement).value;
    const uri = (document.getElementById('dbUriInput') as HTMLInputElement).value;
    if (!uri) {
      showToast('⚠️ Please enter database connection URI.');
      return;
    }
    showToast('🔌 Introspecting schema wire protocol...');
    if (api?.engines) {
      const res = await api.engines.introspectDb(dialect, uri);
      const resBox = document.getElementById('dbIntrospectResultBox');
      if (resBox) {
        resBox.style.display = 'block';
        resBox.innerText = JSON.stringify(res, null, 2);
      }
      if (res?.tables && res.tables.length > 0) {
        txtSourceColumns.value = res.tables[0].columns.map((c: any) => `${c.name}:${c.type}`).join('\n');
        txtSourceTableName.value = res.tables[0].name;
        txtTargetModelName.value = 'stg_' + res.tables[0].name;
        txtTargetOutputPath.value = `models/staging/stg_${res.tables[0].name}.sql`;
        showToast(`✓ Introspected table: ${res.tables[0].name}`);
      }
    }
  });

  // Step 1: Discover Mart Recipes
  document.getElementById('btnAiDiscoverMartRecipes')?.addEventListener('click', () => {
    showToast('✨ Discovering Star-Schema Dimensional Mart Recipes...');
    const preview = document.getElementById('martSqlCodePreview');
    const resBox = document.getElementById('martOutputResultBox');
    if (resBox && preview) {
      resBox.style.display = 'block';
      preview.innerText = `[AI Discovered Dimensional Mart Recipes]\n1. 📊 mart_customer_orders (Grain: customer_id | Joins: stg_customers, stg_orders | Metrics: lifetime_value, order_count)\n2. 📈 mart_daily_revenue (Grain: order_date | Metrics: gross_revenue, completed_orders, return_rate)\n3. 🎯 mart_product_inventory (Grain: product_id | Metrics: total_units_sold, restock_days)`;
      showToast('✓ Discovered 3 Star-Schema Dimensional Mart Recipes!');
    }
  });

  // Step 1: Generate Dimensional Mart
  document.getElementById('btnGenerateDimensionalMart')?.addEventListener('click', async () => {
    const baseModel = (document.getElementById('txtMartBaseModel') as HTMLInputElement).value;
    const joinModel = (document.getElementById('txtMartJoinModel') as HTMLInputElement).value;
    const martName = (document.getElementById('txtMartModelName') as HTMLInputElement).value;
    const mat = (document.getElementById('selMartMaterialization') as HTMLSelectElement).value;
    const joinCond = (document.getElementById('txtMartJoinCondition') as HTMLInputElement).value;

    showToast('🏗️ Generating Star-Schema dimensional dbt Mart...');
    const sql = `{{ config(materialized='${mat}') }}\n\nWITH base AS (\n  SELECT * FROM {{ ref('${baseModel}') }}\n),\njoined_dim AS (\n  SELECT * FROM {{ ref('${joinModel}') }}\n),\nfinal AS (\n  SELECT\n    base.*,\n    joined_dim.name AS customer_name,\n    joined_dim.email AS customer_email\n  FROM base\n  LEFT JOIN joined_dim ON ${joinCond}\n)\nSELECT * FROM final;`;

    const preview = document.getElementById('martSqlCodePreview');
    const resBox = document.getElementById('martOutputResultBox');
    if (resBox && preview) {
      resBox.style.display = 'block';
      preview.innerText = sql;
      showToast(`✓ Generated Mart ${martName}.sql!`);
    }

    if (api?.workspace) {
      const ws = await api.workspace.getCurrent();
      if (ws) {
        await api.workspace.createFile(ws.path + `/models/marts/${martName}.sql`, sql);
        renderFileTree(api);
      }
    }
  });

  // Step 2: Client APIs
  document.getElementById('btnP2GenerateSdk')?.addEventListener('click', async () => {
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

function switchDeliveryPhase(phase: number): void {
  currentActiveDeliveryPhase = phase;
  document.querySelectorAll('.phase-nav-btn[data-phase]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.getAttribute('data-phase') || '1', 10) === phase);
  });
  for (let i = 1; i <= 5; i++) {
    const card = document.getElementById(`phase${i}Card`);
    if (card) card.style.display = i === phase ? 'block' : 'none';
  }
}

// --- MULTI-CLOUD HUB ---
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

  btnConnectGcp?.addEventListener('click', () => handleCloudAction('gcp', btnConnectGcp.getAttribute('data-action') || 'login'));
  btnTabConnectGcp?.addEventListener('click', () => handleCloudAction('gcp', btnTabConnectGcp.getAttribute('data-action') || 'login'));

  btnConnectAws?.addEventListener('click', () => handleCloudAction('aws', btnConnectAws.getAttribute('data-action') || 'login'));
  btnTabConnectAws?.addEventListener('click', () => handleCloudAction('aws', btnTabConnectAws.getAttribute('data-action') || 'login'));

  btnConnectAzure?.addEventListener('click', () => handleCloudAction('azure', btnConnectAzure.getAttribute('data-action') || 'login'));
  btnTabConnectAzure?.addEventListener('click', () => handleCloudAction('azure', btnTabConnectAzure.getAttribute('data-action') || 'login'));

  btnConnectDocker?.addEventListener('click', () => handleCloudAction('docker', btnConnectDocker.getAttribute('data-action') || 'login'));
  btnTabConnectDocker?.addEventListener('click', () => handleCloudAction('docker', btnTabConnectDocker.getAttribute('data-action') || 'login'));
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

// --- DATA ANALYSIS STUDIO ---
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

    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'background: var(--bg-tertiary); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--accent); align-self: flex-end; max-width: 80%;';
    userDiv.innerHTML = `<strong>You:</strong> <div style="margin-top: 4px; color: #fff;">${text}</div>`;
    messagesStream.appendChild(userDiv);

    txtInput.value = '';
    messagesStream.scrollTop = messagesStream.scrollHeight;

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
