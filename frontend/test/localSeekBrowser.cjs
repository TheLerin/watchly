const { chromium } = require('playwright');
const { fork } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const freePort = () => new Promise(resolve => {
 const server = net.createServer();
 server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const wait = async (fn, label) => {
 for (let attempt = 0; attempt < 150; attempt++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
 throw new Error(label);
};
(async () => {
 const backendPort = await freePort(), frontendPort = await freePort();
 const baseUrl = `http://127.0.0.1:${frontendPort}`;
 const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: baseUrl }, stdio: 'ignore' });
 const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
  { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}` }, stdio: 'ignore' });
 let browser;
 try {
  await wait(async () => { try { return (await fetch(baseUrl)).ok && (await fetch(`http://127.0.0.1:${backendPort}`)).ok; } catch { return false; } }, 'test servers did not start');
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || [
   'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(file => existsSync(file)), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const appearance = process.env.SEEK_TEST_APPEARANCE || 'classic';
  for (const touch of [false, true]) {
   const viewport = touch ? { width: 844, height: 390 } : appearance === 'cinematic'
    ? { width: 1280, height: 720 } : { width: 1366, height: 768 };
   const host = await browser.newPage({ viewport: touch ? { width: 390, height: 844 } : viewport, hasTouch: touch });
   const viewer = await browser.newPage({ viewport: touch ? { width: 390, height: 844 } : viewport, hasTouch: touch });
   for (const page of [host, viewer]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(roomStyle => localStorage.setItem('watchly-appearance-settings', JSON.stringify({ roomStyle })), appearance);
   }
   try {
    await host.goto(baseUrl);
    await host.getByRole('button', { name: 'Create room', exact: true }).first().click();
    await host.getByPlaceholder('Your nickname').fill('Native seek host');
    await host.locator('.room-launcher-submit').click(); await host.waitForURL('**/room/**'); await host.locator('.room-shell').waitFor();
    await viewer.goto(baseUrl);
    await viewer.getByRole('button', { name: 'Join room', exact: true }).first().click();
    await viewer.getByPlaceholder('Your nickname').fill('Native seek viewer');
    await viewer.getByPlaceholder('ROOM CODE').fill(host.url().split('/').pop());
    await viewer.locator('.room-launcher-submit').click(); await viewer.waitForURL('**/room/**'); await viewer.locator('.room-shell').waitFor();
    if (touch) { await host.setViewportSize(viewport); await viewer.setViewportSize(viewport); }
    host.once('dialog', dialog => dialog.accept('Native seek regression'));
    await host.locator('input[type=file][accept^="video/"]').setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
    await viewer.getByRole('heading', { name: 'Choose the same local file', exact: true }).waitFor();
    await viewer.locator('input[type=file][accept^="video/"]').setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
    await host.getByText('2/2 ready', { exact: true }).waitFor({ state: 'attached' });
    const video = page => page.locator('.room-player-surface video');
    const values = page => video(page).evaluate(el => ({ time: el.currentTime, paused: el.paused, ready: el.readyState, duration: el.duration }));
    await require('./localSeekChecks.cjs')({ host, viewer, video, values, wait, touch });
   } catch (error) {
    console.log('HOST', await host.locator('body').innerText());
    console.log('COMMANDS', await host.evaluate(() => window.seekCheckCommands));
    console.log('VIEWER', await viewer.locator('body').innerText());
    throw error;
   } finally { await host.close(); await viewer.close(); }
  }
  assert.deepEqual(errors, []);
 } finally { await browser?.close(); frontend.kill(); backend.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
