// Layout and action checks use isolated Auth + PostgreSQL fixtures, never a live project.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path'), net = require('node:net');
const createHarness = require('../../backend/testing/supabaseHarness.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = async predicate => { const end = Date.now() + 30000; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw new Error('Fixture did not become ready'); };
(async () => {
    const service = await createHarness(), backendPort = await port(), frontendPort = await port();
    const base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base, SUPABASE_URL: service.url, SUPABASE_PUBLISHABLE_KEY: service.key, SUPABASE_SERVICE_ROLE_KEY: service.serviceKey }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl, VITE_SUPABASE_URL: service.url, VITE_SUPABASE_PUBLISHABLE_KEY: service.key }, stdio: 'ignore' });
    let browser;
    const errors = [], artifacts = path.resolve(__dirname, 'artifacts'); mkdirSync(artifacts, { recursive: true });
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } });
        for (const [id, username, name] of [[service.A, 'alice', 'Alice'], [service.B, 'bob', 'Bob Snow'], [service.C, 'carol', 'Carol Krishna']]) {
            await service.sql(id, 'insert into public.profiles(id,username,display_name) values($1,$2,$3)', [id, username, name]);
        }
        const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
        browser = await chromium.launch({ executablePath, headless: true });
        const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', error => errors.push(error.message));
        await p.addInitScript(() => localStorage.setItem('watchly-room-appearance', 'classic'));
        await p.goto(`${base}/auth`); await p.getByLabel('Email', { exact: true }).fill('alice@example.test');
        await p.getByRole('button', { name: 'Continue with email', exact: true }).click(); await p.getByLabel('Sign-in code', { exact: true }).fill('123456');
        await p.getByRole('button', { name: 'Verify code', exact: true }).click(); await p.waitForURL('**/my-watchly');
        const loaded = () => p.getByText('No friends yet. Find someone by username.', { exact: true }).waitFor(); await loaded();
        const theme = async value => { await p.evaluate(value => { const current = JSON.parse(localStorage.getItem('watchly-appearance-settings')); localStorage.setItem('watchly-appearance-settings', JSON.stringify({ ...current, uiTheme: value })); }, value); await p.reload(); await p.getByRole('heading', { name: /Good .*Alice/ }).waitFor(); };
        const screenshot = name => p.screenshot({ path: path.join(artifacts, `my-watchly-${name}.png`), fullPage: true });
        for (const value of ['glass-dark', 'glass-light']) {
            await theme(value); await loaded();
            assert.equal(await p.getByRole('heading', { name: /^(Invites|Friend requests|Recent rooms)$/ }).count(), 0);
            assert.equal(await p.getByLabel('Search people by username').isVisible(), false);
            await screenshot(`${value}-empty`);
        }
        await service.sql(service.A, 'select public.request_friend($1)', [service.B]); await service.sql(service.B, 'select public.request_friend($1)', [service.A]);
        await service.sql(service.C, 'select public.request_friend($1)', [service.A]);
        const invite = async () => { const r = await fetch(`${service.url}/rest/v1/rpc/send_room_invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: service.serviceKey, Authorization: `Bearer ${service.serviceKey}` }, body: JSON.stringify({ verified_sender_id: service.B, target_id: service.A, invite_room_code: 'LAT3BIQ' }) }); assert.equal(r.status, 200); return r.json(); };
        await invite();
        await p.evaluate(() => localStorage.setItem('watchly-recent-rooms', JSON.stringify([{ code: 'HCVYWNX', visitedAt: Date.now() }, { code: 'LAT3BIQ', visitedAt: Date.now() - 86400000 }])));
        const matrix = [[1920, 1080], [1440, 900], [1366, 768], [768, 1024], [390, 844], [320, 740], [2560, 1440]];
        for (const value of ['glass-dark', 'glass-light']) {
            await theme(value); await p.getByRole('heading', { name: 'Invites', exact: true }).waitFor(); await p.locator('.my-watchly-friend-list').getByText('@bob', { exact: true }).waitFor();
            for (const [width, height] of matrix) {
                await p.setViewportSize({ width, height });
                const geometry = await p.evaluate(() => {
                    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right, bottom: r.bottom }; };
                    const controls = [...document.querySelectorAll('.account-main button,.person-menu summary')].filter(e => e.getBoundingClientRect().width);
                    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, main: rect('.account-main'), friends: rect('.my-watchly-friends'), hero: rect('.my-watchly-heading'), actions: rect('.my-watchly-room-actions'), alerts: [...document.querySelectorAll('.my-watchly-alerts > section')].map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })), recent: rect('.my-watchly-recent'), targets: controls.map(e => ({ name: e.textContent, height: e.getBoundingClientRect().height })) };
                });
                assert.equal(geometry.overflow, false, `${value} ${width} overflow`); assert.ok(geometry.main.width <= 1240.5); assert.ok(Math.abs(geometry.main.width - geometry.friends.width) < 1);
                assert.ok(geometry.friends.y > geometry.hero.bottom); assert.ok(geometry.recent.y > geometry.friends.bottom);
                if (width > 900) assert.ok(Math.abs(geometry.alerts[0].y - geometry.alerts[1].y) < 1); else assert.ok(geometry.alerts[1].y > geometry.alerts[0].y);
                if (width <= 700) { assert.ok(geometry.actions.width > geometry.main.width - 1); for (const target of geometry.targets) assert.ok(target.height >= 43.5, `${target.name} touch target`); }
                await screenshot(`${value}-${width}-closed`);
                await p.getByRole('button', { name: 'Find friends', exact: true }).click(); await p.getByLabel('Search people by username').waitFor();
                await wait(() => p.getByLabel('Search people by username').evaluate(e => document.activeElement === e));
                assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
                if (width === 390 || width === 1440) await screenshot(`${value}-${width}-search`);
                await p.getByLabel('Search people by username').press('Escape'); assert.equal(await p.getByRole('button', { name: 'Find friends', exact: true }).getAttribute('aria-expanded'), 'false');
            }
        }
        console.log('PASS both themes: empty and populated states, 1920/1440/1366/768/390/320/2560 layouts, full-width Friends, alerts, 44px mobile controls, search focus/Escape and overflow');
        await p.setViewportSize({ width: 1440, height: 900 }); await p.getByRole('button', { name: 'Find friends', exact: true }).click(); await p.getByLabel('Search people by username').fill('@bob');
        await p.locator('#find-people').getByRole('button', { name: 'Friends', exact: true }).waitFor();
        const queries = () => service.requests.filter(r => r.path === '/rest/v1/rpc/search_people').length;
        const before = queries(), loads = service.requests.filter(r => r.path === '/rest/v1/rpc/get_social_data').length;
        await p.getByRole('button', { name: 'Find friends', exact: true }).click(); await p.getByRole('button', { name: 'Find friends', exact: true }).click(); await p.setViewportSize({ width: 1366, height: 768 }); await sleep(600);
        assert.equal(queries(), before); assert.equal(service.requests.filter(r => r.path === '/rest/v1/rpc/get_social_data').length, loads);
        assert.equal(await p.getByLabel('Search people by username').inputValue(), '@bob'); await p.locator('#find-people').getByRole('button', { name: 'Friends', exact: true }).waitFor(); await screenshot('search-results');
        await p.getByRole('button', { name: 'Find friends', exact: true }).click();
        const requests = p.getByRole('region', { name: 'Friend requests', exact: true }), invites = p.getByRole('region', { name: 'Invites', exact: true });
        await requests.getByRole('button', { name: 'Decline', exact: true }).click(); await p.getByRole('heading', { name: 'Friend requests', exact: true }).waitFor({ state: 'hidden' });
        const fullWidth = async () => { const a = await p.locator('.my-watchly-alerts > section').boundingBox(), m = await p.locator('.account-main').boundingBox(); assert.ok(Math.abs(a.width - m.width) < 1); };
        await fullWidth(); await screenshot('invite-only');
        await service.sql(service.C, 'select public.request_friend($1)', [service.A]);
        await invites.getByRole('button', { name: 'Decline', exact: true }).click(); await p.getByRole('heading', { name: 'Invites', exact: true }).waitFor({ state: 'hidden' }); await requests.getByRole('button', { name: 'Accept', exact: true }).waitFor(); await fullWidth(); await screenshot('request-only');
        await requests.getByRole('button', { name: 'Accept', exact: true }).click(); await p.locator('.my-watchly-friend-list').getByText('@carol', { exact: true }).waitFor(); assert.equal(await p.locator('.my-watchly-alerts').count(), 0);
        assert.equal(await p.getByRole('link', { name: 'Edit profile', exact: true }).count(), 0);
        await p.getByRole('button', { name: 'Account menu', exact: true }).click(); await p.getByRole('link', { name: 'Profile', exact: true }).waitFor(); await p.getByRole('button', { name: 'Account menu', exact: true }).click();
        await p.getByRole('button', { name: 'Join room', exact: true }).click(); assert.equal(await p.getByRole('tab', { name: 'Join room', exact: true }).getAttribute('aria-selected'), 'true');
        await p.getByPlaceholder('ROOM CODE').fill('MISSING'); await p.locator('.room-launcher-submit').click(); await p.getByText(/Room not found|expired/i).first().waitFor();
        console.log('PASS search state retained without extra search/load requests, single alert fills width, request accept/decline and invite decline, profile menu and Join launcher');
        await p.getByRole('button', { name: 'Close room launcher', exact: true }).click();
        await p.getByRole('button', { name: 'Create room', exact: true }).click(); await p.locator('.room-launcher-submit').click(); await p.waitForURL('**/room/**');
        const createdCode = p.url().split('/').pop();
        const synced = () => wait(async () => await p.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected'); await synced();
        // Leaving the room for My Watchly intentionally ends its membership. Keep
        // a real guest in the temporary room so Rejoin/Join can use a live code.
        const guest = await browser.newPage(); guest.on('pageerror', error => errors.push(error.message));
        await guest.goto(`${base}/room/${createdCode}`); await guest.getByLabel('Nickname', { exact: true }).fill('Guest watcher'); await guest.getByRole('button', { name: 'Join room', exact: true }).click();
        await wait(async () => await guest.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected');
        const home = async () => { await p.locator('#classic-room-tab').click(); await p.locator('.room-members-queue').getByRole('button', { name: 'Account menu', exact: true }).click(); await p.getByRole('link', { name: 'My Watchly', exact: true }).click(); await p.waitForURL('**/my-watchly'); await p.locator('.my-watchly-friend-list').getByText('@bob', { exact: true }).waitFor(); };
        await home();
        assert.equal(await p.locator('.my-watchly-friend-list .person-row').filter({ hasText: '@bob' }).getByRole('button', { name: 'Invite', exact: true }).isDisabled(), true);
        await p.locator('.my-watchly-recent .invite-row').filter({ hasText: `Room ${createdCode}` }).getByRole('button', { name: 'Rejoin', exact: true }).click(); await p.waitForURL(`**/room/${createdCode}`); await synced();
        await home(); await p.getByRole('button', { name: 'Join room', exact: true }).click(); await p.getByPlaceholder('ROOM CODE').fill(createdCode); await p.locator('.room-launcher-submit').click(); await p.waitForURL(`**/room/${createdCode}`); await synced();
        console.log('PASS My Watchly Create, unchanged no-active-room Invite restriction, persisted Recent room Rejoin, and valid hero Join use the existing room flow');
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); backend.kill(); frontend.kill(); await service.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
