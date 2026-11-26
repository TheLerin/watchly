import registerRealtime from '../../backend/realtime.js';
import accountModule from '../../backend/accounts.js';
import identityModule from '../../backend/livekitIdentity.js';
import accessModule from '../../backend/roomAccess.js';
import { AlarmScheduler, EventAdapter, encode, errorResult, json, boundedJson } from './runtime.mjs';
import { buildIceConfig, mediaProvider } from './media.mjs';
import eventMap from '../../shared/event-map.json' with { type: 'json' };
import { RoomStorage } from './RoomStorage.mjs';
import { actorKey, consume, reserveBudget } from './AbuseGuard.mjs';
import { tablesForEvent, actionForEvent } from './eventPolicy.mjs';
import { OutboundFlow } from './OutboundFlow.mjs';
import { RoomDiagnostics } from './diagnostics.mjs';

const allowed = new Set(eventMap.clientToServer.filter(event => event !== 'disconnect'));

export class WatchRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.outbox = []; this.websockets = new Map(); this.restoring = true;
    this.tail = Promise.resolve(); this.scheduler = new AlarmScheduler(); this.frames = new Map(); this.presenceDirty = false;
    this.incoming = new WeakMap(); this.verifiedAccounts = new Map();
    this.outbound = new OutboundFlow();
    this.diagnostics = new RoomDiagnostics(env.ENABLE_DIAGNOSTICS === 'true');
    this.presenceJobs = new Map();
    this.mediaInFlight = new Set();
    this.store = new RoomStorage(ctx.storage);
    const saved = this.store.load();
    this.presenceState = saved.presenceState || { version: 0, job: null };
    this.rooms = saved.rooms || new Map(); this.name = saved.name || this.presenceState.job?.objectName; this.revision = saved.revision || 0;
    this.connections = saved.connections || new Map(); this.frames = saved.frames || new Map();
    this.mediaRemovals = saved.mediaRemovals || new Map();
    this.mediaEvents = saved.mediaEvents || new Map();
    this.accounts = accountModule.createAccountService({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, requireSession: env.NODE_ENV === 'production' });
    this.io = new EventAdapter((id, frame) => { if (!this.restoring) this.outbox.push({ id, frame }); }, id => this.websockets.get(id)?.close(4001, 'Session replaced'));
    this.presence = {
      changed: () => { if (!this.restoring) this.presenceDirty = true; },
      refresh: socket => this.presence.send(socket),
      send: async socket => {
        if (env.ENABLE_SOCIAL_PRESENCE === 'false') { socket.emit('friends:presence', []); return; }
        if (!socket.data.account || socket.data.account.expiresAt <= Date.now()) return;
        if (!socket.data.account.token) {
          socket.data.friendIds = []; socket.emit('friends:presence', []); socket.emit('account:refresh-required'); this.presenceDirty = true; return;
        }
        if (this.presenceJobs.has(socket.id)) { this.presenceJobs.get(socket.id).dirty = true; return; }
        const account = socket.data.account, job = { dirty: false };
        this.presenceJobs.set(socket.id, job);
        const task = (async () => {
          try {
            if (!await reserveBudget(env, 'social')) throw new Error('Social lookup budget reached');
            const friends = await this.accounts.friendIds(account);
            const response = await this.directory('/query', { friends });
            if (!response.ok) throw new Error('Presence lookup unavailable');
            const statuses = await response.json();
            await this.serial(async () => {
              if (!socket.connected || socket.data.account !== account || account.expiresAt <= Date.now() || !socket.data.watchFriends) return;
              socket.data.friendIds = friends; socket.data.presenceFailures = 0;
              socket.emit('friends:presence', statuses); this.presenceDirty = true; await this.commit();
            });
          } catch {
            await this.serial(async () => {
              if (!socket.connected || socket.data.account !== account || !socket.data.watchFriends) return;
              socket.data.friendIds = []; socket.emit('friends:presence', []); this.presenceDirty = true;
              const failures = socket.data.presenceFailures = (socket.data.presenceFailures || 0) + 1;
              if (failures <= 5) {
                const delay = Math.min(60000, 2000 * 2 ** failures);
                socket.data.socialRefreshAt = Date.now() + delay;
                this.scheduler.setTimeout(() => { delete socket.data.socialRefreshAt; this.presence.send(socket); }, delay);
              }
              await this.commit();
            });
          } finally {
            this.presenceJobs.delete(socket.id);
            if (job.dirty && socket.connected && socket.data.account === account && socket.data.watchFriends) this.presence.send(socket);
          }
        })();
        this.ctx.waitUntil(task);
      },
    };
    this.engine = registerRealtime({ io: this.io, rooms: this.rooms, accounts: this.accounts,
      buildIceConfig: member => buildIceConfig(env, member), runtime: this.engineRuntime() });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('__watchly_ping__', '__watchly_pong__'));
    ctx.blockConcurrencyWhile(async () => {
      for (const ws of ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment(); if (!attachment?.id) { ws.close(1008, 'Invalid session'); continue; }
        this.websockets.set(attachment.id, ws);
        const data = this.connections.get(attachment.id);
        if (data) await this.io.add(attachment.id, data, {}, true);
        else this.armHandshake(ws, attachment);
      }
      // Missing connections were terminated during eviction/restart; retain membership recovery semantics.
      for (const [id, data] of this.connections) if (!this.websockets.has(id)) {
        await this.io.add(id, data, {}, true); await this.io.remove(id); this.connections.delete(id);
      }
      this.engine.restore(); this.restoring = false;
      this.armMediaJobs();
      this.armPresenceJob();
    });
  }
  engineRuntime() {
    return {
      hibernating: true, roomCode: this.name, presence: this.presence,
      verifyAccount: (token, socket) => typeof token === 'string' && this.verifiedAccounts.get(socket.id)?.token === token ? this.verifiedAccounts.get(socket.id).account : this.accounts.verify(token),
      checkRoomPassword: (room, password, socket) => {
        const prepared = this.verifiedAccounts.get(socket.id)?.passwordCheck;
        return prepared && prepared.revision === room.access.revision && prepared.hash === accessModule.hash(password) && prepared.record === room.access.password ? prepared.valid : false;
      },
      createRoomPassword: (password, socket) => {
        const prepared = this.verifiedAccounts.get(socket.id)?.passwordCreate;
        if (!prepared || prepared.hash !== accessModule.hash(password)) throw Object.assign(new Error('Use a password between 8 and 128 characters.'), { code: 'INVALID_PASSWORD_FORMAT' });
        if (prepared.error) throw prepared.error; return prepared.record;
      },
      inviteFriend: (account, targetId, room, socket) => {
        const prepared = this.verifiedAccounts.get(socket.id)?.invitation;
        if (!prepared || prepared.account !== account || prepared.room !== room || prepared.targetId !== targetId) throw new Error('Invitation authorization changed');
        if (prepared.error) throw prepared.error; return prepared.result;
      },
      onMemberKicked: (roomId, memberId) => this.queueMediaRemoval(roomId, memberId),
      onAccountExpired: (roomId, memberId) => this.queueMediaRemoval(roomId, memberId),
      setTimeout: this.scheduler.setTimeout, clearTimeout: this.scheduler.clearTimeout, setInterval: this.scheduler.setInterval,
    };
  }
  directory(path, body) {
    const stub = this.env.PRESENCE.get(this.env.PRESENCE.idFromName('directory'));
    return stub.fetch(new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(body) }));
  }
  async consumeAction(socket, ws, action) {
    if (!this.env.ABUSE) return true;
    if (!await consume(this.env, ws.deserializeAttachment()?.actor, action)) return false;
    return !socket.data.account || await consume(this.env, await actorKey(`account:${socket.data.account.id}`), action);
  }
  armHandshake(ws, attachment) {
    this.scheduler.setTimeout(() => {
      if (!this.io.sockets.sockets.has(attachment.id)) { ws.close(1008, 'Authentication timeout'); this.websockets.delete(attachment.id); }
    }, Math.max(0, attachment.openedAt + 10000 - Date.now()));
  }
  serial(task) {
    const result = this.tail.then(() => {
      if (this.quarantined) throw new Error('Room requires reconstruction after a storage failure');
      return task();
    });
    this.tail = result.catch(() => {}); return result;
  }
  async commit(selected, candidate) {
    for (const [id, socket] of this.io.sockets.sockets) this.connections.set(id, socket.data);
    for (const [id, expiry] of this.mediaEvents) if (expiry <= Date.now()) this.mediaEvents.delete(id);
    if (!this.rooms.size && !this.mediaRemovals.size) this.mediaEvents.clear();
    if (this.presenceDirty && this.name) {
      this.presenceDirty = false;
      const entries = [...this.io.sockets.sockets.values()].filter(socket => socket.data.account?.expiresAt > Date.now()).map(socket => ({
        id: socket.id, objectName: this.name, accountId: socket.data.account.id,
        expiresAt: socket.data.account.expiresAt, status: socket.data.roomId ? 'in_room' : 'online',
        friends: socket.data.watchFriends ? socket.data.friendIds || [] : [],
      }));
      const signature = accessModule.hash(JSON.stringify(entries));
      if ((entries.length || this.presenceState.version) && signature !== this.presenceState.signature) {
        const job = { objectName: this.name, entries, version: ++this.presenceState.version, failures: 0, nextAt: Date.now() };
        this.presenceState.signature = signature;
        if (new TextEncoder().encode(JSON.stringify(job)).length <= 512 * 1024) this.presenceState.job = job;
        else { this.presenceState.job = null; console.warn(JSON.stringify({ code: 'PRESENCE_PAYLOAD_LIMIT' })); }
        if (selected) selected = [...new Set([...selected, 'presence_state'])];
      }
    }
    const pending = this.presenceState.job;
    const dispatchPresence = pending && !this.presenceInFlight && pending.nextAt <= Date.now() ? pending : null;
    if (dispatchPresence) {
      this.presenceInFlight = true; pending.nextAt = Date.now() + 10000;
      if (selected) selected = [...new Set([...selected, 'presence_state'])];
    }
    this.armPresenceJob();
    const saved = { keepObject: this.websockets.size > 0, name: this.name, rooms: this.rooms, connections: this.connections, frames: this.frames, mediaRemovals: this.mediaRemovals, mediaEvents: this.mediaEvents, presenceState: this.presenceState, revision: this.revision };
    const plan = this.store.prepare(saved, selected);
    if (this.store.roomChanged(plan)) {
      this.revision++;
      if (candidate) {
        this.frames.set(candidate.id, candidate.frame);
        plan.set('acknowledgements', this.store.records({ ...saved, frames: this.frames }, ['acknowledgements']).get('acknowledgements'));
      }
      if (plan.get('room_meta')?.has('$object')) plan.get('room_meta').set('$object', encode({ name: this.name, revision: this.revision }));
    }
    try { this.store.writePrepared(plan); }
    catch (error) {
      this.quarantined = true; this.outbox.length = 0;
      for (const ws of this.websockets.values()) try { ws.close(1011, 'Room storage unavailable; reconnect'); } catch { /* already closed */ }
      console.error(JSON.stringify({ code: 'ROOM_STORAGE_FAILED' }));
      // Never serve in-memory mutations after an atomic SQL rollback. Workerd reconstructs from the last committed records.
      this.ctx.abort?.('Room storage commit failed');
      throw error;
    }
    if (!this.rooms.size && !this.connections.size && !this.websockets.size && !this.mediaRemovals.size && !this.presenceState.job) {
      this.scheduler.timers.clear();
    }
    const deadline = this.scheduler.next();
    const current = await this.ctx.storage.getAlarm();
    if (Number.isFinite(deadline)) { if (current !== deadline) await this.ctx.storage.setAlarm(deadline); }
    else if (current !== null) await this.ctx.storage.deleteAlarm();
    // Durable storage output gate commits before externally visible event delivery.
    for (const { id, frame } of this.outbox.splice(0)) {
      try { this.outbound.send(this.websockets.get(id), { ...frame, revision: this.revision }); } catch { /* close callback performs cleanup */ }
    }
    if (dispatchPresence) this.ctx.waitUntil(this.deliverPresence(dispatchPresence));
  }
  armPresenceJob() {
    this.scheduler.clearTimeout(this.presenceTimer);
    if (this.presenceState.job) this.presenceTimer = this.scheduler.setTimeout(() => {}, Math.max(0, this.presenceState.job.nextAt - Date.now()));
  }
  async deliverPresence(job) {
    let failed = false;
    try {
      const response = await this.env.PRESENCE.get(this.env.PRESENCE.idFromName('directory')).fetch(new Request('https://internal/update', { method: 'POST', body: JSON.stringify(job), signal: AbortSignal.timeout(5000) }));
      failed = !response.ok;
    } catch { failed = true; }
    return this.serial(async () => {
      this.presenceInFlight = false;
      if (this.presenceState.job === job) {
        if (!failed) this.presenceState.job = null;
        else if (++job.failures >= 6) { this.presenceState.job = null; console.warn(JSON.stringify({ code: 'PRESENCE_UPDATE_EXHAUSTED', attempts: job.failures })); }
        else job.nextAt = Date.now() + Math.round(Math.min(60000, 1000 * 2 ** job.failures) * (0.85 + Math.random() * 0.3));
      }
      await this.commit();
    });
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/authorize' && new URL(request.url).searchParams.get('livekit') === 'true') return this.authorizeMedia(request);
    return this.serial(async () => {
      const url = new URL(request.url);
      if (url.pathname === '/presence-refresh') {
        for (const socket of this.io.sockets.sockets.values()) if (socket.data.watchFriends) await this.presence.send(socket).catch(() => {});
        await this.commit(); return json({ ok: true });
      }
      if (url.pathname === '/authorize') {
        try {
          const proof = await boundedJson(request);
          const member = identityModule.voiceMember({ io: this.io, rooms: this.rooms }, proof);
          if (proof.fileId) {
            let media; try { media = new URL(member.room.videoState.url); } catch { return json({ error: 'No Drive media selected' }, 403); }
            const id = media.searchParams.get('id') || media.pathname.match(/\/d\/([\w-]+)/)?.[1];
            if (!['drive.google.com', 'drive.usercontent.google.com'].includes(media.hostname) || id !== proof.fileId) return json({ error: 'This file is not selected in the room' }, 403);
          }
          return json({ ok: true });
        } catch (error) { return json({ error: error.status ? error.message : 'Membership verification failed.' }, error.status || 401); }
      }
      if (url.pathname === '/media-event') {
        const event = await boundedJson(request, 32768);
        const eventId = typeof event.id === 'string' && event.id.length <= 128 ? event.id : await actorKey(JSON.stringify(event));
        if (this.mediaEvents.get(eventId) > Date.now()) return json({ ok: true, duplicate: true });
        if (this.mediaEvents.size >= 128) this.mediaEvents.delete(this.mediaEvents.keys().next().value);
        this.mediaEvents.set(eventId, Date.now() + 600000);
        const memberId = event.participant?.identity?.replace(/^watchly-/, '');
        const room = this.rooms.get(this.name), member = room?.users.find(user => user.userId === memberId && user.connected);
        if (event.event === 'participant_joined' && memberId && (!member || room.kickedUserIds.has(memberId))) {
          const roomId = event.room?.name?.match(/^watchly-voice-([A-Z0-9]{7})$/)?.[1] || this.name;
          if (!roomId) return json({ error: 'Invalid media room' }, 400);
          this.queueMediaRemoval(roomId, memberId);
        }
        await this.commit();
        return json({ ok: true });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
      const code = url.pathname.split('/').pop();
      if (!/^[A-Z0-9]{7}$/.test(code) || (this.name && this.name !== code)) return json({ error: 'Invalid room code' }, 400);
      if (this.websockets.size >= 70) return json({ error: 'Connection limit reached' }, 429);
      // First request defines this deterministic object's room key. Re-register its engine before adding sockets.
      if (!this.name) {
        this.name = code;
        this.io.middleware = [];
        this.engine = registerRealtime({ io: this.io, rooms: this.rooms, accounts: this.accounts, buildIceConfig: member => buildIceConfig(this.env, member),
          runtime: this.engineRuntime() });
      }
      const pair = new WebSocketPair(), id = crypto.randomUUID().replaceAll('-', '');
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ id, openedAt: Date.now(), seq: 0, actor: request.headers.get('X-Watchly-Actor') });
      this.websockets.set(id, pair[1]);
      this.armHandshake(pair[1], pair[1].deserializeAttachment());
      await this.commit();
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  }
  async authorizeMedia(request) {
    try {
      const proof = await boundedJson(request), bearer = request.headers.get('authorization');
      const account = bearer ? await this.accounts.verify(/^Bearer (\S+)$/i.exec(bearer)?.[1]) : null;
      const check = () => {
        const current = identityModule.voiceMember({ io: this.io, rooms: this.rooms }, proof);
        if (current.member.accountId || account) {
          if (!account || account.id !== current.member.accountId || current.socket.data.account?.id !== account.id || !current.member.authenticated || current.socket.data.account?.expiresAt <= Date.now()) throw Object.assign(new Error('Use the account that owns this membership.'), { status: 401 });
        }
        return current;
      };
      const initial = await this.serial(async () => {
        const current = check(), now = Date.now(), bucket = current.socket.data.tokenRate;
        if (bucket && now - bucket.at < 60000 && bucket.count >= 8) throw Object.assign(new Error('Too many voice joins.'), { status: 429 });
        current.socket.data.tokenRate = bucket && now - bucket.at < 60000 ? { at: bucket.at, count: bucket.count + 1 } : { at: now, count: 1 };
        await this.commit(); return current;
      });
      const provider = mediaProvider(this.env);
      if (!await reserveBudget(this.env, 'media')) return json({ error: 'New calls are paused after reaching the daily application budget.' }, 429);
      if (this.env.NODE_ENV === 'production' || this.env.LIVEKIT_ENFORCE_ROOM_LIMITS === 'true') await provider.ensureRoom(proof.roomId);
      const token = await provider.token(proof.roomId, initial.member);
      return this.serial(() => {
        const current = check();
        if (current.member !== initial.member || current.room !== initial.room) return json({ error: 'Your room membership changed. Retry joining the call.' }, 403);
        return json(token);
      });
    } catch (error) { return json({ error: error.status ? error.message : 'Call authorization failed. Sign in again or retry.' }, error.status || 401); }
  }
  async webSocketMessage(ws, message) {
    const pending = this.incoming.get(ws) || { tail: Promise.resolve(), count: 0 };
    if (++pending.count > 32) { pending.count--; ws.close(1008, 'Too many pending events'); return; }
    const result = pending.tail.then(async () => {
      let verified;
      try {
        if (typeof message === 'string' && new TextEncoder().encode(message).length <= 256 * 1024) {
          const packet = JSON.parse(message);
          const token = packet?.type === 'hello' ? packet.accessToken : packet?.event === 'auth:update' ? packet.args?.[0]?.accessToken : null;
          if (packet?.v === 1 && typeof token === 'string' && token.length <= 16384) {
            const attachment = ws.deserializeAttachment(), now = Date.now();
            if (!attachment.authAt || now - attachment.authAt > 60000) { attachment.authAt = now; attachment.authCount = 0; }
            if (++attachment.authCount > 12) { ws.close(1008, 'Too many authentication attempts'); return; }
            ws.serializeAttachment(attachment);
            verified = { token, account: await this.accounts.verify(token) };
          }
          const socket = this.io.sockets.sockets.get(ws.deserializeAttachment()?.id), payload = packet?.args?.[0];
          if (socket && packet?.v === 1 && typeof packet.id === 'string' && Number.isSafeInteger(packet.seq) && packet.seq > (ws.deserializeAttachment()?.seq || 0) && !ws.deserializeAttachment()?.recentIds?.includes(packet.id) && !this.frames.get(socket.id)?.recentIds?.includes(packet.id) && payload && typeof payload === 'object' && !Array.isArray(payload)) {
            if (packet.event === 'room:create') { verified ||= {}; verified.budgetAllowed = await reserveBudget(this.env, 'rooms'); }
            const account = socket.data.account;
            if (account?.token && Date.now() - (account.sessionCheckedAt || 0) >= 60000 && !['clock:ping', 'network_ping', 'auth:update'].includes(packet.event)) {
              try { await this.accounts.sessionActive(account); }
              catch { verified ||= {}; verified.revokedAccount = account; }
            }
            const room = this.rooms.get(packet.event === 'room:join' ? payload.roomId : socket.data.roomId);
            const member = room?.users.find(user => user.id === socket.id && user.connected && !room.kickedUserIds.has(user.userId));
            const accountOwnsMember = !member?.accountId || socket.data.account?.id === member.accountId && socket.data.account.expiresAt > Date.now();
            if ((packet.event === 'room:join' && room?.access?.password && accessModule.validPassword(payload.password)) || (packet.event === 'room:access-update' && member?.role === 'Host' && accountOwnsMember && accessModule.validPassword(payload.password))) {
              verified ||= {};
              const attachment = ws.deserializeAttachment(), now = Date.now();
              if (!attachment.kdfAt || now - attachment.kdfAt > 60000) { attachment.kdfAt = now; attachment.kdfCount = 0; }
              if (++attachment.kdfCount > 8) { ws.close(1008, 'Too many password attempts'); return; } ws.serializeAttachment(attachment);
              if (!await this.consumeAction(socket, ws, actionForEvent(packet.event))) verified.preflightDenied = true;
              else if (packet.event === 'room:join') {
                verified.consumedAction = actionForEvent(packet.event);
                const record = room.access.password, revision = room.access.revision;
                verified.passwordCheck = { record, revision, hash: accessModule.hash(payload.password), valid: await accessModule.verifyPassword(record, payload.password) };
              } else {
                verified.consumedAction = actionForEvent(packet.event);
                try { verified.passwordCreate = { hash: accessModule.hash(payload.password), record: await accessModule.passwordRecord(payload.password) }; }
                catch (error) { verified.passwordCreate = { hash: accessModule.hash(payload.password), error }; }
              }
            }
            if (packet.event === 'social:invite' && member && ['Host', 'Moderator'].includes(member.role) && socket.data.account?.expiresAt > Date.now()) {
              verified ||= {}; const account = socket.data.account;
              if (!await this.consumeAction(socket, ws, 'social')) verified.preflightDenied = true;
              else {
                verified.consumedAction = 'social';
                try { verified.invitation = { account, targetId: payload.targetId, room, result: await this.accounts.invite(account, payload.targetId, room.id) }; }
                catch (error) { verified.invitation = { account, targetId: payload.targetId, room, error }; }
              }
            }
          }
        }
      } catch (error) { verified = { error }; }
      return this.processMessage(ws, message, verified);
    });
    pending.tail = result.catch(() => {}); this.incoming.set(ws, pending);
    try { return await result; } finally { pending.count--; }
  }
  async processMessage(ws, message, verified) {
    return this.serial(async () => {
      const started = performance.now(), rowsBefore = this.store.rowsWritten;
      let diagnosticEvent = 'invalid';
      try {
        if (verified?.error) throw verified.error;
        if (typeof message !== 'string' || new TextEncoder().encode(message).length > 256 * 1024) { ws.close(1009, 'Payload too large'); return; }
        const packet = JSON.parse(message), attachment = ws.deserializeAttachment();
        diagnosticEvent = allowed.has(packet?.event) ? packet.event : 'protocol';
        if (!this.websockets.has(attachment?.id) || ws.readyState > 1) return;
        if (verified) this.verifiedAccounts.set(attachment.id, verified);
        if (!packet || packet.v !== 1) { ws.close(1008, 'Protocol mismatch'); return; }
        if (packet.type === 'delivery-ack') {
          if (message.length > 128) { ws.close(1008, 'Invalid delivery receipt'); return; }
          const now = Date.now();
          if (!attachment.deliveryAt || now - attachment.deliveryAt > 1000) { attachment.deliveryAt = now; attachment.deliveryCount = 0; }
          if (++attachment.deliveryCount > 400) { ws.close(1008, 'Too many delivery receipts'); return; }
          ws.serializeAttachment(attachment);
          if (!this.outbound.receipt(ws, packet.seq)) ws.close(1008, 'Invalid delivery receipt');
          return;
        }
        let socket = this.io.sockets.sockets.get(attachment.id);
        if (socket?.data.account && !socket.data.account.token && !['auth:update', 'auth:clear', 'clock:ping', 'network_ping'].includes(packet.event)) {
          socket.emit('account:refresh-required');
          if (!['room:snapshot', 'room:access-get'].includes(packet.event)) {
            this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result: errorResult('AUTH_REFRESH_REQUIRED', 'Refreshing your account. Retry shortly.') } });
            await this.commit(); return;
          }
        }
        if (socket && verified?.revokedAccount && socket.data.account === verified.revokedAccount) {
          await this.io.dispatch(socket, 'auth:clear', [{}]);
          this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result: errorResult('AUTH_REQUIRED', 'Your account session was revoked. Sign in again.') } });
          await this.commit(); return;
        }
        if (!socket) {
          if (packet.type !== 'hello' || (packet.accessToken && (typeof packet.accessToken !== 'string' || packet.accessToken.length > 16384))) { ws.close(1008, 'Handshake required'); return; }
          socket = await this.io.add(attachment.id, {}, { accessToken: packet.accessToken, features: Array.isArray(packet.features) ? packet.features.slice(0, 8) : [] });
          attachment.deliveryEnabled = packet.features?.includes('delivery-ack-v1') === true; ws.serializeAttachment(attachment);
          this.presenceDirty = true;
          this.outbox.push({ id: socket.id, frame: { v: 1, type: 'welcome', id: socket.id } });
          await this.commit(); return;
        }
        if (!allowed.has(packet.event) || typeof packet.id !== 'string' || !/^[\w-]{1,100}$/.test(packet.id) || (packet.ack !== undefined && typeof packet.ack !== 'boolean') || !Number.isSafeInteger(packet.seq) || packet.seq <= 0 || !Array.isArray(packet.args) || packet.args.length > 1) { ws.close(1008, 'Invalid event'); return; }
        const now = Date.now();
        if (!attachment.rateAt || now - attachment.rateAt > 1000) { attachment.rateAt = now; attachment.rateCount = 0; }
        if (++attachment.rateCount > 40) { ws.close(1008, 'Rate limit exceeded'); return; }
        ws.serializeAttachment(attachment);
        const action = actionForEvent(packet.event);
        if (verified?.budgetAllowed === false) {
          this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result: errorResult('DAILY_BUDGET_REACHED', 'New rooms are paused after reaching the daily application budget.') } });
          await this.commit(); return;
        }
        if (packet.event === 'room:create' && this.env.ALLOW_NEW_ROOMS === 'false') {
          this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result: errorResult('ROOM_CREATION_PAUSED', 'New room creation is temporarily paused.') } });
          await this.commit(); return;
        }
        if (verified?.preflightDenied || action && this.env.ABUSE && verified?.consumedAction !== action) {
          if (verified?.preflightDenied || !await this.consumeAction(socket, ws, action)) {
            this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result: errorResult('RATE_LIMITED', 'Too many attempts. Retry shortly.') } });
            await this.commit(); return;
          }
        }
        const previous = this.frames.get(socket.id);
        if (packet.seq <= attachment.seq || previous?.recentIds?.includes(packet.id) || attachment.recentIds?.includes(packet.id)) {
          let result = previous?.id === packet.id ? previous.result : errorResult('REPLAY', 'Stale event rejected.');
          if (previous?.id === packet.id && previous.hasSnapshot) {
            let current; await this.io.dispatch(socket, 'room:snapshot', [], value => { current = value; });
            result = current?.ok ? { ...result, snapshot: current.snapshot } : current;
          }
          this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result } });
          await this.commit(); return;
        }
        attachment.seq = packet.seq;
        attachment.recentIds = [...attachment.recentIds || [], packet.id].slice(-16);
        ws.serializeAttachment(attachment);
        const accountBefore = socket.data.account;
        if (socket.data.account?.expiresAt <= now) await this.io.dispatch(socket, 'auth:clear', []);
        else if (socket.data.account && !socket.data.account.token && packet.event !== 'auth:update' && packet.event !== 'auth:clear') socket.emit('account:refresh-required');
        let result;
        await this.io.dispatch(socket, packet.event, packet.args, value => { result = value; });
        result ??= { ok: true };
        const { snapshot, existingUsers, videoState, queue, chatHistory, localReadiness, ...compact } = result;
        const candidate = { id: socket.id, frame: { id: packet.id, result: compact, hasSnapshot: Boolean(snapshot), recentIds: [...previous?.recentIds || [], packet.id].slice(-64) } };
        if (packet.ack) this.outbox.push({ id: socket.id, frame: { v: 1, ack: packet.id, result } });
        await this.commit(tablesForEvent(packet.event, socket.data.account !== accountBefore), candidate);
      } catch (error) {
        this.outbox.length = 0;
        const code = error.code || error.data?.code;
        if (code === 'AUTH_REQUIRED' || code === 'ACCOUNT_UNAVAILABLE') {
          ws.send(JSON.stringify({ v: 1, type: 'error', error: { code, message: 'Your account could not connect. Sign in again or retry.' } }));
        }
        ws.close(1011, 'Connection could not process this request');
      } finally { this.verifiedAccounts.delete(ws.deserializeAttachment()?.id); this.diagnostics.record(diagnosticEvent, performance.now() - started, this.store.rowsWritten - rowsBefore); }
    });
  }
  async webSocketClose(ws, code) {
    return this.serial(async () => {
      const id = ws.deserializeAttachment()?.id;
      this.outbound.forget(ws);
      await this.io.remove(id); this.connections.delete(id); this.frames.delete(id); this.websockets.delete(id);
      this.presenceDirty = true; await this.commit();
      try { if (code !== 1006) ws.close(); } catch { /* already closed */ }
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws, 1006); }
  queueMediaRemoval(roomId, memberId) {
    if (this.mediaRemovals.has(memberId)) return;
    this.mediaRemovals.set(memberId, { roomId, memberId, nextAt: Date.now(), failures: 0 });
    this.armMediaJobs();
  }
  armMediaJobs() {
    this.scheduler.clearTimeout(this.mediaTimer);
    if (this.mediaRemovals.size) this.mediaTimer = this.scheduler.setTimeout(() => this.removeMediaParticipants(), Math.max(0, Math.min(...[...this.mediaRemovals.values()].map(job => job.nextAt || 0)) - Date.now()));
  }
  async removeMediaParticipants() {
    for (const [id, removal] of this.mediaRemovals) {
      if (removal.nextAt > Date.now()) continue;
      if (removal.terminal) { this.mediaRemovals.delete(id); continue; }
      if (this.mediaInFlight.has(id)) { removal.nextAt = Date.now() + 15000; continue; }
      removal.nextAt = Date.now() + 15000; // Durable watchdog survives interruption before HTTP completion.
      this.mediaInFlight.add(id);
      this.ctx.waitUntil((async () => {
        let failed = false;
        try { await mediaProvider(this.env).remove(removal.roomId, id); } catch { failed = true; }
        await this.serial(async () => {
          this.mediaInFlight.delete(id);
          if (this.mediaRemovals.get(id) !== removal) return;
          if (!failed) this.mediaRemovals.delete(id);
          else {
            removal.failures++; removal.terminal = removal.failures >= 12;
            removal.nextAt = Date.now() + (removal.terminal ? 86400000 : Math.round(Math.min(300000, 15000 * 2 ** Math.min(removal.failures, 5)) * (0.85 + Math.random() * 0.3)));
            if (removal.terminal) console.error(JSON.stringify({ code: 'MEDIA_REMOVAL_EXHAUSTED', attempts: removal.failures }));
          }
          this.armMediaJobs(); await this.commit();
        });
      })());
    }
    this.armMediaJobs();
  }
  alarm() { return this.serial(async () => { await this.scheduler.run(); await this.commit(); }); }
}
