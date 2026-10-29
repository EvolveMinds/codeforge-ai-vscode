/**
 * core/session/sessionTypes.ts — Multi-Session History & Chat Management Types
 *
 * Provides data contracts for multi-session persistence, timeline grouping,
 * session metadata, and multi-format export capabilities.
 */

import type { ProviderName } from '../aiService';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  timestamp?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    result: string;
    isError?: boolean;
  }>;
  thinking?: string;
  contextTag?: string;
}

export interface SessionStats {
  totalTokens?: number;
  toolCallCount?: number;
  lastBuildStatus?: 'success' | 'failed' | 'untested';
  durationMs?: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: ProviderName;
  model: string;
  messages: SessionMessage[];
  filesTouched: string[];
  gitBranch: string;
  isPinned?: boolean;
  tags?: string[];
  stats?: SessionStats;
}

export type TimelineBucket = 'Pinned' | 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

export interface SessionTimelineGroup {
  bucket: TimelineBucket;
  sessions: SessionRecord[];
}

export type SessionExportFormat = 'markdown' | 'pr_memo' | 'adr' | 'json';
