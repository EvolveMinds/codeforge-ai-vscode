/**
 * analysis/cache.ts — Content-hash keyed analysis cache
 *
 * Skips re-analysis when file content is unchanged. In-memory only;
 * cleared on extension restart. Workspace-scoped so one repo's cache
 * doesn't bleed into another.
 */

import * as crypto from 'crypto';
import type { Report } from './types';

interface Entry { hash: string; report: Report; timestamp: number; }

export class AnalysisCache {
  private readonly _max = 500;
  private readonly _entries = new Map<string, Entry>();

  static hash(content: string): string {
    return crypto.createHash('sha1').update(content).digest('hex');
  }

  get(filePath: string, hash: string): Report | null {
    const e = this._entries.get(filePath);
    if (!e || e.hash !== hash) return null;
    return e.report;
  }

  set(filePath: string, hash: string, report: Report): void {
    if (this._entries.size >= this._max) {
      // drop oldest
      const oldest = [...this._entries.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this._entries.delete(oldest[0]);
    }
    this._entries.set(filePath, { hash, report, timestamp: Date.now() });
  }

  invalidate(filePath?: string): void {
    if (filePath) this._entries.delete(filePath);
    else this._entries.clear();
  }
}
