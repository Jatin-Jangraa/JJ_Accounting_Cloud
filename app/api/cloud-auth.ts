import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get, head, put } from '@vercel/blob';

export const dataDir = path.join(process.cwd(), 'website-data');
export const dbPath = path.join(dataDir, 'jj-accounting.sqlite');
export const metaPath = path.join(dataDir, 'sync-meta.json');
export const blobDbPath = process.env.JJ_BLOB_DB_PATH || 'jj-accounting/jj-accounting.sqlite';
export const blobMetaPath = process.env.JJ_BLOB_META_PATH || 'jj-accounting/sync-meta.json';

const isVercel = Boolean(process.env.VERCEL);
const hasBlobCredentials = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

export type SyncMeta = {
  uploadedAt?: string;
  companyName?: string;
  fileName?: string;
  passwordSalt?: string;
  passwordHash?: string;
  databaseSize?: number;
  storage?: 'blob' | 'local';
};

export function bearerToken(header: string | null) {
  const value = header || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export function usingBlobStorage() {
  return hasBlobCredentials || isVercel;
}

function assertBlobConfigured() {
  if (!hasBlobCredentials) {
    throw new Error('Vercel Blob is not configured. Create a Blob store and set BLOB_READ_WRITE_TOKEN in Vercel environment variables.');
  }
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function readMeta(): Promise<SyncMeta> {
  if (usingBlobStorage()) {
    assertBlobConfigured();
    try {
      const result = await get(blobMetaPath, { access: 'private' });
      if (!result || result.statusCode === 304 || !result.stream) return {};
      return JSON.parse((await streamToBuffer(result.stream)).toString('utf8')) as SyncMeta;
    } catch (error: any) {
      if (error?.name === 'BlobNotFoundError') return {};
      throw error;
    }
  }

  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SyncMeta;
  } catch {
    return {};
  }
}

export async function writeMeta(meta: SyncMeta) {
  const body = JSON.stringify({ ...meta, storage: usingBlobStorage() ? 'blob' : 'local' }, null, 2);
  if (usingBlobStorage()) {
    assertBlobConfigured();
    await put(blobMetaPath, body, {
      access: 'private',
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60
    });
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(metaPath, body);
}

export async function writeDatabase(bytes: Buffer) {
  if (usingBlobStorage()) {
    assertBlobConfigured();
    await put(blobDbPath, bytes, {
      access: 'private',
      allowOverwrite: true,
      contentType: 'application/x-sqlite3',
      cacheControlMaxAge: 60
    });
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, bytes);
}

export async function readDatabase() {
  if (usingBlobStorage()) {
    assertBlobConfigured();
    try {
      const result = await get(blobDbPath, { access: 'private' });
      if (!result || result.statusCode === 304 || !result.stream) return null;
      return streamToBuffer(result.stream);
    } catch (error: any) {
      if (error?.name === 'BlobNotFoundError') return null;
      throw error;
    }
  }

  if (!fs.existsSync(dbPath)) return null;
  return readFile(dbPath);
}

export async function databaseExists() {
  if (usingBlobStorage()) {
    assertBlobConfigured();
    try {
      await head(blobDbPath);
      return true;
    } catch (error: any) {
      if (error?.name === 'BlobNotFoundError') return false;
      throw error;
    }
  }

  return fs.existsSync(dbPath);
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
