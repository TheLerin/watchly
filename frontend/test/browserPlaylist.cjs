const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const wait = async (predicate, message, timeout = 45000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error(message);
};
const ytDiagnostic = page => page.evaluate(() => {
    const player = window.__ytPlayers?.at(-1), data = player?.getVideoData?.();
    return { id: data?.video_id, title: data?.title, state: player?.getPlayerState?.(), playlist: player?.getPlaylist?.(), time: player?.getCurrentTime?.() };
}).catch(() => null);

(async () => {
    const backendPort = await freePort(), frontendPort = await freePort();
    const base = `http://127.0.0.1:${frontendPort}`, backendUrl = `http://127.0.0.1:${backendPort}`;
    const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: base }, stdio: 'ignore' });
    const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl }, stdio: 'ignore' });
    let browser; const errors = [];
    try {
        await wait(async () => { try { return (await fetch(base)).ok && (await fetch(backendUrl)).ok; } catch { return false; } }, 'servers did not start');
        const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
        browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
        const makePage = async () => {
            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(45000);
            page.on('pageerror', error => { errors.push(error.message); console.error('JS ERROR', error.message); });
            page.on('requestfailed', request => { if (/iframe_api|\/embed\//.test(request.url())) console.error('YT NETWORK', request.url(), request.failure()?.errorText); });
            await page.addInitScript(() => {
                localStorage.setItem('watchly-theme', 'dark-glass');
                localStorage.setItem('watchly-room-appearance', 'classic');
                // Observe the genuine API's existing player; no simulated media.
                let callback;
                Object.defineProperty(window, 'onYouTubeIframeAPIReady', {
                    configurable: true, get: () => callback,
                    set: fn => { callback = (...args) => {
                        if (!window.__ytWrapped) {
                            const Player = window.YT.Player;
                            window.YT.Player = new Proxy(Player, { construct(target, args) {
                                const player = Reflect.construct(target, args, target);
                                window.__ytPlayers ||= [];
                                window.__ytPlayers.push(player);
                                return player;
                            } });
                            window.__ytWrapped = true;
                        }
                        fn(...args);
                    }; },
                });
            });
            return page;
        };
        const host = await makePage(), viewer = await makePage();
        await host.goto(base, { waitUntil: 'domcontentloaded' });
        await host.getByRole('button', { name: 'Create room', exact: true }).first().click();
        await host.getByPlaceholder('Your nickname').fill('Playlist host');
        await host.locator('.room-launcher-submit').click();
        await host.waitForURL('**/room/**');
        const roomId = host.url().split('/').pop();
        await viewer.goto(`${base}/room/${roomId}`, { waitUntil: 'domcontentloaded' });
        await viewer.getByRole('textbox', { name: 'Nickname' }).fill('Playlist viewer');
        await viewer.getByRole('button', { name: 'Join room', exact: true }).click();
        await viewer.locator('.room-shell').waitFor();
        const socketCall = (page, event, payload) => page.evaluate(async ({ event, payload }) => {
            const { socket } = await import('/src/socket.js');
            return new Promise(resolve => socket.emit(event, payload, resolve));
        }, { event, payload });
        const state = async () => (await socketCall(host, 'room:snapshot', {})).snapshot.videoState;
        const yt = page => page.evaluate(() => {
            const player = window.__ytPlayers?.at(-1);
            return player?.getVideoData ? { id: player.getVideoData()?.video_id, time: player.getCurrentTime(), status: player.getPlayerState(), duration: player.getDuration(), playlist: player.getPlaylist() } : null;
        });
        await host.locator('#room-link-input').fill(process.env.YOUTUBE_PLAYLIST_URL || 'https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE');
        await host.getByRole('button', { name: 'Play Now', exact: true }).first().click();
        await wait(async () => (await state()).playlistItems?.length > 1, 'real playlist did not resolve', 20000);
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'selected item did not become cued');
        let current = await state();
        assert.equal(current.isPlaying, false);
        assert.equal(current.playlistIndex, 0);
        await wait(async () => (await yt(viewer))?.id === current.currentVideoId, 'viewer did not cue the same item');
        assert.ok(((await yt(host)).playlist?.length || 0) <= 1);
        assert.ok(((await yt(viewer)).playlist?.length || 0) <= 1);
        console.log('PASS real playlist discovery, paused readiness and same selected video', { count: current.playlistItems.length, id: current.currentVideoId });
        await host.getByRole('button', { name: 'Next playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 1, 'paused Next failed');
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'next item not ready');
        assert.equal((await state()).isPlaying, false);
        await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).click();
        await wait(async () => (await yt(host))?.status === 1 && (await yt(viewer))?.status === 1, 'playlist did not play for both members');
        current = await state();
        await host.evaluate(() => window.__ytPlayers.at(-1).seekTo(12, true));
        await wait(async () => (await yt(viewer)).time >= 11 && (await yt(viewer)).id === current.currentVideoId, 'playlist seek did not synchronize');
        await host.locator('.playlist-controls').getByRole('button', { name: 'Pause playlist', exact: true }).click();
        await wait(async () => !(await state()).isPlaying, 'pause not synchronized');
        await host.getByRole('button', { name: 'Previous playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 1 && (await state()).playedSeconds < 1, 'Previous did not restart after five seconds');
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'restart did not cue');
        await host.getByRole('button', { name: 'Previous playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 0, 'Previous did not select prior item');
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'previous not ready');
        await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).click();
        await wait(async () => (await yt(host))?.status === 1, 'previous item did not start');
        // Let real ENDED events advance multiple items, without synthesizing them.
        for (let index = 0; index < 2; index++) {
            await host.evaluate(() => { const player = window.__ytPlayers.at(-1); player.seekTo(player.getDuration() - 1, true); });
            await wait(async () => (await state()).playlistIndex === index + 1, 'real ENDED did not advance playlist');
            current = await state();
            await wait(async () => (await yt(host))?.id === current.currentVideoId && (await yt(viewer))?.id === current.currentVideoId && (await yt(host)).status === 1 && (await yt(viewer)).status === 1, 'auto-next did not continue both players');
        }
        const late = await makePage();
        await host.evaluate(() => window.__ytPlayers.at(-1).seekTo(14, true));
        await new Promise(resolve => setTimeout(resolve, 1700));
        await late.goto(`${base}/room/${roomId}`, { waitUntil: 'domcontentloaded' });
        await late.getByRole('textbox', { name: 'Nickname' }).fill('Late playlist viewer');
        await late.getByRole('button', { name: 'Join room', exact: true }).click();
        current = await state();
        await wait(async () => (await yt(late))?.id === current.currentVideoId && (await yt(late)).time >= 13, 'late join did not restore current playlist item/time');
        await viewer.reload();
        await wait(async () => (await yt(viewer))?.id === current.currentVideoId && (await yt(viewer)).time >= 13, 'refresh did not restore current playlist item/time');
        assert.equal(await host.locator('.room-player-surface iframe').count(), 1);
        assert.equal(await viewer.locator('.room-player-surface iframe').count(), 1);
        assert.equal(await host.evaluate(() => window.__ytPlayers.length), 1);
        // Every remaining genuine ENDED event must advance exactly one item.
        for (let index = current.playlistIndex; index < current.playlistItems.length; index++) {
            await wait(async () => (await yt(host))?.status === 1 && (await yt(viewer))?.status === 1, 'remaining item did not start');
            await host.evaluate(() => { const player = window.__ytPlayers.at(-1); player.seekTo(player.getDuration() - 1, true); });
            if (index < current.playlistItems.length - 1) {
                await wait(async () => (await state()).playlistIndex === index + 1, `playlist stopped after item ${index + 1}`);
            } else {
                await wait(async () => (await state()).playlistStatus === 'finished', 'final item did not stop the playlist');
                assert.equal((await state()).isPlaying, false);
            }
            console.log(`PASS real completion of playlist item ${index + 1}`);
        }
        const items = current.playlistItems;
        await viewer.reload();
        await wait(async () => (await yt(viewer))?.id === items.at(-1), 'finished playlist refresh selected the wrong video');
        assert.notEqual((await yt(viewer)).status, 1);
        // The same input accepts a selected video with a conflicting URL index.
        await host.locator('#room-link-input').fill(`https://youtu.be/${items[3]}?list=PLBCF2DAC6FFB574DE&index=1`);
        await host.getByRole('button', { name: 'Play Now', exact: true }).first().click();
        await wait(async () => (await state()).playlistIndex === 3 && (await yt(host))?.id === items[3] && !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'selected video URL was ignored');
        assert.equal((await state()).isPlaying, false);
        // Keep the actual iframe mounted while the host changes playlist items offline.
        await viewer.evaluate(async () => {
            const { socket } = await import('/src/socket.js'); window.recoverySocket = socket;
            window.recoveryIframe = document.querySelector('.room-player-surface iframe');
            window.recoveryMember = JSON.parse(sessionStorage.getItem('watchTogetherSession')).memberId;
            window.recoveryWrites = [];
            socket.onAnyOutgoing((event, payload) => { if (['play_video', 'pause_video', 'seek_video', 'playlist_update'].includes(event) && !['READY', 'RESOLVE'].includes(payload?.action)) window.recoveryWrites.push(event); });
        });
        await viewer.context().setOffline(true);
        await viewer.evaluate(() => window.recoverySocket.io.engine.close());
        await host.getByRole('button', { name: 'Next playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 4 && (await yt(host))?.id === items[4], 'offline host playlist change failed');
        await viewer.context().setOffline(false);
        await wait(async () => await viewer.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'playlist reconnect did not resync');
        assert.equal((await yt(viewer)).id, items[4]);
        assert.notEqual((await yt(viewer)).status, 1);
        assert.equal(await viewer.evaluate(() => window.recoveryIframe === document.querySelector('.room-player-surface iframe')), true);
        assert.deepEqual(await viewer.evaluate(() => window.recoveryWrites), []);
        let recovered = (await socketCall(host, 'room:snapshot', {})).snapshot;
        const recoveredMember = await viewer.evaluate(() => window.recoveryMember);
        assert.equal(recovered.members.filter(member => member.userId === recoveredMember).length, 1);
        await wait(async () => { recovered = (await socketCall(host, 'room:snapshot', {})).snapshot; return recovered.readiness.readyCount === recovered.readiness.totalCount; }, 'playlist readiness not restored');
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'recovered playlist readiness missing');
        await host.getByRole('button', { name: 'Previous playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 3, 'return from reconnect item failed');
        console.log('PASS actual playlist reconnect adopts the newest paused item, retains the iframe, restores readiness and sends no control echoes');
        await host.setViewportSize({ width: 390, height: 844 });
        await host.getByRole('button', { name: 'Watch', exact: true }).click();
        await host.getByRole('button', { name: 'Next playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 4, 'mobile playlist Next failed');
        const buttons = await host.locator('.playlist-controls button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
        assert.ok(buttons.every(height => height >= 40));
        assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await host.setViewportSize({ width: 1280, height: 720 });
        await host.getByRole('button', { name: 'Room settings', exact: true }).click();
        await host.getByRole('button', { name: /Cinematic Immersive theater room/ }).click();
        await host.getByRole('button', { name: 'Room settings', exact: true }).click();
        await host.getByRole('button', { name: 'Watch controls', exact: true }).click();
        assert.ok(await host.locator('.cinema-luxe-scene').count());
        await wait(async () => !(await host.locator('.playlist-controls').getByRole('button', { name: 'Play Now', exact: true }).isDisabled()), 'Cinema Luxe playlist not ready');
        await host.getByRole('button', { name: 'Next playlist video' }).click();
        await wait(async () => (await state()).playlistIndex === 5, 'Cinema Luxe playlist Next failed');
        assert.equal(await host.locator('.room-player-surface iframe').count(), 1);
        console.log('PASS entire real playlist, stopped completion/refresh, selected-video URL, mobile and Cinema Luxe controls');
        // Switching back to a shortened single-video URL retains existing autoplay.
        await host.locator('#room-link-input').fill(`https://youtu.be/${items[0]}`);
        await host.locator('.watch-source-controls').getByRole('button', { name: 'Play Now', exact: true }).click();
        await wait(async () => (await state()).sourceType === 'remote' && (await yt(host))?.id === items[0] && (await yt(viewer))?.id === items[0] && (await yt(host)).status === 1 && (await yt(viewer)).status === 1, 'single YouTube video regression');
        assert.equal(await host.locator('.playlist-controls').count(), 0);
        assert.equal(await host.locator('.room-player-surface iframe').count(), 1);
        console.log('PASS real normal shortened YouTube URL after playlist playback');
        await viewer.evaluate(() => { window.recoveryIframe = document.querySelector('.room-player-surface iframe'); window.recoveryWrites = []; });
        await viewer.context().setOffline(true); await viewer.evaluate(() => window.recoverySocket.io.engine.close());
        await host.evaluate(() => { const player = window.__ytPlayers.at(-1); player.seekTo(12, true); player.pauseVideo(); });
        await wait(async () => !(await state()).isPlaying && (await state()).playedSeconds >= 11, 'single-video host pause/seek missing');
        await viewer.context().setOffline(false);
        await wait(async () => await viewer.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'single YouTube reconnect did not resync');
        assert.ok(Math.abs((await yt(viewer)).time - (await state()).playedSeconds) < 1.5);
        assert.notEqual((await yt(viewer)).status, 1);
        assert.equal(await viewer.evaluate(() => window.recoveryIframe === document.querySelector('.room-player-surface iframe')), true);
        assert.deepEqual(await viewer.evaluate(() => window.recoveryWrites), []);
        console.log('PASS real single YouTube reconnect restores paused time on the existing iframe without echoes');
        assert.deepEqual(errors, []);
        console.log('PASS real Next/Previous, seek, play/pause, repeated auto-next, late join, refresh, single iframe and no page errors');
    } catch (error) {
        console.error('PAGE ERRORS', errors);
        if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error('PAGE', page.url(), (await page.locator('.playlist-controls').textContent().catch(() => '')), await ytDiagnostic(page));
        throw error;
    } finally { await browser?.close(); backend.kill(); frontend.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
