/**
 * offline/cronRegexWorkbench.ts — Interactive Cron Schedule & Regex Visualizer Engine
 *
 * 100% offline & deterministic.
 */

export interface CronEvaluation {
  isValid: boolean;
  rawExpression: string;
  humanDescription: string;
  nextRuns: string[];
  previousRuns: string[];
  error?: string;
}

export interface RegexMatchResult {
  match: string;
  index: number;
  length: number;
  groups: string[];
  namedGroups: Record<string, string>;
}

export interface RegexEvaluation {
  isValid: boolean;
  pattern: string;
  flags: string;
  totalMatches: number;
  matches: RegexMatchResult[];
  error?: string;
}

export class CronRegexWorkbench {
  // ── Cron Engine ─────────────────────────────────────────────────────────────

  static evaluateCron(cronExpr: string, baseDate: Date = new Date()): CronEvaluation {
    const raw = (cronExpr || '').trim();
    if (!raw) {
      return {
        isValid: false,
        rawExpression: raw,
        humanDescription: '',
        nextRuns: [],
        previousRuns: [],
        error: 'Expression is empty',
      };
    }

    const normalized = this._normalizePreset(raw);
    const parts = normalized.split(/\s+/);

    if (parts.length !== 5 && parts.length !== 6) {
      return {
        isValid: false,
        rawExpression: raw,
        humanDescription: '',
        nextRuns: [],
        previousRuns: [],
        error: `Expected 5 or 6 fields, but found ${parts.length} fields.`,
      };
    }

    const minutePart = parts[0];
    const hourPart = parts[1];
    const domPart = parts[2];
    const monthPart = parts[3];
    const dowPart = parts[4];

    const description = this._describeCron(minutePart, hourPart, domPart, monthPart, dowPart);
    const nextRuns = this._calculateNextRuns(parts, baseDate, 10);
    const previousRuns = this._calculatePreviousRuns(parts, baseDate, 5);

    return {
      isValid: true,
      rawExpression: raw,
      humanDescription: description,
      nextRuns,
      previousRuns,
    };
  }

  private static _normalizePreset(expr: string): string {
    const presets: Record<string, string> = {
      '@yearly': '0 0 1 1 *',
      '@annually': '0 0 1 1 *',
      '@monthly': '0 0 1 * *',
      '@weekly': '0 0 * * 0',
      '@daily': '0 0 * * *',
      '@midnight': '0 0 * * *',
      '@hourly': '0 * * * *',
    };
    return presets[expr.toLowerCase()] || expr;
  }

  private static _describeCron(min: string, hr: string, dom: string, mon: string, dow: string): string {
    let desc = '';

    // Minute & Hour
    if (min === '*' && hr === '*') {
      desc = 'Every minute';
    } else if (min.startsWith('*/')) {
      const step = min.slice(2);
      if (hr === '*') {
        desc = `Every ${step} minutes`;
      } else {
        const hrNum = parseInt(hr, 10);
        const ampm = isNaN(hrNum) ? '' : (hrNum >= 12 ? 'PM' : 'AM');
        const hr12 = isNaN(hrNum) ? hr : (hrNum % 12 || 12);
        desc = `Every ${step} minutes, at ${hr12} ${ampm}`.trim();
      }
    } else if (min === '0' && hr === '*') {
      desc = 'Every hour, on the hour';
    } else if (min === '0' && hr.startsWith('*/')) {
      desc = `Every ${hr.slice(2)} hours, on the hour`;
    } else {
      const formattedMin = min.padStart(2, '0');
      const hrNum = parseInt(hr, 10);
      const ampm = isNaN(hrNum) ? '' : (hrNum >= 12 ? 'PM' : 'AM');
      const hr12 = isNaN(hrNum) ? hr : (hrNum % 12 || 12);
      desc = `At ${hr12}:${formattedMin} ${ampm}`.trim();
    }

    // Day of Week
    if (dow !== '*' && dow !== '?') {
      const dayNames: Record<string, string> = {
        '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun',
        'MON': 'Mon', 'TUE': 'Tue', 'WED': 'Wed', 'THU': 'Thu', 'FRI': 'Fri', 'SAT': 'Sat', 'SUN': 'Sun',
      };
      if (dow === '1-5' || dow === 'MON-FRI') desc += ', on Monday through Friday';
      else if (dow === '0,6' || dow === '6,0' || dow === 'SAT,SUN') desc += ', on weekends only';
      else desc += `, on ${dow.split(',').map(d => dayNames[d] || d).join(', ')}`;
    }

    // Day of Month
    if (dom !== '*' && dom !== '?') {
      desc += `, on day ${dom} of the month`;
    }

    // Month
    if (mon !== '*') {
      desc += `, in month ${mon}`;
    }

    return desc;
  }

  private static _calculateNextRuns(parts: string[], base: Date, count: number): string[] {
    const runs: string[] = [];
    let current = new Date(base.getTime());
    current.setSeconds(0, 0);

    for (let step = 1; step <= 20000 && runs.length < count; step++) {
      current = new Date(current.getTime() + 60 * 1000); // advance 1 minute
      if (this._matchesCron(parts, current)) {
        runs.push(current.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
      }
    }
    return runs;
  }

  private static _calculatePreviousRuns(parts: string[], base: Date, count: number): string[] {
    const runs: string[] = [];
    let current = new Date(base.getTime());
    current.setSeconds(0, 0);

    for (let step = 1; step <= 20000 && runs.length < count; step++) {
      current = new Date(current.getTime() - 60 * 1000); // rewind 1 minute
      if (this._matchesCron(parts, current)) {
        runs.push(current.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
      }
    }
    return runs;
  }

  private static _matchesCron(parts: string[], d: Date): boolean {
    const min = d.getUTCMinutes();
    const hr = d.getUTCHours();
    const dom = d.getUTCDate();
    const mon = d.getUTCMonth() + 1;
    const dow = d.getUTCDay();

    return (
      this._fieldMatches(parts[0], min, 0, 59) &&
      this._fieldMatches(parts[1], hr, 0, 23) &&
      this._fieldMatches(parts[2], dom, 1, 31) &&
      this._fieldMatches(parts[3], mon, 1, 12) &&
      this._fieldMatches(parts[4], dow, 0, 7)
    );
  }

  private static _fieldMatches(field: string, val: number, min: number, max: number): boolean {
    if (field === '*' || field === '?') return true;

    // Steps (*/N)
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      return !isNaN(step) && step > 0 && val % step === 0;
    }

    // Comma lists (1,2,3)
    if (field.includes(',')) {
      return field.split(',').some(sub => this._fieldMatches(sub, val, min, max));
    }

    // Ranges (1-5)
    if (field.includes('-')) {
      const [startStr, endStr] = field.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      return !isNaN(start) && !isNaN(end) && val >= start && val <= end;
    }

    const direct = parseInt(field, 10);
    return !isNaN(direct) && (direct === val || (min === 0 && direct === 7 && val === 0));
  }

  // ── Regex Engine ───────────────────────────────────────────────────────────

  static evaluateRegex(pattern: string, flags: string, testText: string): RegexEvaluation {
    if (!pattern) {
      return {
        isValid: false,
        pattern,
        flags,
        totalMatches: 0,
        matches: [],
        error: 'Regex pattern is empty',
      };
    }

    try {
      // Ensure 'g' flag is included for multi-match testing
      const effectiveFlags = flags.includes('g') ? flags : flags + 'g';
      const regex = new RegExp(pattern, effectiveFlags);
      const matches: RegexMatchResult[] = [];
      let match: RegExpExecArray | null;

      let safetyCap = 0;
      while ((match = regex.exec(testText)) !== null && safetyCap++ < 500) {
        matches.push({
          match: match[0],
          index: match.index,
          length: match[0].length,
          groups: match.slice(1),
          namedGroups: match.groups ? { ...match.groups } : {},
        });

        // Prevent infinite loops on zero-width matches (e.g. /^/)
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }

      return {
        isValid: true,
        pattern,
        flags,
        totalMatches: matches.length,
        matches,
      };
    } catch (err: any) {
      return {
        isValid: false,
        pattern,
        flags,
        totalMatches: 0,
        matches: [],
        error: err?.message || 'Invalid regular expression syntax',
      };
    }
  }
}
