import { WatchRoom } from './WatchRoom.mjs';
import { PresenceDirectory } from './PresenceDirectory.mjs';
import { buildIceConfig, mediaProvider } from './media.mjs';
import { boundedJson, boundedBytes, json } from './runtime.mjs';
import { createMediaCookie, verifyTicket, streamDrive, validDriveId } from './drive.mjs';
import { roomPreviewHtml } from '../../frontend/social-preview/metadata.js';
import { AbuseGuard, actorKey, consume } from './AbuseGuard.mjs';
export { WatchRoom, PresenceDirectory, AbuseGuard };

const roomStub = (env, roomId) => env.ROOMS.get(env.ROOMS.idFromName(roomId));
const validRoom = roomId => typeof roomId === 'string' && /^[A-Z0-9]{7}$/.test(roomId);
function authorizedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin || (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).includes(origin);
}
async function authorize(env, proof, livekit = false, authorization) {
  if (!validRoom(proof.roomId)) return json({ error: 'Invalid room' }, 400);
  return roomStub(env, proof.roomId).fetch(new Request(`https://internal/authorize${livekit ? '?livekit=true' : ''}`, {
    method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(proof),
  }));
}

const app = {
  async fetch(request, env, _ctx, requestId) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path.startsWith('/api/') || path.startsWith('/ws/')) {
        if (!authorizedOrigin(request, env)) return json({ error: 'Origin denied' }, 403);
        if (request.method === 'OPTIONS') {
          const response = new Response(null, { status: 204 });
          const origin = request.headers.get('origin');
          if (origin) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin'); response.headers.set('Access-Control-Allow-Credentials', 'true'); }
          response.headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
          response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,Range'); return response;
        }
      }
      const action = path.startsWith('/ws/') ? 'connect' : path === '/api/proxy/gdrive' ? 'drive' : ['/api/livekit/token', '/api/media/session'].includes(path) ? 'media' : null;
      let actor;
      if (action) {
        // CF-Connecting-IP is overwritten by Cloudflare at public ingress. Do not use X-Forwarded-For.
        const ip = request.headers.get('CF-Connecting-IP') || (env.NODE_ENV !== 'production' ? 'local' : null);
        if (!ip) return json({ error: 'Trusted client identity unavailable' }, 503);
        actor = await actorKey(`${env.NODE_ENV}:${new Date().toISOString().slice(0, 10)}:${ip}`);
        if (!await consume(env, actor, action)) {
          const response = json({ error: 'Too many requests. Retry shortly.' }, 429); response.headers.set('Retry-After', '60'); return response;
        }
      }
      if (path === '/api/health' && request.method === 'GET') return json({ ok: true, protocolVersion: 2, wireProtocolVersion: 1, backend: 'cloudflare', turnReady: buildIceConfig(env).turnAvailable });
      if (path === '/api/ice-config' && request.method === 'GET') return json(buildIceConfig(env));
      if (path.startsWith('/ws/rooms/')) {
        const roomId = path.slice('/ws/rooms/'.length);
        if (!validRoom(roomId) || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Invalid WebSocket request' }, 400);
        // Browsers must supply an allowed Origin. Tokens are sent in the first frame, never in URLs.
        if (!request.headers.get('origin')) return json({ error: 'Origin required' }, 403);
        const headers = new Headers(request.headers); headers.set('X-Watchly-Actor', actor);
        return roomStub(env, roomId).fetch(new Request(request, { headers }));
      }
      if (path === '/api/livekit/token' && request.method === 'POST') {
        if (env.ENABLE_CALLS === 'false') return json({ error: 'New calls are temporarily disabled.' }, 503);
        const proof = await boundedJson(request); return authorize(env, proof, true, request.headers.get('authorization'));
      }
      if (path === '/api/livekit/webhook' && request.method === 'POST') {
        if (Number(request.headers.get('content-length')) > 32768) return json({ error: 'Payload too large' }, 413);
        // boundedJson preserves request-size enforcement; verification needs the original raw bytes.
        const rawBytes = await boundedBytes(request, 32768);
        if (rawBytes.byteLength > 32768) return json({ error: 'Payload too large' }, 413);
        let event; try { event = await mediaProvider(env).verifyWebhook(new TextDecoder().decode(rawBytes), request.headers.get('authorization')); }
        catch { return json({ error: 'Invalid webhook' }, 401); }
        const roomId = event.room?.name?.match(/^watchly-voice-([A-Z0-9]{7})$/)?.[1];
        if (roomId) return roomStub(env, roomId).fetch(new Request('https://internal/media-event', { method: 'POST', body: JSON.stringify(event) }));
        return json({ ok: true });
      }
      if (path === '/api/media/session' && request.method === 'POST') {
        const proof = await boundedJson(request);
        if (!validDriveId(proof.fileId)) return json({ error: 'Invalid file id' }, 400);
        const checked = await authorize(env, proof); if (!checked.ok) return checked;
        return createMediaCookie(env, { roomId: proof.roomId, socketId: proof.socketId, resumeToken: proof.resumeToken, fileId: proof.fileId }, url.protocol === 'https:');
      }
      if (path === '/api/proxy/gdrive' && ['GET', 'HEAD'].includes(request.method)) {
        if (env.ENABLE_DRIVE_PROXY === 'false') return json({ error: 'Drive streaming is temporarily disabled.' }, 503);
        const roomId = url.searchParams.get('roomId'); if (!validRoom(roomId)) return json({ error: 'Join a room before streaming' }, 401);
        const cookie = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`watchly_media_${roomId}=`))?.split('=')[1];
        let proof; try { proof = await verifyTicket(env.MEDIA_SESSION_SECRET, cookie); } catch { return json({ error: 'Media session expired. Reconnect to your room.' }, 401); }
        if (proof.roomId !== roomId || proof.fileId !== url.searchParams.get('id')) return json({ error: 'File access denied' }, 403);
        const checked = await authorize(env, proof); if (!checked.ok) return checked;
        return streamDrive(request, env);
      }
      if (path.startsWith('/api/') || path.startsWith('/ws/')) return json({ error: 'Not found' }, 404);
      if (/^\/room\/[A-Z0-9]{7}\/?$/.test(path) && ['GET', 'HEAD'].includes(request.method)) {
        const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        const html = roomPreviewHtml(await shell.text(), path.split('/')[2], url.origin);
        return new Response(request.method === 'HEAD' ? null : html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(JSON.stringify({ code: 'REQUEST_FAILED', requestId, status: error.status || 500 }));
      return json({ error: error.status === 413 ? 'Request too large' : error.status === 400 ? 'Invalid request' : 'Request could not be completed' }, error.status || 500);
    }
  },
};

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    let response = await app.fetch(request, env, ctx, requestId);
    if (response.status !== 101) {
      response = new Response(response.body, response);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      if (new URL(request.url).pathname.startsWith('/api/')) response.headers.set('X-Watchly-Request-ID', requestId);
      if (response.headers.get('Content-Type')?.includes('text/html')) response.headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'self'");
    }
    if (response.status !== 101 && new URL(request.url).pathname.startsWith('/api/')) {
      const origin = request.headers.get('origin');
      if (origin && authorizedOrigin(request, env)) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Vary', 'Origin');
      }
    }
    return response;
  },
};
