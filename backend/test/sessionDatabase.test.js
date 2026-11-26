const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const path = require('node:path');
test('session RPC checks only the caller session, expires it, and denies anonymous enumeration', async () => {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create schema auth;
            create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
            create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
            create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;`);
        await db.exec(readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611260001_watchly_session_check.sql'), 'utf8'));
        const user = '00000000-0000-4000-8000-000000000001', session = '00000000-0000-4000-8000-000000000002';
        await db.query('insert into auth.sessions values($1,$2,null)', [session,user]);
        const check = id => db.transaction(async tx => {
            await tx.exec('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
            await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ session_id: session })]);
            return (await tx.query('select public.watchly_session_active() as active')).rows[0].active;
        });
        assert.equal(await check(user), true); assert.equal(await check(session), false);
        await db.query("update auth.sessions set not_after=now()-interval '1 second'"); assert.equal(await check(user), false);
        await db.query('delete from auth.sessions'); assert.equal(await check(user), false);
        await assert.rejects(db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select public.watchly_session_active()'); }), /permission denied/);
    } finally { await db.close(); }
});
