import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, connect } from './harness.mjs';
import { encode } from '../src/runtime.mjs';

async function fixture() {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  const room = await host.send('room:create', { nickname: 'Host', guestKey: 'h'.repeat(43), protocolVersion: 2 });
  const update = fields => host.send('room:access-update', { revision: item.object.rooms.get('ABCDEFG').access.revision, ...fields });
  const join = (client, fields = {}) => client.send('room:join', { roomId: 'ABCDEFG', nickname: 'Visitor', guestKey: 'v'.repeat(43), protocolVersion: 2, ...fields });
  return { setup, item, host, room, update, join };
}
test('locking/account-only access applies to new joins while valid admitted members can resume', async () => {
  const { setup, item, host, room, update, join } = await fixture(), visitor = await connect(item);
  assert.equal((await update({ locked: true })).ok, true);
  assert.equal((await join(visitor)).error.code, 'ROOM_LOCKED');
  await host.close(); await setup.evict('ABCDEFG');
  const resumed = await connect(item); assert.equal((await resumed.send('room:join', { ...room, nickname: 'Host', protocolVersion: 2 })).ok, true);
  assert.equal((await resumed.send('room:access-update', { revision: item.object.rooms.get('ABCDEFG').access.revision, locked: false, accountOnly: true })).ok, true);
  assert.equal((await join(visitor)).error.code, 'ACCOUNT_REQUIRED');
});
test('private invitations have bounded uses/expiry/revocation, never expose credentials in snapshots or durable ACKs', async () => {
  const { setup, item, host, update, join } = await fixture(); await update({ visibility: 'private' });
  const visitor = await connect(item); assert.equal((await join(visitor)).error.code, 'INVITE_REQUIRED');
  const issued = await host.send('room:invite-create', { ttlSeconds: 60, maxUses: 1 }); assert.equal(issued.ok, true);
  const stored = encode(item.object.store.load()); assert.equal(stored.includes(issued.inviteToken), false);
  assert.equal((await join(visitor, { inviteToken: issued.inviteToken })).ok, true);
  const next = await connect(item); assert.equal((await join(next, { guestKey: 'n'.repeat(43), inviteToken: issued.inviteToken })).error.code, 'INVITE_REQUIRED');
  const view = (await visitor.send('room:snapshot')).snapshot.access; assert.equal(view.invites, undefined); assert.equal(view.pending, undefined);
  assert.equal((await visitor.send('room:access-update', { revision: 1, locked: false })).error.code, 'FORBIDDEN');
  const revoke = await host.send('room:invite-create', {}); await host.send('room:invite-revoke', { inviteId: revoke.inviteId });
  assert.equal((await join(next, { guestKey: 'n'.repeat(43), inviteToken: revoke.inviteToken })).error.code, 'INVITE_REQUIRED');
  const expires = await host.send('room:invite-create', {}); item.object.rooms.get('ABCDEFG').roomInvites.get(expires.inviteId).expiresAt = Date.now() - 1;
  assert.equal((await join(next, { guestKey: 'n'.repeat(43), inviteToken: expires.inviteToken })).error.code, 'INVITE_REQUIRED');
  await item.object.commit(); await setup.evict('ABCDEFG');
  assert.equal((await join(next)).error.code, 'INVITE_REQUIRED');
});
test('passwords use salted strong KDF records, survive reconstruction and are absent from room snapshots', { timeout: 10000 }, async () => {
  const { setup, item, host, update, join } = await fixture();
  assert.equal((await update({ password: 'short' })).error.code, 'INVALID_PASSWORD_FORMAT');
  assert.equal((await update({ password: 'a long test password' })).ok, true);
  const visitor = await connect(item);
  assert.equal((await join(visitor)).error.code, 'PASSWORD_REQUIRED');
  assert.equal((await join(visitor, { password: 'another long password' })).error.code, 'INVALID_PASSWORD');
  await setup.evict('ABCDEFG');
  assert.equal((await join(visitor, { password: 'a long test password' })).ok, true);
  const snapshot = await host.send('room:snapshot');
  assert.equal(snapshot.snapshot.access.policy.hasPassword, true);
  for (const secret of ['a long test password', 'digest', 'salt']) assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(encode(item.object.store.load()).includes('a long test password'), false);
});
test('join approval is host-controlled, persists across eviction and can be denied without leaking room data', async () => {
  const { setup, item, host, update, join } = await fixture(); await update({ approvalRequired: true });
  const visitor = await connect(item); assert.equal((await join(visitor)).error.code, 'APPROVAL_REQUIRED');
  const pending = (await host.send('room:access-get')).access.pending[0]; assert.equal(pending.nickname, 'Visitor');
  assert.equal((await visitor.send('room:snapshot')).error.code, 'NOT_IN_ROOM');
  assert.equal((await visitor.send('room:admission-decide', { requestId: pending.id, approve: true })).error.code, 'FORBIDDEN');
  await setup.evict('ABCDEFG'); await host.send('room:admission-decide', { requestId: pending.id, approve: true });
  assert.ok(visitor.ws.messages.some(frame => frame.event === 'room:admission' && frame.args[0].status === 'approved'));
  assert.equal((await join(visitor)).ok, true);
  const denied = await connect(item); await join(denied, { guestKey: 'd'.repeat(43) });
  const request = (await host.send('room:access-get')).access.pending[0]; await host.send('room:admission-decide', { requestId: request.id, approve: false });
  assert.equal((await join(denied, { guestKey: 'd'.repeat(43) })).error.code, 'JOIN_DENIED');
});
test('guest continuity bans fresh socket joins using the same credential and host unban restores access', async () => {
  const { item, host, join } = await fixture(), visitor = await connect(item), admitted = await join(visitor);
  await host.send('kick_user', { roomId: 'ABCDEFG', targetId: admitted.memberId });
  const returning = await connect(item); assert.equal((await join(returning)).error.code, 'MEMBER_BANNED');
  assert.equal((await host.send('room:unban', { memberId: admitted.memberId })).ok, true);
  assert.equal((await returning.send('room:join', { memberId: admitted.memberId, resumeToken: admitted.resumeToken, roomId: 'ABCDEFG', nickname: 'Visitor', guestKey: 'v'.repeat(43), protocolVersion: 2 })).ok, true);
});
