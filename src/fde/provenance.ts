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
