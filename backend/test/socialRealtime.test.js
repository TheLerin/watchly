const test = require('node:test'), assert = require('node:assert/strict');
const createHarness = require('../testing/supabaseHarness.cjs');
const { readFileSync } = require('node:fs'), path = require('node:path');
let h;
test.before(async () => {
    h = await createHarness();
    for (const [id, name] of [[h.A, 'alice'], [h.B, 'bob'], [h.C, 'carol']]) await h.sql(id, 'insert into public.profiles(id,username,display_name) values($1,$2,$2)', [id, name]);
});
test.after(async () => h?.close());
test('publication contains only four social tables and additive migration is rerunnable', async () => {
    const migration = readFileSync(path.resolve(__dirname, '../../supabase/migrations/202610040001_watchly_social_realtime.sql'), 'utf8');
    await h.adminExec(migration);
    assert.deepEqual((await h.adminSql("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).map(row => row.tablename), ['blocks', 'friend_requests', 'friendships', 'room_invites']);
});
test('targeted projections match existing source-of-truth reads, reject outsiders/anonymous and invalid scopes', async () => {
    await h.sql(h.A, 'select public.request_friend($1)', [h.B]);
    const request = (await h.sql(h.B, 'select public.get_social_data(array[\'requests\']) as data'))[0].data;
    assert.deepEqual(Object.keys(request).sort(), ['outgoing', 'requests']); assert.equal(request.requests.length, 1);
    assert.equal((await h.sql(h.C, 'select public.get_social_data(array[\'requests\']) as data'))[0].data.requests.length, 0);
    await assert.rejects(h.sql(h.A, 'select public.get_social_data(array[\'profiles\'])'), /WATCHLY_INVALID/);
    await assert.rejects(h.roleSql('anon', 'select public.get_social_data(array[\'requests\'])'), /permission denied/);
    const full = (await h.sql(h.B, 'select public.get_my_watchly() as data'))[0].data;
    assert.deepEqual(full.requests, request.requests);
});
test('private deletion invalidations contain no row data, and topic RLS denies other accounts and forged writes', async () => {
    await h.sql(h.B, 'select public.request_friend($1)', [h.A]);
    await h.sql(h.A, 'select public.remove_friend($1)', [h.B]);
    const events = await h.adminSql("select topic,payload from realtime.messages where event='social_changed'");
    assert.ok(events.some(row => row.topic === `watchly-social:${h.B}` && row.payload.table === 'friendships'));
    for (const event of events) assert.deepEqual(Object.keys(event.payload), ['table']);
    // A different feature's permissive policies must not open this namespace.
    await h.adminExec("create policy test_broad_receive on realtime.messages for select to public using(true); create policy test_broad_send on realtime.messages for insert to authenticated with check(true);");
    const own = await h.topicSql(h.A, `watchly-social:${h.A}`, 'select id from realtime.messages');
    assert.ok(own.length > 0);
    const outsider = await h.topicSql(h.C, `watchly-social:${h.A}`, 'select id from realtime.messages');
    assert.equal(outsider.length, 0);
    assert.equal((await h.roleSql('anon', 'select * from realtime.messages')).length, 0);
    await assert.rejects(h.sql(h.A, "insert into realtime.messages(topic,extension,payload) values($1,'broadcast','{}')", [`watchly-social:${h.A}`]), /row-level security/);
});
test('block effects remain hidden by original social RLS but invalidate the blocked account safely', async () => {
    await h.sql(h.A, 'select public.request_friend($1)', [h.B]);
    await h.sql(h.B, 'select public.block_person($1)', [h.A]);
    assert.equal((await h.sql(h.A, 'select * from public.blocks')).length, 0);
    const data = (await h.sql(h.A, 'select public.get_social_data(array[\'requests\',\'friends\',\'invites\']) as data'))[0].data;
    assert.equal(data.requests.length + data.outgoing.length + data.friends.length + data.invites.length, 0);
    assert.ok((await h.adminSql("select * from realtime.messages where topic=$1 and payload->>'table'='blocks'", [`watchly-social:${h.A}`])).length);
    await h.sql(h.B, 'select public.unblock_person($1)', [h.A]);
    assert.equal((await h.sql(h.A, 'select public.friend_ids()')).length, 0);
});
