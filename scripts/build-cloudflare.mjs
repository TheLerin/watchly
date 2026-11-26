import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: process.cwd() + '/frontend',
  env: { ...process.env, VITE_BACKEND_URL: '', VITE_REALTIME_TRANSPORT: 'native' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status || 0;
