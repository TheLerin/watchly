// Actual Chromium UI + native browser transport against the SQLite lifecycle harness.
// All network is intercepted in test code; this does not claim workerd or external media verification.
import { createRequire } from 'node:module';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { environment, context as storageContext } from './harness.mjs';
import { AbuseGuard } from '../src/AbuseGuard.mjs';
import app from '../src/index.mjs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const setup = environment();
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const dist = path.resolve('frontend/dist');
setup.env.ASSETS = { async fetch(request) {
  const parsed = new URL(request.url), relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  let file = path.resolve(dist, relative || 'index.html');
  if (!file.startsWith(dist + path.sep) && file !== dist) return new Response(null, { status: 403 });
  try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html'); } catch { file = path.join(dist, 'index.html'); }
  return new Response(await readFile(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' } });
} };
const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'] });
const errors = [], pages = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (!request.url().startsWith('https://watchly.test/')) return route.abort();
    const response = await app.fetch(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData() } : {}) }), setup.env);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await context.routeWebSocket(/\/ws\/rooms\//, route => {
    const code = new URL(route.url()).pathname.split('/').pop();
    const ready = (async () => {
      const item = await setup.room(code);
      await app.fetch(new Request(`https://watchly.test/ws/rooms/${code}`, { headers: { Upgrade: 'websocket', Origin: 'https://watchly.test', 'CF-Connecting-IP': '192.0.2.10' } }), setup.env);
      const ws = item.ctx.sockets.at(-1), record = ws.send.bind(ws);
      ws.send = value => { record(value); route.send(value); };
      ws.close = (code = 1000, reason = '') => { ws.readyState = 3; route.close({ code, reason }); };
      return { item, ws };
    })();
    route.onMessage(async message => {
      const { item, ws } = await ready;
      if (message === '__watchly_ping__') return route.send('__watchly_pong__');
      await item.object.webSocketMessage(ws, message);
    });
    route.onClose(async () => { const { item, ws } = await ready; ws.readyState = 3; await item.object.webSocketClose(ws, 1000); });
  });
  const host = await context.newPage(), viewer = await context.newPage();
  pages.push(host, viewer);
  for (const page of [host, viewer]) page.on('pageerror', error => errors.push(error.message));
  await host.goto('https://watchly.test');
  const createButton = host.getByRole('button', { name: 'Create room', exact: true }).first();
  const logo = host.locator('.landing-brand img');
  await logo.evaluate(image => image.decode());
  assert.equal(await logo.evaluate(image => image.naturalWidth), 192);
  const fill = await createButton.evaluate(async button => {
    const cycle = button.getAnimations().find(animation => animation.animationName === 'watchly-action-color');
    if (!cycle) return null;
    cycle.pause();
    await cycle.ready;
    const duration = cycle.effect.getTiming().duration;
    const colors = [0, 0.08, 0.16, 0.32, 0.5, 0.68, 0.84, 1].map(phase => {
      cycle.currentTime = phase * duration;
      return getComputedStyle(button).backgroundColor;
    });
    const image = getComputedStyle(button).backgroundImage;
    cycle.play();
    return { colors, duration, image };
  });
  assert.equal(fill?.image, 'none');
  assert.equal(fill.duration, 36000);
  assert.equal(new Set(fill.colors.slice(0, -1)).size, 7);
  assert.equal(fill.colors[0], fill.colors.at(-1));
  await createButton.click();
  assert.equal(await host.locator('.room-launcher-submit').evaluate(button => getComputedStyle(button).animationName), 'watchly-action-color');
  await host.getByPlaceholder('Your nickname').fill('Harness host'); await host.locator('.room-launcher-submit').click();
  await host.waitForURL('**/room/**');
  const code = host.url().split('/').pop(); await host.locator('.room-shell').waitFor();
  await viewer.goto(`https://watchly.test/room/${code}`); await viewer.getByRole('textbox', { name: 'Nickname' }).fill('Harness viewer');
  await viewer.getByRole('button', { name: 'Join room', exact: true }).click(); await viewer.locator('.room-shell').waitFor();
  // Exercise access controls through the real UI and native transport.
  await host.mouse.move(1200, 200);
  await host.getByRole('button', { name: 'Members and queue', exact: true }).click();
  await host.locator('[data-testid="room-access-panel"] summary').click();
  await host.getByLabel('Approve new participants', { exact: true }).check();
  const pendingViewer = await context.newPage(); pages.push(pendingViewer);
  await pendingViewer.goto(`https://watchly.test/room/${code}`);
  await pendingViewer.getByRole('textbox', { name: 'Nickname' }).fill('Pending viewer');
  await pendingViewer.getByRole('button', { name: 'Join room', exact: true }).click();
  await host.getByText('Pending viewer requests to join', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Approve', exact: true }).click();
  await pendingViewer.locator('.room-shell').waitFor();
  await host.getByLabel('Approve new participants', { exact: true }).uncheck();
  await host.getByRole('combobox', { name: 'Room visibility' }).selectOption('private');
  await host.getByRole('button', { name: 'Create 1-hour invitation', exact: true }).click();
  const invitation = await host.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await host.getByLabel('Set room password', { exact: true }).fill('browser-private-password');
  await host.getByRole('button', { name: 'Save password', exact: true }).click();
  await host.getByLabel('Change room password', { exact: true }).waitFor();
  const invitedViewer = await context.newPage(); pages.push(invitedViewer);
  await invitedViewer.goto(invitation);
  await invitedViewer.getByRole('textbox', { name: 'Nickname' }).fill('Invited viewer');
  await invitedViewer.getByRole('button', { name: 'Join room', exact: true }).click();
  await invitedViewer.locator('input[type=password]').fill('browser-private-password');
  await invitedViewer.getByRole('button', { name: 'Join room', exact: true }).click();
  await invitedViewer.locator('.room-shell').waitFor();
  assert.equal(new URL(invitedViewer.url()).searchParams.has('invite'), false);
  await host.getByRole('button', { name: 'Revoke', exact: true }).click();
  await host.getByRole('button', { name: 'Remove password', exact: true }).click();
  await host.getByRole('combobox', { name: 'Room visibility' }).selectOption('public');
  await pendingViewer.close(); await invitedViewer.close(); pages.splice(pages.indexOf(pendingViewer), 1); pages.splice(pages.indexOf(invitedViewer), 1);
  console.log('PASS Chromium host access controls, approval and automatic admission, private invitations, password entry and URL credential cleanup.');
  // Exercise the actual frontend delta subscriber and its missing-revision recovery.
  const roomItem = await setup.room(code);
  const hostSocket = [...roomItem.object.io.sockets.sockets.values()].find(socket => socket.data.memberId && roomItem.object.rooms.get(code).users.find(member => member.userId === socket.data.memberId)?.role === 'Host');
  assert.equal(hostSocket.data.queueDeltas, true);
  await roomItem.object.serial(async () => {
    await roomItem.object.io.dispatch(hostSocket, 'add_to_queue', [{ roomId: code, url: 'https://example.test/queue.mp4', label: 'Browser delta item' }]); await roomItem.object.commit();
  });
  assert.equal(roomItem.object.rooms.get(code).queue.length, 1);
  for (const page of [host, viewer]) await page.locator('[title="Browser delta item"]').waitFor({ state: 'attached' });
  // A skipped revision asks for an authoritative queue snapshot without resetting playback.
  for (const ws of roomItem.ctx.sockets) ws.send(JSON.stringify({ v: 1, event: 'queue:delta', args: [{ baseRevision: 5, revision: 6, op: 'remove', itemId: 'missing' }] }));
  await roomItem.object.serial(async () => {
    const itemId = roomItem.object.rooms.get(code).queue[0].id;
    await roomItem.object.io.dispatch(hostSocket, 'remove_from_queue', [{ roomId: code, itemId }]); await roomItem.object.commit();
  });
  for (const page of [host, viewer]) await page.locator('[title="Browser delta item"]').waitFor({ state: 'detached' });
  console.log('PASS Chromium queue deltas and missing-revision recovery.');
  await host.mouse.move(1200, 200);
  await host.getByRole('button', { name: 'Live chat', exact: true }).click();
  await host.getByPlaceholder('Type a message...').fill('Native browser chat works'); await host.getByPlaceholder('Type a message...').press('Enter');
  await viewer.mouse.move(1200, 200);
  await viewer.getByRole('button', { name: 'Live chat', exact: true }).click(); await viewer.getByText('Native browser chat works', { exact: true }).waitFor();
  const fixture = path.resolve(existsSync('.codex-runtime/browser/local-fixture.mp4') ? '.codex-runtime/browser/local-fixture.mp4' : 'frontend/public/bg-video.mp4');
  {
    await host.locator('input[type=file][accept^="video/"]').setInputFiles(fixture);
    await viewer.getByRole('heading', { name: 'Choose the same local file' }).waitFor();
    await viewer.locator('input[type=file][accept^="video/"]').setInputFiles(fixture);
    for (const page of [host, viewer]) await page.waitForFunction(() => document.querySelector('.room-player-surface video')?.readyState >= 2);
    await host.evaluate(() => document.activeElement?.blur()); await host.keyboard.press('Space');
    for (const page of [host, viewer]) await page.waitForFunction(() => { const video = document.querySelector('.room-player-surface video'); return video && !video.paused && video.currentTime > 0.5; });
    const viewerVideo = viewer.locator('.room-player-surface video');
    const buffering = viewer.locator('.watchly-buffering-compact');
    await viewerVideo.evaluate(video => video.dispatchEvent(new Event('waiting')));
    await buffering.waitFor();
    const ring = await buffering.locator('.watchly-buffer-ring').evaluate(element => getComputedStyle(element, '::before').animationName);
    assert.equal(ring, 'watchly-buffer-spin');
    assert.equal(await buffering.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    await viewerVideo.evaluate(video => video.dispatchEvent(new Event('playing')));
    await buffering.waitFor({ state: 'hidden' });
    await host.keyboard.press('Space');
    for (const page of [host, viewer]) await page.waitForFunction(() => document.querySelector('.room-player-surface video')?.paused);
    await host.locator('.room-player-surface video').evaluate(video => { video.currentTime = 5; });
    await viewer.waitForFunction(() => Math.abs(document.querySelector('.room-player-surface video').currentTime - 5) < 0.4);
    console.log('PASS Chromium local-file selection, metadata fingerprint/readiness, synchronized play/pause and seek.');
  }
  await setup.evict(code);
  // A foreground snapshot must restore through reconstructed socket attachments without changing the room.
  await viewer.evaluate(() => window.dispatchEvent(new Event('focus')));
  await viewer.getByText('Native browser chat works', { exact: true }).waitFor();
  await host.setViewportSize({ width: 390, height: 844 });
  await host.locator('.room-mobile-workspace').waitFor();
  const loopPage = await context.newPage();
  for (const [width, height, variant] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    await loopPage.setViewportSize({ width, height }); await loopPage.goto('https://watchly.test');
    await loopPage.waitForFunction(() => document.querySelector('.cinema-video')?.readyState >= 2);
    const source = await loopPage.locator('.cinema-video').evaluate(video => video.currentSrc);
    assert.match(source, variant === 'mobile' ? /bg-video-mobile\.(webm|mp4)$/ : /bg-video\.(webm|mp4)$/);
    await loopPage.locator('.cinema-video').evaluate(async video => { video.currentTime = video.duration - 0.3; await video.play(); });
    await loopPage.waitForFunction(() => { const video = document.querySelector('.cinema-video'); return video.currentTime < 1 && !video.paused; });
  }
  console.log('PASS Chromium desktop/mobile compressed background decoding, responsive variant selection and loop restart.');
  const reduced = await context.newPage(); await reduced.emulateMedia({ reducedMotion: 'reduce' }); await reduced.setViewportSize({ width: 390, height: 844 });
  await reduced.goto('https://watchly.test'); await reduced.locator('.cinema-video').waitFor();
  await reduced.waitForTimeout(200);
  assert.equal(await reduced.locator('.cinema-video source').count(), 0);
  assert.equal(await reduced.locator('.cinema-video').getAttribute('poster'), '/bg-video-mobile-poster.jpg');
  const reducedCreate = reduced.getByRole('button', { name: 'Create room', exact: true }).first();
  assert.equal(await reducedCreate.evaluate(button => getComputedStyle(button).animationName), 'none');
  assert.equal(await reducedCreate.evaluate(button => getComputedStyle(button).backgroundColor), fill.colors[0]);
  const account = await context.newPage();
  await account.goto('https://watchly.test/auth');
  const emailAction = account.getByRole('button', { name: 'Continue with email' });
  const accountFill = await emailAction.evaluate(button => {
    const style = getComputedStyle(button);
    return { image: style.backgroundImage, animation: style.animationName };
  });
  assert.deepEqual(accountFill, { image: 'none', animation: 'watchly-action-color' });
  await account.close();
  console.log('PASS Chromium logo, solid action fills with smooth palette interpolation, buffering ring during a playback stall and reduced-motion styling.');
  // Test the actual browser challenge flow with a deterministic widget and Siteverify fixture.
  // No production key or success bypass exists in application code.
  const guards = new Map(), originalFetch = globalThis.fetch;
  Object.assign(setup.env, { TURNSTILE_ENFORCE_ANONYMOUS: 'true', TURNSTILE_SITE_KEY: 'public-browser-fixture', TURNSTILE_SECRET_KEY: 'private-browser-fixture', ANON_CREATE_CHALLENGE_AFTER: '0' });
  setup.env.ABUSE = { idFromName: value => value, get(name) {
    if (!guards.has(name)) { const ctx = storageContext(); ctx.storage.ctx = ctx; guards.set(name, new AbuseGuard(ctx, setup.env)); }
    return { fetch: request => guards.get(name).fetch(request) };
  } };
  let verifiedChallenges = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return originalFetch(url, options);
    const body = JSON.parse(options.body); assert.equal(body.response, 'browser-fixture-once'); assert.equal(body.secret, 'private-browser-fixture'); verifiedChallenges++;
    return Response.json({ success: true, action: 'room_create', hostname: 'watchly.test', challenge_ts: new Date().toISOString() });
  };
  try {
    await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = {
      render(element, options) { const button = document.createElement('button'); button.textContent = 'Complete test verification'; button.onclick = () => options.callback('browser-fixture-once'); element.appendChild(button); return 1; },
      remove() {}, reset() {}
    };` }));
    const challenged = await context.newPage(); pages.push(challenged); challenged.on('pageerror', error => errors.push(error.message));
    await challenged.goto('https://watchly.test'); await challenged.getByRole('button', { name: 'Create room', exact: true }).first().click();
    await challenged.getByPlaceholder('Your nickname').fill('Verified browser guest'); await challenged.locator('.room-launcher-submit').click();
    await challenged.getByRole('alertdialog').waitFor(); await challenged.getByRole('button', { name: 'Cancel', exact: true }).click();
    await challenged.getByRole('alertdialog').waitFor({ state: 'detached' }); assert.equal(verifiedChallenges, 0);
    await challenged.locator('.room-launcher-submit').click(); await challenged.getByRole('button', { name: 'Complete test verification' }).click();
    await challenged.waitForURL('**/room/**'); await challenged.locator('.room-shell').waitFor(); assert.equal(verifiedChallenges, 1);
    await challenged.close(); pages.splice(pages.indexOf(challenged), 1);
    console.log('PASS Chromium mandatory anonymous Turnstile prompt, safe cancellation, server verification and automatic room creation.');
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(errors, []);
  await mkdir('.codex-runtime/browser', { recursive: true });
  await reduced.screenshot({ path: '.codex-runtime/browser/mobile-reduced-motion.png' });
  console.log('PASS Chromium UI + SQLite harness: native create/join/chat, direct routes, reconstructed room, mobile layout, reduced-motion poster, no page errors.');
} catch (error) {
  await mkdir('.codex-runtime/browser', { recursive: true });
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `.codex-runtime/browser/failure-${index}.png` });
  console.error({ pageErrors: errors, pages: await Promise.all(pages.map(async page => ({ url: page.url(), text: (await page.locator('body').innerText()).slice(-1600) }))) });
  throw error;
} finally { await browser.close(); }
