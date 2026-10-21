// FACEIT and Steam API keys, encrypted on this PC with the OS keychain (Electron safeStorage).
// Keys never go back to the renderer and never reach the room: callers only learn whether one is set.
// Pure Node: the encryptor is injected, so tests use a fake.

import fs from 'node:fs';
import path from 'node:path';

export type KeyService = 'faceit' | 'steam';
export const KEY_SERVICES: readonly KeyService[] = ['faceit', 'steam'];

export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const FILE = 'secrets.json';
/** FACEIT keys are UUIDs, Steam keys 32 hex chars; accept anything key-shaped. */
const KEY_RE = /^[A-Za-z0-9-]{16,128}$/;

export class Secrets {
  private readonly file: string;
  private readonly enc: Encryptor;
  private data: Partial<Record<KeyService, string>> = {};

  constructor(dir: string, enc: Encryptor) {
    this.file = path.join(dir, FILE);
    this.enc = enc;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      for (const s of KEY_SERVICES) if (typeof raw[s] === 'string') this.data[s] = raw[s] as string;
    } catch { /* no keys yet, or an unreadable file: start empty */ }
  }

  has(service: KeyService): boolean { return this.get(service) !== undefined; }

  /** Decrypted key, or undefined (none saved, or saved on another PC/user so it can't be decrypted). */
  get(service: KeyService): string | undefined {
    const b64 = this.data[service];
    if (!b64) return undefined;
    try {
      const key = this.enc.decryptString(Buffer.from(b64, 'base64'));
      return KEY_RE.test(key) ? key : undefined;
    } catch {
      return undefined;
    }
  }

  /** Save (or clear with null). Refuses to store anything unencrypted. */
  set(service: KeyService, key: string | null): { ok: boolean; error?: string } {
    if (!KEY_SERVICES.includes(service)) return { ok: false, error: 'Unknown service.' };
    if (key === null) {
      delete this.data[service];
      this.write();
      return { ok: true };
    }
    const k = key.trim();
    if (!KEY_RE.test(k)) return { ok: false, error: "That doesn't look like an API key (letters, digits and dashes only)." };
    if (!this.enc.isEncryptionAvailable()) {
      return { ok: false, error: "This PC can't encrypt the key (Windows protection isn't available), so csbot won't store it." };
    }
    this.data[service] = this.enc.encryptString(k).toString('base64');
    this.write();
    return { ok: true };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ v: 1, ...this.data }, null, 2) + '\n', { mode: 0o600 });
  }
}
