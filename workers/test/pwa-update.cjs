const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../frontend/node_modules/playwright');

async function run() {
  const assets = path.resolve('frontend/dist');
  const worker = await readFile(path.join(assets, 'sw.js'), 'utf8');
  let version = 1, activated = 0;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const resource = path.resolve(assets, `.${pathname}`);
    response.setHeader('Cache-Control', 'no-store');
    if (!resource.startsWith(assets + path.sep) && pathname !== '/') return response.writeHead(404).end();
    if (pathname === '/sw.js') return response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(`${worker}\nself.addEventListener('activate', event => event.waitUntil(fetch('/__activated/${version}')));`);
    if (/^\/__activated\/[12]$/.test(pathname)) {
      activated = Number(pathname.at(-1));
      return response.writeHead(204).end();
    }
    if (pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Watchly update fixture</title>');
    try {
      const body = await readFile(resource);
      if (pathname.endsWith('.js')) response.setHeader('Content-Type', 'application/javascript');
      return response.end(body);
    } catch { return response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ executablePath, args: ['--disable-background-networking', '--disable-sync', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const context = await browser.newContext();
    const active = await context.newPage();
    await active.goto(base);
    await active.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await active.reload();
    await active.waitForFunction(() => !!navigator.serviceWorker.controller);
    const second = await context.newPage();
    await second.goto(base);
    await second.waitForFunction(() => !!navigator.serviceWorker.controller);
    for (const page of [active, second]) await page.evaluate(() => { window.initialController = navigator.serviceWorker.controller; });
    version = 2;
    await active.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update().then(() => {}));
    await active.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    for (const page of [active, second]) assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === window.initialController), true);
    await second.close();
    assert.equal(await active.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
    // Keep the same browser context alive while the old registration loses its last tab.
    const observer = await context.newPage();
    await active.close();
    const deadline = Date.now() + 10000;
    while (activated !== 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(activated, 2);
    await observer.goto(base);
    await observer.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state === 'activated' && !registration.waiting;
    });
    console.log('PASS Chromium Workbox update waits for both old tabs before activating.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    server.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
