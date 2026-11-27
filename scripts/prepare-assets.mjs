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
const origin = process.env.VITE_SITE_ORIGIN || loadEnv('production', path.resolve('frontend'), 'VITE_').VITE_SITE_ORIGIN || '';
for (const name of ['robots.txt', 'sitemap.xml']) {
  const file = path.join(root, name), source = await readFile(file, 'utf8');
  const content = origin ? source.replaceAll('https://wchly.vercel.app', new URL(origin).origin)
    : name === 'robots.txt' ? source.replace(/^Sitemap:.*$/m, '') : '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n';
  await writeFile(file, content);
}
