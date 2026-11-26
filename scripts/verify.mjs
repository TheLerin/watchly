import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmEnvironment } from './npm-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const focused = ['accounts', 'playback', 'validators', 'socialDatabase', 'sessionDatabase', 'socialRealtime', 'safeEvents', 'rateLimit', 'driveAccess', 'driveUpstream', 'turnstile', 'mediaIsolation'].map(name => `backend/test/${name}.test.js`);
const checks = [
  ['dependency-audits', ['scripts/audit-dependencies.mjs']],
  ['wrangler-bindings', ['scripts/check-wrangler.mjs']],
  ['workers', ['--test', 'workers/test/*.test.mjs']],
  ['backend-focused', ['--test', ...focused]],
  ['frontend', ['--test', 'test/*.test.js'], 'frontend'],
  ['frontend-lint', ['node_modules/eslint/bin/eslint.js', '.'], 'frontend'],
  ['build', ['scripts/build-cloudflare.mjs']],
  ['asset-validation', ['scripts/prepare-assets.mjs']],
  ['worker-bundle', ['frontend/node_modules/esbuild/bin/esbuild', 'workers/src/index.mjs', '--bundle', '--format=esm', '--platform=browser', '--external:node:*', '--outfile=.worker-build/worker.mjs']],
  ['browser-harness', ['workers/test/browser-harness.mjs']],
  ['workerd-direct', ['workers/test/workerd-direct.mjs']],
  ['workerd-integration', ['workers/test/integration.mjs']],
  ['browser-wire', ['workers/test/browser.cjs']],
  ['pwa-update', ['workers/test/pwa-update.cjs']],
  ['wrangler-dry-run', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', '.worker-build']],
  ['wrangler-staging-dry-run', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--env', 'staging', '--outdir', '.worker-build/staging']],
  ['wrangler-production-dry-run', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--env', 'production', '--outdir', '.worker-build/production']],
  ['backend-full', ['--test'], 'backend'],
];
mkdirSync(path.join(root, '.codex-runtime', 'v2.1'), { recursive: true });
mkdirSync(path.join(root, 'docs'), { recursive: true });
const selected = process.argv.slice(2);
for (const name of selected) if (!checks.some(check => check[0] === name)) throw new Error(`Unknown check: ${name}`);
const recordPath = path.join(root, 'docs', 'verification.json');
let results = selected.length && existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')).results : [];
for (const [name, args, cwd = '.'] of checks) {
  if (selected.length && !selected.includes(name)) continue;
  console.log(`Running ${name}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: path.join(root, cwd), encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...npmEnvironment, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(root, '.codex-runtime', 'wrangler-logs') } });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : '');
  writeFileSync(path.join(root, '.codex-runtime', 'v2.1', `${name}.log`), output);
  const entry = { name, exitCode: result.status, elapsedMs: Date.now() - started, passed: result.status === 0, tests: Number(/ℹ tests (\d+)/.exec(output)?.[1]) || undefined, pass: Number(/ℹ pass (\d+)/.exec(output)?.[1]) || undefined, fail: Number(/ℹ fail (\d+)/.exec(output)?.[1]) || undefined };
  entry.recordedAt = new Date().toISOString();
  // Persist each completed gate before starting another; run verification sequentially.
  if (existsSync(recordPath)) results = JSON.parse(readFileSync(recordPath, 'utf8')).results;
  const previous = results.findIndex(result => result.name === name);
  if (previous >= 0) results[previous] = entry; else results.push(entry);
  console.log(JSON.stringify(entry));
  writeFileSync(recordPath, JSON.stringify({ recordedAt: entry.recordedAt, node: process.version, lastSelectedChecks: selected.length ? selected : 'all', results }, null, 2) + '\n');
}
writeFileSync(recordPath, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, lastSelectedChecks: selected.length ? selected : 'all', results }, null, 2) + '\n');
process.exitCode = results.every(result => result.passed) ? 0 : 1;
