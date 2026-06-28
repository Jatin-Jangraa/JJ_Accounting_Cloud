import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, readMeta, writeMeta } from '../cloud-auth';

export const runtime = 'nodejs';

/** GET /api/setup — check if a key has been generated */
export async function GET() {
  const meta = readMeta();
  return NextResponse.json({
    hasKey: Boolean(meta.passwordHash),
    companyName: meta.companyName ?? null,
    uploadedAt: meta.uploadedAt ?? null,
  });
}

/** POST /api/setup — generate a new access key, returns it once in plain text */
export async function POST() {
  // Generate a human-friendly key: e.g. ABCD-1234-EFGH-5678
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  // Use Node's crypto for server-side
  const randBytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) bytes[i] = randBytes[i];
  const rawKey = Array.from(bytes, (b) => alphabet[b % alphabet.length])
    .join('')
    .replace(/(.{4})/g, '$1-')
    .replace(/-$/, '');

  const meta = readMeta();
  const { salt, hash } = hashPassword(rawKey);
  await writeMeta({
    ...meta,
    passwordSalt: salt,
    passwordHash: hash,
  });

  return NextResponse.json({ key: rawKey });
}
