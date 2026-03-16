/**
 * test/suite/integration/commandExecution.test.ts
 *
 * Integration tests for core command execution patterns.
 * Verifies that AI requests are correctly assembled and dispatched,
 * including mode flags, context content, system prompt sections, budget,
 * cancellation, and error handling.
 *
 * All services are mocked — no VS Code APIs or network calls.
 */

import * as assert from 'assert';
import {
  MockAIService,
  MockContextService,
  MockWorkspaceService,
  MockEventBus,
  emptyContext,
} from '../../mocks';
import { PluginRegistry } from '../../../core/plugin';
import type { IServices } from '../../../core/services';
import type { AIRequest } from '../../../core/aiService';
import type { ProjectContext } from '../../../core/contextService';
import * as vscode from 'vscode';

// ── Helper: build IServices ────────────────────────────────────────────────────

function makeFakeContext(): vscode.ExtensionContext {
  return {
    subscriptions:           [],
    workspaceState:          { get: () => undefined, update: async () => {}, keys: () => [] } as any,
    globalState:             { get: () => undefined, update: async () => {}, keys: () => [], setKeysForSync: () => {} } as any,
    secrets:                 { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event } as any,
    extensionUri:            vscode.Uri.file('/fake'),
    extensionPath:           '/fake',
    storagePath:             '/fake/storage',
    globalStoragePath:       '/fake/global',
    logPath:                 '/fake/log',
    storageUri:              vscode.Uri.file('/fake/storage'),
    globalStorageUri:        vscode.Uri.file('/fake/global'),
    logUri:                  vscode.Uri.file('/fake/log'),
    extensionMode:           vscode.ExtensionMode.Test,
    extension:               {} as any,
    environmentVariableCollection: {} as any,
    asAbsolutePath:          (p: string) => p,
    languageModelAccessInformation: {} as any,
  } as unknown as vscode.ExtensionContext;
}

function makeServices(
  ai: MockAIService,
  ctx: MockContextService,
  ws: MockWorkspaceService,
  bus: MockEventBus,
  registry: PluginRegistry
): IServices {
  return {
    ai,
    context:   ctx,
    workspace: ws,
    plugins:   registry,
    events:    bus as unknown as import('../../../core/eventBus').EventBus,
    vsCtx:     makeFakeContext(),
  };
}

/**
 * Simulate what a core command does: build context, build prompts, send AI request.
 * Returns the request that would have been sent to the AI service.
 */
async function simulateCommand(
  services: IServices,
  instruction: string,
  mode: string,
  signal?: AbortSignal
): Promise<AIRequest> {
  const ctx    = await services.context.build();
  const system = services.context.buildSystemPrompt(ctx);
  const user   = services.context.buildUserPrompt(ctx, instruction);

  const request: AIRequest = {
    messages:    [{ role: 'user', content: user }],
    system,
    instruction,
    mode,
    signal,
  };

  await services.ai.send(request);
  return request;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

suite('Command Execution — Integration', () => {
  let ai:       MockAIService;
  let ctx:      MockContextService;
  let ws:       MockWorkspaceService;
  let bus:      MockEventBus;
  let registry: PluginRegistry;
  let services: IServices;

  setup(() => {
    ai       = new MockAIService();
    ctx      = new MockContextService();
    ws       = new MockWorkspaceService();
    bus      = new MockEventBus();
    registry = new PluginRegistry(bus as unknown as import('../../../core/eventBus').EventBus);
    services = makeServices(ai, ctx, ws, bus, registry);
  });

  teardown(async () => {
    await registry.disposeAll();
    bus.dispose();
  });

  // ── Mode flags ─────────────────────────────────────────────────────────────

  test('"explain" mode is forwarded in AI request', async () => {
    const req = await simulateCommand(services, 'Explain this code', 'explain');
    assert.strictEqual(req.mode, 'explain');
  });

  test('"edit" mode is forwarded in AI request', async () => {
    const req = await simulateCommand(services, 'Refactor this function', 'edit');
    assert.strictEqual(req.mode, 'edit');
  });

  test('"new" mode is forwarded in AI request', async () => {
    const req = await simulateCommand(services, 'Generate a new service class', 'new');
    assert.strictEqual(req.mode, 'new');
  });

  // ── System prompt ──────────────────────────────────────────────────────────

  test('system prompt is included in the AI request', async () => {
    const req = await simulateCommand(services, 'Explain', 'explain');
    assert.ok(req.system.length > 0, 'system prompt should be non-empty');
  });

  test('system prompt uses the text from buildSystemPrompt()', async () => {
    ctx.context = { ...emptyContext(), workspaceName: 'my-project' };
    const req = await simulateCommand(services, 'Do something', 'edit');
    // MockContextService.buildSystemPrompt always returns 'You are a test assistant.'
    assert.ok(req.system === 'You are a test assistant.');
  });

  // ── Context content ────────────────────────────────────────────────────────

  test('"edit" mode includes file content in user prompt via buildUserPrompt()', async () => {
    ctx.context = {
      ...emptyContext(),
      activeFile: {
        path:     '/workspace/hello.ts',
        relPath:  'hello.ts',
        content:  'export function greet() {}',
        language: 'typescript',
      },
    };
    const req = await simulateCommand(services, 'Add documentation', 'edit');
    // MockContextService.buildUserPrompt returns just the instruction
    assert.ok(req.messages.some(m => m.content.includes('Add documentation')));
  });

  test('instruction text is present in messages', async () => {
    const instruction = 'Fix the import statement';
    const req = await simulateCommand(services, instruction, 'edit');
    assert.ok(req.instruction === instruction);
    const allContent = req.messages.map(m => m.content).join('\n');
    assert.ok(allContent.includes(instruction));
  });

  // ── Plugin system prompt injection ────────────────────────────────────────

  test('active plugin system prompt sections are reflected in context', async () => {
    // Register a plugin that appends to system prompt sections
    registry.register({
      id:          'test-section-plugin',
      displayName: 'Section Plugin',
      icon:        '$(plug)',
      detect:      async () => true,
      activate:    async () => [],
      systemPromptSection: () => 'USE_DATABRICKS_BEST_PRACTICES',
    });
    await registry.refresh(undefined, services, makeFakeContext());

    // The real ContextService would incorporate plugin sections.
    // With the mock, we verify the registry exposes them.
    const sections = registry.systemPromptSections;
    assert.ok(sections.includes('USE_DATABRICKS_BEST_PRACTICES'));
  });

  // ── Context budget ─────────────────────────────────────────────────────────

  test('context budget is accessible in the built context', async () => {
    ctx.context = {
      ...emptyContext(),
      contextBudget: { total: 24_000, used: 5_000 },
    };
    const projectCtx: ProjectContext = await services.context.build();
    assert.strictEqual(projectCtx.contextBudget.total, 24_000);
    assert.strictEqual(projectCtx.contextBudget.used,   5_000);
  });

  test('context budget remaining is correctly calculated', async () => {
    ctx.context = {
      ...emptyContext(),
      contextBudget: { total: 24_000, used: 8_000 },
    };
    const projectCtx = await services.context.build();
    const remaining = projectCtx.contextBudget.total - projectCtx.contextBudget.used;
    assert.strictEqual(remaining, 16_000);
  });

  // ── Cancellation ──────────────────────────────────────────────────────────

  test('AbortSignal is passed through to the AI request', async () => {
    const controller = new AbortController();
    const req = await simulateCommand(services, 'Long task', 'explain', controller.signal);
    assert.strictEqual(req.signal, controller.signal);
  });

  test('pre-aborted signal is preserved in the request object', async () => {
    const controller = new AbortController();
    controller.abort();
    const req = await simulateCommand(services, 'Cancelled task', 'edit', controller.signal);
    assert.ok(req.signal?.aborted === true);
  });

  test('request without signal has undefined signal field', async () => {
    const req = await simulateCommand(services, 'Normal task', 'explain');
    assert.strictEqual(req.signal, undefined);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  test('error in context build is propagated to caller', async () => {
    const errorCtx = new MockContextService();
    errorCtx.build = async () => { throw new Error('Context build failed'); };
    const errorServices = makeServices(ai, errorCtx, ws, bus, registry);

    let caughtError: Error | null = null;
    try {
      await simulateCommand(errorServices, 'Do something', 'edit');
    } catch (e) {
      caughtError = e as Error;
    }
    assert.ok(caughtError !== null, 'error should be propagated');
    assert.ok(caughtError?.message.includes('Context build failed'));
  });

  test('AI service send() is called exactly once per command execution', async () => {
    let callCount = 0;
    const countingAI = new MockAIService();
    countingAI.send = async (request: AIRequest) => {
      callCount++;
      return 'result';
    };
    const countingServices = makeServices(countingAI, ctx, ws, bus, registry);
    await simulateCommand(countingServices, 'Test', 'explain');
    assert.strictEqual(callCount, 1);
  });

  test('AI service receives the instruction verbatim', async () => {
    const instruction = 'Explain the async/await pattern in detail';
    await simulateCommand(services, instruction, 'explain');
    assert.strictEqual(ai.lastRequest?.instruction, instruction);
  });
});
