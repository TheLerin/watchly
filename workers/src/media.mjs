import cryptoNode from 'node:crypto';
import { Buffer } from 'node:buffer';
import identity from '../../backend/livekitIdentity.js';

const bytes = value => new TextEncoder().encode(value);
const base64url = value => Buffer.from(value).toString('base64url');
export async function signJwt(secret, claims) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, bytes(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(signature)}`;
}
export function buildIceConfig(env, memberId) {
  const urls = (env.TURN_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  let expiresAt = null;
  if (memberId && urls.length && env.TURN_SHARED_SECRET) {
    const expiry = Math.floor(Date.now() / 1000) + Math.min(86400, Math.max(300, Number(env.TURN_TTL_SECONDS) || 3600));
    const username = `${expiry}:watchly-${String(memberId).replace(/[^\w-]/g, '').slice(0, 48)}`;
    iceServers.push({ urls, username, credential: cryptoNode.createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64') });
    expiresAt = expiry * 1000;
  }
  return { iceServers, expiresAt, turnConfigured: iceServers.length > 1, turnAvailable: Boolean(urls.length && env.TURN_SHARED_SECRET) };
}

export class LiveKitProvider {
  constructor(env, fetcher = fetch) {
    if (env.NODE_ENV === 'production' && !['staging', 'production'].includes(env.LIVEKIT_ROOM_NAMESPACE)) throw Object.assign(new Error('Set the Worker media deployment namespace.'), { status: 503 });
    this.env = { ...env, LIVEKIT_ROOM_NAMESPACE: env.LIVEKIT_ROOM_NAMESPACE || 'development' }; this.fetcher = fetcher; this.config = identity.livekitConfig(this.env);
  }
  async ensureRoom(roomId) {
    if (!this.config) throw Object.assign(new Error('Calls are not configured.'), { status: 503 });
    const now = Math.floor(Date.now() / 1000), maximum = Math.min(6, Math.max(2, Number(this.env.LIVEKIT_MAX_PARTICIPANTS) || 6));
    const token = await signJwt(this.config.apiSecret, { iss: this.config.apiKey, nbf: now - 5, exp: now + 30, video: { roomCreate: true } });
    const url = new URL(this.config.serverUrl); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    const response = await this.fetcher(new URL('/twirp/livekit.RoomService/CreateRoom', url), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: identity.voiceRoomName(roomId, this.env), max_participants: maximum, empty_timeout: 120, departure_timeout: 30 }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Object.assign(new Error('The call service could not reserve a room. Retry shortly.'), { status: 503 });
    const room = await response.json(), actual = room.maxParticipants ?? room.max_participants;
    // CreateRoom is idempotent: pre-existing rooms may retain old, unlimited configuration. Fail closed until that room drains.
    if (!Number.isInteger(actual) || actual < 1 || actual > maximum) throw Object.assign(new Error('This call room needs to empty before the participant limit can apply.'), { status: 503 });
  }
  async token(roomId, member) {
    if (!this.config) throw Object.assign(new Error('LiveKit voice is not configured on the backend yet.'), { status: 503 });
    const now = Math.floor(Date.now() / 1000);
    return { serverUrl: this.config.serverUrl, participantToken: await signJwt(this.config.apiSecret, {
      iss: this.config.apiKey, sub: identity.voiceIdentity(member.userId), name: member.nickname, nbf: now - 5, exp: now + 120,
      roomConfig: { maxParticipants: Math.min(6, Math.max(2, Number(this.env.LIVEKIT_MAX_PARTICIPANTS) || 6)), emptyTimeout: 120, departureTimeout: 30 },
      video: { room: identity.voiceRoomName(roomId, this.env), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: ['microphone', 'camera'] },
    }) };
  }
  async remove(roomId, memberId) {
    if (!this.config) {
      if (this.env.NODE_ENV === 'production') throw new Error('LiveKit removal is not configured');
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(this.config.apiSecret, { iss: this.config.apiKey, nbf: now - 5, exp: now + 60,
      video: { room: identity.voiceRoomName(roomId, this.env), roomAdmin: true } });
    const url = new URL(this.config.serverUrl); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    const response = await this.fetcher(new URL('/twirp/livekit.RoomService/RemoveParticipant', url), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: identity.voiceRoomName(roomId, this.env), identity: identity.voiceIdentity(memberId) }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok && response.status !== 404) throw new Error('Media participant removal failed');
  }
  async verifyWebhook(raw, authorization) {
    if (!this.config || !authorization) throw new Error('Invalid webhook');
    const token = authorization.replace(/^Bearer /i, ''), parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid webhook');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'HS256' || claims.iss !== this.config.apiKey || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || (claims.nbf && claims.nbf * 1000 > Date.now() + 10000)) throw new Error('Invalid webhook');
    const key = await crypto.subtle.importKey('raw', bytes(this.config.apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, Buffer.from(parts[2], 'base64url'), bytes(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid webhook');
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes(raw))).toString('base64');
    if (claims.sha256 !== hash) throw new Error('Invalid webhook');
    return JSON.parse(raw);
  }
}

export function mediaProvider(env, fetcher) {
  const selected = env.MEDIA_PROVIDER || 'livekit';
  if (selected !== 'livekit') throw Object.assign(new Error('This media provider is not enabled. Keep MEDIA_PROVIDER=livekit.'), { status: 503 });
  return new LiveKitProvider(env, fetcher);
}
export const livekitToken = (env, roomId, member) => mediaProvider(env).token(roomId, member);
