/**
 * test/runTest.ts — VS Code extension test runner entry point
 *
 * Launches the Extension Development Host and runs the Mocha test suite.
 * Invoked by `npm test`.
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
  });
}

main().catch(err => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
