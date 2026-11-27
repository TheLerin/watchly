import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.mjs';
import { environment } from './harness.mjs';
const shell = await readFile('frontend/index.html', 'utf8');
function fixture(overrides = {}) {
    const setup = environment({ NODE_ENV: 'production', SITE_ORIGIN: 'https://watchly.test', ...overrides });
    setup.env.ASSETS = { async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/BingSiteAuth.xml') return new Response(await readFile('frontend/public/BingSiteAuth.xml'), { headers: { 'Content-Type': 'application/xml' } });
        if (path === '/google2fd6608b68053b8d.html') return new Response(await readFile('frontend/public/google2fd6608b68053b8d.html'), { headers: { 'Content-Type': 'text/html' } });
        return new Response(shell, { headers: { 'Content-Type': 'text/html' } });
    } };
    return (path, method = 'GET', origin = 'https://watchly.test') => app.fetch(new Request(origin + path, { method }), setup.env);
}
test('search responses use real 404s, private noindex, distinct titles and query-free metadata', async () => {
    const request = fixture();
    for (const path of ['/', '/privacy', '/cookies', '/terms']) {
        const response = await request(path); assert.equal(response.status, 200); assert.equal(response.headers.get('X-Robots-Tag'), null);
        assert.ok((await response.text()).includes('content="index, follow, max-image-preview:large"'));
    }
    for (const path of ['/auth/callback?code=never-publish-this', '/my-watchly', '/profile', '/room/ABCDEFG?invite=never-publish-this']) {
        const response = await request(path), html = await response.text();
        assert.equal(response.status, 200); assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
        assert.ok(!html.includes('never-publish-this')); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    for (const path of ['/missing', '/missing.html', '/404.html']) {
        const response = await request(path); assert.equal(response.status, 404); assert.ok((await response.text()).includes('Page not found | Watchly'));
        assert.equal((await request(path, 'HEAD')).status, 404); assert.equal(await (await request(path, 'HEAD')).text(), '');
    }
    assert.equal((await request('/assets/missing.js')).status, 404);
    const stage = await request('/', 'GET', 'https://stage.watchly.test');
    assert.equal(stage.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});
test('Google verification is preserved and Bing XML is served publicly without a redirect', async () => {
    const request = fixture();
    const google = await request('/google2fd6608b68053b8d.html'); assert.equal(google.status, 200); assert.equal(await google.text(), await readFile('frontend/public/google2fd6608b68053b8d.html', 'utf8'));
    const bing = await request('/BingSiteAuth.xml'); assert.equal(bing.status, 200); assert.ok((await bing.text()).includes('<user>D076BA3A466F949A85D20E308F1132CA</user>'));
});
