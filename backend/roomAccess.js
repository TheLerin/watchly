const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { normalizeRoomName } = require('../shared/room-name.mjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const reject = (code, message) => ({ ok: false, error: { code, message, retryable: false } });
const credential = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(value);
const defaults = () => ({ version: 1, revision: 0, roomName: '', visibility: 'public', locked: false, accountOnly: false, approvalRequired: false, password: null });
const validPassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 128 && Buffer.byteLength(value) <= 512;
async function passwordRecord(password) {
    if (!validPassword(password)) throw Object.assign(new Error('Use a password between 8 and 128 characters.'), { code: 'INVALID_PASSWORD_FORMAT' });
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await crypto.webcrypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveBits']);
    // Do not silently weaken the work factor if a runtime rejects this algorithm/parameter.
    const bits = await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'hex'), iterations: 600000 }, key, 256);
    return { algorithm: 'PBKDF2-SHA256', iterations: 600000, salt, digest: Buffer.from(bits).toString('hex') };
}
async function verifyPassword(record, password) {
    if (!record) return true;
    if (!validPassword(password) || record.algorithm !== 'PBKDF2-SHA256' || record.iterations !== 600000 || !/^[a-f0-9]{32}$/.test(record.salt || '') || !/^[a-f0-9]{64}$/.test(record.digest || '')) return false;
    const key = await crypto.webcrypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(record.salt, 'hex'), iterations: record.iterations }, key, 256);
    return crypto.timingSafeEqual(Buffer.from(bits), Buffer.from(record.digest, 'hex'));
}

function createRoomAccess({ io, rooms, runtime = {}, now = Date.now }) {
    const timers = new Map(), schedule = runtime.setTimeout || setTimeout, cancel = runtime.clearTimeout || clearTimeout;
    const init = room => {
        room.access ||= defaults(); room.roomInvites ||= new Map(); room.joinRequests ||= new Map(); room.bannedGuestHashes ||= new Set();
        return room;
    };
    const memberFor = (room, socket) => room?.users.find(user => user.id === socket.id && user.connected && !room.kickedUserIds.has(user.userId));
    const manager = (room, socket, hostOnly = false) => {
        const member = memberFor(room, socket);
        if (!member || socket.data.roomId !== room.id || !(hostOnly ? member.role === 'Host' : ['Host', 'Moderator'].includes(member.role))) return false;
        if (member.accountId && (socket.data.account?.id !== member.accountId || socket.data.account.expiresAt <= now())) return false;
        return true;
    };
    const publicPolicy = room => ({ version: 1, revision: room.access.revision, roomName: normalizeRoomName(room.access.roomName) || '', visibility: room.access.visibility, locked: room.access.locked, accountOnly: room.access.accountOnly, approvalRequired: room.access.approvalRequired, hasPassword: Boolean(room.access.password) });
    const state = (room, socket) => {
        if (!room?.access) return { policy: defaults() };
        const result = { policy: publicPolicy(room) };
        if (manager(room, socket)) Object.assign(result, {
            invites: [...room.roomInvites.values()].filter(invite => invite.expiresAt > now()).map(({ id, expiresAt, uses, maxUses, revoked }) => ({ id, expiresAt, uses, maxUses, revoked })),
            pending: [...room.joinRequests.values()].filter(request => request.expiresAt > now() && request.status === 'pending').map(({ id, nickname, accountId, expiresAt }) => ({ id, nickname, accountId, expiresAt })),
            bans: room.users.filter(user => room.kickedUserIds.has(user.userId)).map(user => ({ memberId: user.userId, nickname: user.nickname, role: user.role })),
        });
        return result;
    };
    const publish = room => { for (const socket of io.sockets.sockets.values()) if (socket.connected && socket.data.roomId === room.id) socket.emit('room:access-state', state(room, socket)); };
    const prune = room => {
        for (const [id, invite] of room.roomInvites) if (invite.expiresAt <= now()) room.roomInvites.delete(id);
        for (const [id, request] of room.joinRequests) if (request.expiresAt <= now()) room.joinRequests.delete(id);
    };
    const arm = room => {
        cancel(timers.get(room.id)); timers.delete(room.id);
        const expiry = Math.min(...[...room.roomInvites.values(), ...room.joinRequests.values()].map(value => value.expiresAt));
        if (!Number.isFinite(expiry)) return;
        const timer = schedule(() => { timers.delete(room.id); if (rooms.get(room.id) !== room) return; prune(room); publish(room); arm(room); }, Math.max(0, expiry - now()));
        timer.unref?.(); timers.set(room.id, timer);
    };
    const admissionKey = (socket, payload) => socket.data.account ? `account:${socket.data.account.id}` : `guest:${hash(credential(payload.guestKey) ? payload.guestKey : socket.id)}`;
    const check = async (room, socket, payload, existing) => {
        init(room); prune(room);
        const guestHash = credential(payload.guestKey) ? hash(payload.guestKey) : null;
        if (guestHash && room.bannedGuestHashes.has(guestHash)) return reject('MEMBER_BANNED', 'This guest identity was removed from the room.');
        if (existing) return { ok: true, guestHash }; // A valid private resume credential preserves existing admission.
        const revision = room.access.revision;
        if (room.access.locked) return reject('ROOM_LOCKED', 'The Host has locked this room to new participants.');
        if (room.access.accountOnly && (!socket.data.account?.profile || socket.data.account.expiresAt <= now())) return reject('ACCOUNT_REQUIRED', 'Sign in to join this room.');
        let invite;
        if (credential(payload.inviteToken)) invite = [...room.roomInvites.values()].find(value => value.hash === hash(payload.inviteToken) && !value.revoked && value.expiresAt > now() && value.uses < value.maxUses);
        if (!invite && socket.data.account) invite = [...room.roomInvites.values()].find(value => value.accountId === socket.data.account.id && !value.revoked && value.expiresAt > now() && value.uses < value.maxUses);
        if (room.access.visibility === 'private' && !invite) return reject('INVITE_REQUIRED', 'A valid invitation link is required for this room.');
        if (room.access.password) {
            if (!payload.password) return reject('PASSWORD_REQUIRED', 'Enter the room password.');
            let verified;
            try { verified = await (runtime.checkRoomPassword ? runtime.checkRoomPassword(room, payload.password, socket) : verifyPassword(room.access.password, payload.password)); }
            catch { return reject('PASSWORD_UNAVAILABLE', 'Password verification is unavailable on this server.'); }
            if (!verified) return reject('INVALID_PASSWORD', 'The room password is incorrect.');
            if (!socket.connected || rooms.get(room.id) !== room || room.access.revision !== revision) return reject('ACCESS_CHANGED', 'Room access changed. Please retry joining.');
        }
        const key = admissionKey(socket, payload);
        if (room.access.approvalRequired) {
            let request = room.joinRequests.get(key);
            if (request?.status === 'denied') return reject('JOIN_DENIED', 'The Host declined this join request.');
            if (request?.status !== 'approved') {
                if (!request) {
                    if (room.joinRequests.size >= 100) return reject('JOIN_QUEUE_FULL', 'The approval queue is full. Retry later.');
                    request = { id: crypto.randomUUID(), nickname: String(socket.data.account?.profile?.display_name || payload.nickname || 'Guest').slice(0, 24), accountId: socket.data.account?.id || null, expiresAt: now() + 300000, status: 'pending' };
                    room.joinRequests.set(key, request); arm(room); publish(room);
                }
                socket.data.pendingAdmission = { roomId: room.id, key, requestId: request.id };
                return reject('APPROVAL_REQUIRED', 'Join request sent. Waiting for the Host or a Moderator.');
            }
        }
        return { ok: true, guestHash, consume() {
            if (room.access.revision !== revision || room.access.locked) return false;
            if (invite) { if (room.roomInvites.get(invite.id) !== invite || invite.expiresAt <= now() || invite.uses >= invite.maxUses) return false; invite.uses++; }
            room.joinRequests.delete(key); delete socket.data.pendingAdmission; arm(room); return true;
        } };
    };
    const handlers = (socket, on) => {
        const current = () => rooms.get(socket.data.roomId);
        on('room:access-get', (_payload, ack) => { const room = current(); ack(room && memberFor(room, socket) ? { ok: true, access: state(room, socket) } : reject('NOT_IN_ROOM', 'Join a room first.')); });
        on('room:access-update', async (payload, ack) => {
            const room = current(); if (!room || !manager(room, socket, true)) return ack(reject('FORBIDDEN', 'Only the Host can change room access.'));
            init(room); const revision = room.access.revision;
            if (payload.revision !== revision) return ack(reject('ACCESS_CHANGED', 'Access settings changed. Refresh and retry.'));
            const next = { ...room.access };
            if ('roomName' in payload) {
                const name = normalizeRoomName(payload.roomName);
                if (name === null) return ack(reject('INVALID_ROOM_NAME', 'Use a room name up to 48 characters without control characters.'));
                next.roomName = name;
            }
            for (const field of ['locked', 'accountOnly', 'approvalRequired']) if (field in payload) { if (typeof payload[field] !== 'boolean') return ack(reject('INVALID_ACCESS', 'Invalid access settings.')); next[field] = payload[field]; }
            if ('visibility' in payload) { if (!['public', 'private'].includes(payload.visibility)) return ack(reject('INVALID_ACCESS', 'Choose public or invitation-only entry.')); next.visibility = payload.visibility; }
            if (payload.clearPassword === true) next.password = null;
            if ('password' in payload) {
                try { next.password = runtime.createRoomPassword ? await runtime.createRoomPassword(payload.password, socket) : await passwordRecord(payload.password); }
                catch (error) { return ack(reject(error.code || 'PASSWORD_UNAVAILABLE', error.code ? error.message : 'Secure password hashing is unavailable on this server.')); }
            }
            if (!manager(room, socket, true) || rooms.get(room.id) !== room || room.access.revision !== revision) return ack(reject('ACCESS_CHANGED', 'Room access changed. Retry.'));
            if (JSON.stringify(next) === JSON.stringify(room.access)) return ack({ ok: true, access: state(room, socket) });
            next.revision++; room.access = next; publish(room); ack({ ok: true, access: state(room, socket) });
        });
        on('room:invite-create', ({ ttlSeconds = 3600, maxUses = 10 } = {}, ack) => {
            const room = current(); if (!room || !manager(room, socket)) return ack(reject('FORBIDDEN', 'Only the Host and Moderators can create invitations.'));
            init(room); prune(room);
            if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400 || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 50) return ack(reject('INVALID_INVITE', 'Choose an expiry from one minute to one day and 1–50 uses.'));
            if (room.roomInvites.size >= 20) return ack(reject('INVITE_LIMIT', 'Revoke or wait for existing invitations to expire.'));
            const inviteToken = crypto.randomBytes(32).toString('base64url'), id = crypto.randomUUID(), expiresAt = now() + ttlSeconds * 1000;
            room.roomInvites.set(id, { id, hash: hash(inviteToken), expiresAt, maxUses, uses: 0, revoked: false }); arm(room); publish(room);
            ack({ ok: true, inviteId: id, inviteToken, expiresAt });
        });
        on('room:invite-revoke', ({ inviteId } = {}, ack) => {
            const room = current(); if (!room || !manager(room, socket)) return ack(reject('FORBIDDEN', 'Only the Host and Moderators can revoke invitations.'));
            const invite = room.roomInvites?.get(inviteId); if (invite) { room.roomInvites.delete(inviteId); publish(room); arm(room); }
            ack({ ok: true });
        });
        on('room:admission-decide', ({ requestId, approve } = {}, ack) => {
            const room = current(); if (!room || !manager(room, socket)) return ack(reject('FORBIDDEN', 'Only the Host and Moderators can review requests.'));
            if (typeof approve !== 'boolean') return ack(reject('INVALID_ACCESS', 'Choose approve or decline.'));
            const request = [...room.joinRequests?.values() || []].find(value => value.id === requestId && value.expiresAt > now() && value.status === 'pending');
            if (!request) return ack(reject('REQUEST_EXPIRED', 'This join request expired.'));
            request.status = approve ? 'approved' : 'denied';
            for (const target of io.sockets.sockets.values()) if (target.data.pendingAdmission?.requestId === request.id && target.data.pendingAdmission?.roomId === room.id) target.emit('room:admission', { roomId: room.id, status: request.status });
            publish(room); ack({ ok: true });
        });
        on('room:unban', ({ memberId } = {}, ack) => {
            const room = current(); if (!room || !manager(room, socket)) return ack(reject('FORBIDDEN', 'Only the Host and Moderators can unban participants.'));
            const target = room.users.find(user => user.userId === memberId);
            if (!target || (target.role !== 'Viewer' && !manager(room, socket, true))) return ack(reject('FORBIDDEN', 'Only the Host can unban a Moderator.'));
            room.kickedUserIds.delete(memberId); if (target.guestKeyHash) room.bannedGuestHashes.delete(target.guestKeyHash);
            publish(room); ack({ ok: true });
        });
    };
    for (const room of rooms.values()) init(room);
    return { init, check, handlers, state, publish,
        requireApproval(room) {
            init(room);
            if (room.access.approvalRequired) return;
            room.access.approvalRequired = true;
            room.access.revision++;
        },
        friendInvited(room, accountId) {
            init(room); prune(room); if (room.access.visibility !== 'private') return;
            const old = [...room.roomInvites.values()].find(value => value.accountId === accountId);
            if (old) room.roomInvites.delete(old.id);
            if (room.roomInvites.size >= 20) throw new Error('Invitation limit');
            const id = crypto.randomUUID(); room.roomInvites.set(id, { id, accountId, hash: null, expiresAt: now() + 3600000, maxUses: 1, uses: 0, revoked: false }); arm(room); publish(room);
        },
        restore() { for (const room of rooms.values()) { prune(room); arm(room); } }, ban(room, member) { init(room); if (member.guestKeyHash) room.bannedGuestHashes.add(member.guestKeyHash); publish(room); } };
}
module.exports = { createRoomAccess, defaults, passwordRecord, verifyPassword, validPassword, hash };
