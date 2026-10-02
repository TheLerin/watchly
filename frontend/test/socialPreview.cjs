// Production-shell smoke test. Vite preview alone doesn't run Vercel middleware.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, stat } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const expectedImage = 'https://wchly.vercel.app/og/watchly-room-v2.png';
const keys = ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
function checkHtml(html, route) {
  const room = route.startsWith('/room/');
  const expected = {
    'og:title': room ? 'Join my Watchly room' : 'Watchly — Watch Together',
    'og:description': room ? 'Watch together in perfect sync.' : 'Watch videos together in perfect sync.',
    'og:url': `https://wchly.vercel.app${route}`,
    'og:image': expectedImage,
    'twitter:card': 'summary_large_image',
    'twitter:image': expectedImage,
  };
  expected['twitter:title'] = expected['og:title'];
  expected['twitter:description'] = expected['og:description'];
  for (const key of keys) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].find(([tag]) => tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`))?.[0];
    assert.equal(tag?.match(/content="([^"]*)"/)?.[1], expected[key], `${route}: ${key}`);
  }
  assert.ok(html.includes(`<title>${expected['og:title']}</title>`));
  assert.ok(html.includes(`rel="canonical" href="${expected['og:url']}"`));
}

(async () => {
  if (process.env.PUBLIC_BASE_URL) {
    for (const route of ['/', '/room/test123', '/room/LAT3BIQ']) {
      const response = await fetch(new URL(route, process.env.PUBLIC_BASE_URL), { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
      assert.equal(response.status, 200, route);
      checkHtml(await response.text(), route);
    }
    const response = await fetch(expectedImage);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('image/png'));
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    console.log(`HTTPS crawler HTML and 1200 × 630 public PNG passed: ${process.env.PUBLIC_BASE_URL}`);
    return;
  }
  const { default: middleware, config: matcher } = await import('../middleware.js');
  const dist = path.resolve(__dirname, '../dist');
  const shell = await readFile(path.join(dist, 'index.html'), 'utf8');
  const config = JSON.parse(await readFile(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.equal(matcher.matcher, '/room/:roomCode');
  assert.equal(config.rewrites.length, 1);
  assert.equal(config.rewrites.at(-1).destination, '/index.html');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const room = url.pathname.match(/^\/room\/([^/]+)\/?$/);
      if (room) {
        const result = await middleware(new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers: request.headers }));
        for (const [name, value] of result.headers) response.setHeader(name, value);
        response.statusCode = result.status;
        response.end(result.headers.has('x-middleware-next') ? shell : Buffer.from(await result.arrayBuffer()));
        return;
      }
      const file = path.join(dist, url.pathname);
      if (url.pathname !== '/' && existsSync(file) && (await stat(file)).isFile()) {
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        response.end(await readFile(file));
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(shell);
      }
    } catch (error) { response.statusCode = 500; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/', '/room/test123', '/room/LAT3BIQ']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      checkHtml(html, route);
      assert.equal(html.slice(html.indexOf('<body>')), shell.slice(shell.indexOf('<body>')));
      for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) assert.equal((await fetch(`${base}${asset}`)).status, 200);
    }
    const head = await fetch(`${base}/room/test123`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/room/test123`);
    await page.getByRole('heading', { name: 'Join TEST123', exact: true }).waitFor();
    assert.equal(await page.title(), 'Join my Watchly room');
    await page.getByRole('textbox', { name: 'Nickname' }).fill('Preview test');
    assert.deepEqual(errors, []);
    const png = await readFile(path.join(dist, 'og/watchly-room-v2.png'));
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    await page.setViewportSize({ width: 630, height: 630 });
    await page.setContent(`<body style="margin:0;overflow:hidden;background:#050505"><img src="data:image/png;base64,${png.toString('base64')}" style="position:absolute;width:1200px;height:630px;left:-285px;top:0"></body>`);
    await page.locator('img').evaluate(image => image.decode());
    await page.screenshot({ path: path.join(__dirname, '../../.codex-runtime/watchly-local/social-crop-visual-verification.png') });
    console.log('Built homepage/room HTML, HEAD, unchanged SPA body, assets, room deep-link bootstrap and crop passed.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
