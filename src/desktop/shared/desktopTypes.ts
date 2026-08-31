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
  hardwareFingerprint?: string;
  hardwareMatched?: boolean;
  features: string[];
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
}

export interface OfflinePatchApplyResult {
  success: boolean;
  patchedVersion: string;
  templatesUpdated: number;
  enginesReloaded: string[];
  error?: string;
}
