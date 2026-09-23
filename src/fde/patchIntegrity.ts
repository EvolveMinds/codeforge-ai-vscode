/**
 * src/fde/patchIntegrity.ts
 *
 * Integrity rules for the air-gapped offline hot patch archive.
 *
 * The patch feature is aimed at banking, defence and high-assurance enclaves —
 * the customers least able to tolerate an unverified archive being extracted
 * over their installation. Before this module the archive carried no checksum
 * and no signature, and the applier ran `tar -xf` on whatever it was handed
 * while reporting engines it had not reloaded.
 *
 * Two boundaries this module exists to hold:
 *
 *  1. **A digest is not a signature.** A SHA-256 makes tampering *detectable*
 *     by someone who already trusts the digest's source. It does not prove who
 *     built the archive. There is no keypair in the product, so nothing here
 *     claims to be signed — the same distinction drawn for audit receipts in
 *     v2.25.0.
 *
 *  2. **Archive entries are untrusted input.** A patch is a file a customer was
 *     given, possibly over an air-gapped sneakernet. Entry paths are validated
 *     before anything is written, because `tar -xf` will happily follow `../`
 *     out of the target directory.
 */

import * as crypto from 'crypto';
import * as path from 'path';

/** Manifest schema version. Bump when the emitted shape changes. */
export const PATCH_MANIFEST_VERSION = 2;

export interface PatchFileEntry {
  /** Archive-relative path, forward slashes, e.g. "templates/sql/rules.json". */
  path: string;
  /** Byte length of the file as built. */
  bytes: number;
  /** Lowercase hex SHA-256 of the file contents. */
  sha256: string;
}

export interface PatchManifest {
  manifestVersion: number;
  name: string;
  patchId: string;
  patchVersion: string;
  /** App version this patch was built against. */
  baseVersion: string;
  releasedAt: string;
  publisher: string;
  contact: string;
  description: string;
  /** Every file in the archive except the manifest itself. */
  files: PatchFileEntry[];
  /**
   * SHA-256 over the canonical serialisation of this manifest with
   * `manifestDigest` removed. Detects tampering with the file list itself —
   * without it, an attacker could rewrite both a file and its recorded hash.
   */
  manifestDigest?: string;
  /**
   * Stated plainly so no caller can read more into it than is true. There is no
   * keypair in the product; this archive is tamper-evident, not signed.
   */
  integrity: 'sha256-digest';
  signed: false;
}

export const sha256Hex = (data: Buffer | string): string =>
  crypto.createHash('sha256').update(data).digest('hex');

/**
 * Canonical JSON for digesting: keys sorted, no insignificant whitespace, and
 * `manifestDigest` omitted. Both the builder and the verifier must produce byte
 * -identical output for the same logical manifest, so key order cannot be left
 * to object-literal ordering.
 */
export function canonicalManifestJson(manifest: PatchManifest): string {
  const { manifestDigest: _omit, ...rest } = manifest;
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortValue((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortValue(rest));
}

export function computeManifestDigest(manifest: PatchManifest): string {
  return sha256Hex(canonicalManifestJson(manifest));
}

/* ------------------------------------------------------------------ *
 * Path safety
 * ------------------------------------------------------------------ */

/**
 * Whether an archive entry may be written under the extraction root.
 *
 * Rejects absolute paths, drive letters, UNC paths, and any traversal that
 * escapes the root. Checked against the *resolved* path rather than by string
 * matching on "..", because `a/../../b` normalises out of the root without
 * containing a leading "..".
 */
export function isSafeArchivePath(entryPath: string, root = '/patch-root'): boolean {
  if (!entryPath || typeof entryPath !== 'string') return false;
  const normalised = entryPath.replace(/\\/g, '/').replace(/^\.\//, '');

  if (normalised.startsWith('/')) return false;              // absolute
  if (/^[A-Za-z]:/.test(normalised)) return false;           // drive letter
  if (normalised.startsWith('//')) return false;             // UNC
  if (normalised.split('/').some(seg => seg === '..')) return false;
  if (normalised.includes('\0')) return false;

  const resolved = path.posix.resolve(root, normalised);
  return resolved === root || resolved.startsWith(root + '/');
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

export type PatchRejectionReason =
  | 'missing-manifest'
  | 'unreadable-manifest'
  | 'unsupported-manifest-version'
  | 'manifest-digest-mismatch'
  | 'unsafe-path'
  | 'missing-file'
  | 'checksum-mismatch'
  | 'size-mismatch'
  | 'base-version-mismatch';

export interface PatchVerificationResult {
  ok: boolean;
  reason?: PatchRejectionReason;
  /** Human-readable explanation, safe to show in the UI. */
  message?: string;
  /** Files whose digest matched, in manifest order. */
  verifiedFiles: string[];
  manifest?: PatchManifest;
}

/** A file as read from the extracted archive, for verification. */
export interface ExtractedFile {
  path: string;
  contents: Buffer;
}

/**
 * Verifies an extracted patch against its manifest.
 *
 * Deliberately fails closed: any missing file, wrong digest, unsafe path or
 * manifest mismatch rejects the whole patch rather than applying the part that
 * happened to verify. A half-applied patch on an air-gapped box is worse than
 * one that was refused.
 *
 * `currentVersion` is compared against `baseVersion` only when supplied, so a
 * caller can verify an archive it is not about to install.
 */
export function verifyPatch(
  manifestRaw: string | null,
  files: ExtractedFile[],
  currentVersion?: string
): PatchVerificationResult {
  const fail = (reason: PatchRejectionReason, message: string): PatchVerificationResult =>
    ({ ok: false, reason, message, verifiedFiles: [] });

  if (manifestRaw === null || manifestRaw === undefined) {
    return fail('missing-manifest', 'The archive has no manifest.json, so nothing about it can be verified.');
  }

  let manifest: PatchManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    return fail('unreadable-manifest', 'The archive manifest is not valid JSON.');
  }

  if (manifest.manifestVersion !== PATCH_MANIFEST_VERSION) {
    return fail(
      'unsupported-manifest-version',
      `Unsupported patch manifest version ${manifest.manifestVersion ?? '(none)'} — this build expects ${PATCH_MANIFEST_VERSION}. ` +
      'Patches built before integrity checking was added cannot be verified and are refused.'
    );
  }

  const expectedDigest = manifest.manifestDigest;
  if (!expectedDigest || expectedDigest !== computeManifestDigest(manifest)) {
    return fail(
      'manifest-digest-mismatch',
      'The manifest digest does not match its contents — the file list has been altered since the patch was built.'
    );
  }

  if (currentVersion && manifest.baseVersion && manifest.baseVersion !== currentVersion) {
    return fail(
      'base-version-mismatch',
      `This patch targets version ${manifest.baseVersion} but this installation is ${currentVersion}.`
    );
  }

  const byPath = new Map(files.map(f => [f.path.replace(/\\/g, '/').replace(/^\.\//, ''), f]));
  const verified: string[] = [];

  for (const entry of manifest.files || []) {
    if (!isSafeArchivePath(entry.path)) {
      return fail('unsafe-path', `Refused: archive entry "${entry.path}" would write outside the patch directory.`);
    }
    const found = byPath.get(entry.path);
    if (!found) {
      return fail('missing-file', `The archive is missing "${entry.path}", which its manifest lists.`);
    }
    if (found.contents.length !== entry.bytes) {
      return fail(
        'size-mismatch',
        `"${entry.path}" is ${found.contents.length} bytes but the manifest records ${entry.bytes}.`
      );
    }
    if (sha256Hex(found.contents) !== entry.sha256) {
      return fail('checksum-mismatch', `"${entry.path}" does not match its recorded SHA-256 — the file has been modified.`);
    }
    verified.push(entry.path);
  }

  return { ok: true, verifiedFiles: verified, manifest };
}

/**
 * One line describing what the archive's integrity actually proves. Used in the
 * UI and in logs so the guarantee is never overstated.
 */
export function describeIntegrity(manifest?: PatchManifest): string {
  if (!manifest) return 'Not verified.';
  return `SHA-256 verified across ${manifest.files?.length ?? 0} file(s) — tamper-evident, not digitally signed.`;
}
