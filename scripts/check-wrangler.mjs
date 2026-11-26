import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function checkWrangler(config) {
  const names = new Set(), summaries = [];
  const expected = { ROOMS: 'WatchRoom', PRESENCE: 'PresenceDirectory', ABUSE: 'AbuseGuard' };
  for (const [namespace, environment] of [['development', config], ['staging', config.env?.staging], ['production', config.env?.production]]) {
    if (!environment?.name || names.has(environment.name)) throw new Error(`Missing or shared Worker name for ${namespace}`);
    names.add(environment.name);
    if (environment.vars?.LIVEKIT_ROOM_NAMESPACE !== namespace) throw new Error(`Wrong media namespace for ${namespace}`);
    const bindings = environment.durable_objects?.bindings || [];
    if (bindings.length !== 3 || new Set(bindings.map(value => value.name)).size !== 3) throw new Error(`Missing/duplicate Durable Object binding for ${namespace}`);
    for (const [name, className] of Object.entries(expected)) {
      const binding = bindings.find(value => value.name === name);
      if (binding?.class_name !== className || binding.script_name || binding.environment) throw new Error(`Foreign or missing ${name} binding for ${namespace}`);
    }
    if (environment.assets?.binding !== 'ASSETS' || typeof environment.assets.directory !== 'string' || path.posix.normalize(environment.assets.directory) !== 'frontend/dist') throw new Error(`Missing assets binding for ${namespace}`);
    for (const route of ['/api/*', '/ws/*', '/room/*', '/auth/callback*']) if (!environment.assets.run_worker_first?.includes(route)) throw new Error(`Missing Worker route ${route} for ${namespace}`);
    const classes = (environment.migrations || []).flatMap(value => value.new_sqlite_classes || []);
    for (const className of Object.values(expected)) if (!classes.includes(className)) throw new Error(`Missing SQLite migration for ${namespace}:${className}`);
    summaries.push({ namespace, worker: environment.name, durableObjects: Object.keys(expected), assets: 'ASSETS', mediaPrefix: `watchly-${namespace}-voice-` });
  }
  return summaries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const bindingsVerified = checkWrangler(config);
  if (process.argv.includes('--staging-preflight')) {
    const origin = new URL(process.env.VITE_SITE_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== process.env.VITE_SITE_ORIGIN) throw new Error('VITE_SITE_ORIGIN must be the exact HTTPS staging origin.');
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'TURNSTILE_SITE_KEY']) {
      if (!process.env[name]?.trim()) throw new Error(`Required staging setting: ${name}`);
    }
    console.log(`Supabase staging redirect URL: ${origin.origin}/auth/callback`);
  }
  console.log(JSON.stringify({ bindingsVerified, note: 'Structural checks only. Remote bindings, secrets and live providers require staging acceptance.' }, null, 2));
}
