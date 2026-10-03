const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const wait = async (predicate, message, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await sleep(120); } throw new Error(message); };

(async () => {
    const backendPort = await freePort(), frontendPort = await freePort(), base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl }, stdio: 'ignore' });
    let browser; const errors = [];
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } }, 'servers did not start');
        const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
        const pages = [];
        for (let index = 0; index < 3; index++) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true }); pages.push(page);
            page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept('Moderator local movie'));
            await page.addInitScript(() => {
                localStorage.setItem('watchly-theme', 'dark-glass'); localStorage.setItem('watchly-room-appearance', 'classic');
                let callback;
                Object.defineProperty(window, 'onYouTubeIframeAPIReady', { configurable: true, get: () => callback, set: fn => { callback = (...args) => {
                    if (!window.__ytWrapped) { const Player = window.YT.Player; window.YT.Player = new Proxy(Player, { construct(target, args) { const player = Reflect.construct(target, args, target); window.__ytPlayers ||= []; window.__ytPlayers.push(player); return player; } }); window.__ytWrapped = true; }
                    fn(...args);
                }; } });
            });
        }
        const [host, moderator, viewer] = pages;
        const synced = page => wait(async () => await page.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'room not synced');
        const instrument = page => page.evaluate(async () => { const { socket } = await import('/src/socket.js'); window.roleSocket = socket; window.roleWrites = []; socket.onAnyOutgoing((event, payload) => { if (['play_video', 'pause_video', 'seek_video', 'playback:command', 'change_video', 'playlist_update'].includes(event) && !['READY', 'RESOLVE'].includes(payload?.action)) window.roleWrites.push({ event, payload }); }); });
        const call = (page, event, payload = {}) => page.evaluate(({ event, payload }) => new Promise(resolve => window.roleSocket.emit(event, payload, resolve)), { event, payload });
        const emit = (page, event, payload) => page.evaluate(({ event, payload }) => window.roleSocket.emit(event, payload), { event, payload });
        const snapshot = async () => (await call(host, 'room:snapshot')).snapshot;
        const video = page => page.locator('.room-player-surface video');
        const values = page => video(page).evaluate(element => ({ time: element.currentTime, paused: element.paused, source: element.currentSrc }));
        const allPaused = paused => wait(async () => (await Promise.all(pages.map(values))).every(value => value.paused === paused), `players did not all become ${paused ? 'paused' : 'playing'}`);
        const openWatch = async page => {
            if (await page.locator('#room-link-input').isVisible()) return;
            const button = page.viewportSize().width >= 1180 ? page.getByRole('tab', { name: 'Watch', exact: true }) : page.locator('.mobile-classic-tabs').getByRole('button', { name: 'Watch', exact: true });
            await button.click();
        };
        const setSource = async (page, url) => { await openWatch(page); await page.locator('#room-link-input').fill(url); await page.locator('.watch-source-controls').getByRole('button', { name: 'Play Now', exact: true }).click(); };
        const member = async page => (await snapshot()).members.find(user => user.id === page._socketId);
        await host.goto(base); await host.getByRole('button', { name: 'Create room', exact: true }).first().click(); await host.getByPlaceholder('Your nickname').fill('Role host'); await host.locator('.room-launcher-submit').click(); await host.waitForURL('**/room/**'); await synced(host);
        const roomId = host.url().split('/').pop();
        for (const [page, name] of [[moderator, 'Role moderator'], [viewer, 'Role viewer']]) { await page.goto(`${base}/room/${roomId}`); await page.getByRole('textbox', { name: 'Nickname' }).fill(name); await page.getByRole('button', { name: 'Join room', exact: true }).click(); await synced(page); }
        for (const page of pages) { await instrument(page); page._socketId = await page.evaluate(() => window.roleSocket.id); }
        await setSource(host, `${base}/bg-video.mp4?roles=host`); await allPaused(false);
        await host.locator('#classic-room-tab').click();
        const modRow = host.locator('.room-members-queue .group.relative').filter({ hasText: 'Role moderator' }); await modRow.hover(); await modRow.getByRole('button').click(); await host.getByRole('button', { name: 'Promote to mod', exact: true }).click();
        await wait(async () => (await member(moderator)).role === 'Moderator', 'promotion missing');
        await openWatch(moderator); await moderator.locator('#room-link-input').waitFor();
        assert.equal((await snapshot()).controllerMemberId, (await member(host)).userId, 'promotion must not require taking the coordinator');
        await host.locator('#classic-watch-tab').click();
        await video(moderator).evaluate(element => element.pause()); await allPaused(true);
        await video(moderator).evaluate(element => { element.currentTime = 90; });
        await wait(async () => (await Promise.all(pages.map(values))).every(value => Math.abs(value.time - 90) < 0.5), 'Moderator seek to 90 did not reach all three players');
        for (const position of [30, 55, 10]) { await video(moderator).evaluate((element, value) => { element.currentTime = value; }, position); await sleep(40); }
        await wait(async () => (await Promise.all(pages.map(values))).every(value => Math.abs(value.time - 10) < 0.5), 'Moderator rapid seek did not settle');
        await video(moderator).evaluate(element => element.play()); await allPaused(false);
        console.log('PASS three isolated browsers: immediate promotion, Moderator pause/play/seek and rapid seeking synchronize Host/Moderator/Viewer');
        await viewer.evaluate(() => { window.roleWrites = []; window.originalViewerPlayer = document.querySelector('.room-player-surface video'); });
        assert.equal(await video(viewer).evaluate(element => element.controls), false);
        await video(viewer).evaluate(element => element.pause());
        await synced(viewer); await wait(async () => !(await values(viewer)).paused, 'Viewer remained privately paused');
        await video(viewer).evaluate(element => { element.currentTime = 75; }); await synced(viewer);
        await wait(async () => Math.abs((await values(viewer)).time - (await values(moderator)).time) < 1.5, 'Viewer remained privately sought');
        assert.equal((await snapshot()).videoState.isPlaying, true); assert.deepEqual(await viewer.evaluate(() => window.roleWrites), []);
        assert.equal(await viewer.evaluate(() => window.originalViewerPlayer === document.querySelector('.room-player-surface video')), true);
        await viewer.locator('[aria-label="Local video volume"]').fill('25'); assert.equal(await video(viewer).evaluate(element => element.volume), 0.25);
        await viewer.getByRole('button', { name: 'Mute video locally', exact: true }).click(); assert.equal(await video(viewer).evaluate(element => element.muted), true);
        const pip = viewer.getByRole('button', { name: 'Picture-in-picture video locally', exact: true });
        if (await pip.count()) {
            await pip.click();
            await wait(async () => await viewer.evaluate(() => Boolean(document.pictureInPictureElement)) || await viewer.getByText('Picture-in-picture is unavailable for this player.', { exact: true }).count(), 'PiP must open or explain browser rejection');
            if (await viewer.evaluate(() => Boolean(document.pictureInPictureElement))) await viewer.evaluate(() => document.exitPictureInPicture());
        }
        await viewer.getByRole('button', { name: 'Fullscreen video locally', exact: true }).click(); assert.equal(await viewer.evaluate(() => Boolean(document.fullscreenElement)), true); await viewer.evaluate(() => document.exitFullscreen());
        await viewer.evaluate(() => document.activeElement?.blur()); await viewer.keyboard.press('Space'); await sleep(400); assert.equal((await snapshot()).videoState.isPlaying, true);
        await viewer.setViewportSize({ width: 390, height: 844 }); await wait(async () => !(await values(viewer)).paused, 'mobile viewer did not load');
        const bounds = await video(viewer).boundingBox(); await viewer.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await video(viewer).evaluate(element => element.pause()); await synced(viewer); await wait(async () => !(await values(viewer)).paused, 'mobile Viewer remained paused');
        assert.deepEqual(await viewer.evaluate(() => window.roleWrites), []);
        await viewer.setViewportSize({ width: 1280, height: 720 }); await allPaused(false);
        console.log('PASS Viewer native pause/seek and mobile pause automatically resync; volume, mute and fullscreen stay local; keyboard denial emits no shared commands');

        await moderator.setViewportSize({ width: 390, height: 844 });
        // Keep the 96-second fixture away from its end during the queue checks.
        await video(moderator).evaluate(element => { element.currentTime = 0; });
        await openWatch(moderator);
        for (const label of ['first', 'second']) { await moderator.locator('#room-link-input').fill(`${base}/bg-video.mp4?queue=${label}`); await moderator.getByRole('button', { name: 'Queue', exact: true }).click(); }
        await moderator.locator('.mobile-classic-tabs').getByRole('button', { name: 'Room', exact: true }).click(); await moderator.getByRole('button', { name: 'Move queue item 2 up', exact: true }).click();
        await wait(async () => (await snapshot()).queue[0]?.url.endsWith('second'), 'Moderator reorder failed');
        await moderator.getByRole('button', { name: 'Remove queue item 2', exact: true }).click(); await wait(async () => (await snapshot()).queue.length === 1, 'Moderator remove failed');
        await moderator.getByRole('button', { name: 'Play Next', exact: true }).click(); await wait(async () => (await snapshot()).videoState.url.endsWith('second'), 'Moderator Play Next failed'); await moderator.locator('.mobile-classic-tabs').getByRole('button', { name: 'Watch', exact: true }).click(); await allPaused(false);
        await moderator.setViewportSize({ width: 1280, height: 720 });
        await setSource(moderator, `${base}/bg-video.mp4?roles=moderator`); await allPaused(false);
        await wait(async () => (await values(host)).source.endsWith('roles=moderator'), 'Moderator direct source failed');
        await video(moderator).evaluate(element => element.pause()); await allPaused(true);
        // Revoke authority while a direct seek debounce is still pending.
        await video(moderator).evaluate(element => { element.currentTime = 66; });
        await emit(host, 'demote_to_viewer', { roomId, targetId: moderator._socketId });
        await wait(async () => !(await member(moderator)).permissions.canControlPlayback, 'demotion did not remove rights'); await sleep(500);
        assert.equal(await moderator.locator('#room-link-input').count(), 0); assert.notEqual((await snapshot()).videoState.playedSeconds, 66);
        await emit(host, 'promote_to_moderator', { roomId, targetId: moderator._socketId }); await wait(async () => (await member(moderator)).role === 'Moderator', 're-promotion missing'); await openWatch(moderator); await moderator.locator('#room-link-input').waitFor();
        console.log('PASS Moderator queue add/reorder/remove/play-next/source and immediate demotion cancel a pending unauthorized seek');

        const file = { name: 'role-test.mp4', mimeType: 'video/mp4', buffer: readFileSync(path.resolve(__dirname, '../public/bg-video.mp4')) };
        await moderator.locator('input[type=file][accept^="video/"]').setInputFiles(file);
        for (const page of [host, viewer]) { await page.getByRole('heading', { name: 'Choose the same local file', exact: true }).waitFor(); await page.locator('input[type=file][accept^="video/"]').setInputFiles(file); }
        await wait(async () => (await snapshot()).readiness.readyCount === 3, 'same-file readiness missing');
        await moderator.evaluate(() => document.activeElement?.blur()); await moderator.keyboard.press('Space'); await allPaused(false);
        await video(moderator).evaluate(element => element.pause()); await allPaused(true);
        await video(moderator).evaluate(element => { element.currentTime = 30; }); await wait(async () => (await Promise.all(pages.map(values))).every(value => Math.abs(value.time - 30) < 0.5), 'Moderator local seek failed');
        await moderator.keyboard.press('Space'); await allPaused(false); await video(viewer).evaluate(element => element.pause()); await synced(viewer); await wait(async () => !(await values(viewer)).paused, 'local Viewer remained paused');
        await moderator.context().setOffline(true); await moderator.evaluate(() => window.roleSocket.io.engine.close()); await moderator.context().setOffline(false); await synced(moderator);
        moderator._socketId = await moderator.evaluate(() => window.roleSocket.id);
        assert.equal((await member(moderator)).role, 'Moderator'); assert.equal((await member(moderator)).permissions.canControlPlayback, true);
        await moderator.keyboard.press('Space'); await allPaused(false);
        console.log('PASS Moderator initiates local same-file flow, scheduled play/pause/seeking and reconnect retains role/capabilities; local Viewer pause resyncs');

        // Exercise the actual YouTube API and iframe; no fabricated media events.
        await setSource(moderator, 'https://youtu.be/GvgqDSnpRQM');
        const yt = page => page.evaluate(() => { const p = window.__ytPlayers?.at(-1); return p ? { id: p.getVideoData?.()?.video_id, state: p.getPlayerState?.(), time: p.getCurrentTime?.() } : null; });
        await wait(async () => (await Promise.all(pages.map(yt))).every(value => value?.id === 'GvgqDSnpRQM' && value.state === 1), 'real Moderator YouTube source did not play', 45000);
        const playersBeforeTablet = await viewer.evaluate(() => window.__ytPlayers.length);
        await viewer.setViewportSize({ width: 768, height: 1024 });
        await wait(async () => {
            const value = await yt(viewer);
            return await viewer.evaluate(count => window.__ytPlayers.length > count && typeof window.__ytPlayers.at(-1)?.getVolume === 'function', playersBeforeTablet) && value?.id === 'GvgqDSnpRQM' && value.state === 1;
        }, 'tablet YouTube player did not become ready after responsive remount', 45000);
        await viewer.locator('[aria-label="Local video volume"]').fill('30');
        await wait(async () => await viewer.evaluate(() => window.__ytPlayers?.at(-1)?.getVolume?.()) === 30, 'YouTube local volume change was not acknowledged by the iframe');
        if (await viewer.getByRole('button', { name: 'Mute video locally', exact: true }).count()) await viewer.getByRole('button', { name: 'Mute video locally', exact: true }).click();
        await wait(async () => await viewer.evaluate(() => window.__ytPlayers?.at(-1)?.isMuted?.()), 'YouTube local mute change was not acknowledged by the iframe');
        await viewer.evaluate(() => { window.roleWrites = []; window.__ytPlayers.at(-1).pauseVideo(); }); await synced(viewer);
        await wait(async () => (await yt(viewer)).state === 1, 'YouTube Viewer remained paused');
        await viewer.evaluate(() => window.__ytPlayers.at(-1).seekTo(65, true));
        await wait(async () => Math.abs((await yt(viewer)).time - (await yt(moderator)).time) < 1.5, 'YouTube Viewer private seek was not restored'); assert.deepEqual(await viewer.evaluate(() => window.roleWrites), []);
        await moderator.evaluate(() => window.__ytPlayers.at(-1).pauseVideo()); await wait(async () => !(await snapshot()).videoState.isPlaying && (await Promise.all(pages.map(yt))).every(value => value.state !== 1), 'Moderator YouTube pause failed');
        await viewer.evaluate(() => window.__ytPlayers.at(-1).seekTo(70, true));
        await wait(async () => (await yt(viewer)).state !== 1 && Math.abs((await yt(viewer)).time - (await yt(moderator)).time) < 1.5, 'Viewer paused YouTube seek must restore position and paused intent');
        assert.deepEqual(await viewer.evaluate(() => window.roleWrites), []);
        await moderator.evaluate(() => window.__ytPlayers.at(-1).seekTo(25, true)); await wait(async () => Math.abs((await snapshot()).videoState.playedSeconds - 25) < 1.5 && (await Promise.all(pages.map(yt))).every(value => Math.abs(value.time - 25) < 1.5), 'Moderator native YouTube seek failed');
        await moderator.evaluate(() => window.__ytPlayers.at(-1).playVideo()); await wait(async () => (await Promise.all(pages.map(yt))).every(value => value.state === 1), 'Moderator YouTube resume failed');
        console.log('PASS genuine YouTube: Moderator source/play/pause/native seek and Viewer pause/private seek reconciliation without echoes');
        await setSource(moderator, 'https://youtube.com/playlist?list=PLBCF2DAC6FFB574DE');
        await wait(async () => (await snapshot()).videoState.playlistItems?.length > 1 && !(await moderator.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'Moderator real playlist not ready', 45000);
        await moderator.getByRole('button', { name: 'Next playlist video', exact: true }).click(); await wait(async () => (await snapshot()).videoState.playlistIndex === 1, 'Moderator Next failed');
        let selected = (await snapshot()).videoState;
        await wait(async () => (await Promise.all(pages.map(yt))).every(value => value.id === selected.currentVideoId), 'Moderator Next did not select the same item for all clients');
        await moderator.getByRole('button', { name: 'Previous playlist video', exact: true }).click(); await wait(async () => (await snapshot()).videoState.playlistIndex === 0, 'Moderator Previous failed');
        await wait(async () => !(await moderator.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'previous item not cued');
        await moderator.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).click(); await wait(async () => (await Promise.all(pages.map(yt))).every(value => value.state === 1), 'Moderator playlist play did not reach everyone');
        await moderator.getByRole('button', { name: 'Pause playlist', exact: true }).click(); await wait(async () => !(await snapshot()).videoState.isPlaying, 'Moderator playlist pause failed');
        selected = (await snapshot()).videoState;
        await viewer.evaluate(() => window.__ytPlayers.at(-1).playVideo()); await synced(viewer);
        await wait(async () => (await yt(viewer)).state !== 1 && (await yt(viewer)).id === selected.currentVideoId, 'Viewer cannot privately play a paused playlist');
        assert.deepEqual(await viewer.evaluate(() => window.roleWrites), []);
        console.log('PASS Moderator real playlist discovery/Next/Previous/play/pause, selected item agreement and Viewer paused-play reconciliation');
        await viewer.setViewportSize({ width: 1280, height: 720 });
        await require('./roleAutoHideChecks.cjs')({ host, viewer, setSource, base, snapshot, video, values, wait, sleep });
        assert.deepEqual(errors, []);
        console.log('PASS role/control interaction matrix with no browser exceptions');
    } catch (error) {
        if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error('PAGE', page.url(), await page.locator('body').innerText().catch(() => ''), await page.evaluate(() => ({ writes: window.roleWrites, player: [...document.querySelectorAll('.room-player-surface video')].map(v => ({ time: v.currentTime, paused: v.paused })), yt: window.__ytPlayers?.at(-1)?.getVideoData?.() })).catch(() => null));
        console.error('PAGE ERRORS', errors); throw error;
    } finally { await browser?.close(); backend.kill(); frontend.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
