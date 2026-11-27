// Production UI/native transport/SQLite room harness. External media SDK is a fixture.
import { createRequire } from 'node:module';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { environment, context as storageContext } from './harness.mjs';
import { AbuseGuard } from '../src/AbuseGuard.mjs';
import app from '../src/index.mjs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const setup = environment({ NODE_ENV: 'production', SITE_ORIGIN: 'https://watchly.test' }), dist = path.resolve('frontend/dist');
const guards = new Map();
setup.env.ABUSE = { idFromName: name => name, get(name) {
    if (!guards.has(name)) { const ctx = storageContext(); ctx.storage.ctx = ctx; guards.set(name, new AbuseGuard(ctx, setup.env)); }
    return { fetch: request => guards.get(name).fetch(request) };
} };
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
setup.env.ASSETS = { async fetch(request) {
    let file = path.resolve(dist, `.${new URL(request.url).pathname}`);
    if (file !== dist && !file.startsWith(dist + path.sep)) return new Response(null, { status: 403 });
    try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html'); } catch { file = path.join(dist, 'index.html'); }
    return new Response(await readFile(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' } });
} };
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const errors = []; let providerRequests = 0;
await mkdir('.codex-runtime/privacy', { recursive: true });
try {
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    const sdk = await readFile('frontend/test/fixtures/youtube-api.js', 'utf8');
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === 'www.youtube.com' && url.pathname === '/iframe_api') { providerRequests++; return route.fulfill({ contentType: 'application/javascript', body: sdk }); }
        if (url.hostname !== 'watchly.test') return route.abort();
        const response = await app.fetch(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData() } : {}) }), setup.env);
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await context.routeWebSocket(/\/ws\/rooms\//, route => {
        const code = new URL(route.url()).pathname.split('/').pop();
        const ready = (async () => {
            const item = await setup.room(code);
            const upgrade = await app.fetch(new Request(`https://watchly.test/ws/rooms/${code}`, { headers: { Upgrade: 'websocket', Origin: 'https://watchly.test', 'CF-Connecting-IP': '127.0.0.1' } }), setup.env);
            if (upgrade.status !== 101) throw new Error(`Fixture WebSocket rejected: ${upgrade.status} ${await upgrade.text()}`);
            const ws = item.ctx.sockets.at(-1), send = ws.send.bind(ws);
            ws.send = value => { send(value); route.send(value); };
            ws.close = (code = 1000, reason = '') => { ws.readyState = 3; route.close({ code, reason }); };
            return { item, ws };
        })();
        route.onMessage(async message => { const { item, ws } = await ready; if (message === '__watchly_ping__') return route.send('__watchly_pong__'); await item.object.webSocketMessage(ws, message); });
        route.onClose(async () => { const { item, ws } = await ready; ws.readyState = 3; await item.object.webSocketClose(ws, 1000); });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://watchly.test/');
    const banner = page.getByRole('region', { name: 'Privacy choices', exact: true }); await banner.waitFor();
    for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.ok(await banner.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight));
    }
    await banner.getByRole('button', { name: 'Necessary only', exact: true }).click();
    assert.equal(providerRequests, 0);
    for (const [route, heading] of [['privacy', 'Privacy policy'], ['terms', 'Terms of use'], ['cookies', 'Cookies & storage']]) {
        const response = await page.goto(`https://watchly.test/${route}`); assert.equal(response.status(), 200);
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.ok(await page.title()); assert.equal(await page.locator('a[href="mailto:assist.watchly@gmail.com"]').count(), 1);
        for (const width of [320, 820, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
        await page.screenshot({ path: `.codex-runtime/privacy/${route}.png`, fullPage: true });
    }
    const lost = await page.goto('https://watchly.test/missing-scene'); assert.equal(lost.status(), 404);
    await page.getByRole('heading', { name: 'This scene is missing.', exact: true }).waitFor();
    assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, nofollow');
    await page.screenshot({ path: '.codex-runtime/privacy/404.png', fullPage: true });
    await page.getByRole('link', { name: 'Back to Watchly', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('meta[name=robots]')?.content === 'index, follow, max-image-preview:large');
    assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'index, follow, max-image-preview:large');
    assert.equal(await page.locator('script#watchly-structured-data').count(), 1);
    assert.equal(await banner.count(), 0);
    await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cookie settings', exact: true }); await dialog.waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Cookie settings', exact: true }).evaluate(button => button === document.activeElement), true);
    console.log('PASS responsive policies/contact/footer, consent rejection/persistence, real 404, metadata after client navigation and keyboard dialog focus.');
    await page.getByRole('button', { name: 'Create room', exact: true }).first().click();
    await page.getByPlaceholder('Your nickname').fill('Privacy host'); await page.locator('.room-launcher-submit').click();
    await page.waitForURL('**/room/**');
    await page.getByRole('button', { name: 'Watch controls', exact: true }).click();
    await page.locator('#room-link-input').fill('https://youtu.be/GvgqDSnpRQM'); await page.getByRole('button', { name: 'Play Now', exact: true }).click();
    const gate = page.getByRole('region', { name: 'External video permission', exact: true }); await gate.waitFor();
    assert.equal(providerRequests, 0); assert.equal(await page.locator('.room-player-surface iframe').count(), 0);
    await page.waitForFunction(() => document.querySelector('.room-ping-button')?.dataset.connectionPhase === 'connected');
    await gate.getByRole('button', { name: 'Cookie settings', exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Save choices', exact: true }).click();
    await page.waitForFunction(() => window.fixtureYouTubePlayers?.at(-1)?.state === 1);
    assert.equal(providerRequests, 1);
    await page.evaluate(() => {
        window.privacyWrites = []; const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function(value) { try { const frame = JSON.parse(value); if (['play_video', 'pause_video', 'seek_video', 'video_ended'].includes(frame.event)) window.privacyWrites.push(frame); } catch { /* heartbeat */ } return send.call(this, value); };
    });
    await page.getByRole('button', { name: 'Room settings', exact: true }).click();
    await page.getByRole('button', { name: 'Privacy & cookie settings', exact: true }).click(); await dialog.waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), true);
    await dialog.getByRole('checkbox').uncheck(); await dialog.getByRole('button', { name: 'Save choices', exact: true }).click();
    await gate.waitFor(); assert.equal(await page.locator('.room-player-surface iframe').count(), 0);
    await page.evaluate(() => window.fixtureYouTubePlayers.at(-1).emit(0));
    assert.deepEqual(await page.evaluate(() => window.privacyWrites), []);
    console.log('PASS no external SDK/iframe before opt-in, explicit activation, room-settings withdrawal and no late unauthorized end callbacks.');
    await page.keyboard.press('Escape');
    const other = await context.newPage(); other.on('pageerror', error => errors.push(error.message)); await other.goto('https://watchly.test/');
    await other.getByRole('button', { name: 'Cookie settings', exact: true }).click();
    const otherDialog = other.getByRole('dialog', { name: 'Cookie settings', exact: true });
    await otherDialog.getByRole('checkbox').check(); await otherDialog.getByRole('button', { name: 'Save choices', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.room-player-surface iframe'));
    await other.getByRole('button', { name: 'Cookie settings', exact: true }).click();
    await otherDialog.getByRole('button', { name: 'Necessary only', exact: true }).click();
    await gate.waitFor(); assert.equal(await page.locator('.room-player-surface iframe').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS cross-tab consent changes activate and stop optional players.');
} finally { await browser.close(); }
