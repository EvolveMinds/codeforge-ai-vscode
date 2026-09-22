/**
 * Evolve AI Enterprise Desktop Edition — Single Source of Truth for the App Version
 *
 * The version is read from the packaged package.json at runtime and never written
 * as a literal anywhere else. A hardcoded version ships as whatever it was last
 * hand-edited to, so a new build reports the old number to every user — which is
 * exactly the bug this module exists to prevent. Releases bump package.json only.
 *
 * `scripts/check-version-literals.js` enforces that; see docs/PACKAGING.md.
 */

import * as fs from 'fs';
import * as path from 'path';

let _cached: string | null = null;

/**
 * Candidate package.json locations, covering development (out/desktop/... -> repo
 * root) and the packaged layouts electron-builder produces.
 */
function _candidatePaths(): string[] {
  const resources = process.resourcesPath || '';
  return [
    path.join(__dirname, '..', '..', '..', 'package.json'),
    path.join(__dirname, '..', '..', '..', '..', 'package.json'),
    resources ? path.join(resources, 'app.asar', 'package.json') : '',
    resources ? path.join(resources, 'app', 'package.json') : ''
  ].filter(Boolean);
}

/**
 * The running application version, e.g. "2.24.0". Returns '0.0.0' only if every
 * lookup fails — a deliberately obvious sentinel rather than a plausible-looking
 * stale version that would hide the failure.
 */
export function getAppVersion(): string {
  if (_cached) return _cached;
  for (const file of _candidatePaths()) {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')).version;
      if (v && typeof v === 'string') {
        _cached = v;
        return _cached;
      }
    } catch { /* try the next layout */ }
  }
  _cached = '0.0.0';
  return _cached;
}

/** The version prefixed with "v", e.g. "v2.24.0". */
export function getAppVersionTag(): string {
  return `v${getAppVersion()}`;
}

/** Overrides the resolved version. For tests only. */
export function _setAppVersionForTests(version: string | null): void {
  _cached = version;
}
