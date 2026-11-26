import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { npmCli, npmEnvironment } from './npm-command.mjs';
if (/^(1|true)$/i.test(process.env.npm_config_offline || '')) throw new Error('Offline npm audit cannot establish a clean dependency graph.');
const root = path.resolve(import.meta.dirname, '..'), evidence = path.join(root, '.codex-runtime', 'targeted-audit');
mkdirSync(evidence, { recursive: true });
const results = [];
for (const scope of ['root', 'backend', 'frontend']) {
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json', '--audit-level=high', '--fetch-retries=0', '--fetch-timeout=15000'], {
    cwd: scope === 'root' ? root : path.join(root, scope), encoding: 'utf8', timeout: 30000,
    env: { ...npmEnvironment, npm_config_cache: path.join(evidence, 'npm-cache') },
  });
  const raw = result.stdout || ''; writeFileSync(path.join(evidence, `${scope}-after.json`), raw + '\n');
  let report; try { report = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { /* A non-JSON CLI failure is a blocked audit. */ }
  const available = Boolean(report?.metadata?.vulnerabilities);
  const entry = { scope, exitCode: result.status, status: available ? result.status === 0 ? 'passed' : 'findings' : 'blocked',
    vulnerabilities: report?.metadata?.vulnerabilities || null, findings: available ? report.vulnerabilities : null,
    error: available ? undefined : report?.message || result.error?.message || 'Audit did not return a vulnerability report' };
  results.push(entry); console.log(JSON.stringify({ ...entry, findings: undefined }));
}
writeFileSync(path.join(root, 'docs', 'dependency-audits.json'), JSON.stringify({ recordedAt: new Date().toISOString(), command: 'npm audit --json --audit-level=high', results }, null, 2) + '\n');
process.exitCode = results.every(value => value.status === 'passed') ? 0 : 1;
