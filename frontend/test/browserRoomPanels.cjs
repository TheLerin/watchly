const { chromium } = require('playwright'), assert = require('node:assert/strict');
const { fork } = require('node:child_process'), { existsSync, readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path'), net = require('node:net');
const createHarness = require('../../backend/testing/supabaseHarness.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const wait = async (fn, message) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await fn()) return; await sleep(80); } throw new Error(message); };
(async () => {
    const h = await createHarness(), backendPort = await port(), frontendPort = await port();
    const base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base, SUPABASE_URL: h.url, SUPABASE_PUBLISHABLE_KEY: h.key, SUPABASE_SERVICE_ROLE_KEY: h.serviceKey, LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl, VITE_SUPABASE_URL: h.url, VITE_SUPABASE_PUBLISHABLE_KEY: h.key, VITE_VOICE_PROVIDER: 'livekit' }, stdio: 'ignore' });
    let browser, host; const errors = [], artifacts = path.resolve(__dirname, 'artifacts'); mkdirSync(artifacts, { recursive: true });
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } }, 'servers unavailable');
        await h.sql(h.A, 'insert into public.profiles(id,username,display_name) values($1,$2,$3)', [h.A, 'w'.repeat(24), 'W'.repeat(24)]);
        const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        host = await browser.newPage({ viewport: { width: 1366, height: 768 }, hasTouch: true }); host.on('pageerror', e => errors.push(e.message)); host.on('dialog', dialog => dialog.accept('Room panel movie'));
        await host.addInitScript(() => localStorage.setItem('watchly-appearance-settings', JSON.stringify({ uiTheme: 'glass-dark', roomStyle: 'cinematic', hideDelay: 'never', reduceMotion: true })));
        await host.goto(`${base}/auth`); await host.getByLabel('Email', { exact: true }).fill('alice@example.test'); await host.getByRole('button', { name: 'Continue with email', exact: true }).click();
        await host.getByLabel('Sign-in code', { exact: true }).fill('123456'); await host.getByRole('button', { name: 'Verify code', exact: true }).click(); await host.waitForURL('**/my-watchly');
        await host.getByRole('button', { name: 'Create room', exact: true }).click(); await host.locator('.room-launcher-submit').click(); await host.waitForURL('**/room/**');
        const code = host.url().split('/').pop();
        const guest = await browser.newPage(); guest.on('pageerror', e => errors.push(e.message));
        await guest.goto(`${base}/room/${code}`); await guest.getByLabel('Nickname', { exact: true }).fill('GuestWWWWWWWWWWWWWWWWWWW'); await guest.getByRole('button', { name: 'Join room', exact: true }).click();
        await wait(async () => await host.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'host not connected');
        const snapshot = () => host.evaluate(async () => { const { socket } = await import('/src/socket.js'); return new Promise(resolve => socket.emit('room:snapshot', {}, r => resolve(r.snapshot))); });
        await wait(async () => (await snapshot()).members.length === 2, 'guest did not join');
        await host.evaluate(async ({ code, base }) => { const { socket } = await import('/src/socket.js'); for (let n = 0; n < 2; n++) socket.emit('add_to_queue', { roomId: code, url: `${base}/bg-video.mp4?queue=${n}`, label: 'QueueTitleWithoutSpaces'.repeat(12) }); }, { code, base });
        await host.locator('input[type=file][accept^="video/"]').setInputFiles({ name: 'local-readiness.mp4', mimeType: 'video/mp4', buffer: readFileSync(path.resolve(__dirname, '../public/bg-video.mp4')) });
        await wait(async () => Boolean((await snapshot()).media), 'local readiness not declared');
        const appearance = async name => { await host.getByRole('button', { name: 'Room settings', exact: true }).click(); await host.locator('.appearance-panel').getByRole('button', { name: new RegExp(`^${name}(?: |$)`) }).click(); await host.keyboard.press('Escape'); await host.locator('.appearance-panel').waitFor({ state: 'hidden' }); };
        const mode = async () => host.locator('.room-shell').getAttribute('data-room-appearance');
        const open = async name => {
            const desktop = host.viewportSize().width >= 1180, cinema = desktop && await mode() === 'cinematic';
            const labels = { members: 'Members and queue', voice: 'Voice call', chat: 'Live chat', share: 'Share screen', watch: 'Watch controls', info: 'Now watching' };
            if (cinema) { const button = host.getByRole('button', { name: labels[name], exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click(); return button; }
            const label = ({ members: 'Room', voice: 'Call', chat: 'Chat', watch: 'Watch' })[name];
            const button = desktop ? host.getByRole('tab', { name: label, exact: true }) : host.getByRole('navigation', { name: 'Mobile room sections', exact: true }).getByRole('button', { name: label, exact: true });
            if (await button.getAttribute(desktop ? 'aria-selected' : 'data-active') !== 'true') await button.click(); return button;
        };
        const memberPanel = async () => host.locator(host.viewportSize().width < 1180 ? '.mobile-classic-room' : await mode() === 'cinematic' ? '.room-members-group' : '.room-right-rail');
        const closed = async () => wait(async () => host.viewportSize().width < 1180 ? await host.locator('.mobile-classic-panels').isHidden() : await mode() === 'cinematic' ? await host.locator('.room-right-rail').getAttribute('data-open-tool') === '' : await host.locator('.room-shell').getAttribute('data-classic-tab') === '', 'panel did not close');
        const checkPopover = async menu => {
            for (const action of await menu.locator('button,a').all()) {
                await action.scrollIntoViewIfNeeded();
                assert.equal(await action.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'popover action is clipped or covered');
            }
        };
        const checkBounds = async () => {
            const panel = await memberPanel();
            const geometry = await panel.evaluate(el => {
                const box = el.getBoundingClientRect();
                const bad = [...el.querySelectorAll('*')].filter(child => {
                    const rect = child.getBoundingClientRect(); if (!rect.width || !rect.height) return false;
                    return rect.left < box.left - 1 || rect.right > box.right + 1;
                }).map(child => ({ className: child.className, text: child.textContent.slice(0, 60), width: child.getBoundingClientRect().width }));
                return { left: box.left, right: box.right, width: box.width, bad, overflow: el.scrollWidth > el.clientWidth + 1, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, viewport: innerWidth };
            });
            assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
            assert.deepEqual(geometry.bad, [], JSON.stringify(geometry)); assert.equal(geometry.overflow, false); assert.equal(geometry.documentOverflow, false);
            const invite = panel.getByRole('button', { name: 'Invite friends', exact: true }); await invite.scrollIntoViewIfNeeded(); const ib = await invite.boundingBox(), pb = await panel.boundingBox();
            assert.ok(ib.x >= pb.x && ib.x + ib.width <= pb.x + pb.width + 1);
            await panel.getByRole('region', { name: 'Local file readiness', exact: true }).scrollIntoViewIfNeeded();
            await panel.getByRole('heading', { name: 'Members', exact: true }).scrollIntoViewIfNeeded();
        };
        for (const style of ['Cinematic', 'Classic']) {
            await host.setViewportSize({ width: 1366, height: 768 }); await appearance(style);
            for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [320, 740], [844, 390]]) {
                await host.setViewportSize({ width, height }); await open('members'); await checkBounds();
                const panel = await memberPanel();
                await panel.getByRole('button', { name: 'Account menu', exact: true }).click(); const account = panel.locator('.account-menu'); await account.waitFor();
                const ab = await account.boundingBox(), pb = await panel.boundingBox(); assert.ok(ab.x >= pb.x && ab.x + ab.width <= pb.x + pb.width + 1, 'account popover escapes drawer');
                await checkPopover(account);
                await panel.getByRole('button', { name: 'Account menu', exact: true }).click();
                const guestRow = panel.locator('.group.relative').filter({ hasText: 'GuestWWWW' }); await guestRow.hover(); await guestRow.locator('.room-member-menu-button').click();
                const memberMenu = panel.locator('.room-member-menu'); await memberMenu.waitFor(); await checkPopover(memberMenu);
                await panel.getByRole('heading', { name: 'Members', exact: true }).click(); assert.equal(await panel.isVisible(), true);
                await panel.getByRole('button', { name: 'Invite friends', exact: true }).click(); await host.getByRole('dialog', { name: 'Invite friends', exact: true }).waitFor();
                await host.getByRole('dialog', { name: 'Invite friends', exact: true }).getByRole('heading', { name: 'Invite friends', exact: true }).click(); assert.equal(await panel.isVisible(), true);
                await host.keyboard.press('Escape'); await host.getByRole('dialog', { name: 'Invite friends', exact: true }).waitFor({ state: 'hidden' }); assert.equal(await panel.isVisible(), true, 'modal Escape closed underlying drawer');
                const trigger = await open('members'); await trigger.click(); await closed(); await trigger.click(); await panel.waitFor();
                await host.keyboard.press('Escape'); await closed();
                if (width >= 1180 && await mode() === 'classic') assert.equal(await host.getByRole('tab', { name: 'Watch', exact: true }).getAttribute('tabindex'), '0', 'closed tablist lost keyboard entry');
                await open('members');
                const videoBox = await host.locator('.room-player-surface').boundingBox();
                const playerPoint = { x: videoBox.x + videoBox.width / 2, y: (Math.max(0, videoBox.y) + Math.min(height, videoBox.y + videoBox.height)) / 2 };
                assert.equal(await host.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.room-player-surface')), playerPoint), true, 'tap target is not within visible player');
                await host.evaluate(() => { window.drawerPlayerClicks = 0; document.querySelector('.room-player-surface').addEventListener('click', () => window.drawerPlayerClicks++); });
                if (width < 1180) await host.touchscreen.tap(playerPoint.x, playerPoint.y);
                else await host.mouse.click(playerPoint.x, playerPoint.y);
                await closed(); assert.ok(await host.evaluate(() => window.drawerPlayerClicks > 0), 'outside dismissal blocked player click');
                await open('chat'); const input = host.getByPlaceholder('Type a message...'); await input.fill('Drawer draft'); await input.click(); assert.equal(await input.isVisible(), true);
                await open('voice'); await host.getByRole('button', { name: 'Join Voice', exact: true }).waitFor(); assert.equal(await input.isVisible(), false, 'two panels are open');
                await host.getByRole('button', { name: 'Join Voice', exact: true }).click(); assert.equal(await host.locator('.room-voice:visible').count(), 1);
                await host.locator('.room-voice:visible').getByText('LiveKit voice is not configured on the backend yet.', { exact: true }).waitFor();
                assert.equal(await host.getByRole('button', { name: 'Join Voice', exact: true }).isVisible(), true);
                await host.getByRole('button', { name: 'Room settings', exact: true }).click(); await host.locator('.appearance-panel').waitFor(); assert.equal(await host.locator('.room-voice:visible').count(), 0);
                await host.locator('.appearance-panel').getByRole('heading', { name: 'Appearance', exact: true }).click(); assert.equal(await host.locator('.appearance-panel').isVisible(), true);
                await host.keyboard.press('Escape'); await host.locator('.appearance-panel').waitFor({ state: 'hidden' });
                await open('chat'); assert.equal(await input.inputValue(), 'Drawer draft'); await host.keyboard.press('Escape'); await closed();
                await open('members'); await host.screenshot({ path: path.join(artifacts, `room-panel-${style.toLowerCase()}-${width}.png`) });
                console.log(`PASS ${style} ${width}x${height}`);
            }
            console.log(`PASS ${style}: viewport/padding/long-name/queue/readiness/account-popover bounds, inside/modal clicks, toggle/switch/Escape, mouse/touch outside and unblocked player at eight sizes`);
        }
        const metrics = await host.context().newCDPSession(host);
        for (const style of ['Cinematic', 'Classic']) {
            await host.setViewportSize({ width: 1366, height: 768 }); await appearance(style);
            for (const scale of [1.25, 1.5]) {
                const width = Math.floor(1366 / scale), height = Math.floor(768 / scale);
                await host.setViewportSize({ width, height });
                // Browser zoom reduces the logical viewport and raises DPR.
                await metrics.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
                await open('members'); await checkBounds();
                console.log(`PASS ${style} zoom-equivalent ${scale * 100}% logical viewport/DPR`);
            }
            await metrics.send('Emulation.clearDeviceMetricsOverride');
        }
        await metrics.detach();
        await host.setViewportSize({ width: 1366, height: 768 }); await appearance('Cinematic');
        await host.getByRole('button', { name: 'Room settings', exact: true }).click(); await open('members');
        assert.equal(await host.locator('.appearance-panel').isVisible(), false, 'exiting settings overlaps the next drawer');
        await host.locator('.appearance-panel').waitFor({ state: 'detached' }); await (await memberPanel()).getByRole('heading', { name: 'Members', exact: true }).click();
        assert.equal(await (await memberPanel()).isVisible(), true, 'departing settings cleared the current panel ref');
        await host.keyboard.press('Escape'); await closed();
        assert.equal(await host.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))), true, 'closed drawers intercept player Escape');
        await open('watch'); await host.locator('#room-link-input').fill('https://example.test/draft.mp4'); await open('members'); assert.equal(await host.locator('#room-link-input').isVisible(), false);
        await open('watch'); assert.equal(await host.locator('#room-link-input').inputValue(), 'https://example.test/draft.mp4'); await host.keyboard.press('Escape');
        await open('members'); const panel = await memberPanel(), row = panel.locator('.group.relative').filter({ hasText: 'GuestWWWW' }); await row.hover(); await row.locator('.room-member-menu-button').click();
        await panel.getByRole('button', { name: 'Promote to mod', exact: true }).click(); assert.equal(await panel.isVisible(), true); await wait(async () => (await snapshot()).members.some(m => m.role === 'Moderator'), 'member action failed');
        await panel.getByRole('button', { name: 'Move queue item 1 down', exact: true }).click(); assert.equal(await panel.isVisible(), true);
        await panel.getByRole('button', { name: 'Remove queue item 1', exact: true }).click(); await wait(async () => (await snapshot()).queue.length === 1, 'queue removal failed');
        console.log('PASS movie tools share the same active panel, drafts survive switching, and member/queue actions remain inside the open drawer');
        assert.deepEqual(errors, []);
    } catch (error) { if (host) { console.error('PAGE', host.url(), await host.locator('body').innerText()); await host.screenshot({ path: path.join(artifacts, 'room-panels-failure.png') }).catch(() => {}); } throw error; }
    finally { await browser?.close(); backend.kill(); frontend.kill(); await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
