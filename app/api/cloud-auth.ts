import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const dataDir = path.join(os.tmpdir(), 'jj-website-data');
export const dbPath = path.join(dataDir, 'jj-accounting.sqlite');
export const metaPath = path.join(dataDir, 'sync-meta.json');

export type SyncMeta = {
  uploadedAt?: string;
  companyName?: string;
  fileName?: string;
  passwordSalt?: string;
  passwordHash?: string;
};

export function bearerToken(header: string | null) {
  const value = header || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export function readMeta(): SyncMeta {
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SyncMeta;
  } catch {
    return {};
  }
}

export async function writeMeta(meta: SyncMeta) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 180_000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, meta: SyncMeta) {
  if (!meta.passwordSalt || !meta.passwordHash) return false;
  try {
    const test = hashPassword(password, meta.passwordSalt).hash;
    const testBuffer = Buffer.from(test, 'hex');
    const storedBuffer = Buffer.from(meta.passwordHash, 'hex');
    return testBuffer.length === storedBuffer.length && crypto.timingSafeEqual(testBuffer, storedBuffer);
  } catch {
    return false;
  }
}
