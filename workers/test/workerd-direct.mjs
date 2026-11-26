import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url)), { build } = require('esbuild');
const directory = path.resolve('.codex-runtime/workerd-direct'); await mkdir(directory, { recursive: true });
await build({ entryPoints: ['workers/test/workerd-direct-entry.mjs'], outfile: path.join(directory, 'entry.mjs'), bundle: true, format: 'esm', platform: 'browser', external: ['node:*'],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
const config = { name: 'watchly-direct-runtime-tests', main: './entry.mjs', no_bundle: true, compatibility_date: '2026-11-25', compatibility_flags: ['nodejs_compat'],
  vars: { NODE_ENV: 'development', MEDIA_PROVIDER: 'livekit' },
  durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'WatchRoom' }, { name: 'PRESENCE', class_name: 'PresenceDirectory' }, { name: 'ABUSE', class_name: 'AbuseGuard' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['WatchRoom', 'PresenceDirectory', 'AbuseGuard'] }] };
await writeFile(path.join(directory, 'wrangler.json'), JSON.stringify(config, null, 2));
const architecture = process.arch === 'x64' ? '64' : process.arch;
const binary = path.resolve(process.platform === 'win32' ? 'node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe' : process.platform === 'darwin' ? `node_modules/@cloudflare/workerd-darwin-${architecture}/bin/workerd` : `node_modules/@cloudflare/workerd-linux-${architecture}/bin/workerd`);
const result = spawnSync(binary, ['test', path.join(directory, 'wrangler.json')], { encoding: 'utf8', timeout: 45000 });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
