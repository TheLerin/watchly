const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Server } = require('socket.io');
const { io } = require('../../frontend/node_modules/socket.io-client');
const register = require('../realtime');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', C = '00000000-0000-4000-8000-000000000003';
let server, realtime, base, friends = true; const clients = [];
const identities = { alice: A, refreshed: A, bob: B, carol: C, short: C, delayed: C, incomplete: C };
const accounts = {
    async verify(token) {
        const id = identities[token]; if (!id) throw Object.assign(new Error('Invalid account session.'), { code: 'AUTH_REQUIRED' });
        if (token === 'delayed') await new Promise(resolve => setTimeout(resolve, 100));
        return { id, token, expiresAt: Date.now()+(token === 'short' ? 250 : 60000), profile: token === 'incomplete' ? null : { id, username: id === A ? 'alice' : id === B ? 'bob' : 'carol', display_name: id === A ? 'Alice' : id === B ? 'Bob' : 'Carol', avatar_url: null } };
    },
    async friendIds(account) { return friends ? account.id === A ? [B] : account.id === B ? [A] : [] : []; },
    async invite(account, target, code) { if (!(await this.friendIds(account)).includes(target)) throw new Error('Not friends'); return `${account.id}:${target}:${code}`; },
};
const connect = token => new Promise((resolve, reject) => {
    const client = io(base, { transports: ['websocket'], auth: token ? { accessToken: token } : { userId: A, role: 'Host' }, reconnection: false }); clients.push(client);
    client.once('connect', () => resolve(client)); client.once('connect_error', reject);
});
const call = (client,event,payload={}) => new Promise(resolve => client.timeout(3000).emit(event,payload,(error,result) => resolve(error ? { ok:false,error } : result)));
const receive = (client,event,match=()=>true) => new Promise((resolve,reject) => {
    const listener = value => { if (match(value)) { clearTimeout(timer); client.off(event,listener); resolve(value); } };
    const timer=setTimeout(()=>{ client.off(event,listener); reject(new Error(`Missing ${event}`)); },3000); client.on(event,listener);
});
test.before(async () => {
    server=http.createServer(); realtime=new Server(server); register({ io:realtime,rooms:new Map(),accounts });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { clients.forEach(client=>client.close()); await new Promise(resolve=>realtime.close(resolve)); });

test('invalid account handshake fails closed and guests cannot forge account IDs, roles or emails',async()=>{
    await assert.rejects(connect('invalid'),/account could not connect/);
    const host=await connect('alice'); const room=await call(host,'room:create',{nickname:'forged',accountId:C,role:'Viewer',protocolVersion:2});
    assert.equal(room.user.accountId,A); assert.equal(room.user.userId,A); assert.equal(room.user.nickname,'Alice'); assert.equal(room.user.role,'Host');
    const guest=await connect(); const joined=await call(guest,'room:join',{roomId:room.roomId,nickname:'Guest',accountId:A,userId:A,email:'private@example.test',role:'Host',protocolVersion:2});
    assert.equal(joined.user.role,'Viewer'); assert.equal(joined.user.accountId,null); assert.notEqual(joined.user.userId,A);
    assert.equal(JSON.stringify(joined.snapshot).includes('private@example.test'),false);
});

test('verified account recovery keeps a single member, role and source; other accounts cannot reuse its credentials',async()=>{
    const host=await connect('alice'), created=await call(host,'room:create',{protocolVersion:2});
    const mod=await connect('bob'), joined=await call(mod,'room:join',{roomId:created.roomId,protocolVersion:2});
    const role=receive(mod,'role_updated'); host.emit('promote_to_moderator',{roomId:created.roomId,targetId:mod.id}); await role;
    host.emit('change_video',{roomId:created.roomId,url:'https://example.com/movie.mp4'});
    const impersonator=await connect('carol'); const rejected=await call(impersonator,'room:join',{roomId:created.roomId,resumeToken:joined.resumeToken,memberId:joined.memberId,protocolVersion:2});
    assert.equal(rejected.error.code,'ACCOUNT_SESSION_MISMATCH');
    const updated=await call(mod,'auth:update',{accessToken:'bob',userId:A}); assert.equal(updated.accountId,B);
    mod.close(); const returning=await connect('bob'); const resumed=await call(returning,'room:join',{roomId:created.roomId,protocolVersion:2});
    assert.equal(resumed.memberId,joined.memberId); assert.equal(resumed.user.role,'Moderator');
    assert.equal(resumed.snapshot.members.length,2); assert.equal(resumed.snapshot.videoState.url,'https://example.com/movie.mp4');
    const replacing=await connect('bob'); const replaced=await call(replacing,'room:join',{roomId:created.roomId,protocolVersion:2});
    assert.equal(replaced.memberId,joined.memberId); assert.equal(replaced.user.role,'Moderator'); assert.equal(replaced.snapshot.members.length,2);
    assert.equal((await call(host,'auth:update',{accessToken:'refreshed'})).accountId,A);
});

test('signing in upgrades the same guest membership without disconnecting or changing Host rights/playback',async()=>{
    const guest=await connect(), created=await call(guest,'room:create',{nickname:'Guest host',protocolVersion:2});
    guest.emit('change_video',{roomId:created.roomId,url:'https://example.com/guest.mp4'});
    const result=await call(guest,'auth:update',{accessToken:'alice'}); assert.equal(result.ok,true);
    const snapshot=(await call(guest,'room:snapshot')).snapshot;
    assert.equal(snapshot.members.length,1); assert.equal(snapshot.members[0].userId,created.memberId);
    assert.equal(snapshot.members[0].role,'Host'); assert.equal(snapshot.members[0].nickname,'Alice');
    assert.equal(snapshot.members[0].accountId,A); assert.equal(snapshot.videoState.url,'https://example.com/guest.mp4');
    assert.equal((await call(guest,'auth:update',{accessToken:'bob'})).ok,false);
    assert.equal((await call(guest,'room:snapshot')).snapshot.members[0].accountId,A);
});

test('presence is friends-only, reveals no room codes, and refresh removes a blocked/unfriended account',async()=>{
    const alice=await connect('alice'), bob=await connect('bob'), stranger=await connect('carol');
    const created=await call(alice,'room:create',{protocolVersion:2});
    const update=receive(bob,'friends:presence'); await call(bob,'social:watch'); const payload=await update;
    assert.ok(payload.some(item=>item.accountId===A&&item.status==='in_room'));
    assert.equal(JSON.stringify(payload).includes(created.roomId),false);
    const none=receive(stranger,'friends:presence'); await call(stranger,'social:watch'); assert.deepEqual(await none,[]);
    friends=false; const removed=receive(bob,'friends:presence',items=>items.length===0); await call(bob,'social:watch'); alice.emit('social:refresh'); await removed;
    friends=true;
});

test('room invites derive the current room and sender from the verified socket, and Viewer cannot invite',async()=>{
    const host=await connect('alice'), created=await call(host,'room:create',{protocolVersion:2});
    const viewer=await connect('bob'); await call(viewer,'room:join',{roomId:created.roomId,protocolVersion:2});
    assert.equal((await call(viewer,'social:invite',{targetId:A})).ok,false);
    const result=await call(host,'social:invite',{targetId:B,senderId:C,roomId:'FORGED1'});
    assert.equal(result.ok,true); assert.equal(result.inviteId,`${A}:${B}:${created.roomId}`);
});

test('expiry clears verified account privileges without duplicating or replacing the active room member',async()=>{
    const guest=await connect(), created=await call(guest,'room:create',{nickname:'Short session',protocolVersion:2});
    const expired=receive(guest,'account:expired');
    assert.equal((await call(guest,'auth:update',{accessToken:'short'})).ok,true);
    await expired;
    const snapshot=(await call(guest,'room:snapshot')).snapshot;
    assert.equal(snapshot.members.length,1); assert.equal(snapshot.members[0].userId,created.memberId);
    assert.equal(snapshot.members[0].role,'Host'); assert.equal(snapshot.members[0].isAuthenticated,false);
    assert.equal((await call(guest,'social:invite',{targetId:A})).ok,false);
    assert.equal((await call(guest,'auth:update',{accessToken:'carol'})).ok,true);
    assert.equal((await call(guest,'room:snapshot')).snapshot.members[0].isAuthenticated,true);
});

test('sign-out fences an in-flight account update, and a kicked account cannot resume on another device',async()=>{
    const guest=await connect(), created=await call(guest,'room:create',{nickname:'Guest',protocolVersion:2});
    const updating=call(guest,'auth:update',{accessToken:'delayed'});
    await new Promise(resolve=>setTimeout(resolve,20)); guest.emit('auth:clear');
    assert.equal((await updating).error.code,'AUTH_REPLACED');
    assert.equal((await call(guest,'room:snapshot')).snapshot.members[0].accountId,null);
    const bob=await connect('bob'); await call(bob,'room:join',{roomId:created.roomId,protocolVersion:2});
    const kicked=receive(bob,'user_kicked'); guest.emit('kick_user',{roomId:created.roomId,targetId:bob.id}); await kicked;
    bob.close(); const returning=await connect('bob');
    assert.equal((await call(returning,'room:join',{roomId:created.roomId,protocolVersion:2})).error.code,'MEMBER_BANNED');
});

test('guest-token recovery cannot bind a duplicate account, and incomplete setup can resume its original guest Host',async()=>{
    const alice=await connect('alice'), room=await call(alice,'room:create',{protocolVersion:2});
    const guest=await connect(), joined=await call(guest,'room:join',{roomId:room.roomId,nickname:'Guest',protocolVersion:2}); guest.close();
    const duplicate=await connect('alice');
    assert.equal((await call(duplicate,'room:join',{roomId:room.roomId,resumeToken:joined.resumeToken,memberId:joined.memberId,protocolVersion:2})).error.code,'ACCOUNT_IN_ROOM');
    assert.equal((await call(alice,'room:snapshot')).snapshot.members.length,1);
    const guestAgain=await connect();
    assert.equal((await call(guestAgain,'room:join',{roomId:room.roomId,nickname:'Guest',resumeToken:joined.resumeToken,memberId:joined.memberId,protocolVersion:2})).memberId,joined.memberId);
    const host=await connect(), created=await call(host,'room:create',{nickname:'Guest Host',protocolVersion:2}); host.close();
    const incomplete=await connect('incomplete');
    const resumed=await call(incomplete,'room:join',{roomId:created.roomId,nickname:'Guest Host',resumeToken:created.resumeToken,memberId:created.memberId,protocolVersion:2});
    assert.equal(resumed.ok,true); assert.equal(resumed.memberId,created.memberId); assert.equal(resumed.user.role,'Host'); assert.equal(resumed.user.accountId,null);
    assert.equal((await call(incomplete,'auth:update',{accessToken:'carol'})).ok,true);
    assert.equal((await call(incomplete,'room:snapshot')).snapshot.members[0].userId,created.memberId);
});
