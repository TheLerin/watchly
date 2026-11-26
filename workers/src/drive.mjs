import { signJwt } from './media.mjs';
import { Buffer } from 'node:buffer';
import { json } from './runtime.mjs';

export const validDriveId = id => typeof id === 'string' && /^[\w-]{10,200}$/.test(id);
export function validDriveUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname) || url.hostname.endsWith('.googleusercontent.com'));
  } catch { return false; }
}
export async function verifyTicket(secret, token) {
  if (!secret || !token || token.length > 4096) throw new Error('Invalid media session');
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('Invalid media session');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (header.alg !== 'HS256' || !await crypto.subtle.verify('HMAC', key, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error('Invalid media session');
  return claims;
}
export async function createMediaCookie(env, proof, secure) {
  if (!env.MEDIA_SESSION_SECRET) return json({ error: 'Drive media sessions require MEDIA_SESSION_SECRET on the Worker.' }, 503);
  const response = json({ ok: true });
  const token = await signJwt(env.MEDIA_SESSION_SECRET, { ...proof, exp: Math.floor(Date.now() / 1000) + 900 });
  response.headers.set('Set-Cookie', `watchly_media_${proof.roomId}=${token}; HttpOnly; SameSite=Strict; Path=/api/proxy/gdrive; Max-Age=900${secure ? '; Secure' : ''}`);
  return response;
}
export async function streamDrive(request, env, fetcher = fetch) {
  const url = new URL(request.url), id = url.searchParams.get('id');
  if (!validDriveId(id)) return json({ error: 'Invalid Google Drive file id' }, 400);
  const range = request.headers.get('range');
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json({ error: 'Only a single byte range is supported' }, 416);
  let target = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`;
  let upstream;
  for (let hop = 0; hop < 6; hop++) {
    if (!validDriveUrl(target)) return json({ error: 'Unsafe Drive redirect rejected' }, 502);
    upstream = await fetcher(target, { method: request.method, headers: range ? { Range: range } : {}, redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      const location = upstream.headers.get('location'); await upstream.body?.cancel(); target = new URL(location, target).href; upstream = null; continue;
    }
    break;
  }
  if (!upstream) return json({ error: 'Too many Drive redirects' }, 502);
  const isMedia = /^(video\/|audio\/|application\/octet-stream)/i.test(upstream.headers.get('content-type') || '');
  if ((!isMedia || ![200, 206, 416].includes(upstream.status)) && env.GDRIVE_LEGACY_ORIGIN) {
    await upstream.body?.cancel();
    const legacy = new URL(env.GDRIVE_LEGACY_ORIGIN);
    if (legacy.protocol !== 'https:' || legacy.username || legacy.password || legacy.pathname !== '/' || legacy.search || legacy.hash) return json({ error: 'Invalid legacy Drive configuration' }, 503);
    if (!env.GDRIVE_LEGACY_SECRET) return json({ error: 'Legacy Drive authentication is not configured' }, 503);
    const ticket = await signJwt(env.GDRIVE_LEGACY_SECRET, { aud: 'watchly-drive-bridge', fileId: id, method: request.method, range: range || '', exp: Math.floor(Date.now() / 1000) + 30 });
    upstream = await fetcher(new URL(`/api/proxy/gdrive?id=${encodeURIComponent(id)}`, legacy), { method: request.method, headers: { ...(range ? { Range: range } : {}), 'X-Watchly-Drive-Ticket': ticket }, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
  }
  if (![200, 206, 416].includes(upstream.status) || (upstream.status !== 416 && !/^(video\/|audio\/|application\/octet-stream)/i.test(upstream.headers.get('content-type') || ''))) {
    await upstream.body?.cancel(); return json({ error: 'Google Drive did not authorize direct media delivery.', hint: 'Check file sharing and provider restrictions, or configure the isolated legacy adapter.' }, 502);
  }
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
  if (request.method === 'HEAD') { await upstream.body?.cancel(); return new Response(null, { status: upstream.status, headers }); }
  return new Response(upstream.body, { status: upstream.status, headers });
}
