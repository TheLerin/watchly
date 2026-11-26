import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

export async function localServer() {
  if (process.env.WATCHLY_TEST_BASE) {
    const url = new URL(process.env.WATCHLY_TEST_BASE);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Tests are restricted to local services.');
    return { base: url.origin, stop() {} };
  }
  if (!existsSync('node_modules/wrangler/bin/wrangler.js')) throw new Error('Wrangler is unavailable. Run npm install on a machine with npm registry access, then retry.');
  if (!existsSync('frontend/dist/index.html')) throw new Error('Run npm run build first.');
  const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  const directory = path.resolve('.codex-runtime/worker-integration', randomUUID()); await mkdir(directory, { recursive: true });
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  delete config.env; delete config.$schema;
  config.name = 'watchly-local-tests'; config.main = path.resolve(config.main);
  config.assets.directory = path.resolve(config.assets.directory);
  config.observability = { enabled: false };
  // Isolated config directory prevents loading real .dev.vars or production credentials.
  config.vars = { NODE_ENV: 'development', MEDIA_PROVIDER: 'livekit', LIVEKIT_ROOM_NAMESPACE: 'development', ALLOWED_ORIGINS: '' };
  await writeFile(path.join(directory, 'wrangler.json'), JSON.stringify(config, null, 2));
  // Test-only CLI settings avoid external Request.cf fetches and user-profile registry writes.
  // Worker NODE_ENV remains development in config.vars.
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', path.join(directory, 'wrangler.json'), '--ip', '127.0.0.1', '--port', String(port), '--persist-to', path.join(directory, 'state')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', XDG_CONFIG_HOME: path.join(directory, 'config'), WRANGLER_SEND_METRICS: 'false' } });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('Wrangler exited: ' + output);
    try { if ((await fetch(base + '/api/health')).ok) return { base, stop: () => child.kill() }; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill(); throw new Error('Wrangler did not become reachable. ' + output);
}
