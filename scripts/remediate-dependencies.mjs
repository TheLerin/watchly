// Transactional manifest/lock preparation for a network-enabled host. No --force or major framework upgrade.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { npmCli, npmEnvironment } from './npm-command.mjs';
const root = path.resolve(import.meta.dirname, '..'), scopes = ['root', 'backend', 'frontend'];
const manifests = Object.fromEntries(scopes.map(scope => [scope, JSON.parse(readFileSync(path.join(root, scope === 'root' ? '' : scope, 'package.json'), 'utf8'))]));
manifests.frontend.devDependencies.vite = '^7.3.8';
manifests.frontend.overrides = { ...manifests.frontend.overrides,
  'rollup@>=4.0.0 <4.59.0': '^4.59.0', '@rollup/plugin-terser': { 'serialize-javascript': '^7.1.3' } };
const plan = { backend: { ws: '8.21.0' }, frontend: { vite: '^7.3.8', rollup4: '^4.59.0', terserSerializer: '^7.1.3', ws: '8.21.0' },
  note: 'Serializer 7 retains the CommonJS serialize(value, options) API used by plugin-terser; Node 24 satisfies its newer engine requirement. Rollup 2 used by Workbox remains on its own compatible branch.' };
console.log(JSON.stringify(plan, null, 2));
if (!process.argv.includes('--apply')) { console.log('Plan only. Use --apply with registry access to resolve, audit and install before applying new locks.'); process.exit(0); }
if (/^(1|true)$/i.test(process.env.npm_config_offline || '')) throw new Error('Offline npm audit cannot establish that a dependency graph is clean. Run on a host with approved registry access.');
const directory = path.join(root, '.codex-runtime', `dependency-upgrade-${Date.now()}`); mkdirSync(directory, { recursive: true });
let applied = false;
const npm = (args, cwd) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit', timeout: 180000,
    env: { ...npmEnvironment, npm_config_cache: process.env.WATCHLY_NPM_CACHE || path.join(directory, 'cache'), npm_config_fetch_retries: '0', npm_config_fetch_timeout: '15000' } });
  if (result.status !== 0) throw new Error(applied ? `npm ${args[0]} failed after applying manifests/locks; installation and verification must pass before release.` : `npm ${args[0]} failed; proposed manifest/lock files have not been applied.`);
};
// Keep all proposed changes isolated until resolution and all three critical/high audits pass.
for (const scope of scopes) {
  const original = path.join(root, scope === 'root' ? '' : scope), staging = path.join(directory, scope); mkdirSync(staging);
  writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifests[scope], null, 2) + '\n'); copyFileSync(path.join(original, 'package-lock.json'), path.join(staging, 'package-lock.json'));
}
const failures = [];
for (const scope of scopes) {
  const staging = path.join(directory, scope);
  try { npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], staging); }
  catch (error) { failures.push(`${scope}: ${error.message}`); }
}
if (failures.length) throw new Error(failures.join('\n'));
for (const scope of scopes) {
  const staging = path.join(directory, scope);
  npm(['audit', 'fix', '--package-lock-only', '--ignore-scripts', '--audit-level=high'], staging);
  npm(['audit', '--audit-level=high'], staging);
  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], staging);
}
for (const scope of scopes) {
  const destination = path.join(root, scope === 'root' ? '' : scope), staging = path.join(directory, scope);
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(path.join(staging, file), path.join(destination, file));
}
applied = true;
for (const scope of scopes) npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(root, scope === 'root' ? '' : scope));
npm(['run', 'verify'], root);
