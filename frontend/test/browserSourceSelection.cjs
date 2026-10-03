const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const wait = async (predicate, message, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw new Error(message); };

(async () => {
    const backendPort = await freePort(), frontendPort = await freePort(), base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl }, stdio: 'ignore' });
    let browser;
    const errors = [];
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } }, 'servers did not start');
        const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        const host = await browser.newPage(), moderator = await browser.newPage();
        for (const page of [host, moderator]) {
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => { localStorage.setItem('watchly-room-appearance', 'classic'); });
        }
        const synced = page => wait(async () => await page.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'room not synced');
        const call = (page, event, payload = {}) => page.evaluate(({ event, payload }) => new Promise(resolve => window.selectionSocket.emit(event, payload, resolve)), { event, payload });
        const emit = (page, event, payload) => page.evaluate(({ event, payload }) => { window.selectionSocket.emit(event, payload); }, { event, payload });
        await host.goto(base); await host.getByRole('button', { name: 'Create room', exact: true }).first().click(); await host.getByPlaceholder('Your nickname').fill('Selection host'); await host.locator('.room-launcher-submit').click(); await host.waitForURL('**/room/**'); await synced(host);
        const roomId = host.url().split('/').pop();
        await moderator.goto(`${base}/room/${roomId}`); await moderator.getByRole('textbox', { name: 'Nickname' }).fill('Selection moderator'); await moderator.getByRole('button', { name: 'Join room', exact: true }).click(); await synced(moderator);
        for (const page of [host, moderator]) await page.evaluate(async () => {
            const { socket } = await import('/src/socket.js'); window.selectionSocket = socket; window.selectionWrites = [];
            socket.onAnyOutgoing((event, payload) => { if (event === 'media:declare') window.selectionWrites.push(payload); });
            const timeout = socket.timeout.bind(socket);
            socket.timeout = milliseconds => {
                const target = timeout(milliseconds);
                return { emit(event, payload, ack) {
                    return target.emit(event, payload, event === 'room:snapshot' && window.snapshotDelay
                        ? (...args) => setTimeout(() => ack(...args), window.snapshotDelay) : ack);
                } };
            };
            window.prompt = () => {
                window.promptCalls = (window.promptCalls || 0) + 1;
                if (window.promptMode === 'unsupported') throw new Error('prompt() is not supported.');
                if (window.promptMode === 'focus') window.dispatchEvent(new Event('focus'));
                if (window.promptMode === 'resync') window.dispatchEvent(new Event('online'));
                return 'Private movie';
            };
        });
        const file = { name: 'PRIVATE-device-filename.mp4', mimeType: 'video/mp4', buffer: readFileSync(path.resolve(__dirname, '../public/bg-video.mp4')) };
        const replacement = { ...file, buffer: Buffer.concat([file.buffer, Buffer.from([0])]) };
        const choose = async (page, selected) => {
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: 'Watch Local File', exact: true }).click();
            await (await chooser).setFiles(selected);
        };
        const snapshot = async () => (await call(host, 'room:snapshot')).snapshot;
        await host.evaluate(() => { window.snapshotDelay = 1500; window.promptMode = 'focus'; });
        await choose(host, file);
        await wait(async () => await host.evaluate(() => window.promptCalls === 1), 'file was not inspected');
        assert.equal(await host.locator('.room-ping-button').getAttribute('data-connection-phase'), 'resyncing');
        assert.equal(await host.evaluate(() => window.selectionWrites.length), 0, 'source declared before snapshot restoration');
        await wait(async () => (await snapshot()).media?.sourceType === 'local-file', 'selected file was rejected during foreground sync');
        await synced(host);
        assert.equal(await host.evaluate(() => window.selectionWrites.length), 1);
        const privateUri = await host.locator('.room-player-surface video').evaluate(video => video.currentSrc);
        assert.match(privateUri, /^blob:/);
        console.log('PASS focus after native-file selection waits for the real snapshot and declares once');

        await host.evaluate(() => { window.snapshotDelay = 0; window.promptMode = 'unsupported'; });
        await choose(host, replacement);
        await wait(async () => (await snapshot()).media?.displayTitle === 'Local movie', 'unsupported native prompt rejected file');
        await synced(host);
        assert.equal(JSON.stringify((await snapshot()).media).includes(file.name), false);
        console.log('PASS unsupported title prompts use a generic private title and still select the local file');

        await host.evaluate(() => { window.snapshotDelay = 1500; window.promptMode = 'focus'; window.selectionWrites = []; });
        const beforeDisconnect = await host.locator('.room-player-surface video').evaluate(video => video.currentSrc);
        await choose(host, file);
        await wait(async () => await host.evaluate(() => window.promptCalls === 3), 'disconnect test did not reach title');
        await host.evaluate(() => window.selectionSocket.disconnect());
        await host.getByText('Wait for the room to reconnect before selecting a new source.', { exact: true }).first().waitFor();
        assert.equal(await host.evaluate(() => window.selectionWrites.length), 0);
        assert.equal(await host.locator('.room-player-surface video').evaluate(video => video.currentSrc), beforeDisconnect, 'cancelled selection discarded original private file');
        await host.evaluate(() => { window.snapshotDelay = 0; window.selectionSocket.connect(); }); await synced(host); await sleep(1800);
        assert.equal(await host.evaluate(() => window.selectionWrites.length), 0, 'cancelled source replayed after reconnect');
        console.log('PASS real disconnect cancels selection, preserves original Blob and never replays after reconnect');

        const targetId = await moderator.evaluate(() => window.selectionSocket.id);
        await moderator.evaluate(() => { window.snapshotDelay = 300; window.dispatchEvent(new Event('focus')); });
        await wait(async () => await moderator.locator('.room-ping-button').getAttribute('data-connection-phase') === 'resyncing', 'missing-file member did not request snapshot');
        await synced(moderator);
        await moderator.getByRole('heading', { name: 'Choose the same local file', exact: true }).waitFor();
        assert.equal((await snapshot()).members.find(member => member.id === targetId).localReady, false);
        console.log('PASS room resync completes without a private file while same-file readiness remains false');

        await emit(host, 'promote_to_moderator', { roomId, targetId }); await moderator.locator('#room-link-input').waitFor();
        // This case must actually wait for a snapshot. A second focus within the
        // recovery wake throttle can be ignored, so force its recovery path.
        await moderator.evaluate(() => { window.snapshotDelay = 1500; window.promptMode = 'resync'; });
        await choose(moderator, file);
        await wait(async () => await moderator.evaluate(() => window.promptCalls === 1), 'Moderator file was not inspected');
        assert.equal(await moderator.locator('.room-ping-button').getAttribute('data-connection-phase'), 'resyncing');
        await emit(host, 'demote_to_viewer', { roomId, targetId });
        await moderator.getByText('Only the Host and Moderators can choose the shared source.', { exact: true }).first().waitFor();
        assert.equal(await moderator.evaluate(() => window.selectionWrites.length), 0, 'demoted member declared a source');
        assert.deepEqual(errors, []);
        console.log('PASS permissions are rechecked after waiting; demoted Moderator emits no declaration');
    } catch (error) {
        if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error('PAGE', page.url(), await page.locator('body').innerText().catch(() => ''));
        console.error('BROWSER ERRORS', errors); throw error;
    } finally { await browser?.close(); backend.kill(); frontend.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
