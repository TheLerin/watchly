import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('frontend/dist');
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if ((await stat(file)).size >= 25 * 1024 * 1024) throw new Error(`${file} exceeds Cloudflare's 25 MiB asset limit. Run python scripts/optimize-backgrounds.py.`);
  }
}
await check(root);
// Only content-hashed bundles receive immutable caching; public /assets filenames can change in place.
const headersPath = path.join(root, '_headers');
let headers = (await readFile(headersPath, 'utf8')).split('\n# Generated immutable bundle routes')[0] + '\n# Generated immutable bundle routes\n';
for (const name of await readdir(path.join(root, 'assets'))) if (/-[\w-]{8,}\.(js|css|woff2)$/.test(name)) headers += `\n/assets/${name}\n  Cache-Control: public, max-age=31536000, immutable\n`;
await writeFile(headersPath, headers);
const html = await readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes('/assets/')) throw new Error('Missing production frontend assets');
console.log('Static assets validated; every file is below 25 MiB.');

// Public metadata should not retain a dependency on the previous frontend host.
const { loadEnv } = await import('../frontend/node_modules/vite/dist/node/index.js');
const { cleanOrigin, PUBLIC_PAGES, pageMetadataHtml } = await import('../frontend/social-preview/siteMetadata.js');
const origin = cleanOrigin(process.env.VITE_SITE_ORIGIN || loadEnv('production', path.resolve('frontend'), 'VITE_').VITE_SITE_ORIGIN);
await writeFile(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(PUBLIC_PAGES).map(route => `<url><loc>${origin}${route}</loc></url>`).join('')}</urlset>\n`);
await writeFile(path.join(root, '404.html'), pageMetadataHtml(html, '/404', origin));
const { mkdir } = await import('node:fs/promises');
for (const route of [...Object.keys(PUBLIC_PAGES).filter(route => route !== '/'), '/auth', '/auth/callback', '/my-watchly', '/profile', '/setup-profile']) {
  const directory = path.join(root, route.slice(1)); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), pageMetadataHtml(html, route, origin));
}
