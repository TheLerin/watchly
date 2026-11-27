import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageMetadata, pageMetadataHtml, HOME_TITLE, PUBLIC_PAGES } from '../social-preview/siteMetadata.js';
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('public routes get distinct canonical metadata and only public pages are indexable', () => {
    const titles = new Set();
    for (const route of Object.keys(PUBLIC_PAGES)) {
        const data = pageMetadata(route); titles.add(data.title);
        const html = pageMetadataHtml(shell, route);
        assert.equal(data.status, 200); assert.equal(data.noindex, false);
        assert.ok(html.includes(`href="https://wchly.pages.dev${route}"`));
        assert.ok(html.includes('content="index, follow, max-image-preview:large"'));
        assert.equal((html.match(/name="description"/g) || []).length, 1);
    }
    assert.equal(titles.size, 4); assert.equal(pageMetadata('/').title, HOME_TITLE);
    assert.ok(pageMetadataHtml(shell).includes('"@type":"WebApplication"'));
    for (const route of ['/room/ABC1234', '/auth', '/auth/callback', '/profile', '/my-watchly', '/setup-profile', '/not-a-page']) {
        const data = pageMetadata(route), html = pageMetadataHtml(shell, route);
        assert.equal(data.noindex, true); assert.ok(html.includes('content="noindex, nofollow"'));
        assert.ok(!html.includes('id="watchly-structured-data"'));
    }
});
test('unknown routes return 404 metadata and deployment noindex survives public pages', () => {
    assert.equal(pageMetadata('/lost').status, 404);
    const html = pageMetadataHtml(shell, '/', 'https://preview.example', { noindex: true });
    assert.ok(html.includes('content="noindex, nofollow"')); assert.ok(!html.includes('id="watchly-structured-data"'));
    assert.ok(!pageMetadataHtml(shell, '/lost"><script>bad</script>').includes('<script>bad</script>'));
});
