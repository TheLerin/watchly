const { chromium } = require('../../frontend/node_modules/playwright');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
(async () => {
  const { localServer } = await import('./local-server.mjs');
  const server = await localServer(); let browser;
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
    const context = await browser.newContext();
    // This wire test needs only the isolated local Worker, not external fonts/providers.
    await context.route('**/*', route => new URL(route.request().url()).origin === server.base ? route.continue() : route.abort());
    const host = await context.newPage(), viewer = await context.newPage(); const errors = [];
    for (const page of [host, viewer]) page.on('pageerror', error => errors.push(error.message));
    await host.goto(server.base); await host.getByRole('button', { name: 'Create room', exact: true }).first().click();
    await host.getByPlaceholder('Your nickname').fill('Native host'); await host.locator('.room-launcher-submit').click(); await host.waitForURL('**/room/**');
    const roomId = host.url().split('/').pop();
    await viewer.goto(server.base + '/room/' + roomId); await viewer.getByRole('textbox', { name: 'Nickname' }).fill('Native viewer');
    await viewer.getByRole('button', { name: 'Join room', exact: true }).click(); await viewer.locator('.room-shell').waitFor();
    await host.mouse.move(1200, 200); await host.getByRole('button', { name: 'Live chat', exact: true }).click();
    await host.getByPlaceholder('Type a message...').fill('Cloudflare native chat'); await host.getByPlaceholder('Type a message...').press('Enter');
    await viewer.mouse.move(1200, 200); await viewer.getByRole('button', { name: 'Live chat', exact: true }).click(); await viewer.getByText('Cloudflare native chat', { exact: true }).waitFor();
    const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.emulateMedia({ reducedMotion: 'reduce' });
    await mobile.goto(server.base); await mobile.locator('.cinema-video').waitFor();
    assert.equal(await mobile.locator('.cinema-video source').count(), 0);
    assert.equal(await mobile.locator('.cinema-video').getAttribute('poster'), '/bg-video-mobile-poster.jpg');
    assert.deepEqual(errors, []); console.log('PASS two-browser native rooms/chat, direct SPA navigation, mobile reduced-motion poster.');
  } finally { await browser?.close(); server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
