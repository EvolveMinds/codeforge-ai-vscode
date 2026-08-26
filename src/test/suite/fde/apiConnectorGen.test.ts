import * as assert from 'assert';
import { ApiConnectorGenerator, ApiConnectorOptions } from '../../../fde/apiConnectorGen';

suite('FDE Suite — ApiConnectorGenerator', () => {
  const options: ApiConnectorOptions = {
    connectorName: 'BillingApi',
    baseUrl: 'https://api.client-billing.internal/v1',
    authType: 'bearer',
    targetLanguage: 'typescript',
    maxRetries: 3,
    endpoints: [
      { name: 'getInvoices', method: 'GET', path: '/invoices', description: 'Fetch all invoices' },
      { name: 'createInvoice', method: 'POST', path: '/invoices', description: 'Create new invoice' },
    ],
  };

  test('generates robust TypeScript client SDK with retry & rate limiting handling', () => {
    const code = ApiConnectorGenerator.generateTypeScriptSdk(options);

    assert.ok(code.includes('export class BillingApiClient'));
    assert.ok(code.includes('Authorization'));
    assert.ok(code.includes('retry-after'));
    assert.ok(code.includes('async getInvoices'));
    assert.ok(code.includes('async createInvoice'));
  });

  test('generates robust Python client SDK with retry handling', () => {
    const pyOptions: ApiConnectorOptions = { ...options, targetLanguage: 'python' };
    const code = ApiConnectorGenerator.generatePythonSdk(pyOptions);

    assert.ok(code.includes('class BillingApiClient:'));
    assert.ok(code.includes('Authorization'));
    assert.ok(code.includes('requests.Session()'));
    assert.ok(code.includes('def getinvoices'));
    assert.ok(code.includes('def createinvoice'));
  });

  test('parses cURL command and extracts baseUrl, headers, authType and endpoint', () => {
    const curl = `curl -X POST https://api.client-vpc.internal/v1/payments -H 'Authorization: Bearer sk_live_test123' -H 'Content-Type: application/json' -d '{"amount": 500}'`;
    const parsed = ApiConnectorGenerator.parseCurlCommand(curl);

    assert.strictEqual(parsed.baseUrl, 'https://api.client-vpc.internal');
    assert.strictEqual(parsed.authType, 'bearer');
    assert.ok(parsed.endpoints);
    assert.strictEqual(parsed.endpoints.length, 1);
    assert.strictEqual(parsed.endpoints[0].method, 'POST');
    assert.strictEqual(parsed.endpoints[0].path, '/v1/payments');
  });

  test('parses OpenAPI JSON spec and extracts title, endpoints and security schemes', () => {
    const openApiJson = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'AcmeBillingService', version: '1.0.0' },
      servers: [{ url: 'https://api.acme.corp/v2' }],
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
      paths: {
        '/subscriptions': {
          get: { summary: 'List subscriptions' },
          post: { summary: 'Create subscription' },
        },
      },
    });

    const parsed = ApiConnectorGenerator.parseOpenApiSpec(openApiJson);

    assert.strictEqual(parsed.connectorName, 'AcmeBillingServiceApi');
    assert.strictEqual(parsed.baseUrl, 'https://api.acme.corp/v2');
    assert.strictEqual(parsed.authType, 'apiKey');
    assert.ok(parsed.endpoints);
    assert.strictEqual(parsed.endpoints.length, 2);
    assert.strictEqual(parsed.endpoints[0].path, '/subscriptions');
  });
});
