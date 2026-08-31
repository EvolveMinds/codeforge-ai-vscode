/**
 * Evolve AI Enterprise Desktop Edition — Machine-Encrypted Secret Vault
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class DesktopSecretVault {
  private _vaultFile: string;
  private _encryptionKey: Buffer;

  constructor(customStorageDir?: string) {
    const baseDir = customStorageDir || path.join(os.homedir(), '.evolve');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
    }
    this._vaultFile = path.join(baseDir, 'vault.enc');

    // Derive deterministic AES-256 key from machine entropy
    const machineEntropy = `evolve:vault:${os.platform()}:${os.hostname()}:${os.userInfo().username}`;
    this._encryptionKey = crypto.createHash('sha256').update(machineEntropy).digest();
  }

  public getSecret(key: string): string | null {
    const data = this._readVault();
    return data[key] || null;
  }

  public setSecret(key: string, value: string): void {
    const data = this._readVault();
    data[key] = value;
    this._writeVault(data);
  }

  public listKeys(): string[] {
    const data = this._readVault();
    return Object.keys(data);
  }

  public deleteSecret(key: string): boolean {
    const data = this._readVault();
    if (key in data) {
      delete data[key];
      this._writeVault(data);
      return true;
    }
    return false;
  }

  private _readVault(): Record<string, string> {
    try {
      if (!fs.existsSync(this._vaultFile)) return {};
      const raw = fs.readFileSync(this._vaultFile);
      if (raw.length < 28) return {}; // 12-byte IV + 16-byte Auth Tag

      const iv = raw.subarray(0, 12);
      const authTag = raw.subarray(12, 28);
      const encrypted = raw.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this._encryptionKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch {
      return {};
    }
  }

  private _writeVault(data: Record<string, string>): void {
    try {
      const plainText = JSON.stringify(data);
      const iv = crypto.randomBytes(12);

      const cipher = crypto.createCipheriv('aes-256-gcm', this._encryptionKey, iv);
      let encrypted = cipher.update(plainText, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      const combined = Buffer.concat([iv, authTag, encrypted]);
      fs.writeFileSync(this._vaultFile, combined);
    } catch {}
  }
}
