/**
 * test/suite/offline/cronRegexWorkbench.test.ts — Unit tests for Cron & Regex workbench engine
 */

import * as assert from 'assert';
import { CronRegexWorkbench } from '../../../offline/cronRegexWorkbench';

suite('Offline Cron & Regex Workbench Suite', () => {
  test('evaluates standard 5-field cron expression with human description and next runs', () => {
    const cron = '*/15 4 * * 1-5';
    const evalRes = CronRegexWorkbench.evaluateCron(cron, new Date('2026-08-25T00:00:00Z'));

    assert.strictEqual(evalRes.isValid, true);
    assert.ok(evalRes.humanDescription.includes('Every 15 minutes'));
    assert.ok(evalRes.humanDescription.includes('Monday through Friday'));
    assert.strictEqual(evalRes.nextRuns.length, 10);
    assert.strictEqual(evalRes.previousRuns.length, 5);
  });

  test('evaluates Airflow presets such as @daily and @hourly', () => {
    const dailyRes = CronRegexWorkbench.evaluateCron('@daily', new Date('2026-08-25T00:00:00Z'));
    assert.strictEqual(dailyRes.isValid, true);
    assert.ok(dailyRes.nextRuns.length > 0);

    const hourlyRes = CronRegexWorkbench.evaluateCron('@hourly', new Date('2026-08-25T00:00:00Z'));
    assert.strictEqual(hourlyRes.isValid, true);
    assert.ok(hourlyRes.humanDescription.includes('Every hour'));
  });

  test('handles invalid cron expressions gracefully', () => {
    const invalid = CronRegexWorkbench.evaluateCron('invalid * *');
    assert.strictEqual(invalid.isValid, false);
    assert.ok(invalid.error);
  });

  test('evaluates regular expressions with capture groups and flags', () => {
    const pattern = '(\\w+)@([a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})';
    const text = 'Contact support@evolve.ai or admin@company.org for assistance.';
    const regexRes = CronRegexWorkbench.evaluateRegex(pattern, 'g', text);

    assert.strictEqual(regexRes.isValid, true);
    assert.strictEqual(regexRes.totalMatches, 2);
    assert.strictEqual(regexRes.matches[0].match, 'support@evolve.ai');
    assert.deepStrictEqual(regexRes.matches[0].groups, ['support', 'evolve.ai']);
    assert.strictEqual(regexRes.matches[1].match, 'admin@company.org');
  });

  test('handles invalid regular expression syntax gracefully', () => {
    const invalid = CronRegexWorkbench.evaluateRegex('[a-z(', 'g', 'test');
    assert.strictEqual(invalid.isValid, false);
    assert.ok(invalid.error);
  });
});
