import { existsSync } from 'node:fs';
import path from 'node:path';

// Invoke npm without a shell/profile, and never run dependency lifecycle scripts.
const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
export const npmCli = candidates.find(value => value && existsSync(value));
if (!npmCli) throw new Error('Cannot locate npm-cli.js beside Node; run this command through npm.');
export const npmEnvironment = {
  ...process.env, npm_config_ignore_scripts: 'true', npm_config_fund: 'false',
  POWERSHELL_TELEMETRY_OPTOUT: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  VERCEL_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false',
  APPLICATIONINSIGHTS_DISABLE_TELEMETRY: 'true',
};
