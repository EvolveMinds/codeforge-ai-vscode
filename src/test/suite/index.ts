/**
 * test/suite/index.ts — Mocha test suite bootstrap
 *
 * Discovers and runs all *.test.js files in this directory.
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 10_000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob('**/**.test.js', { cwd: testsRoot })
      .then(files => {
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} test(s) failed.`));
          } else {
            resolve();
          }
        });
      })
      .catch(reject);
  });
}
