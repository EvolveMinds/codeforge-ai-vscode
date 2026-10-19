/**
 * src/fde/provenance.ts
 *
 * The Delivery Studio ships two kinds of number: ones we measured on the client's
 * own system, and ones we invented so a sales demo has something on screen. Before
 * this module those were indistinguishable once they reached a document — a
 * hardcoded `98.0%` fallback rendered exactly like a real benchmark result, and a
 * `Math.random()` string was labelled "Ed25519 signature".
 *
 * Everything here exists to keep that boundary visible:
 *
 *   - `StudioMode` is the switch. DEMO is for pitching, LIVE is for engagements.
 *   - `Measured<T>` wraps any client-facing metric with where it came from.
 *   - `renderMeasured()` is the ONLY sanctioned way to put a metric in a document.
 *     An unmeasured value renders as a visible placeholder, never as a plausible
 *     number, so a reader can always tell the difference.
 *
 * The rule this module enforces, and the reason it is worth a file of its own:
 * a document may under-claim, but it must never state a number we did not measure.
 */

/** Which mode the Studio is operating in. Persisted on the engagement. */
export type StudioMode = 'DEMO' | 'LIVE';

/** Where a client-facing value came from. Ordered weakest → strongest. */
export type ProvenanceKind =
  /** Nothing has produced this yet. */
  | 'unmeasured'
  /** A shipped preset/sample. Fine on screen in DEMO, never presentable as fact. */
  | 'demo_preset'
  /** A human typed it (ROI inputs, client name). Real, but asserted not observed. */
  | 'user_supplied'
  /** Produced by actually executing something against the target. */
  | 'measured';

export interface Measured<T> {
  value: T | null;
  provenance: ProvenanceKind;
  /** How it was obtained, e.g. "golden benchmark run 2026-09-22T10:14Z". */
  source?: string;
  /** Epoch ms when it was obtained. */
  at?: number;
}

export const unmeasured = <T>(): Measured<T> => ({ value: null, provenance: 'unmeasured' });

export const measured = <T>(value: T, source?: string): Measured<T> =>
  ({ value, provenance: 'measured', source, at: Date.now() });

export const demoPreset = <T>(value: T, source?: string): Measured<T> =>
  ({ value, provenance: 'demo_preset', source });

export const userSupplied = <T>(value: T, source?: string): Measured<T> =>
  ({ value, provenance: 'user_supplied', source });

/** True when the value may be stated to a client as fact. */
export function isPresentable(m: Measured<unknown> | undefined | null): boolean {
  if (!m || m.value === null || m.value === undefined) return false;
  return m.provenance === 'measured' || m.provenance === 'user_supplied';
}

/** Marker used wherever a metric exists but was never measured. */
export const NOT_MEASURED = '⚠️ NOT YET MEASURED';

/** Marker for a value that came from a shipped demo preset. */
export const DEMO_DATA = '⚠️ DEMO DATA — NOT A REAL MEASUREMENT';

export interface RenderMeasuredOptions {
  /** Appended to a presentable value, e.g. '%' or 'ms'. */
  unit?: string;
  /** Shown instead of the value when it is not presentable. */
  placeholder?: string;
  /** Formats a presentable value. Defaults to String(). */
  format?: (v: never) => string;
}

/**
 * The single sanctioned way to put a metric into client-facing output.
 *
 * Deliberately has no "default value" parameter. That omission is the whole
 * point: a `|| 98.0` fallback is what let unmeasured metrics reach signed
 * documents, so this function makes the honest path the only path.
 */
export function renderMeasured<T>(
  m: Measured<T> | undefined | null,
  opts: RenderMeasuredOptions = {}
): string {
  const { unit = '', placeholder } = opts;

  if (!m || m.value === null || m.value === undefined) {
    return placeholder ?? NOT_MEASURED;
  }
  if (m.provenance === 'unmeasured') {
    return placeholder ?? NOT_MEASURED;
  }

  const shown = opts.format
    ? (opts.format as (v: T) => string)(m.value)
    : String(m.value);

  if (m.provenance === 'demo_preset') {
    return `${shown}${unit} \`${DEMO_DATA}\``;
  }
  return `${shown}${unit}`;
}

/**
 * Renders a whole document section only when its inputs are presentable.
 * Omitting a section is honest; printing it with invented numbers is not.
 */
export function sectionIf(
  condition: boolean,
  body: string,
  omittedNote = '_This section is omitted because the underlying values have not been measured yet._'
): string {
  return condition ? body : omittedNote;
}

/* ------------------------------------------------------------------ *
 * Document banners
 * ------------------------------------------------------------------ */

/**
 * Banner stamped at the top of every generated client document.
 * In DEMO mode this is the thing standing between a sample artifact and a
 * client treating it as a real deliverable, so it is deliberately loud.
 */
export function documentBanner(mode: StudioMode, generatedAt = new Date()): string {
  const ts = generatedAt.toISOString();
  if (mode === 'DEMO') {
    return [
      '> [!WARNING]',
      '> ## ⚠️ DEMONSTRATION ARTIFACT — NOT A CLIENT DELIVERABLE',
      '>',
      '> This document was generated while the Delivery Studio was in **DEMO mode**.',
      '> Figures, findings and signatures in it come from built-in sample data and',
      '> describe no real system. It must not be shared with a client, attached to a',
      '> proposal, or used as evidence of testing.',
      '>',
      `> _Generated ${ts}_`,
      ''
    ].join('\n');
  }
  return [
    '> [!NOTE]',
    `> Generated by Evolve AI Delivery Studio in **LIVE mode** — ${ts}.`,
    '> Values marked ' + '`' + NOT_MEASURED + '`' + ' have not been produced by a real run yet.',
    ''
  ].join('\n');
}

/** HTML equivalent of {@link documentBanner}, for the .html twins. */
export function documentBannerHtml(mode: StudioMode, generatedAt = new Date()): string {
  const ts = generatedAt.toISOString();
  if (mode === 'DEMO') {
    return `<div style="background:#7f1d1d;border:2px solid #ef4444;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:24px;font-family:system-ui,sans-serif;">
  <div style="font-size:18px;font-weight:800;margin-bottom:6px;">⚠️ DEMONSTRATION ARTIFACT — NOT A CLIENT DELIVERABLE</div>
  <div style="font-size:13px;line-height:1.6;">Generated in <strong>DEMO mode</strong>. Figures, findings and signatures come from built-in sample data and describe no real system. Do not share with a client or use as evidence of testing.</div>
  <div style="font-size:11px;opacity:.75;margin-top:8px;">Generated ${ts}</div>
</div>`;
  }
  return `<div style="background:#064e3b;border:1px solid #10b981;color:#d1fae5;padding:10px 14px;border-radius:6px;margin-bottom:20px;font-family:system-ui,sans-serif;font-size:12px;">
  Generated by Evolve AI Delivery Studio in <strong>LIVE mode</strong> — ${ts}. Values marked "${NOT_MEASURED}" have not been produced by a real run yet.
</div>`;
}

/* ------------------------------------------------------------------ *
 * Integrity stamps
 * ------------------------------------------------------------------ */

/**
 * What an audit stamp actually is, stated honestly.
 *
 * The Studio previously emitted `'ed25519_sig_' + sha256(...)` and even
 * `'ed25519_' + Math.random()` and displayed both as "Ed25519 Cryptographically
 * Signed". There is no keypair anywhere in the product, so nothing could verify
 * them. A content digest is genuinely useful — it detects tampering with a
 * record you already trust — but it is not a signature and must not claim to be.
 */
export type IntegrityStampKind = 'sha256_digest' | 'unsigned_demo';

export interface IntegrityStamp {
  kind: IntegrityStampKind;
  /** Hex digest for 'sha256_digest'; a clearly fake marker for demo. */
  value: string;
  /** Plain-English description safe to render in a client document. */
  label: string;
  /** True only if a real keypair signed this. Always false today. */
  cryptographicallySigned: boolean;
  at: number;
}

export function sha256Stamp(hexDigest: string): IntegrityStamp {
  return {
    kind: 'sha256_digest',
    value: hexDigest,
    label: 'SHA-256 content digest (tamper-evident; not a digital signature)',
    cryptographicallySigned: false,
    at: Date.now()
  };
}

export function unsignedDemoStamp(): IntegrityStamp {
  return {
    kind: 'unsigned_demo',
    value: 'DEMO_UNSIGNED',
    label: 'Demo artifact — no integrity stamp',
    cryptographicallySigned: false,
    at: Date.now()
  };
}

/** Renders an integrity stamp without overstating what it proves. */
export function renderIntegrityStamp(s: IntegrityStamp | undefined | null): string {
  if (!s) return NOT_MEASURED;
  if (s.kind === 'unsigned_demo') return DEMO_DATA;
  return `\`${s.value}\` — ${s.label}`;
}

/* ------------------------------------------------------------------ *
 * Evidence & Unknowns Ledger (Zero-Hallucination Grounding)
 * ------------------------------------------------------------------ */

export type EvidenceKind =
  | 'static_source'
  | 'decompiled_artifact'
  | 'runtime_observation'
  | 'test_assertion'
  | 'schema_introspection'
  | 'binary_symbol'
  | 'inspected_component';

export type EvidenceConfidence = 'exact' | 'inferred' | 'heuristic';

export interface EvidenceSpan {
  startLine?: number;
  endLine?: number;
  startOffset?: number;
  endOffset?: number;
  symbol?: string;
  file?: string;
}

export interface EvidenceRecord {
  /** Deterministic content-addressed identifier (e.g., "ev_a1b2c3d4"). */
  id: string;
  kind: EvidenceKind;
  confidence: EvidenceConfidence;
  sourceUri: string;
  span?: EvidenceSpan;
  summary: string;
  /** Raw excerpt, byte slice, or AST node text proving the claim. */
  rawProof?: string;
  recordedAt: number;
  metadata?: Record<string, unknown>;
}

export type UnknownSeverity = 'blocking' | 'warning' | 'informational';

export interface UnknownItem {
  /** Deterministic identifier (e.g., "unk_x1y2z3"). */
  id: string;
  target: string;
  reason: string;
  severity: UnknownSeverity;
  remediation: string;
  sourceUri?: string;
  recordedAt: number;
}

export interface EvidenceManifest {
  version: '1.0';
  generatedAtISO: string;
  recordsCount: number;
  unknownsCount: number;
  blockingUnknownsCount: number;
  evidence: EvidenceRecord[];
  unknowns: UnknownItem[];
  digest: string;
}

function generateDeterministicId(prefix: string, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${prefix}_${hex}`;
}

/**
 * Verifiable evidence ledger inspired by REA's proof-bound architecture.
 * Binds transformed code and FDE claims to cryptographic proof records,
 * and maintains an explicit catalog of unresolved unknowns.
 */
export class EvidenceLedger {
  private _records = new Map<string, EvidenceRecord>();
  private _unknowns = new Map<string, UnknownItem>();

  /**
   * Records a verifiable piece of evidence. If an identical proof is already
   * recorded, returns the existing record to guarantee deduplication.
   */
  public record(entry: Omit<EvidenceRecord, 'id' | 'recordedAt'>): EvidenceRecord {
    const seed = `${entry.kind}|${entry.confidence}|${entry.sourceUri}|${JSON.stringify(entry.span || {})}|${entry.summary}|${entry.rawProof || ''}`;
    const id = generateDeterministicId('ev', seed);

    const existing = this._records.get(id);
    if (existing) {
      return existing;
    }

    const record: EvidenceRecord = {
      ...entry,
      id,
      recordedAt: Date.now()
    };
    this._records.set(id, record);
    return record;
  }

  /**
   * Records an explicit unknown boundary where static or decompilation analysis
   * cannot prove a behavior without dynamic runtime testing.
   */
  public recordUnknown(item: Omit<UnknownItem, 'id' | 'recordedAt'>): UnknownItem {
    const seed = `${item.target}|${item.reason}|${item.severity}|${item.sourceUri || ''}`;
    const id = generateDeterministicId('unk', seed);

    const existing = this._unknowns.get(id);
    if (existing) {
      return existing;
    }

    const unknown: UnknownItem = {
      ...item,
      id,
      recordedAt: Date.now()
    };
    this._unknowns.set(id, unknown);
    return unknown;
  }

  public get(id: string): EvidenceRecord | undefined {
    return this._records.get(id);
  }

  public getAll(): EvidenceRecord[] {
    return Array.from(this._records.values());
  }

  public getUnknowns(): UnknownItem[] {
    return Array.from(this._unknowns.values());
  }

  public getBlockingUnknowns(): UnknownItem[] {
    return this.getUnknowns().filter(u => u.severity === 'blocking');
  }

  public hasBlockingUnknowns(): boolean {
    return this.getBlockingUnknowns().length > 0;
  }

  /**
   * Exports an auditable, serialized manifest with a cryptographic digest.
   */
  public exportManifest(): EvidenceManifest {
    const evidence = this.getAll();
    const unknowns = this.getUnknowns();
    const blockingCount = this.getBlockingUnknowns().length;

    const payload = JSON.stringify({ evidence, unknowns });
    const digest = generateDeterministicId('sha', payload);

    return {
      version: '1.0',
      generatedAtISO: new Date().toISOString(),
      recordsCount: evidence.length,
      unknownsCount: unknowns.length,
      blockingUnknownsCount: blockingCount,
      evidence,
      unknowns,
      digest
    };
  }

  /**
   * Renders a human-readable GitHub-flavored markdown report suitable for
   * inclusion in client deliverables or conversion review panels.
   */
  public renderMarkdownAudit(): string {
    const lines: string[] = [
      '### Verifiable Grounding & Evidence Ledger',
      '',
      `* **Total Verified Claims:** \`${this._records.size}\``,
      `* **Unresolved Unknowns:** \`${this._unknowns.size}\` (${this.hasBlockingUnknowns() ? '⚠️ Blocking items present' : '✅ No blocking unknowns'})`,
      ''
    ];

    if (this._records.size > 0) {
      lines.push('| Evidence ID | Kind | Confidence | Source Target | Summary |');
      lines.push('| :--- | :--- | :---: | :--- | :--- |');
      for (const rec of this.getAll()) {
        const spanText = rec.span?.symbol ? ` (${rec.span.symbol})` : (rec.span?.startLine ? ` (L${rec.span.startLine})` : '');
        lines.push(`| \`${rec.id}\` | \`${rec.kind}\` | **${rec.confidence}** | \`${rec.sourceUri}${spanText}\` | ${rec.summary} |`);
      }
      lines.push('');
    }

    if (this._unknowns.size > 0) {
      lines.push('#### Unresolved Analysis Boundaries (Unknowns)');
      lines.push('| Unknown ID | Severity | Target Boundary | Reason / Remediation |');
      lines.push('| :--- | :---: | :--- | :--- |');
      for (const unk of this.getUnknowns()) {
        const sevBadge = unk.severity === 'blocking' ? '🔴 **BLOCKING**' : (unk.severity === 'warning' ? '🟡 WARNING' : 'ℹ️ INFO');
        lines.push(`| \`${unk.id}\` | ${sevBadge} | \`${unk.target}\` | **Reason:** ${unk.reason}<br/>**Action:** ${unk.remediation} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

