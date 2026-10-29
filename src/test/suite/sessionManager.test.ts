/**
 * test/suite/sessionManager.test.ts — Unit tests for SessionManager
 */

import * as assert from 'assert';
import { SessionManager } from '../../core/session/sessionManager';

class MockMemento {
  private data = new Map<string, any>();

  get<T>(key: string, defaultValue?: T): T {
    return this.data.has(key) ? this.data.get(key) : (defaultValue as T);
  }

  async update(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  keys(): readonly string[] {
    return Array.from(this.data.keys());
  }
}

suite('SessionManager', () => {
  let memento: MockMemento;
  let mgr: SessionManager;

  setup(() => {
    memento = new MockMemento();
    mgr = new SessionManager(memento as any);
  });

  test('creates new session with default values', () => {
    const session = mgr.createSession();
    assert.ok(session.id.startsWith('sess_'));
    assert.strictEqual(session.title, 'New Coding Session');
    assert.strictEqual(session.messages.length, 0);
    assert.strictEqual(mgr.getActiveSession().id, session.id);
  });

  test('adds message and auto-generates title from first prompt', async () => {
    const sess = mgr.getActiveSession();
    await mgr.addMessageToActiveSession({
      role: 'user',
      content: 'Implement PERS Option 51 person enquiry service',
    });

    const updated = mgr.getActiveSession();
    assert.strictEqual(updated.messages.length, 1);
    assert.strictEqual(updated.title, 'PERS Option 51 Person Enquiry Service');
  });

  test('renames and pins session', async () => {
    const s = mgr.createSession({ title: 'Original Title' });
    await mgr.renameSession(s.id, 'Renamed Title');
    assert.strictEqual(mgr.getActiveSession().title, 'Renamed Title');

    const pinned = await mgr.togglePinSession(s.id);
    assert.strictEqual(pinned, true);
    assert.strictEqual(mgr.getActiveSession().isPinned, true);
  });

  test('deletes session and falls back to remaining', async () => {
    const s1 = mgr.createSession({ title: 'Session 1' });
    const s2 = mgr.createSession({ title: 'Session 2' });
    assert.strictEqual(mgr.getActiveSession().id, s2.id);

    const deleted = await mgr.deleteSession(s2.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(mgr.getActiveSession().id, s1.id);
  });

  test('groups sessions into timeline buckets', async () => {
    const now = Date.now();
    mgr.createSession({ title: 'Today Task', updatedAt: now });
    mgr.createSession({ title: 'Pinned Task', isPinned: true, updatedAt: now - 100_000 });
    mgr.createSession({ title: 'Yesterday Task', updatedAt: now - 90_000_000 });
    mgr.createSession({ title: 'Old Task', updatedAt: now - 800_000_000 });

    const groups = mgr.getTimelineGroups();
    const buckets = groups.map(g => g.bucket);
    assert.ok(buckets.includes('Pinned'));
    assert.ok(buckets.includes('Today'));
  });

  test('searches sessions by keyword', async () => {
    mgr.createSession({ title: 'Java Spring Controller' });
    mgr.createSession({ title: 'Vue Vuetify Menu' });

    const results = mgr.searchSessions('spring');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Java Spring Controller');
  });

  test('exports session to markdown, PR memo, and ADR', async () => {
    const s = mgr.createSession({ title: 'Enquiry Feature' });
    await mgr.recordFileTouched('backend/web/EnquiryController.java');
    await mgr.addMessageToActiveSession({ role: 'user', content: 'Add endpoint' });
    await mgr.addMessageToActiveSession({ role: 'assistant', content: 'Added endpoint successfully' });

    const md = mgr.exportSession(s.id, 'markdown');
    assert.ok(md.includes('Enquiry Feature'));
    assert.ok(md.includes('backend/web/EnquiryController.java'));

    const memo = mgr.exportSession(s.id, 'pr_memo');
    assert.ok(memo.includes('Release & Delivery Memo'));

    const adr = mgr.exportSession(s.id, 'adr');
    assert.ok(adr.includes('ADR: Enquiry Feature'));
  });
});
