import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, hashPassword, readMeta, verifyPassword, writeDatabase, writeMeta } from '../cloud-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const password = bearerToken(request.headers.get('authorization'));
    if (password.length < 8) {
      return NextResponse.json({ error: 'Enter the website password from the desktop app.' }, { status: 401 });
    }

    const meta = await readMeta();
    const requiredUploadToken = process.env.JJ_SYNC_TOKEN;
    const isMasterToken = Boolean(requiredUploadToken && password === requiredUploadToken);
    const isWebsiteKey = !isMasterToken && Boolean(meta.passwordHash && verifyPassword(password, meta));
    if (!isMasterToken && !isWebsiteKey) {
      const error = meta.passwordHash
        ? 'Invalid cloud sync password. If you regenerated the website access key or moved to a new Blob store, paste the latest website key into the desktop app and try again.'
        : 'No website access key is set in cloud storage. Open the website, generate an access key, paste it into the desktop app, and sync again.';
      return NextResponse.json({ error }, { status: 401 });
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'Uploaded database file is empty or invalid.' }, { status: 400 });
    }

    await writeDatabase(bytes);
    const storedPassword = (!isMasterToken && meta.passwordHash) ? { passwordSalt: meta.passwordSalt, passwordHash: meta.passwordHash } : (() => {
      const next = hashPassword(password);
      return { passwordSalt: next.salt, passwordHash: next.hash };
    })();
    await writeMeta({
      ...meta,
      ...storedPassword,
      uploadedAt: new Date().toISOString(),
      companyName: decodeURIComponent(request.headers.get('x-company-name') || ''),
      fileName: request.headers.get('x-file-name') || 'jj-accounting.sqlite',
      databaseSize: bytes.length
    });

    return NextResponse.json({ ok: true, message: 'Database uploaded successfully.' });
  } catch (error: any) {
    console.error('[/api/sync]', error);
    return NextResponse.json({ error: error.message || 'Cloud sync failed.' }, { status: 500 });
  }
}
