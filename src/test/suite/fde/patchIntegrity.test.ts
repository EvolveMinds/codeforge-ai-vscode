/**
 * Offline hot patch integrity.
 *
 * These tests exist because the feature previously verified nothing: it ran
 * `tar -xf` on any file it was handed and reported six "reloaded" engines from
 * a hardcoded array, including when the extraction had failed. The assertions
 * below are the guarantees a banking or defence enclave is actually relying on,
 * so each one states the attack or accident it rules out.
 */

import * as assert from 'assert';
import {
  verifyPatch,
  computeManifestDigest,
  isSafeArchivePath,
  sha256Hex,
  describeIntegrity,
  PATCH_MANIFEST_VERSION,
  PatchManifest,
  ExtractedFile
} from '../../../fde/patchIntegrity';

/** Builds a manifest + matching files, as the generator would. */
function buildValidPatch(baseVersion = '2.25.0') {
  const files: ExtractedFile[] = [
    { path: 'templates/sql/rules.json', contents: Buffer.from('{"dialect":"x"}') },
    { path: 'templates/pii/patterns.json', contents: Buffer.from('{"rules":[]}') }
  ];

  const manifest: PatchManifest = {
    manifestVersion: PATCH_MANIFEST_VERSION,
    name: 'Test Patch',
    patchId: 'PATCH-20260922-R1',
    patchVersion: `${baseVersion}-patch-1`,
    baseVersion,
    releasedAt: new Date().toISOString(),
    publisher: 'Evolve Mind Solutions Pty Ltd',
    contact: 'support@evolvemindsolutions.com',
    description: 'test',
    files: files
      .map(f => ({ path: f.path, bytes: f.contents.length, sha256: sha256Hex(f.contents) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    integrity: 'sha256-digest',
    signed: false
  };
  manifest.manifestDigest = computeManifestDigest(manifest);

  return { manifest, files };
}

suite('FDE Suite — Offline Patch Integrity', () => {
  test('a well-formed patch verifies', () => {
    const { manifest, files } = buildValidPatch();
    const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');

    assert.strictEqual(res.ok, true, res.message);
    assert.strictEqual(res.verifiedFiles.length, 2);
  });

  test('a tampered file is rejected', () => {
    // The core promise: someone edits a template inside the archive after it
    // was built. Previously this was extracted without comment.
    const { manifest, files } = buildValidPatch();
    const original = files[0].contents;
    // Same byte length, different content — so this exercises the digest check
    // rather than the cheaper size check that would otherwise catch it first.
    const tampered = Buffer.from(original);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x78 ? 0x79 : 0x78;
    assert.strictEqual(tampered.length, original.length, 'tamper must preserve length');
    files[0] = { path: files[0].path, contents: tampered };

    const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'checksum-mismatch');
  });

  test('a file of the right length but wrong size field is rejected', () => {
    const { manifest, files } = buildValidPatch();
    files[0] = { path: files[0].path, contents: Buffer.from('{"dialect":"much longer content"}') };

    const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'size-mismatch');
  });

  test('rewriting a file AND its recorded hash is still rejected', () => {
    // Without a digest over the manifest itself, an attacker could change a
    // file and simply update the hash next to it. The manifest digest is what
    // closes that hole.
    const { manifest, files } = buildValidPatch();
    const evil = Buffer.from('{"dialect":"EVIL"}');
    files[0] = { path: files[0].path, contents: evil };
    const entry = manifest.files.find(f => f.path === files[0].path)!;
    entry.sha256 = sha256Hex(evil);
    entry.bytes = evil.length;
    // manifestDigest deliberately left at its original value

    const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'manifest-digest-mismatch');
  });

  test('a missing file is rejected rather than partially applied', () => {
    const { manifest, files } = buildValidPatch();
    const res = verifyPatch(JSON.stringify(manifest), [files[0]], '2.25.0');

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'missing-file');
    // Nothing is reported as verified: a half-applied patch on an air-gapped
    // box is worse than one that was refused.
    assert.strictEqual(res.verifiedFiles.length, 0);
  });

  test('a patch for a different app version is rejected', () => {
    const { manifest, files } = buildValidPatch('2.24.0');
    const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'base-version-mismatch');
  });

  test('an archive with no manifest is rejected', () => {
    const { files } = buildValidPatch();
    const res = verifyPatch(null, files, '2.25.0');

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'missing-manifest');
  });

  test('a pre-integrity manifest is refused, not trusted', () => {
    // Archives built before this work carry no file digests. They must be
    // refused rather than waved through for backward compatibility — that would
    // reinstate exactly the hole being closed.
    const legacy = {
      name: 'Evolve AI Enterprise Air-Gapped Hot Patch',
      patchVersion: '2.24.0-patch-1789959796681',
      baseVersion: '2.24.0',
      templatesUpdated: ['templates/sql/x.json'],
      enginesReloaded: ['SqlTranspiler']
    };
    const res = verifyPatch(JSON.stringify(legacy), [], '2.24.0');

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'unsupported-manifest-version');
  });

  test('unparseable manifest is rejected', () => {
    const res = verifyPatch('{not json', [], '2.25.0');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'unreadable-manifest');
  });

  suite('archive path safety', () => {
    test('accepts ordinary nested paths', () => {
      assert.strictEqual(isSafeArchivePath('templates/sql/rules.json'), true);
      assert.strictEqual(isSafeArchivePath('./templates/pii/p.json'), true);
      assert.strictEqual(isSafeArchivePath('manifest.json'), true);
    });

    test('rejects traversal, absolute, drive and UNC paths', () => {
      // `tar -xf` follows these happily, which is why they are checked before
      // anything is written.
      for (const bad of [
        '../outside.json',
        'templates/../../escape.json',
        'a/../../b.json',
        '/etc/passwd',
        'C:/Windows/System32/evil.dll',
        '//server/share/evil.dll',
        ''
      ]) {
        assert.strictEqual(isSafeArchivePath(bad), false, `should reject: ${bad}`);
      }
    });

    test('a manifest listing an unsafe path is rejected', () => {
      const { manifest, files } = buildValidPatch();
      manifest.files[0].path = '../escape.json';
      manifest.manifestDigest = computeManifestDigest(manifest);

      const res = verifyPatch(JSON.stringify(manifest), files, '2.25.0');
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.reason, 'unsafe-path');
    });
  });

  test('integrity is described without claiming a signature', () => {
    const { manifest } = buildValidPatch();
    const note = describeIntegrity(manifest);

    assert.ok(/not digitally signed/i.test(note), note);
    assert.ok(!/\bsigned\b(?!.*not)/i.test(note.replace(/not digitally signed/i, '')), note);
    assert.strictEqual(manifest.signed, false);
  });
});
