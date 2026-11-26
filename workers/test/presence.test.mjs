import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, connect } from './harness.mjs';

test('friend-authorized presence crosses room objects, reveals no room code and refresh removes revoked friends', async () => {
  const setup = environment(), a = await setup.room('ABCDEFG'), b = await setup.room('HIJKLMN'); b.code = 'HIJKLMN';
  const aliceId = '00000000-0000-4000-8000-000000000001', bobId = '00000000-0000-4000-8000-000000000002';
  let friends = true;
  for (const item of [a, b]) {
    item.object.accounts.verify = async token => {
      const id = token === 'alice' ? aliceId : bobId;
      return { id, token, expiresAt: Date.now() + 60000, profile: { id, username: token, display_name: token } };
    };
    item.object.accounts.friendIds = async account => friends ? [account.id === aliceId ? bobId : aliceId] : [];
  }
  const alice = await connect(a, 'alice'), bob = await connect(b, 'bob');
  await bob.send('room:create', { nickname: 'Bob', protocolVersion: 2 });
  await Promise.all([...a.ctx.tasks, ...b.ctx.tasks]);
  await alice.send('social:watch');
  await Promise.all(a.ctx.tasks);
  let message = alice.ws.messages.findLast(frame => frame.event === 'friends:presence');
  assert.deepEqual(message.args[0], [{ accountId: bobId, status: 'in_room' }]);
  assert.equal(JSON.stringify(message).includes('HIJKLMN'), false);
  friends = false; await alice.send('social:refresh');
  a.object.io.sockets.sockets.get(alice.id).data.socialRefreshAt = Date.now() - 1;
  await a.object.commit(); await setup.evict('ABCDEFG');
  a.object.accounts.friendIds = async () => [];
  await a.object.alarm();
  message = alice.ws.messages.findLast(frame => frame.event === 'friends:presence'); assert.deepEqual(message.args[0], []);
  await bob.close(); await Promise.all(b.ctx.tasks); await setup.directory.alarm();
  assert.equal(setup.directory.status(bobId), 'offline');
});
