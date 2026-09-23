/**
 * Evolve AI Enterprise Desktop Edition — Shared Type Definitions
 */

import { LicensePlan } from '../../enterprise/license/licenseTypes';

export interface WorkspaceInfo {
  path: string;
  name: string;
  isGitRepo: boolean;
  activeBranch?: string;
  lastOpened: string;
  clientName?: string;
  targetVpc?: string;
}

export interface FileNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  children?: FileNode[];
  status?: 'modified' | 'untracked' | 'deleted' | 'clean';
}

export interface FileOpenResult {
  path: string;
  relativePath: string;
  content: string;
  size: number;
  readOnly: boolean;
  language: string;
  isBinary?: boolean;
  isTruncated?: boolean;
  error?: string;
}

export interface FileSaveResult {
  success: boolean;
  path: string;
  bytesWritten: number;
  error?: string;
}

export interface TerminalSpawnOptions {
  id?: string;
  name?: string;
  cwd?: string;
  shell?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface TerminalSessionInfo {
  id: string;
  name: string;
  shell: string;
  pid: number;
  cwd: string;
  active: boolean;
  createdAt: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number;
}

export interface RegisteredUserProfile {
  userId: string;
  userDisplayName: string;
  email: string;
  organization: string;
  role: string;
  engagementId?: string;
  lastLogin: string;
}

export interface EnterpriseLicenseState {
  isLicensed: boolean;
  plan: LicensePlan | 'enterprise_pro' | 'enterprise_sovereign_airgap' | 'fde_partner';
  organization: string;
  userEmail?: string;
  licenseId: string;
  expiresAt: string;
  daysRemaining: number;
  seats: number;
  maxSeats?: number;
  licenseScope?: 'seat' | 'site';
  hardwareFingerprint?: string;
  hardwareMatched?: boolean;
  features: string[];
  claimantEmail?: string;
  seatId?: string;
  seatNumber?: number;
}

export interface HardwareFingerprintInfo {
  machineFingerprint: string;
  hostname: string;
  platform: string;
  arch: string;
  cpus: string;
  macAddressSample: string;
}

export interface ActivationChallengeRequest {
  challengeId: string;
  userId: string;
  organization: string;
  machineFingerprint: string;
  requestedAt: string;
  appVersion: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  releaseDate?: string;
  downloadUrl?: string;
  checksumSha512?: string;
  isAirGapped?: boolean;
  networkStatus?: 'online' | 'offline' | 'blocked';
  statusMessage?: string;
}

export interface OfflinePatchApplyResult {
  success: boolean;
  patchedVersion: string;
  /** Count of files actually written to disk — not a projection from the manifest. */
  templatesUpdated: number;
  /**
   * Engines whose templates this patch replaced. Derived from the files that
   * were written; previously this was a hardcoded list returned unconditionally,
   * including when the extraction had failed.
   */
  enginesReloaded: string[];
  error?: string;
  /** Why the patch was refused, when it was. */
  rejectionReason?: string;
  /** Archive-relative paths whose SHA-256 matched the manifest. */
  verifiedFiles?: string[];
  /** Plain statement of what the integrity check proves — never "signed". */
  integrityNote?: string;
  /**
   * True when the new templates are live in the running process. The engines
   * read their templates from disk on next use rather than holding them in
   * memory, so this says whether a restart is needed rather than asserting a
   * hot reload that did not happen.
   */
  appliesWithoutRestart?: boolean;
}
