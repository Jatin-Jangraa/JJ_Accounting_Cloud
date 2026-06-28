import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, dataDir, dbPath, hashPassword, readMeta, verifyPassword, writeMeta } from '../cloud-auth';
import { mkdir, writeFile } from 'node:fs/promises';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const password = bearerToken(request.headers.get('authorization'));
  if (password.length < 8) {
    return NextResponse.json({ error: 'Enter the website password from the desktop app.' }, { status: 401 });
  }

  const meta = readMeta();
  const requiredUploadToken = process.env.JJ_SYNC_TOKEN;
  const isMasterToken = Boolean(requiredUploadToken && password === requiredUploadToken);
  const isWebsiteKey = !isMasterToken && Boolean(meta.passwordHash && verifyPassword(password, meta));
  if (!isMasterToken && !isWebsiteKey) {
    return NextResponse.json({ error: 'Invalid cloud sync password.' }, { status: 401 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length < 1024) {
    return NextResponse.json({ error: 'Uploaded database file is empty or invalid.' }, { status: 400 });
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, bytes);
  const storedPassword = (!isMasterToken && meta.passwordHash) ? { passwordSalt: meta.passwordSalt, passwordHash: meta.passwordHash } : (() => {
    const next = hashPassword(password);
    return { passwordSalt: next.salt, passwordHash: next.hash };
  })();
  await writeMeta({
    ...meta,
    ...storedPassword,
    uploadedAt: new Date().toISOString(),
    companyName: decodeURIComponent(request.headers.get('x-company-name') || ''),
    fileName: request.headers.get('x-file-name') || 'jj-accounting.sqlite'
  });

  return NextResponse.json({ ok: true, message: 'Database uploaded successfully.' });
}
