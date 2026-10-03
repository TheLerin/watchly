const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', C = '00000000-0000-4000-8000-000000000003';
let db;
const asUser = (id, sql, args = []) => db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    return (await tx.query(sql, args)).rows;
});
const sendInvite = (sender,target,code) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query('select public.send_room_invite($1,$2,$3) as id',[sender,target,code])).rows;
});
test.before(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to authenticated; insert into auth.users values('${A}'),('${B}'),('${C}');`);
    await db.exec(readFileSync(path.resolve(__dirname, '../../supabase/migrations/202610030001_watchly_accounts.sql'), 'utf8'));
    for (const [id, name] of [[A, 'alice'], [B, 'bob'], [C, 'carol']]) await asUser(id, 'insert into public.profiles(id,username,display_name) values($1,$2,$2)', [id, name]);
});
test.after(async () => db?.close());

test('real PostgreSQL migration enforces profile ownership, canonical usernames and safe search columns', async () => {
    await asUser(A, 'insert into public.profiles(id,username,display_name,avatar_url) values($1,$2,$3,$4) on conflict(id) do update set id=excluded.id,username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url returning id,username,display_name', [A,'alice','alice',null]);
    await assert.rejects(asUser(A, 'update public.profiles set id=$1 where id=$2', [C,A]), /row-level security/);
    assert.equal((await asUser(A, 'update public.profiles set display_name=$1 where id=$2 returning id', ['forged', B])).length, 0);
    await assert.rejects(asUser(A, 'insert into public.profiles(id,username,display_name) values($1,$2,$3)', [C, 'stolen', 'stolen']));
    await assert.rejects(asUser(A, 'update public.profiles set username=$1 where id=$2', ['ALICE', A]), /check constraint/);
    await assert.rejects(asUser(A, 'update public.profiles set username=$1 where id=$2', ['bob', A]), /unique constraint/);
    await assert.rejects(asUser(A, 'select last_seen_at from public.profiles'), /permission denied/);
    const people = await asUser(A, "select * from public.search_people('bob')");
    assert.deepEqual(Object.keys(people[0]).sort(), ['avatar_url', 'display_name', 'id', 'username']);
    assert.equal((await asUser(A, "select * from public.search_people('bob@example.com')")).length, 0);
    await assert.rejects(db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select * from public.profiles'); }), /permission denied/);
});

test('opposite and repeated requests reconcile into exactly one friendship; outsiders cannot respond or write tables', async () => {
    await assert.rejects(asUser(A, 'select public.request_friend($1)', [A]), /WATCHLY_SELF/);
    assert.equal((await asUser(A, 'select public.request_friend($1) as status', [B]))[0].status, 'pending');
    assert.equal((await asUser(A, 'select public.request_friend($1) as status', [B]))[0].status, 'pending');
    const request = (await asUser(B, 'select id from public.friend_requests'))[0];
    await assert.rejects(asUser(C, 'select public.respond_friend_request($1,true)', [request.id]), /WATCHLY_FORBIDDEN/);
    assert.equal((await asUser(C, 'select * from public.friend_requests')).length, 0);
    assert.equal((await asUser(B, 'select public.request_friend($1) as status', [A]))[0].status, 'friends');
    await asUser(B, 'select public.respond_friend_request($1,true)', [request.id]);
    assert.equal((await asUser(A, 'select * from public.friendships')).length, 1);
    assert.equal((await asUser(C, 'select * from public.friendships')).length, 0);
    await assert.rejects(asUser(C, 'insert into public.friendships(user_low,user_high) values($1,$2)', [A, C]), /permission denied/);
    assert.deepEqual((await asUser(A, 'select public.friend_ids() as id')).map(row => row.id), [B]);
});

test('invites are friend-only, deduplicated, private, receiver-owned and expire', async () => {
    await assert.rejects(asUser(A, 'select public.send_room_invite($1,$2,$3)', [A,B,'FORGED1']), /permission denied/);
    await assert.rejects(sendInvite(A,C,'ABCDEFG'), /WATCHLY_NOT_FRIENDS/);
    const invite = (await sendInvite(A,B,'ABCDEFG'))[0].id;
    assert.equal((await sendInvite(A,B,'ABCDEFG'))[0].id, invite);
    assert.equal((await asUser(C, 'select * from public.room_invites')).length, 0);
    await assert.rejects(asUser(A, 'select public.respond_room_invite($1,true)', [invite]), /WATCHLY_FORBIDDEN/);
    assert.equal((await asUser(B, 'select public.respond_room_invite($1,true) as code', [invite]))[0].code, 'ABCDEFG');
    const expired = (await sendInvite(A,B,'HIJKLMN'))[0].id;
    await db.query("update public.room_invites set expires_at=now()-interval '1 minute' where id=$1", [expired]);
    await assert.rejects(asUser(B, 'select public.respond_room_invite($1,true)', [expired]), /WATCHLY_EXPIRED/);
});

test('block atomically hides search/presence, removes friends and invites; unblock does not restore friendship', async () => {
    await sendInvite(A,B,'ABCDEFG');
    await asUser(A, 'select public.block_person($1)', [B]);
    assert.equal((await asUser(B, "select * from public.search_people('alice')")).length, 0);
    assert.equal((await asUser(B, 'select public.friend_ids()')).length, 0);
    assert.equal((await asUser(B, 'select * from public.blocks')).length, 0);
    assert.equal((await asUser(B, 'select * from public.room_invites')).length, 0);
    await assert.rejects(asUser(B, 'select public.request_friend($1)', [A]), /WATCHLY_BLOCKED/);
    const social = (await asUser(A, 'select public.get_my_watchly() as data'))[0].data;
    assert.equal(social.friends.length, 0); assert.equal(social.blocks[0].id, B);
    await asUser(A, 'select public.unblock_person($1)', [B]);
    assert.equal((await asUser(A, 'select * from public.friendships')).length, 0);
    await asUser(A, 'select public.request_friend($1)', [B]);
    const request = (await asUser(B, "select id from public.friend_requests where status='pending'"))[0];
    await asUser(B, 'select public.respond_friend_request($1,true)', [request.id]);
    await asUser(A, 'select public.remove_friend($1)', [B]);
    assert.equal((await asUser(A, 'select * from public.friendships')).length, 0);
    await asUser(A, 'select public.request_friend($1)', [B]);
    await db.query('delete from auth.users where id=$1', [B]);
    assert.equal((await db.query('select * from public.friend_requests')).rows.length, 0);
});
