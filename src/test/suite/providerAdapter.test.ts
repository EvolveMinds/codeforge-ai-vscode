/**
 * test/suite/providerAdapter.test.ts — Unit tests for ProviderAdapter & Slash Commands
 */

import * as assert from 'assert';
import { ProviderAdapter } from '../../core/providers/providerAdapter';
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

suite('ProviderAdapter & Slash Commands', () => {
  let mgr: SessionManager;

  setup(() => {
    mgr = new SessionManager(new MockMemento() as any);
  });

  test('returns Anthropic-specific commands when active provider is anthropic', () => {
    const commands = ProviderAdapter.getCommandsForProvider('anthropic');
    const names = commands.map(c => c.name);
    assert.ok(names.includes('compact'));
    assert.ok(names.includes('review'));
    assert.ok(names.includes('cost'));
    assert.ok(names.includes('think'));
    assert.ok(names.includes('bug'));
    assert.ok(names.includes('export'));
    assert.ok(!names.includes('ground'));
  });

  test('returns Gemini-specific commands when active provider is gemini', () => {
    const commands = ProviderAdapter.getCommandsForProvider('gemini');
    const names = commands.map(c => c.name);
    assert.ok(names.includes('ground'));
    assert.ok(names.includes('digest'));
    assert.ok(names.includes('sandbox'));
    assert.ok(names.includes('search'));
    assert.ok(!names.includes('compact'));
  });

  test('returns Ollama-specific commands when active provider is ollama', () => {
    const commands = ProviderAdapter.getCommandsForProvider('ollama');
    const names = commands.map(c => c.name);
    assert.ok(names.includes('advisor'));
    assert.ok(names.includes('pull'));
    assert.ok(names.includes('airgap'));
  });

  test('returns provider profile with brand metadata and shortcuts', () => {
    const profile = ProviderAdapter.getProfile('anthropic');
    assert.strictEqual(profile.label, 'Anthropic Claude');
    assert.strictEqual(profile.features.hasExtendedThinking, true);
    assert.ok(profile.shortcuts.some(s => s.command === '/compact'));

    const geminiProfile = ProviderAdapter.getProfile('gemini');
    assert.strictEqual(geminiProfile.label, 'Google Gemini');
    assert.strictEqual(geminiProfile.features.hasGrounding, true);
  });

  test('executes /export slash command', async () => {
    const posted: any[] = [];
    const res = await ProviderAdapter.executeSlashCommand('/export json', {
      sessionManager: mgr,
      activeProvider: 'anthropic',
      activeModel: 'claude-3-7-sonnet',
      postMessage: (m) => posted.push(m),
      sendToAi: async () => {},
    });

    assert.ok(res);
    assert.strictEqual(res?.handled, true);
    assert.ok(res?.notification?.includes('Exported'));
  });

  test('executes /think slash command to adjust reasoning budget', async () => {
    const posted: any[] = [];
    const res = await ProviderAdapter.executeSlashCommand('/think 16000', {
      sessionManager: mgr,
      activeProvider: 'anthropic',
      activeModel: 'claude-3-7-sonnet',
      postMessage: (m) => posted.push(m),
      sendToAi: async () => {},
    });

    assert.ok(res);
    assert.strictEqual(res?.handled, true);
    assert.ok(posted.some(p => p.type === 'extendedThinkingChanged' && p.budget === 16000));
  });

  test('executes /ground slash command to toggle search grounding', async () => {
    const posted: any[] = [];
    const res = await ProviderAdapter.executeSlashCommand('/ground on', {
      sessionManager: mgr,
      activeProvider: 'gemini',
      activeModel: 'gemini-2.5-pro',
      postMessage: (m) => posted.push(m),
      sendToAi: async () => {},
    });

    assert.ok(res);
    assert.strictEqual(res?.handled, true);
    assert.ok(posted.some(p => p.type === 'groundingToggled' && p.enabled === true));
  });
});
