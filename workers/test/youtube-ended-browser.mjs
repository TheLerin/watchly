// Production ReactPlayer + native transport + SQLite room engine; only YouTube's SDK is a fixture.
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { environment } from './harness.mjs';
import app from '../src/index.mjs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const setup = environment(), dist = path.resolve('frontend/dist');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
setup.env.ASSETS = { async fetch(request) {
    let file = path.resolve(dist, `.${new URL(request.url).pathname}`);
    if (file !== dist && !file.startsWith(dist + path.sep)) return new Response(null, { status: 403 });
    try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html'); } catch { file = path.join(dist, 'index.html'); }
    return new Response(await readFile(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' } });
} };
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const errors = [];
try {
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    const sdk = await readFile('frontend/test/fixtures/youtube-api.js', 'utf8');
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === 'www.youtube.com' && url.pathname === '/iframe_api') return route.fulfill({ contentType: 'application/javascript', body: sdk });
        if (url.hostname !== 'watchly.test') return route.abort();
        const response = await app.fetch(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData() } : {}) }), setup.env);
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await context.routeWebSocket(/\/ws\/rooms\//, route => {
        const code = new URL(route.url()).pathname.split('/').pop();
        const ready = (async () => {
            const item = await setup.room(code);
            await app.fetch(new Request(`https://watchly.test/ws/rooms/${code}`, { headers: { Upgrade: 'websocket', Origin: 'https://watchly.test' } }), setup.env);
            const ws = item.ctx.sockets.at(-1), send = ws.send.bind(ws);
            ws.send = value => { send(value); route.send(value); };
            ws.close = (code = 1000, reason = '') => { ws.readyState = 3; route.close({ code, reason }); };
            return { item, ws };
        })();
        route.onMessage(async message => { const { item, ws } = await ready; if (message === '__watchly_ping__') return route.send('__watchly_pong__'); await item.object.webSocketMessage(ws, message); });
        route.onClose(async () => { const { item, ws } = await ready; ws.readyState = 3; await item.object.webSocketClose(ws, 1000); });
    });
    const host = await context.newPage(), viewer = await context.newPage();
    for (const page of [host, viewer]) page.on('pageerror', error => errors.push(error.message));
    const synced = page => page.waitForFunction(() => document.querySelector('.room-ping-button')?.dataset.connectionPhase === 'connected');
    await host.goto('https://watchly.test/');
    await host.getByRole('button', { name: 'Allow external players', exact: true }).click();
    await host.getByRole('button', { name: 'Create room', exact: true }).first().click();
    await host.getByPlaceholder('Your nickname').fill('Replay host'); await host.locator('.room-launcher-submit').click();
    await host.waitForURL('**/room/**'); await synced(host);
    const code = new URL(host.url()).pathname.split('/').pop();
    await viewer.goto(`https://watchly.test/room/${code}`);
    await viewer.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Replay viewer');
    await viewer.getByRole('button', { name: 'Join room', exact: true }).click(); await synced(viewer);
    for (const page of [host, viewer]) await page.evaluate(() => {
        window.fixtureWrites = []; const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function(value) { try { const frame = JSON.parse(value); if (['play_video', 'pause_video', 'seek_video', 'video_ended'].includes(frame.event)) window.fixtureWrites.push(frame); } catch { /* heartbeat */ } return send.call(this, value); };
    });
    await host.getByRole('button', { name: 'Watch controls', exact: true }).click();
    await host.locator('#room-link-input').fill('https://youtu.be/GvgqDSnpRQM');
    await host.getByRole('button', { name: 'Play Now', exact: true }).click();
    for (const page of [host, viewer]) await page.waitForFunction(() => window.fixtureYouTubePlayers?.at(-1)?.state === 1);
    const item = await setup.room(code);
    const state = () => item.object.rooms.get(code).videoState;
    const lateSnapshot = () => item.object.serial(async () => {
        Object.assign(state(), { playedSeconds: 270, isPlaying: true, updatedAt: Date.now(), stateVersion: state().stateVersion + 1 });
        await item.object.commit();
    });
    const expire = async () => {
        // Foreground wakes intentionally coalesce for five seconds.
        await host.waitForTimeout(5100);
        // Seed the late snapshot that caused the recording's loop. Subsequent
        // recovery, ENDED and replay all go through the real browser transport.
        await lateSnapshot();
        await host.evaluate(() => { window.fixtureYouTubePlayers.at(-1).calls = []; window.dispatchEvent(new Event('focus')); });
        try { await host.waitForFunction(() => document.querySelector('.room-ping-button')?.dataset.connectionPhase === 'connected' && window.fixtureYouTubePlayers.at(-1).state === 0); }
        catch (error) {
            console.error('RECOVERY', state(), await host.evaluate(() => ({ phase: document.querySelector('.room-ping-button')?.dataset.connectionPhase, players: window.fixtureYouTubePlayers.map(p => ({ state: p.state, time: p.time, calls: p.calls })), writes: window.fixtureWrites, text: document.body.innerText })));
            throw error;
        }
        for (let i = 0; state().isPlaying && i < 30; i++) await host.waitForTimeout(100);
        assert.equal(state().isPlaying, false); assert.equal(state().playedSeconds, 268);
        assert.equal(await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).calls.filter(value => value[0] === 'play').length), 0);
    };
    await expire();
    await host.waitForTimeout(1300);
    assert.equal(await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).state), 0);
    console.log('PASS expired playing snapshot reaches ENDED, completes recovery and pauses the room without any automatic replay.');
    await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).playVideo());
    for (const page of [host, viewer]) await page.waitForFunction(() => { const p = window.fixtureYouTubePlayers.at(-1); return p.state === 1 && p.time < 2; });
    assert.equal(state().isPlaying, true); assert.ok(state().playedSeconds < 2);
    await host.waitForTimeout(1200); assert.ok(await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).time > 1));
    console.log('PASS intentional Replay shares the rewind and plays from zero for both participants.');
    await expire();
    await viewer.evaluate(() => { window.fixtureWrites = []; window.fixtureYouTubePlayers.at(-1).playVideo(); });
    await synced(viewer); await viewer.waitForFunction(() => window.fixtureYouTubePlayers.at(-1).state === 0);
    assert.deepEqual(await viewer.evaluate(() => window.fixtureWrites), []);
    assert.equal(state().isPlaying, false);
    console.log('PASS a Viewer cannot replay a paused room or send playback/end commands during recovery.');
    await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).playVideo());
    await host.waitForFunction(() => window.fixtureYouTubePlayers.at(-1).state === 1);
    // Replay's shared PLAY is debounced; wait for the authoritative state too.
    for (let i = 0; !state().isPlaying && i < 30; i++) await host.waitForTimeout(100);
    assert.equal(state().isPlaying, true);
    await host.locator('#room-link-input').fill('https://youtu.be/dQw4w9WgXcQ');
    await host.getByRole('button', { name: 'Queue', exact: true }).click();
    for (let i = 0; item.object.rooms.get(code).queue.length !== 1 && i < 30; i++) await host.waitForTimeout(100);
    assert.equal(item.object.rooms.get(code).queue.length, 1);
    const previousSource = state().sourceId;
    await lateSnapshot(); await host.reload(); await synced(host);
    await host.waitForFunction(() => window.fixtureYouTubePlayers.at(-1).state === 0);
    assert.equal(state().isPlaying, false, 'controller disconnect intentionally pauses the room');
    assert.equal(state().sourceId, previousSource);
    assert.equal(item.object.rooms.get(code).queue.length, 1, 'reload must preserve the queued item');
    await host.evaluate(() => window.fixtureYouTubePlayers.at(-1).playVideo());
    for (let i = 0; !state().isPlaying && i < 30; i++) await host.waitForTimeout(100);
    assert.equal(state().isPlaying, true);
    await host.evaluate(() => { const p = window.fixtureYouTubePlayers.at(-1); p.seekTo(p.duration); });
    for (const page of [host, viewer]) await page.waitForFunction(() => { const p = window.fixtureYouTubePlayers.at(-1); return p.id === 'dQw4w9WgXcQ' && p.state === 1; });
    assert.notEqual(state().sourceId, previousSource);
    assert.equal(item.object.rooms.get(code).queue.length, 0);
    console.log('PASS reload preserves paused end state/membership/queue, and a subsequent real ENDED event advances that queue once for everyone.');
    assert.deepEqual(errors, []);
} finally { await browser.close(); }
