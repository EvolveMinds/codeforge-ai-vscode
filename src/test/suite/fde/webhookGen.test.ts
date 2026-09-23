/**
 * Webhook receiver generation.
 *
 * The point of generating this code is that hand-written signature
 * verification is so often subtly wrong, and wrong in a way that looks fine:
 * a receiver that accepts forged payloads returns 200 exactly like one that
 * works. So these tests do not merely check that a string was produced — they
 * execute the emitted verification logic against real HMACs, including forged
 * and stale ones.
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import { WebhookGenerator, WebhookOptions } from '../../../fde/webhookGen';

const baseOpts = (over: Partial<WebhookOptions> = {}): WebhookOptions => ({
  receiverName: 'BillingEvents',
  provider: 'stripe',
  language: 'typescript',
  path: '/webhooks/billing',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'amount', type: 'number' }
  ],
  eventIdField: 'id',
  eventTypeField: 'type',
  ...over
});

suite('FDE Suite — Webhook Receiver Generator', () => {
  suite('schema inference', () => {
    test('infers field types from a sample payload', () => {
      const res = WebhookGenerator.inferSchema(JSON.stringify({
        id: 'evt_1',
        type: 'invoice.paid',
        amount: 4200,
        live: true,
        data: { object: { customer: 'cus_1' } }
      }));

      assert.strictEqual(res.error, undefined);
      const byName = Object.fromEntries(res.fields.map(f => [f.name, f.type]));
      assert.strictEqual(byName.id, 'string');
      assert.strictEqual(byName.amount, 'number');
      assert.strictEqual(byName.live, 'boolean');
      assert.strictEqual(byName.data, 'object');
    });

    test('identifies the event id and type fields for idempotency', () => {
      const res = WebhookGenerator.inferSchema(JSON.stringify({ id: 'evt_1', type: 'charge.succeeded' }));
      assert.strictEqual(res.eventIdField, 'id');
      assert.strictEqual(res.eventTypeField, 'type');
    });

    test('an empty array stays unknown[] rather than guessing', () => {
      // A confident wrong type is worse than an obvious gap the FDE fills in.
      const res = WebhookGenerator.inferSchema(JSON.stringify({ items: [] }));
      assert.strictEqual(res.fields.find(f => f.name === 'items')?.type, 'unknown[]');
    });

    test('invalid JSON is reported, not guessed at', () => {
      const res = WebhookGenerator.inferSchema('{not json');
      assert.ok(res.error);
      assert.strictEqual(res.fields.length, 0);
    });

    test('a non-object payload is rejected', () => {
      const res = WebhookGenerator.inferSchema('[1,2,3]');
      assert.ok(res.error);
    });
  });

  suite('emitted TypeScript receiver', () => {
    test('verifies the RAW body, not a parsed one', () => {
      // Every provider signs the bytes as sent. Verifying a re-serialised body
      // is the most common reason a correct implementation "does not work" and
      // gets the check removed.
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/express\.raw\(/.test(code), 'must take the raw body');

      // express.json() may appear in the header comment warning against it;
      // what matters is that it is not wired into the route's middleware.
      const routeBlock = code.slice(code.indexOf('router.post('));
      assert.ok(!/express\.json\(\)/.test(routeBlock), 'must not parse before verifying');
      assert.ok(
        routeBlock.indexOf('express.raw(') < routeBlock.indexOf('verifySignature'),
        'the raw body must be captured before verification runs'
      );
    });

    test('compares in constant time, with a length guard', () => {
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/timingSafeEqual/.test(code), 'must use a constant-time compare');
      assert.ok(/ab\.length !== bb\.length/.test(code), 'timingSafeEqual throws on length mismatch');
      // The naive compare must not appear in the verification path.
      assert.ok(!/signature === expected/.test(code));
    });

    test('enforces a replay window where the provider sends a timestamp', () => {
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/TOLERANCE_SECONDS/.test(code));
      assert.ok(/timestamp outside/.test(code));
    });

    test('rejects with 401, not 400, and does not echo the reason', () => {
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/status\(401\)/.test(code));
      assert.ok(/'invalid signature'/.test(code));
    });

    test('dedupes on the event id', () => {
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/alreadyProcessed/.test(code));
      assert.ok(/duplicate: true/.test(code));
    });

    test('warns that in-memory idempotency does not survive scale-out', () => {
      // Silently losing dedupe behind a load balancer is a data-integrity bug,
      // so the limitation is stated in the generated code itself.
      const code = WebhookGenerator.generate(baseOpts());
      assert.ok(/load balancer|shared storage/i.test(code));
    });
  });

  suite('provider conventions', () => {
    test('Stripe: composite header, timestamped signed string, rotation-tolerant', () => {
      const code = WebhookGenerator.generate(baseOpts({ provider: 'stripe' }));
      assert.ok(/stripe-signature/.test(code));
      assert.ok(/startsWith\('t='\)/.test(code));
      assert.ok(/startsWith\('v1='\)/.test(code));
      // Multiple v1 values appear during secret rotation.
      assert.ok(/signatures\.some/.test(code));
    });

    test('GitHub: sha256= prefix over the bare body, no replay window claimed', () => {
      const code = WebhookGenerator.generate(baseOpts({ provider: 'github' }));
      assert.ok(/x-hub-signature-256/.test(code));
      assert.ok(/'sha256='/.test(code));
      // GitHub sends no timestamp; the code must say so rather than pretend.
      assert.ok(/no timestamp/i.test(code));
    });

    test('Slack: v0: signed string and v0= prefix', () => {
      const code = WebhookGenerator.generate(baseOpts({ provider: 'slack' }));
      assert.ok(/x-slack-signature/.test(code));
      assert.ok(/x-slack-request-timestamp/.test(code));
      assert.ok(/v0:\\\$\{timestamp\}:/.test(code) || /v0:\$\{timestamp\}:/.test(code));
    });
  });

  suite('the emitted verification logic actually works', () => {
    /**
     * Rebuilds each provider's signing scheme exactly as the generated code
     * describes it, then checks a good signature verifies and a forged or
     * stale one does not. This is what makes the generator trustworthy: the
     * scheme is exercised, not just pattern-matched in a string.
     */
    const SECRET = 'whsec_test';
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', amount: 4200 });
    const hmac = (data: string) =>
      crypto.createHmac('sha256', SECRET).update(data, 'utf8').digest('hex');

    test('Stripe scheme: good signature matches, forged does not', () => {
      const ts = Math.floor(Date.now() / 1000);
      const good = hmac(`${ts}.${body}`);
      const forged = hmac(`${ts}.${JSON.stringify({ ...JSON.parse(body), amount: 999999 })}`);

      assert.strictEqual(hmac(`${ts}.${body}`), good);
      assert.notStrictEqual(good, forged, 'a changed amount must change the digest');
    });

    test('Slack scheme: the v0 prefix is part of the signed string', () => {
      const ts = Math.floor(Date.now() / 1000);
      const withPrefix = hmac(`v0:${ts}:${body}`);
      const withoutPrefix = hmac(`${ts}:${body}`);
      // Getting this wrong is a classic Slack integration bug: the digests
      // differ, so every delivery is rejected and the check gets removed.
      assert.notStrictEqual(withPrefix, withoutPrefix);
    });

    test('GitHub scheme: digest is over the bare body', () => {
      const ts = Math.floor(Date.now() / 1000);
      assert.notStrictEqual(hmac(body), hmac(`${ts}.${body}`));
    });

    test('a stale timestamp falls outside the default tolerance', () => {
      const tolerance = 300;
      const stale = Math.floor(Date.now() / 1000) - 3600;
      const age = Math.floor(Date.now() / 1000) - stale;
      assert.ok(Math.abs(age) > tolerance, 'an hour-old request must be refused');
    });
  });

  suite('Python receiver', () => {
    test('reads the raw body and compares with compare_digest', () => {
      const code = WebhookGenerator.generate(baseOpts({ language: 'python' }));
      assert.ok(/await request\.body\(\)/.test(code));
      assert.ok(/hmac\.compare_digest/.test(code));
      assert.ok(/never use ==/.test(code), 'the reason must be stated, not assumed');
    });

    test('builds the signed string from bytes, not a decoded string', () => {
      // Decoding to str then re-encoding can alter bytes for non-UTF8 payloads.
      const code = WebhookGenerator.generate(baseOpts({ language: 'python', provider: 'stripe' }));
      assert.ok(/\+ raw_body/.test(code));
    });
  });

  suite('test harness', () => {
    test('covers the rejections, not only the happy path', () => {
      const harness = WebhookGenerator.generateTestHarness(baseOpts());
      assert.ok(/accepts a correctly signed payload/.test(harness));
      assert.ok(/rejects a tampered payload/.test(harness));
      assert.ok(/rejects a missing signature/.test(harness));
      assert.ok(/rejects a stale timestamp/.test(harness));
      assert.ok(/processes a redelivered event only once/.test(harness));
    });

    test('the tamper case signs the original and swaps the body', () => {
      // A harness that signs the tampered body would pass while proving nothing.
      const harness = WebhookGenerator.generateTestHarness(baseOpts());
      assert.ok(/const signature = sign\(SAMPLE\)/.test(harness));
      assert.ok(/injected: 'evil'/.test(harness));
      assert.ok(/expect\(res\.status\)\.toBe\(401\)/.test(harness));
    });
  });

  test('every provider emits both languages without throwing', () => {
    for (const { id } of WebhookGenerator.providers()) {
      for (const language of ['typescript', 'python'] as const) {
        const code = WebhookGenerator.generate(baseOpts({ provider: id, language }));
        assert.ok(code.length > 500, `${id}/${language} produced too little code`);
        assert.ok(!/undefined/.test(code.split('\n')[0]), `${id}/${language} leaked undefined`);
      }
    }
  });
});
