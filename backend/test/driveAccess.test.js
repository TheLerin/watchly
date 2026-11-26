const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerDriveAccess } = require('../driveAccess');
const fixture = () => {
    const routes = new Map(), app = { post(path, ...handlers) { routes.set(path, handlers.at(-1)); }, use(path, handler) { routes.set(path, handler); } };
    const secret = 'test-secret', resumeToken = 'r'.repeat(43), fileId = 'abcdefghijk', roomId = 'ABCDEFG', socketId = 'socket1';
    const member = { userId: 'member', id: socketId, connected: true, resumeTokenHash: crypto.createHash('sha256').update(resumeToken).digest('hex') };
    const room = { videoState: { url: `https://drive.google.com/file/d/${fileId}/view` }, users: [member], kickedUserIds: new Set() };
    const socket = { connected: true, data: { roomId, memberId: 'member' } };
    registerDriveAccess({ app, io: { sockets: { sockets: new Map([[socketId, socket]]) } }, rooms: new Map([[roomId, room]]), env: { MEDIA_SESSION_SECRET: secret, GDRIVE_LEGACY_SECRET: secret } });
    const res = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(name, value) { this.headers[name] = value; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, sendStatus(code) { this.statusCode = code; return this; } });
    return { routes, secret, resumeToken, fileId, roomId, socketId, member, room, res };
};
test('legacy Drive requires active selected-file membership; kicks revoke existing cookies', async () => {
    const f = fixture(), session = f.routes.get('/api/media/session'), gate = f.routes.get('/api/proxy/gdrive');
    let response = f.res(); await session({ body: { fileId: f.fileId, roomId: f.roomId, socketId: f.socketId, resumeToken: 'wrong'.repeat(10) } }, response); assert.equal(response.statusCode, 403);
    response = f.res(); await session({ body: f }, response); assert.equal(response.statusCode, 200);
    const cookie = response.headers['set-cookie'].split(';')[0];
    const request = { method: 'GET', query: { id: f.fileId, roomId: f.roomId }, headers: { cookie }, get(name) { return this.headers[name]; } };
    let allowed = false; await gate(request, f.res(), () => { allowed = true; }); assert.equal(allowed, true);
    f.room.kickedUserIds.add('member'); response = f.res(); await gate(request, response, () => assert.fail('kicked member')); assert.equal(response.statusCode, 403);
    response = f.res(); await gate({ ...request, headers: {} }, response, () => assert.fail('public proxy')); assert.equal(response.statusCode, 403);
});
test('Worker bridge signatures bind file, method, range and short expiration', async () => {
    const { signJwt } = await import('../../workers/src/media.mjs');
    const f = fixture(), gate = f.routes.get('/api/proxy/gdrive');
    const ticket = await signJwt(f.secret, { aud: 'watchly-drive-bridge', fileId: f.fileId, method: 'GET', range: 'bytes=0-1', exp: Math.floor(Date.now() / 1000) + 30 });
    const request = { method: 'GET', query: { id: f.fileId }, headers: { range: 'bytes=0-1', 'x-watchly-drive-ticket': ticket }, get(name) { return this.headers[name]; } };
    let allowed = false; await gate(request, f.res(), () => { allowed = true; }); assert.equal(allowed, true);
    request.headers.range = 'bytes=2-3'; const response = f.res(); await gate(request, response, () => assert.fail('changed range')); assert.equal(response.statusCode, 403);
});
