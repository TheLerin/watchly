import turnstile from '../../backend/turnstile.js';
import { actorKey, consume } from './AbuseGuard.mjs';

export async function checkAnonymousCreation(env, { account, actor, hostname, suspicious, token }, fetcher = fetch) {
  if (!turnstile.enabled(env)) return { ok: true };
  if (account?.profile && account.expiresAt > Date.now()) return { ok: true };
  if (!env.ABUSE || !/^[a-f0-9]{64}$/.test(actor || '')) return turnstile.unavailable(env);
  const shard = parseInt(actor.slice(0, 2), 16) % 64;
  const response = await env.ABUSE.get(env.ABUSE.idFromName(`abuse-${shard}`)).fetch(new Request('https://internal/consume', {
    method: 'POST', body: JSON.stringify({ actor, action: 'anonymousCreate', challengeAfter: turnstile.threshold(env) }),
  }));
  if (!response.ok) return turnstile.failure('RATE_LIMITED', 'Too many room creation attempts. Retry later.', {});
  const risk = await response.json();
  if (!risk.challengeRequired && !suspicious) return { ok: true };
  const verified = await turnstile.verifyCreationChallenge({ token, hostname, env, fetcher });
  if (!verified.ok) return verified;
  // Siteverify replay detection is eventually consistent; atomically claim the hash in a fixed guard shard too.
  if (!await consume(env, await actorKey(`turnstile:${token}`), 'challenge')) return turnstile.failure('TURNSTILE_FAILED', 'Verification was already used. Complete a fresh verification.', env);
  return { ok: true };
}
