/**
 * test/suite/security.test.ts — Unit tests for the Security Scanner plugin
 */

import * as assert from 'assert';
import { SecurityPlugin, scanContent, type SecurityFinding } from '../../plugins/security';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasCategory(findings: SecurityFinding[], category: string): boolean {
  return findings.some(f => f.category === category);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('SecurityPlugin', () => {
  let plugin: SecurityPlugin;

  setup(() => {
    plugin = new SecurityPlugin();
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is security', () => {
      assert.strictEqual(plugin.id, 'security');
    });

    test('displayName is Security Scanner', () => {
      assert.strictEqual(plugin.displayName, 'Security Scanner');
    });

    test('icon is $(shield)', () => {
      assert.strictEqual(plugin.icon, '$(shield)');
    });
  });

  // ── detect() ─────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns true when workspace is undefined (always-on)', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, true);
    });

    test('returns true with a workspace folder (always-on)', async () => {
      const ws = { uri: { fsPath: '/tmp' }, name: 'test', index: 0 } as any;
      const result = await plugin.detect(ws);
      assert.strictEqual(result, true);
    });
  });

  // ── systemPromptSection() ────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains OWASP reference', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('OWASP'), 'Expected "OWASP" in system prompt');
    });

    test('contains SQL injection guidance', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('sql') || prompt.includes('parameterized'),
        'Expected SQL injection guidance in system prompt'
      );
    });

    test('contains XSS guidance', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('XSS') || prompt.includes('innerHTML'),
        'Expected XSS guidance in system prompt'
      );
    });

    test('contains secrets / environment variable guidance', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('environment variable') || prompt.includes('os.environ'),
        'Expected secrets management guidance in system prompt'
      );
    });

    test('contains crypto guidance', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('bcrypt') || prompt.includes('SHA-256') || prompt.includes('AES'),
        'Expected cryptography guidance in system prompt'
      );
    });

    test('contains input validation guidance', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('input validation') || prompt.includes('Pydantic'),
        'Expected input validation guidance in system prompt'
      );
    });
  });

  // ── contextHooks ─────────────────────────────────────────────────────────

  suite('contextHooks', () => {
    test('has exactly 1 context hook', () => {
      assert.strictEqual(plugin.contextHooks!.length, 1);
    });

    test('hook key is security.findings', () => {
      assert.strictEqual(plugin.contextHooks![0].key, 'security.findings');
    });

    test('format() returns clean message when no findings', () => {
      const result = plugin.contextHooks![0].format({ findingCount: 0, categories: [], highCount: 0, mediumCount: 0, lowCount: 0 });
      assert.ok(result.includes('No security'), 'Expected "No security" in clean output');
    });

    test('format() reports finding count when issues exist', () => {
      const result = plugin.contextHooks![0].format({
        findingCount: 3,
        categories:   [{ cat: 'secret', count: 2 }, { cat: 'xss', count: 1 }],
        highCount:    2,
        mediumCount:  1,
        lowCount:     0,
      });
      assert.ok(result.includes('3'), 'Expected finding count in output');
    });
  });

  // ── codeActions ───────────────────────────────────────────────────────────

  suite('codeActions', () => {
    test('has exactly 6 code actions', () => {
      assert.strictEqual(plugin.codeActions!.length, 6);
    });

    test('all code actions are quickfix kind', () => {
      for (const ca of plugin.codeActions!) {
        assert.strictEqual(ca.kind, 'quickfix', `Expected quickfix kind for: ${ca.title}`);
      }
    });

    test('all code actions reference aiForge.security.fixFinding command', () => {
      for (const ca of plugin.codeActions!) {
        assert.strictEqual(ca.command, 'aiForge.security.fixFinding');
      }
    });

    test('all code actions have non-empty titles', () => {
      for (const ca of plugin.codeActions!) {
        assert.ok(ca.title.length > 0, 'Expected non-empty title');
      }
    });
  });

  // ── transforms ────────────────────────────────────────────────────────────

  suite('transforms', () => {
    test('has exactly 2 transforms', () => {
      assert.strictEqual(plugin.transforms!.length, 2);
    });

    test('first transform is secret scan', () => {
      assert.ok(
        plugin.transforms![0].label.toLowerCase().includes('secret'),
        'Expected first transform to be about secrets'
      );
    });

    test('second transform is input validation', () => {
      assert.ok(
        plugin.transforms![1].label.toLowerCase().includes('validation') ||
        plugin.transforms![1].label.toLowerCase().includes('input'),
        'Expected second transform to be about input validation'
      );
    });
  });

  // ── commands ─────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 3 commands', () => {
      assert.strictEqual(plugin.commands!.length, 3);
    });

    test('command IDs are correct', () => {
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.security.scanFile'),      'Missing scanFile command');
      assert.ok(ids.includes('aiForge.security.scanWorkspace'), 'Missing scanWorkspace command');
      assert.ok(ids.includes('aiForge.security.fixFinding'),    'Missing fixFinding command');
    });

    test('all commands have handler functions', () => {
      for (const cmd of plugin.commands!) {
        assert.strictEqual(typeof cmd.handler, 'function', `Command ${cmd.id} missing handler`);
      }
    });

    test('all command IDs start with aiForge.security.', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(
          cmd.id.startsWith('aiForge.security.'),
          `Expected aiForge.security. prefix: ${cmd.id}`
        );
      }
    });
  });

  // ── statusItem ────────────────────────────────────────────────────────────

  suite('statusItem', () => {
    test('has a statusItem', () => {
      assert.ok(plugin.statusItem, 'Expected statusItem to be defined');
    });

    test('statusItem.text is a function', () => {
      assert.strictEqual(typeof plugin.statusItem!.text, 'function');
    });
  });

  // ── scanContent() — True Positives ────────────────────────────────────────

  suite('scanContent() — true positives (should detect)', () => {
    test('detects hardcoded password', () => {
      const findings = scanContent('password = "mysecret123"');
      assert.ok(hasCategory(findings, 'secret'), 'Expected secret finding for hardcoded password');
    });

    test('detects hardcoded api_key', () => {
      const findings = scanContent('api_key = "sk-1234567890abcdef"');
      assert.ok(hasCategory(findings, 'secret'), 'Expected secret finding for hardcoded api_key');
    });

    test('detects hardcoded AWS_SECRET_ACCESS_KEY', () => {
      const findings = scanContent('AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG"');
      assert.ok(hasCategory(findings, 'secret'), 'Expected secret finding for AWS credential');
    });

    test('detects SQL injection via string concatenation', () => {
      const findings = scanContent('"SELECT * FROM users WHERE id = " + userId');
      assert.ok(hasCategory(findings, 'sql-injection'), 'Expected sql-injection finding');
    });

    test('detects SQL injection via f-string', () => {
      const findings = scanContent('f"SELECT * FROM users WHERE id = {user_id}"');
      assert.ok(hasCategory(findings, 'sql-injection'), 'Expected sql-injection finding for f-string');
    });

    test('detects innerHTML XSS', () => {
      const findings = scanContent('element.innerHTML = userInput');
      assert.ok(hasCategory(findings, 'xss'), 'Expected xss finding for innerHTML');
    });

    test('detects pickle.loads deserialization', () => {
      const findings = scanContent('pickle.loads(data)');
      assert.ok(hasCategory(findings, 'deserialization'), 'Expected deserialization finding for pickle.loads');
    });

    test('detects yaml.load without SafeLoader', () => {
      const findings = scanContent('config = yaml.load(data)');
      assert.ok(hasCategory(findings, 'deserialization'), 'Expected deserialization finding for yaml.load');
    });

    test('detects eval() call', () => {
      const findings = scanContent('result = eval(userInput)');
      assert.ok(hasCategory(findings, 'deserialization'), 'Expected deserialization finding for eval');
    });

    test('detects hashlib.md5 weak crypto', () => {
      const findings = scanContent('hashlib.md5(password)');
      assert.ok(hasCategory(findings, 'weak-crypto'), 'Expected weak-crypto finding for md5');
    });
  });

  // ── scanContent() — True Negatives ───────────────────────────────────────

  suite('scanContent() — true negatives (should NOT detect as issues)', () => {
    test('does not flag env-var password read', () => {
      const findings = scanContent('password = os.environ["DB_PASSWORD"]');
      assert.strictEqual(
        findings.filter(f => f.category === 'secret').length,
        0,
        'Should not flag env-var password read'
      );
    });

    test('does not flag bcrypt password hashing', () => {
      const findings = scanContent('password_hash = bcrypt.hash(password)');
      assert.strictEqual(
        findings.filter(f => f.category === 'secret').length,
        0,
        'Should not flag bcrypt hash'
      );
    });

    test('does not flag parameterized SQL query', () => {
      const findings = scanContent('cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))');
      assert.strictEqual(
        findings.filter(f => f.category === 'sql-injection').length,
        0,
        'Should not flag parameterized SQL'
      );
    });

    test('does not flag textContent assignment', () => {
      const findings = scanContent('element.textContent = userInput');
      assert.strictEqual(
        findings.filter(f => f.category === 'xss').length,
        0,
        'Should not flag textContent'
      );
    });

    test('does not flag yaml.safe_load', () => {
      const findings = scanContent('config = yaml.safe_load(data)');
      assert.strictEqual(
        findings.filter(f => f.category === 'deserialization').length,
        0,
        'Should not flag yaml.safe_load'
      );
    });

    test('does not flag hashlib.sha256', () => {
      const findings = scanContent('digest = hashlib.sha256(data)');
      assert.strictEqual(
        findings.filter(f => f.category === 'weak-crypto').length,
        0,
        'Should not flag sha256'
      );
    });

    test('does not flag comments containing "password"', () => {
      const findings = scanContent('# password must be at least 8 characters');
      assert.strictEqual(
        findings.filter(f => f.category === 'secret').length,
        0,
        'Should not flag comment-only lines'
      );
    });

    test('does not flag // comment containing "password"', () => {
      const findings = scanContent('// password is stored in the vault, not here');
      assert.strictEqual(
        findings.filter(f => f.category === 'secret').length,
        0,
        'Should not flag JS comment-only lines'
      );
    });
  });

  // ── scanContent() — Severity ──────────────────────────────────────────────

  suite('scanContent() — severity', () => {
    test('hardcoded password is high severity', () => {
      const findings = scanContent('password = "supersecret99"');
      const secretFindings = findings.filter(f => f.category === 'secret');
      assert.ok(secretFindings.length > 0, 'Expected secret finding');
      assert.strictEqual(secretFindings[0].severity, 'high');
    });

    test('innerHTML is high severity', () => {
      const findings = scanContent('element.innerHTML = userInput');
      const xssFindings = findings.filter(f => f.category === 'xss');
      assert.ok(xssFindings.length > 0, 'Expected xss finding');
      assert.strictEqual(xssFindings[0].severity, 'high');
    });

    test('dangerouslySetInnerHTML is medium severity', () => {
      const findings = scanContent('return <div dangerouslySetInnerHTML={val} />');
      const xssFindings = findings.filter(f => f.category === 'xss');
      assert.ok(xssFindings.length > 0, 'Expected xss finding');
      assert.strictEqual(xssFindings[0].severity, 'medium');
    });
  });

  // ── scanContent() — Finding fields ───────────────────────────────────────

  suite('scanContent() — finding fields', () => {
    test('findings include line number', () => {
      const src = 'import os\npassword = "hunter2"\n';
      const findings = scanContent(src);
      assert.ok(findings.length > 0, 'Expected a finding');
      assert.strictEqual(findings[0].line, 1, 'Expected finding on line 1 (0-indexed)');
    });

    test('findings include column', () => {
      const findings = scanContent('password = "hunter2"');
      assert.ok(findings.length > 0);
      assert.ok(typeof findings[0].column === 'number');
    });

    test('findings include message', () => {
      const findings = scanContent('password = "hunter2"');
      assert.ok(findings.length > 0);
      assert.ok(findings[0].message.length > 0, 'Expected non-empty message');
    });

    test('findings include pattern string', () => {
      const findings = scanContent('password = "hunter2"');
      assert.ok(findings.length > 0);
      assert.ok(typeof findings[0].pattern === 'string');
    });
  });
});
