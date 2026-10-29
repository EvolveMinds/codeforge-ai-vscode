/**
 * test/suite/agentRunner.test.ts — Unit tests for AgentTools, BuildVerifier, and AgentRunner
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AgentTools } from '../../core/agent/agentTools';
import { BuildVerifier } from '../../core/agent/buildVerifier';
import { AgentRunner } from '../../core/agent/agentRunner';
import { SessionManager } from '../../core/session/sessionManager';

class MockMemento {
  private data = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T {
    return this.data.has(key) ? this.data.get(key) : (defaultValue as T);
  }
  async update(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }
}

suite('Agent Tools & Build Verifier Suite', () => {
  const tmpDir = path.join(__dirname, '..', '..', '..', '.tmp_test_agent');
  let tools: AgentTools;

  setup(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    tools = new AgentTools(tmpDir);
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('writes, reads, and edits files cleanly', async () => {
    const filePath = 'backend/test/Sample.java';
    const writeRes = await tools.writeFile(filePath, 'public class Sample {\n  int val = 1;\n}');
    assert.strictEqual(writeRes.success, true);

    const readRes = await tools.readFile(filePath);
    assert.strictEqual(readRes.success, true);
    assert.ok(readRes.output.includes('class Sample'));

    const editRes = await tools.editFile(filePath, 'int val = 1;', 'int val = 42;');
    assert.strictEqual(editRes.success, true);

    const verifyRead = await tools.readFile(filePath);
    assert.ok(verifyRead.output.includes('val = 42;'));
  });

  test('parses compiler diagnostics from Java and Vue errors', () => {
    const verifier = new BuildVerifier(tmpDir, tools);
    const mockOutput = `
[ERROR] src/main/java/au/gov/nsw/education/eshr/PersonService.java:[42,15] error: cannot find symbol
src/views/PersonView.vue:55:12 - error TS2304: Cannot find name 'LegacyData'.
    `;

    const diags = verifier.parseDiagnostics(mockOutput);
    assert.strictEqual(diags.length, 2);

    const javaDiag = diags.find(d => d.sourceType === 'java');
    assert.ok(javaDiag);
    assert.strictEqual(javaDiag?.line, 42);
    assert.ok(javaDiag?.message.includes('cannot find symbol'));

    const vueDiag = diags.find(d => d.sourceType === 'vue');
    assert.ok(vueDiag);
    assert.strictEqual(vueDiag?.line, 55);
  });

  test('AgentRunner parses multi-file outputs', () => {
    const runner = new AgentRunner({
      workspaceRoot: tmpDir,
      aiService: {} as any,
      sessionManager: new SessionManager(new MockMemento() as any),
    });

    const aiOutput = `
I have implemented the service and view:

## backend/PersonService.java
\`\`\`java
public class PersonService {}
\`\`\`

## frontend/PersonView.vue
\`\`\`vue
<template><div>Person View</div></template>
\`\`\`
    `;

    const parsed = runner.parseFilesFromOutput(aiOutput);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].path, 'backend/PersonService.java');
    assert.ok(parsed[0].content.includes('PersonService'));
    assert.strictEqual(parsed[1].path, 'frontend/PersonView.vue');
  });
});
