import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomPreviewHtml } from '../social-preview/metadata.js';
import middleware from '../middleware.js';

const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const imageUrl = 'https://wchly.vercel.app/og/watchly-room-v2.png';

function meta(html, key) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0]);
  const tag = tags.find(tag => tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`));
  return tag?.match(/content="([^"]*)"/)?.[1];
}

function check(html, title, description, url) {
  assert.ok(html.includes(`<title>${title}</title>`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}"`));
  for (const key of ['og:title', 'twitter:title']) assert.equal(meta(html, key), title);
  for (const key of ['description', 'og:description', 'twitter:description']) assert.equal(meta(html, key), description);
  for (const key of ['og:url', 'twitter:url']) assert.equal(meta(html, key), url);
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image']) assert.equal(meta(html, key), imageUrl);
  assert.equal(meta(html, 'og:type'), 'website');
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(html, 'og:image:width'), '1200');
  assert.equal(meta(html, 'og:image:height'), '630');
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
}

test('homepage has concise matching HTML, OG and X metadata', () => {
  check(homepage, 'Watchly — Watch Together', 'Watch videos together in perfect sync.', 'https://wchly.vercel.app/');
});

test('room metadata preserves the SPA body and assets and uses the shared URL', () => {
  for (const code of ['test123', 'LAT3BIQ']) {
    const room = roomPreviewHtml(homepage, code);
    check(room, 'Join my Watchly room', 'Watch together in perfect sync.', `https://wchly.vercel.app/room/${code}`);
    assert.equal(room.slice(room.indexOf('<body>')), homepage.slice(homepage.indexOf('<body>')));
    assert.equal(meta(room, 'theme-color'), meta(homepage, 'theme-color'));
  }
});

test('untrusted room identifiers cannot inject HTML into the response', () => {
  const code = '"><script>alert(1)</script>?secret=value&extra=1';
  const room = roomPreviewHtml(homepage, code);
  check(room, 'Join my Watchly room', 'Watch together in perfect sync.', `https://wchly.vercel.app/room/${encodeURIComponent(code)}`);
  assert.ok(!room.includes(code));
});

test('room middleware fetches its deployment shell outside the matcher and strips private query data', async t => {
  const fetchShell = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, 'https://preview.example/index.html');
    assert.equal(options.headers.get('cookie'), 'deployment-access=allowed');
    return new Response(homepage, { headers: { 'Content-Type': 'text/html' } });
  });
  const response = await middleware(new Request('https://preview.example/room/test123?password=private', { headers: { cookie: 'deployment-access=allowed' } }));
  check(await response.text(), 'Join my Watchly room', 'Watch together in perfect sync.', 'https://wchly.vercel.app/room/test123');
  assert.equal(fetchShell.mock.calls.length, 1);
  const head = await middleware(new Request('https://preview.example/room/test123', { method: 'HEAD', headers: { cookie: 'deployment-access=allowed' } }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('static fetch errors continue the original SPA routing instead of breaking room access', async t => {
  for (const outcome of ['network', 'status', 'type']) {
    const fetchShell = t.mock.method(globalThis, 'fetch', async () => {
      if (outcome === 'network') throw new Error('Unavailable');
      return new Response('Not the app shell', { status: outcome === 'status' ? 503 : 200, headers: { 'Content-Type': 'text/plain' } });
    });
    const response = await middleware(new Request('https://preview.example/room/test123'));
    assert.equal(response.headers.get('x-middleware-next'), '1');
    fetchShell.mock.restore();
  }
});
