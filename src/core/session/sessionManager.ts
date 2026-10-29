/**
 * core/session/sessionManager.ts — Multi-Session History & Persistence Engine
 *
 * Implements persistent multi-session chat management, timeline grouping,
 * keyword searching, automated title generation, and export utilities.
 */

import * as vscode from 'vscode';
import type { ProviderName } from '../aiService';
import type {
  SessionRecord,
  SessionMessage,
  SessionTimelineGroup,
  TimelineBucket,
  SessionExportFormat,
} from './sessionTypes';

const SESSIONS_STORE_KEY = 'aiForge.sessions.v1';
const ACTIVE_SESSION_ID_KEY = 'aiForge.activeSessionId';
const LEGACY_HISTORY_KEY = 'aiForge.chatHistory';
const MAX_SAVED_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 60;

export class SessionManager {
  private _sessions: Map<string, SessionRecord> = new Map();
  private _activeSessionId: string | null = null;

  constructor(private readonly _storage: vscode.Memento) {
    this._load();
  }

  private _load(): void {
    const raw = this._storage.get<SessionRecord[]>(SESSIONS_STORE_KEY, []);
    this._sessions.clear();
    for (const s of raw) {
      if (s && s.id) {
        this._sessions.set(s.id, s);
      }
    }

    const savedActiveId = this._storage.get<string>(ACTIVE_SESSION_ID_KEY, '');
    if (savedActiveId && this._sessions.has(savedActiveId)) {
      this._activeSessionId = savedActiveId;
    } else if (this._sessions.size > 0) {
      // Pick the most recently updated session
      const sorted = this.getAllSessions();
      this._activeSessionId = sorted[0].id;
    } else {
      // Attempt legacy migration if present
      this._migrateLegacyHistory();
    }
  }

  private _migrateLegacyHistory(): void {
    const legacy = this._storage.get<Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>>(
      LEGACY_HISTORY_KEY,
      []
    );
    if (legacy && legacy.length > 0) {
      const firstUserMsg = legacy.find(m => m.role === 'user')?.content || 'Previous Workspace Session';
      const migrated = this.createSession({
        title: this.autoGenerateTitle(firstUserMsg),
        messages: legacy.map(m => ({
          role: m.role,
          content: m.content,
          images: m.images,
          timestamp: Date.now(),
        })),
      });
      this._activeSessionId = migrated.id;
    }
  }

  private async _save(): Promise<void> {
    const arr = Array.from(this._sessions.values());
    // Enforce max storage cap: keep pinned ones + most recently updated
    if (arr.length > MAX_SAVED_SESSIONS) {
      const pinned = arr.filter(s => s.isPinned);
      const unpinned = arr.filter(s => !s.isPinned).sort((a, b) => b.updatedAt - a.updatedAt);
      const allowedUnpinned = MAX_SAVED_SESSIONS - pinned.length;
      const retained = [...pinned, ...unpinned.slice(0, Math.max(0, allowedUnpinned))];
      this._sessions.clear();
      for (const s of retained) this._sessions.set(s.id, s);
    }

    await this._storage.update(SESSIONS_STORE_KEY, Array.from(this._sessions.values()));
    if (this._activeSessionId) {
      await this._storage.update(ACTIVE_SESSION_ID_KEY, this._activeSessionId);
    }
  }

  public getAllSessions(): SessionRecord[] {
    return Array.from(this._sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getActiveSession(): SessionRecord {
    if (!this._activeSessionId || !this._sessions.has(this._activeSessionId)) {
      return this.createSession();
    }
    return this._sessions.get(this._activeSessionId)!;
  }

  public async setActiveSession(id: string): Promise<SessionRecord | undefined> {
    if (this._sessions.has(id)) {
      this._activeSessionId = id;
      await this._storage.update(ACTIVE_SESSION_ID_KEY, id);
      return this._sessions.get(id);
    }
    return undefined;
  }

  public createSession(opts?: Partial<SessionRecord>): SessionRecord {
    const now = Date.now();
    const id = `sess_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const session: SessionRecord = {
      id,
      title: opts?.title || 'New Coding Session',
      createdAt: opts?.createdAt || now,
      updatedAt: opts?.updatedAt || now,
      provider: opts?.provider || 'anthropic',
      model: opts?.model || 'claude-3-7-sonnet',
      messages: opts?.messages || [],
      filesTouched: opts?.filesTouched || [],
      gitBranch: opts?.gitBranch || 'main',
      isPinned: opts?.isPinned || false,
      tags: opts?.tags || [],
      stats: opts?.stats || { toolCallCount: 0, lastBuildStatus: 'untested' },
    };

    this._sessions.set(id, session);
    this._activeSessionId = id;
    void this._save();
    return session;
  }

  public async updateActiveSession(patch: Partial<SessionRecord>): Promise<SessionRecord> {
    const current = this.getActiveSession();
    const updated: SessionRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this._sessions.set(updated.id, updated);
    await this._save();
    return updated;
  }

  public async addMessageToActiveSession(msg: SessionMessage): Promise<SessionRecord> {
    const current = this.getActiveSession();
    const updatedMessages = [...current.messages, { ...msg, timestamp: msg.timestamp || Date.now() }];
    
    // Auto-generate title from first user message if still default
    let title = current.title;
    if (current.title === 'New Coding Session' && msg.role === 'user' && msg.content) {
      title = this.autoGenerateTitle(msg.content);
    }

    // Trim session messages if exceeding limit
    const trimmed = updatedMessages.slice(-MAX_MESSAGES_PER_SESSION);

    return this.updateActiveSession({
      title,
      messages: trimmed,
      updatedAt: Date.now(),
    });
  }

  public async recordFileTouched(filePath: string): Promise<void> {
    const current = this.getActiveSession();
    const set = new Set(current.filesTouched);
    set.add(filePath);
    await this.updateActiveSession({ filesTouched: Array.from(set) });
  }

  public async deleteSession(id: string): Promise<boolean> {
    if (!this._sessions.has(id)) return false;
    this._sessions.delete(id);
    if (this._activeSessionId === id) {
      const remaining = this.getAllSessions();
      this._activeSessionId = remaining.length > 0 ? remaining[0].id : null;
    }
    await this._save();
    return true;
  }

  public async renameSession(id: string, newTitle: string): Promise<boolean> {
    const session = this._sessions.get(id);
    if (!session) return false;
    session.title = newTitle.trim() || 'Untitled Session';
    session.updatedAt = Date.now();
    await this._save();
    return true;
  }

  public async togglePinSession(id: string): Promise<boolean> {
    const session = this._sessions.get(id);
    if (!session) return false;
    session.isPinned = !session.isPinned;
    session.updatedAt = Date.now();
    await this._save();
    return session.isPinned;
  }

  public autoGenerateTitle(prompt: string): string {
    if (!prompt) return 'New Coding Session';
    const cleaned = prompt
      .replace(/^(please|can you|could you|help me|i want to|i need to|implement|build|create|generate)\s+/i, '')
      .replace(/[^\w\s\-\.\/]/g, ' ')
      .trim();
    const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 7);
    if (words.length === 0) return 'New Coding Session';
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  public searchSessions(query: string): SessionRecord[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.getAllSessions();
    return this.getAllSessions().filter(s => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.model.toLowerCase().includes(q)) return true;
      if (s.provider.toLowerCase().includes(q)) return true;
      if (s.filesTouched.some(f => f.toLowerCase().includes(q))) return true;
      if (s.messages.some(m => m.content && m.content.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  public getTimelineGroups(query?: string): SessionTimelineGroup[] {
    const sessions = query ? this.searchSessions(query) : this.getAllSessions();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86_400_000;
    const startOf7Days = startOfToday - 7 * 86_400_000;

    const buckets: Record<TimelineBucket, SessionRecord[]> = {
      'Pinned': [],
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Older': [],
    };

    for (const s of sessions) {
      if (s.isPinned) {
        buckets['Pinned'].push(s);
      } else if (s.updatedAt >= startOfToday) {
        buckets['Today'].push(s);
      } else if (s.updatedAt >= startOfYesterday) {
        buckets['Yesterday'].push(s);
      } else if (s.updatedAt >= startOf7Days) {
        buckets['Previous 7 Days'].push(s);
      } else {
        buckets['Older'].push(s);
      }
    }

    const order: TimelineBucket[] = ['Pinned', 'Today', 'Yesterday', 'Previous 7 Days', 'Older'];
    return order
      .filter(b => buckets[b].length > 0)
      .map(bucket => ({ bucket, sessions: buckets[bucket] }));
  }

  public exportSession(id: string, format: SessionExportFormat): string {
    const session = this._sessions.get(id);
    if (!session) return '';

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    }

    const dateStr = new Date(session.createdAt).toISOString().slice(0, 10);
    const filesList = session.filesTouched.length > 0
      ? session.filesTouched.map(f => `- \`${f}\``).join('\n')
      : '_None recorded_';

    if (format === 'pr_memo') {
      return `## Release & Delivery Memo: ${session.title}\n\n`
        + `**Date:** ${dateStr}  \n`
        + `**Provider/Model:** ${session.provider} / \`${session.model}\`  \n`
        + `**Branch:** \`${session.gitBranch}\`  \n\n`
        + `### 📦 Files Modified & Generated\n${filesList}\n\n`
        + `### 📝 Session Summary & Key Interactions\n`
        + session.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => `**${m.role === 'user' ? '👤 Developer' : '🤖 AI Copilot'}:**\n${m.content}\n`)
            .join('\n---\n\n');
    }

    if (format === 'adr') {
      return `# ADR: ${session.title}\n\n`
        + `* **Status:** Accepted\n`
        + `* **Date:** ${dateStr}\n`
        + `* **Context & Consultation Engine:** ${session.provider} (\`${session.model}\`)\n\n`
        + `## Context\n`
        + `Engineering session conducted on branch \`${session.gitBranch}\`.\n\n`
        + `## Affected Artifacts\n${filesList}\n\n`
        + `## Decision & Discussion Log\n`
        + session.messages
            .map(m => `### ${m.role.toUpperCase()} (${new Date(m.timestamp || session.updatedAt).toLocaleTimeString()})\n\n${m.content}`)
            .join('\n\n');
    }

    // Default: markdown
    return `# Evolve AI Chat Session: ${session.title}\n\n`
      + `* **Created:** ${new Date(session.createdAt).toLocaleString()}\n`
      + `* **Provider:** ${session.provider} | **Model:** ${session.model}\n`
      + `* **Branch:** \`${session.gitBranch}\`\n\n`
      + `## Touched Files\n${filesList}\n\n`
      + `## Conversation Transcript\n\n`
      + session.messages
          .map(m => `### ${m.role === 'user' ? 'Developer' : 'Copilot'}\n\n${m.content}\n`)
          .join('\n---\n\n');
  }
}
