/**
 * test/suite/enterprise/loadTest.test.ts
 *
 * Unit tests for LoadTestGenerator (k6 & Locust test generation).
 * Evolve Mind Solutions Pty Ltd.
 */

import * as assert from 'assert';
import { LoadTestGenerator } from '../../../enterprise/loadTesting/loadTestGenerator';
import { LoadTestOptions } from '../../../enterprise/loadTesting/loadTestTypes';

suite('Enterprise Suite — Load & Stress Test Generator', () => {

  test('generates robust k6 performance test script with strict SLA thresholds', () => {
    const opts: LoadTestOptions = {
      serviceName: 'PaymentsApi',
      targetUrl: 'https://api.payments.internal/v1/charge',
      method: 'POST',
      authType: 'bearer',
      sla: {
        p95LatencyMs: 120,
        p99LatencyMs: 250,
        maxErrorRatePercent: 0.5,
      },
      requestBody: { amount: 100, currency: 'USD', customerId: 'cust_123' },
      rampPreset: 'standard',
    };

    const suite = LoadTestGenerator.generateSuite(opts);

    assert.ok(suite.k6Script.includes("import http from 'k6/http';"));
    assert.ok(suite.k6Script.includes("'p(95)<120'"));
    assert.ok(suite.k6Script.includes("'p(99)<250'"));
    assert.ok(suite.k6Script.includes("'Authorization': `Bearer ${__ENV.API_TOKEN"));
    assert.ok(suite.k6FilePath.includes('k6_paymentsapi.js'));
  });

  test('generates robust Locust Python load testing script', () => {
    const opts: LoadTestOptions = {
      serviceName: 'InvoicingService',
      targetUrl: '/v1/invoices',
      method: 'GET',
      sla: {
        p95LatencyMs: 200,
        p99LatencyMs: 400,
        maxErrorRatePercent: 1.0,
      },
    };

    const suite = LoadTestGenerator.generateSuite(opts);

    assert.ok(suite.locustScript.includes('class InvoicingServiceLoadTestUser(HttpUser):'));
    assert.ok(suite.locustScript.includes('wait_time = between(0.1, 0.5)'));
    assert.ok(suite.locustScript.includes('SLA Violation: Latency > 200ms'));
    assert.ok(suite.locustFilePath.includes('locustfile.py'));
  });

  test('generates valid shell and powershell execution runners', () => {
    const opts: LoadTestOptions = {
      serviceName: 'AuthService',
      targetUrl: 'https://auth.internal',
    };

    const suite = LoadTestGenerator.generateSuite(opts);

    assert.ok(suite.shellRunner.includes('k6 run tests/load/k6_authservice.js'));
    assert.ok(suite.psRunner.includes('k6 run "tests/load/k6_authservice.js"'));
  });
});
