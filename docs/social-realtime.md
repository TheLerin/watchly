# Realtime social updates

## 1. Root cause

The old `useSocial` instances fetched the complete `get_my_watchly` result when
mounted, after their own mutation, on focus/visibility return, and every 30
seconds. They did not subscribe to persistent database changes. Socket.IO's
`friends:presence` updated online/in-room status only. Another user's database
mutation therefore did not immediately invalidate the receiving browser.

## 2. Mechanism

`SocialProvider` owns one external store for the initialized, authenticated
account with a completed profile. My Watchly and Invite friends share it through
the existing `useSocial` entry point. Two fixed Supabase channels are used:

- Scoped Postgres Changes for INSERT and UPDATE events on the social tables.
- A private `watchly-social:<auth.uid()>` Broadcast channel for table-only
  invalidations on DELETE and for RLS-hidden block effects.

The private bridge is necessary because private DELETE rows cannot safely be
distributed through the existing row policies, and the blocked account cannot
read someone else's block row. It carries only `{table: ...}`; no user IDs,
relationship rows, room codes, profiles or tokens appear in its payload. The
notification causes an authorized read, never a local reconstruction of rules.
Supabase documents the [Postgres Changes limitations](https://supabase.com/docs/guides/realtime/postgres-changes)
and [private database Broadcast](https://supabase.com/docs/guides/realtime/broadcast).

Socket.IO continues to own presence, room membership, playback, permissions,
chat and queue. Supabase authentication and LiveKit voice are unchanged.

## 3. Tables

`friend_requests`, `friendships`, `blocks`, `room_invites`. Profiles are not
subscribed to or newly added to the publication.

## 4. Deployment migration — required

Apply the complete contents of
`supabase/migrations/202610040001_watchly_social_realtime.sql` to the Watchly
Supabase project **after** the existing accounts migration. Use the project's
SQL editor as the database owner, or the usual linked Supabase migration
workflow. Do not rerun the original table-creation migration on an existing DB.

The new migration runs in one transaction and is rerunnable. It adds only the
four needed tables to `supabase_realtime`, preserving any existing publication
members. It installs targeted projections, deletion/block triggers and topic
policies. No dashboard table toggles or additional environment keys are needed.

The workspace has no linked Supabase CLI/project administrator credentials;
the migration was executed and verified on the isolated PostgreSQL fixture,
**not on the production Supabase project**. GitHub/Vercel deployments cannot
automatically apply this SQL. Live updates require this database step.

During a staggered deploy, only a `PGRST202` missing-function response falls back
to the existing `get_my_watchly` RPC so the existing page and actions remain
usable. That fallback does not provide live notifications and is not polling.
After SQL is installed, all ordinary reads use the targeted RPC. The original
RPC delegates to the same projections, so there is one authoritative source.

Optional deployment verification in the SQL editor:

```sql
select tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public'
  and tablename in ('friend_requests','friendships','blocks','room_invites')
order by tablename;

select to_regprocedure('public.get_social_data(text[])');
select policyname from pg_policies
where schemaname='realtime' and tablename='messages'
  and policyname like 'watchly_social_%';
```

Expected: all four tables, a non-null procedure, and three topic policies.
After applying SQL, open two signed-in browsers and exercise the actions below
to verify the real project's publication and Realtime service configuration.

## 5. Filtering

One Postgres Changes channel contains 14 narrowly scoped listeners: INSERT and
UPDATE for each endpoint of requests, friendships and invites, plus the block
owner. Requests/invites filter `sender_id` and `receiver_id`; friendships filter
`user_low` and `user_high`; blocks filter `blocker_id`. Every filter equals the
current authenticated user's stable ID. There is no global DELETE listener.

For private invalidations, a database trigger chooses only the deleted
relationship's endpoints or the account affected by a hidden block change.
Topic RLS requires the authenticated user's own topic. There are no anonymous
subscriptions or frontend service-role credentials.

## 6. Targeted invalidation and UI

| Change | Projections refreshed |
|---|---|
| Request created, declined or deleted | incoming requests + outgoing pending IDs |
| Accepted request | requests + friends |
| Friendship inserted/deleted | friends |
| Invite inserted/updated/deleted | incoming invites + pending sender invites |
| Block/unblock | blocks + affected relationship lists |

`get_social_data(sections text[])` executes only requested projections. It
derives identity from `auth.uid()` and preserves the database's ownership,
blocking, expiry and friendship rules. Multiple events in a 60 ms burst are
coalesced; an invalidation during a fetch forces a trailing read. Event order
does not matter. Arrays replace previous authoritative arrays, with stable
database/user IDs as existing React keys. No blind append or duplicate counters.

Successful actor mutations immediately refresh their affected sections without
waiting for Realtime. Existing pending buttons remain. Background reads retain
data and never reset page loading skeletons. Invite friends' `Invited` label now
comes from the database's pending sender invites and updates after acceptance,
decline or revocation. Existing count displays remain derived from arrays; no
separate notification counter, permanent connection indicator or toast spam.

A scoped CSS stacking fix keeps an open friend menu above the glass invite
card, allowing Block/Remove to be clicked when pending invitations are visible.
Dimensions, layout and themes are preserved.

## 7. Cleanup

Account changes replace the store before old results can render. Effect cleanup
removes both channels, socket handlers and browser listeners; aborts pending
reads; clears scheduled invalidations; and fences late callbacks and mutations
using a generation. Channel removal completes before the same private topic is
reused during Strict Mode effect replay. Route/card changes reuse the provider;
they never create extra channels. Logout clears the old account's subscriptions.

## 8. Reconnect and visibility

The official SDK reconnects/rejoins automatically. After both channels have
rejoined, the store reconciles all four projections once, recovering missed
requests and invites. Initial join also closes the initial read/subscribe gap.
Focus and visibility-return events are coalesced safety reconciliation. No
`setInterval`, page reload or focus event is required for ordinary updates.

## 9. RLS

Existing profiles/requests/friendships/blocks/invites RLS and write grants are
unchanged. The new authenticated projection RPC has the same identity and
business rules as the previous RPC; anonymous execution is denied. Direct
social writes remain denied.

Three additional `realtime.messages` policies permit read-only access to the
signed-in account's private topic and restrict that namespace even if another
feature has installed broad permissive policies. Browser writes into the
namespace are denied. The migration does not ALTER Supabase-owned realtime
tables, disable RLS, grant public SELECT on social tables, or expose secrets.
See [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

## 10. Verification

- Backend: 57 tests pass, including four real PostgreSQL migration/publication,
  targeted projection, topic isolation, anonymous/forged-write and block tests.
- Frontend: 100 tests pass, including seven store tests covering filters,
  coalescing, late reads, Strict Mode, cleanup, immediate actor refresh,
  reconnect/foreground reconciliation and staggered-deploy compatibility.
- ESLint and Vite production/PWA build pass.
- `browserSocialRealtime.cjs`: independent headless **Chrome and Edge** use the
  official Supabase browser SDK, actual WebSocket transport, local Auth/REST
  service boundaries and real PostgreSQL RLS/projections/triggers. Request
  creation/decline/revocation/acceptance, friendship removal, invite creation/
  decline/revocation/acceptance, sender pending state, block/unblock, network
  loss with missed request/invite, logout, account switching, Strict Mode and
  SPA navigation all pass without a refresh or dispatched focus event. The
  test verifies request-only and invite-only refetches and no duplicate rows.
- Existing `browserAccounts.cjs` passes with all social focus workarounds removed:
  Google PKCE/email OTP, profile setup/edit, presence, social actions, invites,
  guest account upgrade, sign-out and room recovery remain intact.
- `browserMyWatchly.cjs` passes both themes and 1920/1440/1366/768/390/320/2560
  layouts, search retention/focus/Escape, responsive controls, recent-room
  rejoin, launcher and social actions.
- `browserRoles.cjs` passes real playback/YouTube/playlist/local-file and
  Host/Moderator/Viewer checks plus Cinema Luxe control visibility.

Local fixture tests prove the application flow and SQL/RLS behavior; they do
not prove that the production Supabase migration or publication is installed.
LiveKit voice modules, room synchronization and authentication implementations
were not edited by this change.

## Exact files changed

Production:
`frontend/src/App.jsx`, `frontend/src/context/SocialContext.jsx`,
`frontend/src/hooks/useSocial.js`, `frontend/src/utils/socialStore.js`,
`frontend/src/components/account/InviteFriends.jsx`,
`frontend/src/components/account/account.css`,
`supabase/migrations/202610040001_watchly_social_realtime.sql`.

Verification/docs:
`backend/package.json`, `backend/package-lock.json`,
`backend/testing/supabaseHarness.cjs`, `backend/testing/socialRealtime.cjs`,
`backend/test/socialRealtime.test.js`, `frontend/test/socialStore.test.js`,
`frontend/test/browserSocialRealtime.cjs`, `frontend/test/browserAccounts.cjs`,
`frontend/test/browserMyWatchly.cjs`, `docs/accounts-and-my-watchly.md`,
`docs/social-realtime.md`.
