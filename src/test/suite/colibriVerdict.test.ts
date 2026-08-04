/**
 * colibriVerdict.test.ts — HardwareInspector.assessColibri()
 *
 * assessColibri() is the honesty gate in front of the Colibri provider: it
 * decides whether a machine can realistically run GLM-5.2 before the user
 * commits to a ~372GB download. These tests pin the tier boundaries so a later
 * refactor can't quietly turn "unusable" into "looks fine".
 */

import * as assert from 'assert';
import { HardwareInspector, COLIBRI_MODEL_DISK_GB, COLIBRI_MIN_RAM_GB } from '../../core/hardwareInspector';
import type { HardwareProfile, GpuInfo } from '../../core/hardwareInspector';

/** Build a HardwareProfile with sane defaults, overriding only what a test cares about. */
function profile(over: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    ramGb:      32,
    cpu:        { model: 'Test CPU', cores: 8, arch: 'x64' },
    gpu:        null,
    diskFreeGb: 1000,
    ollama:     { installed: false, version: null, needsUpdate: false },
    gemma4:     { installed: false, variants: [] },
    platform:   'win32',
    detectedAt: 0,
    ...over,
  };
}

const gpu = (vramGb: number, vendor: GpuInfo['vendor'] = 'nvidia'): GpuInfo =>
  ({ vendor, vramGb, name: `Test ${vendor} ${vramGb}GB` });

suite('HardwareInspector — assessColibri()', () => {
  let inspector: HardwareInspector;

  setup(() => { inspector = new HardwareInspector(); });

  // ── Hard blockers ──────────────────────────────────────────────────────────

  test('blocks when free disk is below the model size', () => {
    const v = inspector.assessColibri(profile({ diskFreeGb: COLIBRI_MODEL_DISK_GB - 1 }));
    assert.strictEqual(v.tier, 'blocked');
    assert.match(v.headline, /disk/i);
    assert.ok(v.suggestions.length > 0, 'a blocked verdict must offer alternatives');
  });

  test('blocks when RAM is below Colibri minimum, even with ample disk', () => {
    const v = inspector.assessColibri(profile({ ramGb: COLIBRI_MIN_RAM_GB - 1, diskFreeGb: 2000 }));
    assert.strictEqual(v.tier, 'blocked');
    assert.match(v.headline, /RAM/i);
  });

  test('disk is checked before RAM — a machine failing both reports the disk blocker', () => {
    const v = inspector.assessColibri(profile({ ramGb: 8, diskFreeGb: 50 }));
    assert.strictEqual(v.tier, 'blocked');
    assert.match(v.headline, /disk/i);
  });

  test('unknown disk (0, detection failed) does not trigger a false disk block', () => {
    const v = inspector.assessColibri(profile({ ramGb: 128, diskFreeGb: 0 }));
    assert.notStrictEqual(v.tier, 'blocked');
  });

  // ── Speed tiers ────────────────────────────────────────────────────────────

  test('bare minimum RAM yields the "crawling" tier, not a pass', () => {
    const v = inspector.assessColibri(profile({ ramGb: COLIBRI_MIN_RAM_GB, diskFreeGb: 1000 }));
    assert.strictEqual(v.tier, 'crawling');
    // The headline must not imply this is a workable setup.
    assert.match(v.headline, /too slowly|unusable/i);
  });

  test('128GB desktop yields "slow" — runs, but minutes per response', () => {
    const v = inspector.assessColibri(profile({ ramGb: 128 }));
    assert.strictEqual(v.tier, 'slow');
  });

  test('a single 24GB GPU reaches "slow" even with modest system RAM', () => {
    const v = inspector.assessColibri(profile({ ramGb: 32, gpu: gpu(24) }));
    assert.strictEqual(v.tier, 'slow');
  });

  test('multi-GPU residency (100GB+ VRAM) yields "comfortable"', () => {
    const v = inspector.assessColibri(profile({ ramGb: 256, gpu: gpu(192) }));
    assert.strictEqual(v.tier, 'comfortable');
    assert.strictEqual(v.suggestions.length, 0, 'a comfortable verdict needs no alternatives');
  });

  test('large unified-memory Apple Silicon yields "comfortable"', () => {
    const v = inspector.assessColibri(profile({ ramGb: 256, gpu: gpu(256, 'apple'), platform: 'darwin' }));
    assert.strictEqual(v.tier, 'comfortable');
  });

  // ── Invariants ─────────────────────────────────────────────────────────────

  test('every non-comfortable verdict offers at least one alternative', () => {
    const machines = [
      profile({ ramGb: COLIBRI_MIN_RAM_GB }),
      profile({ ramGb: 128 }),
      profile({ diskFreeGb: 10 }),
      profile({ ramGb: 4, diskFreeGb: 2000 }),
    ];
    for (const m of machines) {
      const v = inspector.assessColibri(m);
      if (v.tier === 'comfortable') continue;
      assert.ok(v.suggestions.length > 0, `tier "${v.tier}" must suggest an alternative`);
    }
  });

  test('every verdict reports an estimated speed', () => {
    for (const ram of [25, 64, 128, 512]) {
      const v = inspector.assessColibri(profile({ ramGb: ram, diskFreeGb: 1000 }));
      assert.ok(v.estTokensPerSec.length > 0, `no speed estimate for ${ram}GB`);
    }
  });
});
