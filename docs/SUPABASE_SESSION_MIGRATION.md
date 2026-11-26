# Supabase session-check migration

Apply only `supabase/migrations/202611260001_watchly_session_check.sql` after approving the intended staging database change. No live database was modified during implementation. Keep the original account/social migrations and existing records; do not reset Supabase or rerun their create-table statements.

The additive function `public.watchly_session_active()` returns a boolean for the caller's own `auth.uid()` and JWT `session_id`. It checks that the matching `auth.sessions` row exists and is not past `not_after`. Its empty search path prevents object substitution; SECURITY DEFINER permits that constrained lookup without exposing the auth table. PUBLIC/anon execution is revoked and authenticated execution is granted.

Production account verification calls this RPC after Auth verifies the JWT. A missing RPC or database error fails account verification closed. Guests remain available. Active account actions refresh the session check after a maximum 60-second cache; the browser also re-supplies credentials every five minutes. This is polling, not immediate push revocation.

Staging acceptance:

1. Confirm the target project and migration history; back up the schema definition as required by your database procedure.
2. Review and apply only the additive migration after approval. It creates/replaces the one function and its grants; it does not alter user/social rows.
3. With an authenticated staging browser client, call `supabase.rpc('watchly_session_active')`; expect true for its active session. An anonymous request must be denied.
4. Use an authorized staging test account to sign out/revoke the session. A request carrying its former access JWT must return false from the function while the JWT remains otherwise valid, and subsequent room actions must lose account privileges after the documented cache window.
5. Confirm a different session cannot validate the revoked one. Verify refresh, private/account-only room disconnection, OAuth/email callbacks and normal guest creation.

Do not delete `auth.sessions` manually to test this against production. Do not remove the function while production server checks depend on it. Record project/environment, migration application and acceptance results in the release-gate report; never record access/refresh tokens.
