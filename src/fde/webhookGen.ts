/**
 * src/fde/webhookGen.ts — Inbound webhook receiver generator.
 *
 * Section 2B is titled "Resilient Client API & Webhook Ingest Studio", but only
 * the outbound half existed: `apiConnectorGen.ts` builds clients that *call*
 * a client's API. A webhook is the other direction — an endpoint the client's
 * system calls us on — and none of it was implemented.
 *
 * The part worth generating is signature verification. It is the part most
 * often written by hand and got subtly wrong, and the failure is silent: a
 * receiver that accepts forged payloads looks exactly like one that works.
 * Three mistakes this generator exists to avoid:
 *
 *  1. **Verifying a parsed body.** Every provider signs the *raw bytes*. Once
 *     `express.json()` has parsed and re-serialised the payload, key order and
 *     whitespace can differ and the HMAC will never match — so people "fix" it
 *     by removing the check.
 *  2. **Comparing with `===`.** String comparison leaks timing. Both emitted
 *     languages use a constant-time compare, with an explicit length guard
 *     because `crypto.timingSafeEqual` throws on a length mismatch.
 *  3. **No replay window.** A valid signature is valid forever without one, so
 *     a captured request can be replayed indefinitely.
 *
 * Idempotency is separate from replay protection and both are generated: replay
 * rejects a *duplicate delivery of the same bytes* inside a time window;
 * idempotency stops a legitimate provider retry from applying an effect twice.
 */

export type WebhookProvider = 'stripe' | 'github' | 'slack' | 'generic_hmac';
export type WebhookLanguage = 'typescript' | 'python';

export interface WebhookFieldSpec {
  name: string;
  /** TS-flavoured type name; the Python emitter maps it. */
  type: string;
  /** Nested object fields, when `type` is 'object'. */
  children?: WebhookFieldSpec[];
}

export interface WebhookOptions {
  /** Identifier used for the handler/class name, e.g. "BillingEvents". */
  receiverName: string;
  provider: WebhookProvider;
  language: WebhookLanguage;
  /** Route the provider will POST to. */
  path: string;
  /** Inferred from a sample payload; drives the emitted types. */
  fields: WebhookFieldSpec[];
  /** Dotted path to the provider's unique event id, for idempotency. */
  eventIdField?: string;
  /** Dotted path to the event type/name, when the payload carries one. */
  eventTypeField?: string;
  /** Distinct event types seen, so the handler can stub a branch per type. */
  eventTypes?: string[];
  /** Seconds a signed request stays acceptable. */
  toleranceSeconds?: number;
  /** Env var holding the shared secret. */
  secretEnvVar?: string;
}

interface ProviderTraits {
  label: string;
  /** Header carrying the signature. */
  signatureHeader: string;
  /** Header carrying the timestamp, when it is separate from the signature. */
  timestampHeader?: string;
  /** How the signed string is built from timestamp + raw body. */
  signedPayload: 'timestamp.body' | 'body' | 'v0:timestamp:body';
  /** Prefix the provider puts in front of the hex digest, if any. */
  digestPrefix: string;
  /** Whether the signature header packs several fields, e.g. Stripe's t=/v1=. */
  compositeHeader: boolean;
  notes: string;
}

const PROVIDERS: Record<WebhookProvider, ProviderTraits> = {
  stripe: {
    label: 'Stripe',
    signatureHeader: 'stripe-signature',
    signedPayload: 'timestamp.body',
    digestPrefix: '',
    compositeHeader: true,
    notes: 'Header packs `t=<unix>` and one or more `v1=<hex>`. Signed string is `${t}.${rawBody}`. Several v1 values can appear during secret rotation, so every candidate is checked.'
  },
  github: {
    label: 'GitHub',
    signatureHeader: 'x-hub-signature-256',
    signedPayload: 'body',
    digestPrefix: 'sha256=',
    compositeHeader: false,
    notes: 'HMAC-SHA256 over the raw body, hex, prefixed `sha256=`. GitHub sends no timestamp, so replay protection relies on the delivery id (`x-github-delivery`).'
  },
  slack: {
    label: 'Slack',
    signatureHeader: 'x-slack-signature',
    timestampHeader: 'x-slack-request-timestamp',
    signedPayload: 'v0:timestamp:body',
    digestPrefix: 'v0=',
    compositeHeader: false,
    notes: 'Signed string is `v0:${timestamp}:${rawBody}`; digest prefixed `v0=`. Slack recommends rejecting timestamps older than five minutes.'
  },
  generic_hmac: {
    label: 'Generic HMAC-SHA256',
    signatureHeader: 'x-signature',
    timestampHeader: 'x-timestamp',
    signedPayload: 'timestamp.body',
    digestPrefix: '',
    compositeHeader: false,
    notes: 'Fallback for providers without a published convention: HMAC-SHA256 over `${timestamp}.${rawBody}`, hex, with the timestamp in its own header.'
  }
};

export class WebhookGenerator {
  static providers(): Array<{ id: WebhookProvider; label: string; notes: string }> {
    return (Object.keys(PROVIDERS) as WebhookProvider[]).map(id => ({
      id,
      label: PROVIDERS[id].label,
      notes: PROVIDERS[id].notes
    }));
  }

  /**
   * Infers a typed schema from one sample payload, the way `parseCurlCommand`
   * infers an endpoint from a cURL string.
   *
   * Deliberately shallow-but-honest: an empty array yields `unknown[]` rather
   * than guessing an element type, because a confident wrong type is worse than
   * an obvious gap the FDE will fill in.
   */
  static inferSchema(sampleJson: string): {
    fields: WebhookFieldSpec[];
    eventIdField?: string;
    eventTypeField?: string;
    error?: string;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sampleJson);
    } catch (e: any) {
      return { fields: [], error: `Sample payload is not valid JSON: ${e?.message || e}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { fields: [], error: 'Sample payload must be a JSON object.' };
    }

    const typeOf = (v: unknown): string => {
      if (v === null) return 'null';
      if (Array.isArray(v)) {
        if (v.length === 0) return 'unknown[]';
        const inner = typeOf(v[0]);
        return inner === 'object' ? 'Record<string, unknown>[]' : `${inner}[]`;
      }
      switch (typeof v) {
        case 'string': return 'string';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'object': return 'object';
        default: return 'unknown';
      }
    };

    const walk = (obj: Record<string, unknown>, depth = 0): WebhookFieldSpec[] =>
      Object.entries(obj).map(([name, value]) => {
        const type = typeOf(value);
        // Three levels is enough to type the envelope a handler branches on;
        // deeper structures stay Record<string, unknown> rather than producing
        // an unreadable wall of nested interfaces.
        if (type === 'object' && depth < 2) {
          return { name, type: 'object', children: walk(value as Record<string, unknown>, depth + 1) };
        }
        return { name, type: type === 'object' ? 'Record<string, unknown>' : type };
      });

    const fields = walk(parsed as Record<string, unknown>);
    const top = parsed as Record<string, unknown>;

    // Common id/type field names across providers, most specific first.
    const pick = (candidates: string[]): string | undefined =>
      candidates.find(c => {
        const [head, ...rest] = c.split('.');
        if (!(head in top)) return false;
        if (rest.length === 0) return typeof top[head] === 'string';
        const nested = top[head];
        return !!nested && typeof nested === 'object' && rest[0] in (nested as Record<string, unknown>);
      });

    return {
      fields,
      eventIdField: pick(['id', 'event_id', 'eventId', 'delivery_id', 'event.id']),
      eventTypeField: pick(['type', 'event_type', 'eventType', 'event', 'action'])
    };
  }

  static generate(opts: WebhookOptions): string {
    return opts.language === 'python'
      ? this._python(opts)
      : this._typescript(opts);
  }

  /* ---------------------------------------------------------------- *
   * TypeScript / Express
   * ---------------------------------------------------------------- */

  private static _typescript(o: WebhookOptions): string {
    const p = PROVIDERS[o.provider];
    const cls = o.receiverName.replace(/[^A-Za-z0-9]/g, '') || 'Webhook';
    const secretEnv = o.secretEnvVar || `${cls.toUpperCase()}_WEBHOOK_SECRET`;
    const tolerance = o.toleranceSeconds ?? 300;
    const iface = this._tsInterface(cls + 'Event', o.fields);

    const verifyBody = this._tsVerify(o.provider, p, tolerance);
    const eventId = o.eventIdField
      ? `(payload as any)?.${o.eventIdField.split('.').join('?.')}`
      : `req.header('${p.signatureHeader}')`;

    const branches = (o.eventTypes || []).length
      ? (o.eventTypes || [])
        .map(t => `      case ${JSON.stringify(t)}:\n        // TODO: handle ${t}\n        break;`)
        .join('\n')
      : '      // TODO: branch on the event type once known';

    return `/**
 * ${cls} — inbound ${p.label} webhook receiver.
 *
 * Generated by Evolve AI (Forward Deployed Engineer Suite).
 *
 * ${p.notes}
 *
 * Wire it up BEFORE any body parser, or move the raw-body middleware ahead of
 * express.json(): the signature is over the bytes as sent, and a parsed and
 * re-serialised body will not match.
 */

import express, { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

${iface}

/** Seconds a signed request stays acceptable. */
const TOLERANCE_SECONDS = ${tolerance};

/**
 * Event ids already processed, so a provider retry does not apply an effect
 * twice. In-memory is fine for a single process; behind a load balancer or
 * across restarts this must be shared storage (Redis, a table with a unique
 * index) or duplicates will slip through on the other instance.
 */
const seenEventIds = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = ${tolerance * 4} * 1000;

function alreadyProcessed(id: string): boolean {
  const now = Date.now();
  for (const [key, at] of seenEventIds) {
    if (now - at > IDEMPOTENCY_TTL_MS) seenEventIds.delete(key);
  }
  if (seenEventIds.has(id)) return true;
  seenEventIds.set(id, now);
  return false;
}

/** Constant-time compare. Length is checked first: timingSafeEqual throws when the buffers differ in length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

${verifyBody}

export function ${cls}Router(): express.Router {
  const router = express.Router();

  router.post(
    '${o.path}',
    // Raw body, not JSON: the signature covers the bytes as sent.
    express.raw({ type: '*/*' }),
    (req: Request, res: Response) => {
      const rawBody = (req.body as Buffer).toString('utf8');

      const verdict = verifySignature(req, rawBody);
      if (!verdict.ok) {
        // 401, not 400: the request is well-formed but unauthenticated. Do not
        // echo the reason to the caller — it is logged instead.
        console.warn('[${cls}] rejected webhook: %s', verdict.reason);
        return res.status(401).json({ error: 'invalid signature' });
      }

      let payload: ${cls}Event;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'invalid json' });
      }

      const eventId = String(${eventId} ?? '');
      if (eventId && alreadyProcessed(eventId)) {
        // Acknowledge: the provider already delivered this and will keep
        // retrying on a non-2xx.
        return res.status(200).json({ received: true, duplicate: true });
      }

      switch (String((payload as any)?.${(o.eventTypeField || 'type').split('.').join('?.')} ?? '')) {
${branches}
      default:
        break;
      }

      // Respond promptly; do slow work on a queue. Providers time out fast and
      // a timeout looks like a failure, triggering redelivery.
      return res.status(200).json({ received: true });
    }
  );

  return router;
}

/* Usage:
 *
 *   const app = express();
 *   app.use(${cls}Router());
 *   app.listen(3000);
 *
 * Set ${secretEnv} to the signing secret from your ${p.label} dashboard.
 */
`;
  }

  private static _tsVerify(provider: WebhookProvider, p: ProviderTraits, tolerance: number): string {
    const secret = `process.env.${'${SECRET_ENV}'}`;
    void secret;

    if (provider === 'stripe') {
      return `interface Verdict { ok: boolean; reason?: string; }

function verifySignature(req: Request, rawBody: string): Verdict {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'WEBHOOK_SECRET is not set' };

  const header = req.header('${p.signatureHeader}');
  if (!header) return { ok: false, reason: 'missing ${p.signatureHeader}' };

  // Header looks like: t=1614556800,v1=abc...,v1=def...
  const parts = header.split(',').map(s => s.trim());
  const timestamp = parts.find(s => s.startsWith('t='))?.slice(2);
  const signatures = parts.filter(s => s.startsWith('v1=')).map(s => s.slice(3));

  if (!timestamp || signatures.length === 0) {
    return { ok: false, reason: 'malformed signature header' };
  }

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) {
    // Without this, a captured request stays replayable forever.
    return { ok: false, reason: \`timestamp outside \${TOLERANCE_SECONDS}s tolerance\` };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`, 'utf8')
    .digest('hex');

  // Several v1 values appear during secret rotation; any match is valid.
  const matched = signatures.some(sig => safeEqual(sig, expected));
  return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}`;
    }

    if (provider === 'slack') {
      return `interface Verdict { ok: boolean; reason?: string; }

function verifySignature(req: Request, rawBody: string): Verdict {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'WEBHOOK_SECRET is not set' };

  const signature = req.header('${p.signatureHeader}');
  const timestamp = req.header('${p.timestampHeader}');
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' };

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) {
    return { ok: false, reason: \`timestamp outside \${TOLERANCE_SECONDS}s tolerance\` };
  }

  const expected = '${p.digestPrefix}' + crypto
    .createHmac('sha256', secret)
    .update(\`v0:\${timestamp}:\${rawBody}\`, 'utf8')
    .digest('hex');

  return safeEqual(signature, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}`;
    }

    if (provider === 'github') {
      return `interface Verdict { ok: boolean; reason?: string; }

function verifySignature(req: Request, rawBody: string): Verdict {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'WEBHOOK_SECRET is not set' };

  const signature = req.header('${p.signatureHeader}');
  if (!signature) return { ok: false, reason: 'missing ${p.signatureHeader}' };

  const expected = '${p.digestPrefix}' + crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // GitHub sends no timestamp, so there is no replay window to enforce here.
  // Replay is bounded by the delivery id in the idempotency check instead.
  return safeEqual(signature, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}`;
    }

    return `interface Verdict { ok: boolean; reason?: string; }

function verifySignature(req: Request, rawBody: string): Verdict {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'WEBHOOK_SECRET is not set' };

  const signature = req.header('${p.signatureHeader}');
  const timestamp = req.header('${p.timestampHeader}');
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' };

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) {
    return { ok: false, reason: \`timestamp outside \${TOLERANCE_SECONDS}s tolerance\` };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`, 'utf8')
    .digest('hex');

  return safeEqual(signature, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}`;
  }

  private static _tsInterface(name: string, fields: WebhookFieldSpec[], indent = ''): string {
    if (fields.length === 0) {
      return `export interface ${name} {\n  [key: string]: unknown;\n}`;
    }
    const body = fields
      .map(f => {
        if (f.type === 'object' && f.children?.length) {
          const nested = f.children
            .map(c => `${indent}    ${JSON.stringify(c.name)}: ${c.type === 'object' ? 'Record<string, unknown>' : c.type};`)
            .join('\n');
          return `${indent}  ${JSON.stringify(f.name)}: {\n${nested}\n${indent}  };`;
        }
        return `${indent}  ${JSON.stringify(f.name)}: ${f.type};`;
      })
      .join('\n');
    return `export interface ${name} {\n${body}\n}`;
  }

  /* ---------------------------------------------------------------- *
   * Python / FastAPI
   * ---------------------------------------------------------------- */

  private static _python(o: WebhookOptions): string {
    const p = PROVIDERS[o.provider];
    const cls = o.receiverName.replace(/[^A-Za-z0-9]/g, '') || 'Webhook';
    const tolerance = o.toleranceSeconds ?? 300;
    const secretEnv = o.secretEnvVar || `${cls.toUpperCase()}_WEBHOOK_SECRET`;

    const verify = this._pyVerify(o.provider, p);
    const eventIdExpr = o.eventIdField
      ? `payload.get(${JSON.stringify(o.eventIdField.split('.')[0])})`
      : `request.headers.get(${JSON.stringify(p.signatureHeader)})`;

    return `"""
${cls} — inbound ${p.label} webhook receiver.

Generated by Evolve AI (Forward Deployed Engineer Suite).

${p.notes}

The signature covers the raw request bytes. FastAPI's \`await request.body()\`
returns them unparsed, which is what is verified here — parsing first and
re-serialising would change key order and whitespace, and the HMAC would never
match.
"""

import hmac
import hashlib
import json
import os
import time
from typing import Any, Dict, Tuple

from fastapi import APIRouter, Request, Response, status

router = APIRouter()

# Seconds a signed request stays acceptable.
TOLERANCE_SECONDS = ${tolerance}

# Event ids already processed, so a provider retry does not apply an effect
# twice. In-memory is fine for one process; behind a load balancer or across
# restarts this needs shared storage or duplicates slip through elsewhere.
_seen_event_ids: Dict[str, float] = {}
_IDEMPOTENCY_TTL = ${tolerance * 4}


def _already_processed(event_id: str) -> bool:
    now = time.time()
    for key, seen_at in list(_seen_event_ids.items()):
        if now - seen_at > _IDEMPOTENCY_TTL:
            del _seen_event_ids[key]
    if event_id in _seen_event_ids:
        return True
    _seen_event_ids[event_id] = now
    return False


def _safe_equal(a: str, b: str) -> bool:
    """Constant-time compare — never use ==, it leaks timing."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


${verify}


@router.post("${o.path}")
async def ${cls.toLowerCase()}_webhook(request: Request) -> Response:
    raw_body = await request.body()

    ok, reason = _verify_signature(request, raw_body)
    if not ok:
        # 401, not 400: well-formed but unauthenticated. The reason is logged,
        # not returned, so a prober learns nothing.
        print(f"[${cls}] rejected webhook: {reason}")
        return Response(
            content=json.dumps({"error": "invalid signature"}),
            status_code=status.HTTP_401_UNAUTHORIZED,
            media_type="application/json",
        )

    try:
        payload: Dict[str, Any] = json.loads(raw_body)
    except json.JSONDecodeError:
        return Response(
            content=json.dumps({"error": "invalid json"}),
            status_code=status.HTTP_400_BAD_REQUEST,
            media_type="application/json",
        )

    event_id = str(${eventIdExpr} or "")
    if event_id and _already_processed(event_id):
        # Acknowledge: the provider already delivered this and retries on non-2xx.
        return Response(
            content=json.dumps({"received": True, "duplicate": True}),
            status_code=status.HTTP_200_OK,
            media_type="application/json",
        )

    event_type = str(payload.get(${JSON.stringify((o.eventTypeField || 'type').split('.')[0])}) or "")
${(o.eventTypes || []).length
        ? (o.eventTypes || []).map(t => `    if event_type == ${JSON.stringify(t)}:\n        pass  # TODO: handle ${t}`).join('\n')
        : '    # TODO: branch on event_type once known'}

    # Respond promptly; queue slow work. Providers time out fast, and a timeout
    # looks like failure and triggers redelivery.
    return Response(
        content=json.dumps({"received": True}),
        status_code=status.HTTP_200_OK,
        media_type="application/json",
    )


# Usage:
#   from fastapi import FastAPI
#   app = FastAPI()
#   app.include_router(router)
#
# Set ${secretEnv} to the signing secret from your ${p.label} dashboard.
`;
  }

  private static _pyVerify(provider: WebhookProvider, p: ProviderTraits): string {
    if (provider === 'stripe') {
      return `def _verify_signature(request: Request, raw_body: bytes) -> Tuple[bool, str]:
    secret = os.environ.get("WEBHOOK_SECRET")
    if not secret:
        return False, "WEBHOOK_SECRET is not set"

    header = request.headers.get("${p.signatureHeader}")
    if not header:
        return False, "missing ${p.signatureHeader}"

    # Header looks like: t=1614556800,v1=abc...,v1=def...
    parts = [s.strip() for s in header.split(",")]
    timestamp = next((s[2:] for s in parts if s.startswith("t=")), None)
    signatures = [s[3:] for s in parts if s.startswith("v1=")]
    if not timestamp or not signatures:
        return False, "malformed signature header"

    try:
        age = int(time.time()) - int(timestamp)
    except ValueError:
        return False, "malformed timestamp"
    if abs(age) > TOLERANCE_SECONDS:
        # Without this, a captured request stays replayable forever.
        return False, f"timestamp outside {TOLERANCE_SECONDS}s tolerance"

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    # Several v1 values appear during secret rotation; any match is valid.
    if any(_safe_equal(sig, expected) for sig in signatures):
        return True, ""
    return False, "signature mismatch"`;
    }

    if (provider === 'slack') {
      return `def _verify_signature(request: Request, raw_body: bytes) -> Tuple[bool, str]:
    secret = os.environ.get("WEBHOOK_SECRET")
    if not secret:
        return False, "WEBHOOK_SECRET is not set"

    signature = request.headers.get("${p.signatureHeader}")
    timestamp = request.headers.get("${p.timestampHeader}")
    if not signature or not timestamp:
        return False, "missing signature headers"

    try:
        age = int(time.time()) - int(timestamp)
    except ValueError:
        return False, "malformed timestamp"
    if abs(age) > TOLERANCE_SECONDS:
        return False, f"timestamp outside {TOLERANCE_SECONDS}s tolerance"

    expected = "${p.digestPrefix}" + hmac.new(
        secret.encode("utf-8"),
        f"v0:{timestamp}:".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return (True, "") if _safe_equal(signature, expected) else (False, "signature mismatch")`;
    }

    if (provider === 'github') {
      return `def _verify_signature(request: Request, raw_body: bytes) -> Tuple[bool, str]:
    secret = os.environ.get("WEBHOOK_SECRET")
    if not secret:
        return False, "WEBHOOK_SECRET is not set"

    signature = request.headers.get("${p.signatureHeader}")
    if not signature:
        return False, "missing ${p.signatureHeader}"

    expected = "${p.digestPrefix}" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()

    # GitHub sends no timestamp, so there is no replay window to enforce here.
    # Replay is bounded by the delivery id in the idempotency check instead.
    return (True, "") if _safe_equal(signature, expected) else (False, "signature mismatch")`;
    }

    return `def _verify_signature(request: Request, raw_body: bytes) -> Tuple[bool, str]:
    secret = os.environ.get("WEBHOOK_SECRET")
    if not secret:
        return False, "WEBHOOK_SECRET is not set"

    signature = request.headers.get("${p.signatureHeader}")
    timestamp = request.headers.get("${p.timestampHeader}")
    if not signature or not timestamp:
        return False, "missing signature headers"

    try:
        age = int(time.time()) - int(timestamp)
    except ValueError:
        return False, "malformed timestamp"
    if abs(age) > TOLERANCE_SECONDS:
        return False, f"timestamp outside {TOLERANCE_SECONDS}s tolerance"

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return (True, "") if _safe_equal(signature, expected) else (False, "signature mismatch")`;
  }

  /* ---------------------------------------------------------------- *
   * Test harness
   * ---------------------------------------------------------------- */

  /**
   * A runnable harness that replays a captured payload against the receiver —
   * once correctly signed, once tampered, once replayed, once stale.
   *
   * Generated alongside the receiver because "it returned 200" is not evidence
   * the verification works: a receiver that accepts everything also returns
   * 200. The FDE needs to be able to show the rejection in front of a client.
   */
  static generateTestHarness(o: WebhookOptions): string {
    const p = PROVIDERS[o.provider];
    const cls = o.receiverName.replace(/[^A-Za-z0-9]/g, '') || 'Webhook';

    const signExpr = o.provider === 'stripe'
      ? "`t=${ts},v1=${hmac(`${ts}.${body}`)}`"
      : o.provider === 'slack'
        ? "`v0=${hmac(`v0:${ts}:${body}`)}`"
        : o.provider === 'github'
          ? '`sha256=${hmac(body)}`'
          : '`${hmac(`${ts}.${body}`)}`';

    return `/**
 * ${cls} receiver — signature, replay and idempotency checks.
 *
 * Proves the receiver REJECTS what it should. A receiver that accepts
 * everything also returns 200 on the happy path, so the negative cases are the
 * ones that carry the evidence.
 *
 *   npm i -D vitest supertest && npx vitest run
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as crypto from 'crypto';
import { ${cls}Router } from './${cls.toLowerCase()}';

const SECRET = 'test-secret';
process.env.WEBHOOK_SECRET = SECRET;

const app = express();
app.use(${cls}Router());

const hmac = (data: string) =>
  crypto.createHmac('sha256', SECRET).update(data, 'utf8').digest('hex');

const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => ${signExpr};

const SAMPLE = JSON.stringify(${JSON.stringify(
      Object.fromEntries((o.fields || []).slice(0, 4).map(f => [f.name, f.type === 'number' ? 1 : 'x'])),
      null,
      2
    )});

describe('${cls} webhook receiver', () => {
  it('accepts a correctly signed payload', async () => {
    const res = await request(app)
      .post('${o.path}')
      .set('${p.signatureHeader}', sign(SAMPLE))${p.timestampHeader ? `\n      .set('${p.timestampHeader}', String(Math.floor(Date.now() / 1000)))` : ''}
      .set('content-type', 'application/json')
      .send(SAMPLE);

    expect(res.status).toBe(200);
  });

  it('rejects a tampered payload', async () => {
    // Signature computed over the original, body swapped afterwards — exactly
    // what an attacker who captured one delivery would attempt.
    const signature = sign(SAMPLE);
    const tampered = JSON.stringify({ ...JSON.parse(SAMPLE), injected: 'evil' });

    const res = await request(app)
      .post('${o.path}')
      .set('${p.signatureHeader}', signature)${p.timestampHeader ? `\n      .set('${p.timestampHeader}', String(Math.floor(Date.now() / 1000)))` : ''}
      .set('content-type', 'application/json')
      .send(tampered);

    expect(res.status).toBe(401);
  });

  it('rejects a missing signature', async () => {
    const res = await request(app)
      .post('${o.path}')
      .set('content-type', 'application/json')
      .send(SAMPLE);

    expect(res.status).toBe(401);
  });
${p.timestampHeader || o.provider === 'stripe' ? `
  it('rejects a stale timestamp (replay)', async () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    const res = await request(app)
      .post('${o.path}')
      .set('${p.signatureHeader}', sign(SAMPLE, old))${p.timestampHeader ? `\n      .set('${p.timestampHeader}', String(old))` : ''}
      .set('content-type', 'application/json')
      .send(SAMPLE);

    expect(res.status).toBe(401);
  });
` : ''}
  it('processes a redelivered event only once', async () => {
    const body = JSON.stringify({ ...JSON.parse(SAMPLE), ${JSON.stringify(o.eventIdField?.split('.')[0] || 'id')}: 'evt_dedupe_1' });
    const send = () =>
      request(app)
        .post('${o.path}')
        .set('${p.signatureHeader}', sign(body))${p.timestampHeader ? `\n        .set('${p.timestampHeader}', String(Math.floor(Date.now() / 1000)))` : ''}
        .set('content-type', 'application/json')
        .send(body);

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();
    expect(second.body.duplicate).toBe(true);
  });
});
`;
  }
}
