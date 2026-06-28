import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { hashPassword, readMeta, usingBlobStorage, writeMeta } from '../cloud-auth';

export const runtime = 'nodejs';

/** GET /api/setup — check if a key has been generated */
export async function GET() {
  try {
    const meta = await readMeta();
    return NextResponse.json({
      hasKey: Boolean(meta.passwordHash),
      companyName: meta.companyName ?? null,
      uploadedAt: meta.uploadedAt ?? null,
      storage: usingBlobStorage() ? 'blob' : 'local',
    });
  } catch (error: any) {
    console.error('[/api/setup]', error);
    return NextResponse.json({ error: error.message || 'Setup status failed.' }, { status: 500 });
  }
}

/** POST /api/setup — generate a new access key, returns it once in plain text */
export async function POST() {
  try {
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

    const meta = await readMeta();
    const { salt, hash } = hashPassword(rawKey);
    await writeMeta({
      ...meta,
      passwordSalt: salt,
      passwordHash: hash,
    });

    return NextResponse.json({ key: rawKey });
  } catch (error: any) {
    console.error('[/api/setup]', error);
    return NextResponse.json({ error: error.message || 'Access key generation failed.' }, { status: 500 });
  }
}
