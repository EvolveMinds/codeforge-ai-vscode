/**
 * test/suite/reportDesign.test.ts — Unit tests for report design & python script sanitization
 */

import * as assert from 'assert';
import { sanitizePythonFStrings } from '../../core/reportDesign';

suite('ReportDesign — Python f-string sanitizer', () => {
  test('extracts expressions containing backslashes from f-strings', () => {
    const input = '    summary = f"The dataset contains {evolve_num(len(df))} apps and {evolve_num(df[\'Installs\'].str.replace(r\'[^\\d]\', \'\', regex=True).astype(int).sum())} installs."';
    const output = sanitizePythonFStrings(input);

    assert.ok(output.includes('_evolve_calc_1 = evolve_num(df[\'Installs\'].str.replace(r\'[^\\d]\', \'\', regex=True).astype(int).sum())'));
    assert.ok(output.includes('and {_evolve_calc_1} installs.'));
    assert.ok(!output.includes('{evolve_num(df[\'Installs\'].str.replace'));
  });

  test('leaves f-strings without backslashes untouched', () => {
    const input = '    text = f"Total count: {len(df)} in {category}"';
    const output = sanitizePythonFStrings(input);
    assert.strictEqual(output, input);
  });
});
