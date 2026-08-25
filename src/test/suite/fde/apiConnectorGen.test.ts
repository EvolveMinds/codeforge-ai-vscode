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
});
