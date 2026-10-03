// Actual Chrome and Edge + official Supabase SDK. Auth/REST/Realtime service
// boundaries are local fixtures; SQL projections, triggers and RLS are real PG.
const { chromium } = require('playwright'), assert = require('node:assert/strict');
const { fork } = require('node:child_process'), { existsSync } = require('node:fs');
const path = require('node:path'), net = require('node:net');
const createHarness = require('../../backend/testing/supabaseHarness.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = async (predicate, message) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await predicate()) return; await sleep(80); } throw new Error(message); };
(async () => {
    const h = await createHarness(), backendPort = await port(), frontendPort = await port();
    const base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base, SUPABASE_URL: h.url, SUPABASE_PUBLISHABLE_KEY: h.key, SUPABASE_SERVICE_ROLE_KEY: h.serviceKey }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl, VITE_SUPABASE_URL: h.url, VITE_SUPABASE_PUBLISHABLE_KEY: h.key }, stdio: 'ignore' });
    const browsers = [], errors = [];
    let alice, bob;
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } }, 'servers did not start');
        for (const [id, name] of [[h.A, 'alice'], [h.B, 'bob'], [h.C, 'carol']]) await h.sql(id, 'insert into public.profiles(id,username,display_name) values($1,$2,$2)', [id, name]);
        for (const executablePath of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
            assert.ok(existsSync(executablePath), `Browser missing: ${executablePath}`);
            browsers.push(await chromium.launch({ executablePath, headless: true }));
        }
        const page = async browser => { const p = await browser.newPage({ viewport: { width: 1366, height: 900 } }); p.on('pageerror', e => errors.push(e.message)); await p.addInitScript(() => localStorage.setItem('watchly-room-appearance', 'classic')); return p; };
        alice = await page(browsers[0]); bob = await page(browsers[1]);
        const login = async (p, email) => {
            await p.goto(`${base}/auth`); await p.getByLabel('Email', { exact: true }).fill(email);
            await p.getByRole('button', { name: 'Continue with email', exact: true }).click(); await p.getByLabel('Sign-in code', { exact: true }).fill('123456');
            await p.getByRole('button', { name: 'Verify code', exact: true }).click(); await p.waitForURL('**/my-watchly');
            await p.getByText('No friends yet. Find someone by username.', { exact: true }).waitFor();
        };
        const ready = async id => wait(() => h.realtime.channels().filter(c => c.id === id).length === 2, 'expected exactly two account channels');
        await login(alice, 'alice@example.test'); await login(bob, 'bob@example.test'); await ready(h.A); await ready(h.B); await sleep(250);
        const requests = bob.getByRole('region', { name: 'Friend requests', exact: true });
        const empty = p => p.getByText('No friends yet. Find someone by username.', { exact: true }).waitFor();
        const friend = (p, name) => p.locator('.my-watchly-friend-list').getByText(`@${name}`, { exact: true }).waitFor();
        const add = () => alice.getByRole('button', { name: 'Add Friend', exact: true }).click();
        await alice.getByRole('button', { name: 'Find friends', exact: true }).click(); await alice.getByLabel('Search people by username').fill('@bob');
        let marker = h.requests.length, started = Date.now(); await add(); await requests.getByRole('button', { name: 'Decline', exact: true }).waitFor();
        assert.ok(Date.now() - started < 5000, 'request latency exceeded five seconds');
        await requests.getByRole('button', { name: 'Decline', exact: true }).click(); await requests.waitFor({ state: 'hidden' }); await alice.getByRole('button', { name: 'Add Friend', exact: true }).waitFor();
        assert.ok(h.requests.slice(marker).filter(r => r.path.endsWith('/get_social_data')).every(r => r.sections.length === 1 && r.sections[0] === 'requests'), 'request/decline fetched unrelated lists');
        console.log('PASS Chrome → Edge request within realtime latency, decline clears both sides; targeted request-only reads, no reload/focus');
        await add(); await requests.getByRole('button', { name: 'Accept', exact: true }).waitFor();
        await h.adminSql("delete from public.friend_requests where sender_id=$1 and receiver_id=$2 and status='pending'", [h.A, h.B]);
        await requests.waitFor({ state: 'hidden' }); await alice.getByRole('button', { name: 'Add Friend', exact: true }).waitFor();
        const accept = async () => { await add(); await requests.getByRole('button', { name: 'Accept', exact: true }).click(); await friend(alice, 'bob'); await friend(bob, 'alice'); };
        await accept(); assert.equal(await alice.locator('.my-watchly-friend-list .person-row').count(), 1);
        await bob.getByLabel('Options for @alice').click(); await bob.getByRole('button', { name: 'Remove friend', exact: true }).click(); await empty(bob); await empty(alice);
        await accept();
        console.log('PASS request revocation, atomic accept/outgoing removal and friendship deletion update both browsers without duplicate rows');
        await alice.getByRole('button', { name: 'Create room', exact: true }).click(); await alice.locator('.room-launcher-submit').click(); await alice.waitForURL('**/room/**');
        const code = alice.url().split('/').pop(); await alice.locator('#classic-room-tab').click(); await alice.getByRole('button', { name: 'Invite friends', exact: true }).click();
        const inviteDialog = alice.getByRole('dialog', { name: 'Invite friends', exact: true }), invites = bob.getByRole('region', { name: 'Invites', exact: true });
        await ready(h.A); await sleep(200); marker = h.requests.length;
        // Respect the existing Render invite spam guard (500 ms), unchanged.
        const send = async () => { await sleep(550); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).click(); await inviteDialog.getByRole('button', { name: 'Invited', exact: true }).waitFor(); await invites.waitFor(); };
        await send(); await invites.getByRole('button', { name: 'Decline', exact: true }).click(); await invites.waitFor({ state: 'hidden' }); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).waitFor();
        assert.ok(h.requests.slice(marker).filter(r => r.path.endsWith('/get_social_data')).every(r => r.sections.length === 1 && r.sections[0] === 'invites'), 'invite transition fetched unrelated lists');
        await send(); await h.adminSql("delete from public.room_invites where room_code=$1 and status='pending'", [code]); await invites.waitFor({ state: 'hidden' }); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).waitFor();
        await send(); await invites.getByRole('button', { name: 'Join', exact: true }).click(); await bob.waitForURL(`**/room/${code}`); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).waitFor();
        const snapshot = p => p.evaluate(async () => { const { socket } = await import('/src/socket.js'); return new Promise(resolve => socket.emit('room:snapshot', {}, r => resolve(r.snapshot))); });
        assert.equal((await snapshot(alice)).members.length, 2);
        await bob.locator('#classic-room-tab').click(); await bob.locator('.room-members-queue').getByRole('button', { name: 'Account menu', exact: true }).click(); await bob.getByRole('link', { name: 'My Watchly', exact: true }).click(); await bob.waitForURL('**/my-watchly'); await friend(bob, 'alice');
        console.log('PASS live invites, decline/accept/revoke and sender Invited state; accepting uses unchanged Watchly room join/roles');
        await send(); await bob.getByLabel('Options for @alice').click(); await bob.getByRole('button', { name: 'Block', exact: true }).click(); await empty(bob); await invites.waitFor({ state: 'hidden' });
        await inviteDialog.getByText('No friends yet. Find people in My Watchly after this room.', { exact: true }).waitFor();
        await bob.getByText('Blocked people (1)', { exact: true }).click(); await bob.getByRole('button', { name: 'Unblock', exact: true }).click(); await bob.getByText('Blocked people (1)', { exact: true }).waitFor({ state: 'hidden' });
        assert.equal((await h.sql(h.A, 'select public.friend_ids()')).length, 0);
        console.log('PASS block removes both friendship and pending invite through authoritative DB state; unblock does not restore friendship');
        // Preserve A's room while simulating an actual dropped Realtime socket.
        await h.sql(h.A, 'select public.request_friend($1)', [h.B]); await requests.getByRole('button', { name: 'Accept', exact: true }).click(); await friend(bob, 'alice'); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).waitFor();
        await bob.context().setOffline(true); h.realtime.disconnect(h.B); await wait(() => h.realtime.channels().filter(c => c.id === h.B).length === 0, 'offline channel did not close');
        await h.sql(h.C, 'select public.request_friend($1)', [h.B]); await inviteDialog.getByRole('button', { name: 'Invite', exact: true }).click(); await inviteDialog.getByRole('button', { name: 'Invited', exact: true }).waitFor();
        assert.equal(await requests.count(), 0); assert.equal(await invites.count(), 0);
        await bob.context().setOffline(false); await ready(h.B); await requests.getByText('@carol', { exact: true }).waitFor(); await invites.waitFor();
        console.log('PASS network disconnect misses a request and invite; automatic rejoin reconciles both without manual reload/focus');
        await bob.getByRole('button', { name: 'Account menu', exact: true }).click(); await bob.getByRole('button', { name: 'Sign out', exact: true }).click();
        await wait(() => h.realtime.channels().every(c => c.id !== h.B), 'logout left old channels');
        await login(bob, 'carol@example.test'); await ready(h.C); assert.equal(await bob.getByRole('region', { name: 'Invites', exact: true }).count(), 0);
        assert.ok(h.realtime.channels().every(c => c.id !== h.B));
        await h.sql(h.A, 'select public.request_friend($1)', [h.C]); await bob.getByRole('region', { name: 'Friend requests', exact: true }).getByText('@alice', { exact: true }).waitFor();
        const topics = await bob.evaluate(async () => { const { supabase } = await import('/src/supabase.js'); return supabase.getChannels().map(c => c.topic); });
        assert.equal(topics.length, 2); assert.ok(topics.every(topic => topic.includes(h.C)));
        // SPA route changes must reuse these channels.
        await bob.getByRole('link', { name: 'Watchly', exact: true }).click(); await bob.getByRole('button', { name: 'Account menu', exact: true }).click(); await bob.getByRole('link', { name: 'My Watchly', exact: true }).last().click(); await bob.waitForURL('**/my-watchly'); await ready(h.C);
        console.log('PASS logout/account switch isolates requests/invites; Strict Mode and navigation keep two fixed channels per signed-in user');
        assert.deepEqual(errors, []);
    } catch (error) {
        console.error('CHANNELS', h.realtime.channels(), 'REQUESTS', h.requests.slice(-12));
        for (const p of [alice, bob]) if (p) console.error('PAGE', p.url(), await p.locator('body').innerText().catch(() => ''));
        throw error;
    } finally { await Promise.all(browsers.map(b => b.close())); backend.kill(); frontend.kill(); await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
