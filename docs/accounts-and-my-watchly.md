# Accounts and My Watchly

Watchly now has an account and social foundation alongside its existing guest rooms. The operator's supplied public Supabase URL/key are saved only in ignored local environment files, using Vite's `VITE_*` names instead of Next.js's `NEXT_PUBLIC_*`. A read-only project check returned `PGRST205` for the missing `profiles` table; the migration and provider/deployment setup remain to be applied. No real Supabase database was modified, no credentials were invented, and no live Google or email delivery test has been performed.

## Existing architecture and audit

| Area | Existing implementation and integration decision |
| --- | --- |
| Frontend | React 19, Vite 7, React Router 7, JSX/CSS, with Context providers and component hooks. The new Auth provider follows that structure. |
| Hosting | Vercel serves the frontend; Render runs Express 5 and Socket.IO 4. Neither service is replaced. |
| Backend APIs | Express supplies health, ICE configuration and existing media/proxy support. Socket.IO is the authoritative room API. Social database operations use Supabase's authenticated API. |
| Persistent database | The existing room implementation had no persistent account/social database. Supabase adds that separate responsibility. |
| Rooms | A server-owned in-memory `Map` stores temporary rooms, members, queue, playback state, readiness and room control. A backend restart can expire rooms. |
| Guest identity | Render generates a stable member UUID with `crypto.randomUUID()`. The current `socket.id` is a transport address rather than the member's permanent identity. |
| Display names | The server validates a guest nickname of 1–24 characters and keeps it on the room member. Account members use their verified profile's display name. |
| Roles | Host, Moderator and Viewer remain room-member properties, with the existing permission checks and controller lease. There is no global account role. A guest can still create a room as Host. |
| Socket client/server | `frontend/src/socket.js` owns one lazily connected client; `backend/server.js` owns one Socket.IO server. `backend/realtime.js` registers the room protocol and now optional account authentication. |
| Reconnect identity | The browser's `watchTogetherSession` sessionStorage entry contains room ID, nickname, member ID and a resume token. Render stores the SHA-256 token hash and verifies it when restoring a member. Existing recovery owns retry, snapshots, control resync and replacement of an older socket. |
| Existing storage | Appearance uses `watchly-appearance-settings`, with migration of older `watchly-theme`/`watchly-room-appearance` values. Audio/subtitle choices use `watchly-preferred-audio-language` and `watchly-preferred-subtitle-language`. Local video bytes and object URLs remain browser-local. |
| Recent rooms | There was no shared recent-room utility to reuse. The new optional `watchly-recent-rooms` localStorage list stores up to ten distinct room codes and visit times. It contains no resume tokens or media. |
| Homepage and joining | The existing cinematic hero, sections, room launcher and `/room/:roomId` nickname onboarding remain. Only account navigation and profile identity are integrated. My Watchly and invite acceptance call the same RoomContext create/join methods. |
| Environment conventions | Vite exposes explicitly public `VITE_*` variables at build time. Render uses server environment variables. Existing backend URL, CORS, port and TURN configuration remain. |

Supabase owns authentication, profiles, usernames, relationships, blocks and persistent invites. Render continues to own rooms, playback, roles, queue, readiness, presence and WebRTC signaling. Supabase is not a replacement for Socket.IO, and accounts are not required to enter a shared room link.

## Files

Paths below are relative to the repository root.

| New files | Responsibility |
| --- | --- |
| `frontend/src/supabase.js` | One official Supabase browser client; PKCE, persisted SDK sessions and automatic token refresh. Missing or invalid configuration disables account features without crashing guest mode. |
| `frontend/src/context/AuthContext.jsx` | Central auth listener, initial restoration, profile loading, Google/email sign-in, verification, profile saving and sign-out. |
| `frontend/src/utils/account.js`, `frontend/src/utils/accountRecovery.js` | Canonical usernames, safe public fields/avatars/return routes, clean errors, and fenced SDK refresh after account handshake rejection. |
| `frontend/src/utils/recentRooms.js` | Defensive local history parsing, deduplication and ten-room limit. |
| `frontend/src/hooks/useSocial.js` | Authenticated social reads/mutations, username search, refresh scheduling and friend presence subscription. |
| `frontend/src/components/account/` | `AuthPages.jsx`, `MyWatchly.jsx`, `InviteFriends.jsx`, `AccountActions.jsx`, `AccountShell.jsx`, `AccountDialog.jsx`, `Avatar.jsx`, `LegalPage.jsx` and `account.css`: account pages, responsive social UI, portal dialogs, avatar/menu and basic legal pages. |
| `backend/accounts.js` | Supabase Auth verification, safe profile/friend lookups, server-authorized invite issuance and friend-only presence aggregation. |
| `supabase/migrations/202610030001_watchly_accounts.sql` | The five tables, constraints, indexes, RLS, grants and transactional social functions. |
| `backend/test/accounts.test.js`, `backend/test/accountRooms.integration.test.js`, `backend/test/socialDatabase.test.js` | Verification boundaries, authenticated room integration and actual PostgreSQL/RLS social tests. |
| `backend/testing/supabaseHarness.cjs`, `frontend/test/browserAccounts.cjs` | An isolated test Auth endpoint and real PGlite database used with the official browser SDK. Test credentials are fixtures, not production configuration. |
| `frontend/test/account.test.js` | Username, return-route, avatar, privacy/error and recent-room utility checks. |

Modified files include `frontend/src/App.jsx`, `LandingPage.jsx`, `RoomLayout.jsx`, `UserQueueSidebar.jsx`, `RoomContext.jsx`, `socket.js` and `utils/roomRecovery.js`; both packages and lockfiles; both `.env.example` files; `render.yaml`; `frontend/vercel.json`; `.gitignore`; and recovery/source-selection tests. Vercel's account-route headers prevent indexing of auth, setup, profile and My Watchly pages. Browser screenshots/artifacts are excluded from Git. Deployment instructions link to this report.

## Sign-in, profiles and navigation

`/auth` is shared by Sign in and Get started. It supports Google redirect OAuth and email codes using the official SDK. There are no password or password-reset forms. `/auth/callback` handles the SDK's PKCE return and optional email token-hash confirmation. A small sessionStorage entry stores only a permitted return path; external URLs, protocol-relative URLs and unsafe paths are rejected.

`AuthProvider` restores the SDK session once and displays account/profile skeletons while it initializes. Auth callbacks update state synchronously; database requests are scheduled outside the callback to avoid SDK auth-lock deadlocks. Profile loads are fenced against a changed account or newer profile save. The SDK, rather than a custom token storage implementation, owns persistence and refreshing. PKCE is Supabase's supported flow. [Supabase PKCE documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

New users without a profile go to `/setup-profile`. The form asks for display name and username only. Google can prefill a name and avatar, but the user may edit the name or choose generated initials. `/profile` allows later changes. Usernames are normalized to lowercase, accept 3–24 letters/numbers/underscores, and are unique in PostgreSQL. A conflict shows “That username is already taken.” Display names accept 1–24 characters. Avatars use a safe HTTPS provider URL or initials; no upload/storage system is introduced.

Logged-out homepage navigation shows Sign in and Get started. Logged-in navigation shows My Watchly, Create room and an avatar menu with name, username, My Watchly, Profile and Sign out. Hero Create room/Join room remain available to guests. Authenticated create/join uses the profile identity automatically. `/my-watchly` and profile routes require sign-in; a shared `/room/ROOM123` link does not.

The new account UI uses dark glass surfaces, restrained borders, a desktop two-column layout and a single mobile column. Buttons use practical touch targets; menus and portal dialogs support Escape, and dialogs restore focus and trap keyboard focus. Loading and empty states remain small.

## Database, indexes and authorization

The saved migration runs as one transaction. It creates the following tables; these have not yet been applied to the user's real project.

| Table | Data and constraints | Important indexes |
| --- | --- | --- |
| `profiles` | UUID primary key referencing `auth.users(id) ON DELETE CASCADE`; canonical unique username; display name; optional HTTPS avatar; creation/update/private last-seen timestamps. No email or credentials. | Primary key and unique username. |
| `friend_requests` | Sender/receiver profiles, pending/accepted/rejected status and timestamps; self requests prohibited. | One pending normalized unordered pair; sender/status and receiver/status. |
| `friendships` | One normalized `user_low < user_high` pair, primary key and creation time; self/duplicate friendships prohibited. | Pair primary key and `user_high`. |
| `blocks` | Blocker/blocked pair and creation time; self blocks prohibited. | Pair primary key and blocked ID. |
| `room_invites` | Sender/receiver profiles, seven-character room code, pending/accepted/declined status and two-hour expiry; self invites prohibited. | One pending sender/receiver/room combination; receiver/status/expiry. |

Every table has RLS enabled. Anonymous users receive no table access. Authenticated profile reads expose only ID, username, display name, avatar and creation/update timestamps, with blocked relationships excluded; `last_seen_at` is not granted as a readable column. Profile creation/update is restricted to `auth.uid()`, and only the intended editable columns are writable.

PostgREST profile upserts include `id` in their update list, so its column grant is included. The ownership policies still prevent changing a profile to another user's ID; actual PostgreSQL tests cover that case. Invite creation takes `verified_sender_id`, `target_id` and `invite_room_code`, and only the backend's `service_role` can execute it.

Requests, friendships and invites are readable only by involved users and subject to blocking. A user reads only their own block list. Direct writes to social tables are revoked, including for authenticated users. Social mutations use explicit database functions whose ownership comes from `auth.uid()` rather than a supplied sender ID. Security-definer functions use a fixed empty search path and explicitly qualified objects; private helper access is restricted. RLS and grants are complementary controls. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

The callable functions are `search_people`, `friend_ids`, `get_my_watchly`, `request_friend`, `respond_friend_request`, `remove_friend`, `block_person`, `unblock_person`, `respond_room_invite` and `touch_profile`. Invite creation is the special server-only `send_room_invite` function described below. `touch_profile` prepares a private last-seen field; online presence is not continually written to Postgres.

Mutations lock an unordered user pair with a transaction-scoped advisory lock. Repeated Add Friend returns the pending state; crossed pending requests accept one friendship; repeated acceptance does not insert duplicates. The database also enforces unique indexes, so correctness does not depend on disabled UI buttons. Blocking removes the friendship, rejects pending requests and removes pending invites between the pair. Unblocking does not silently recreate a friendship. Removing a friend also removes pending invites.

Deleting a future Supabase auth user cascades through the profile and dependent relationships, requests, blocks and invites. This task does not introduce an account-deletion UI.

## Socket identity, guests and recovery

The existing singleton client reads the current access token on every Socket.IO handshake. Auth state changes update that in-memory value. A serialized `auth:update` path authenticates an already connected socket, including an inline guest upgrade and SDK token refresh.

Render verifies each supplied token using the official SDK's `auth.getUser(token)` against Supabase Auth, then fetches that user's safe profile with the user JWT and public key. A decoded JWT is used only to schedule expiration after remote verification; its claims, editable metadata and client-provided user/role/email fields do not authorize identity. Unverifiable account connections fail closed. [Supabase `getUser` reference](https://supabase.com/docs/reference/javascript/auth-getuser)

New authenticated memberships use the verified Supabase UUID as their stable room `userId`. A guest who signs in inside an existing room retains the original guest member UUID, with the verified `accountId` added separately. This preserves readiness, role, playback and in-memory local file state. Account identity never promotes a Viewer or changes the Host/Moderator permission matrix.

An account-bound resume token also requires the matching verified account. Knowing a resume token alone cannot resume another account's membership. The same verified account can recover its one logical membership in that room from another device; the previous socket is fenced and disconnected using the existing replacement protocol. The system retains current single-active-membership rules per account per room, not two independent seats. Room roles and controller leases still follow the existing recovery/lease rules; an expired temporary room is not resurrected by a persistent account.

On token expiry, account-only social access and presence are removed, the client requests SDK refresh, and the logical room membership is retained. Authentication updates are fenced against a later sign-out or changed connection. A refreshed token is used by future reconnects. Guests provide no account token and follow the existing nickname/resume path without a Supabase dependency.

Permanent account ownership/profile errors stop room retries and expose sign-in/setup controls. Invalid access and refresh credentials are cleared through the SDK and lead to a typed ownership failure rather than an endless restoring screen. An incomplete profile may still resume its original guest Host membership and finish setup inline; a guest token cannot create a second membership for an account that already owns a seat.

Inside a room, the member panel offers an inline email-code sign-in and profile setup dialog. It preserves the current room and local video object URL. Google sign-in is disabled there with an explanation to leave first, because its full-page redirect would tear down local media/voice state. A full-page magic link or reload may likewise require reselecting a local file; use the inline code to avoid that. Sign-out in a room explicitly says **Leave room & sign out**, performing the existing leave before clearing the session. Themes, appearance, language preferences and local recent rooms are retained.

## My Watchly, friends, presence and invites

My Watchly provides a greeting, Create room/Join room, friends, debounced username-prefix search, incoming requests, invitations, local recent rooms, and a compact blocked-people list. Search waits 300 ms, requires three characters and returns at most ten safe profiles. It does not accept or reveal emails. Guests and profiles that have not completed setup are handled before this page loads.

Friend requests support Add Friend, Accept and Decline; the list supports Remove friend, Block and Unblock. Outgoing and existing-friend states disable inappropriate repeated actions. Invites and requests hide when empty. Recent rooms are device-local and may refer to rooms that have expired; Rejoin uses the existing join flow and displays its existing errors.

Persistent social lists refresh every 30 seconds while visible and on window focus/visibility return. A mutation immediately reloads the actor's list. This does not require enabling Supabase Realtime or adding tables to a publication.

Presence is different: Render aggregates authenticated sockets across devices and emits `online`, `in_room` or `offline` only to subscribers after a fresh database-authorized friend lookup. Disconnects and room transitions trigger updates. Payloads contain account ID and status, never a room code. If presence cannot be obtained, the UI says it is unavailable rather than pretending the friend is offline. Removing/blocking someone removes their authorized presence visibility.

The Invite friends dialog is available to the current room's authenticated Host/Moderators. Render takes the sender from the verified socket and the room code from the bound room; client sender/room/role fields are ignored. It checks the existing room permission before calling the database. Invite creation uses a backend-only service-role credential and a database function granted only to `service_role`, so clients cannot bypass room authorization by directly invoking that creation RPC. Other auth/profile/friend operations continue using the public key and the user's JWT/RLS.

The database independently checks the sender/profile, code format, friendship, blocks, expiry and duplicates. Only the invited receiver can respond. My Watchly's Join calls the existing RoomContext join flow and then marks the invitation accepted; a failed room join does not consume the invitation. An invite does not guarantee a temporary room is still alive. My Watchly disables Invite when there is no current room or sufficient room permission; no scheduling/public discovery system is added.

## Configure Supabase later

### 1. Apply the saved migration

Open the intended Supabase project's SQL editor and run the complete contents of `supabase/migrations/202610030001_watchly_accounts.sql` once. This creates all tables, policies, grants and functions in one operation; no manual table-by-table setup is needed. The migration is versioned rather than a repeatable seed, so do not rerun it after a successful apply.

Alternatively, from this repository with the Supabase CLI installed, initialize CLI configuration if it does not already exist, log in, link the project and push the saved migration:

```sh
supabase init
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Skip `init` when `supabase/config.toml` already exists. Use the intended project reference; the CLI will prompt for any required project access/database authentication. Do not put those credentials in source. [Supabase environment and migration workflow](https://supabase.com/docs/guides/deployment/managing-environments)

### 2. Set environment variables

Both deployments must refer to the same Supabase project:

| Location | Variable | Value |
| --- | --- | --- |
| Vercel / frontend `.env` | `VITE_SUPABASE_URL` | Supabase project URL. |
| Vercel / frontend `.env` | `VITE_SUPABASE_PUBLISHABLE_KEY` | Project's public publishable key. |
| Render / backend `.env` | `SUPABASE_URL` | The same project URL. |
| Render / backend `.env` | `SUPABASE_PUBLISHABLE_KEY` | The same public key, used for verified Auth and user-scoped REST calls. |
| Render / backend `.env` only | `SUPABASE_SERVICE_ROLE_KEY` | Legacy JWT `service_role` key, used only for server-authorized invite issuance. Never use this as a `VITE_*` value. |

The invite service-role credential is a privileged backend secret. Keep it only in Render's secret/environment settings or an untracked local backend environment. Google client secrets also belong in the Supabase provider dashboard, not browser variables. No actual values are committed.

Keep existing `VITE_BACKEND_URL`, `CORS_ORIGIN`, TURN variables and other deployment settings. Rebuild/redeploy Vercel after changing Vite variables; restart/redeploy Render after changing its environment. A missing Supabase client configuration leaves guest rooms usable and shows that accounts are not configured. Missing the invite-only server secret leaves other account features usable but prevents sending persistent room invitations.

For local development, copy each `.env.example` to its untracked `.env` and fill in your own values. Vite reads `frontend/.env` automatically. The existing backend start command does not load a file by itself: from `backend`, use `node --env-file=.env server.js` with Node 20+ or set those variables in the shell before `npm start`.

### 3. Set Auth URL configuration

In Supabase Authentication URL Configuration:

- Set Site URL to the production frontend origin, currently `https://wchly.vercel.app` if that remains the chosen deployment.
- Add `https://wchly.vercel.app/auth/callback` to allowed redirects.
- Add `http://localhost:5173/auth/callback` for local development.
- Add exact callback URLs for any future custom domain or intentional preview deployment.

Watchly builds its callback from `window.location.origin`; it does not hardcode localhost for production. Native/Capacitor deep-link handling is not implemented in this web release. [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)

### 4. Enable Google

Create or use a Google Cloud web OAuth client and configure its consent screen/audience. Use the production and local frontend origins as the authorized JavaScript origins where required. The Google client's authorized redirect URI must be the Supabase callback:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

Use the callback shown by the Supabase Google provider if the project has a custom Auth domain. Enable Google in Supabase and put the Google client ID and secret there. If Google's audience remains in testing, add the intended test users; complete any required consent/brand publication before wider access. Supabase then redirects to Watchly's allowed `/auth/callback` and the app restores its safe intended destination. [Official Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google)

### 5. Enable email codes and delivery

Keep the Email provider enabled and allow new-user signups if Get started should create accounts. Watchly sends `shouldCreateUser: true`; the project remains the final authority for signup policy.

Edit the Magic Link email template to include the code variable `{{ .Token }}`, because the default template may contain only a link. Also include it in a separate signup-confirmation template if that project sends one. The UI submits email and code through `verifyOtp({ type: 'email' })`. Configure an appropriate OTP expiry and sender/rate limits in the project. [Official passwordless email guide](https://supabase.com/docs/guides/auth/auth-email-passwordless)

An optional compatible magic link can point to the callback supplied by Watchly:

```html
<p>Your Watchly sign-in code: {{ .Token }}</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Sign in to Watchly</a></p>
```

This implementation passes `emailRedirectTo` as the allowed `/auth/callback`; the callback exchanges the token hash using the SDK. Entering the code inline remains the preferred method while watching a local file. [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates)

Configure custom SMTP for real-user delivery. Supabase's default email sender is restricted and is not a general production email service. Keep SMTP/provider credentials in the dashboard. [Supabase custom SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)

### 6. Finish production acceptance

The basic `/terms` and `/privacy` pages describe the implemented behavior. Before launching accounts, the operator should supply a real contact/account-removal channel and review those pages for the actual deployment's policies.

After configuration, test a real first-time and returning Google account, real first-time and returning email code, canceled OAuth, invalid/expired code, refresh, sign-out, two real friends, an active-room invite and authenticated reconnect. Those external provider/delivery checks cannot be completed without the operator's project and provider configuration.

## Verification

The implementation includes these repeatable checks:

```sh
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
node frontend/test/browserAccounts.cjs
```

| Coverage | Current evidence |
| --- | --- |
| Frontend utilities and existing unit tests | 86 passing tests, including account refresh/expiry/switch fencing and terminal ownership errors. |
| Backend and authenticated-room tests | 45 passing tests, including verification, stable Host/Moderator identity, forged identity rejection, guest upgrade, ownership, expiry, sign-out fencing, duplicate account/guest resume rejection and incomplete profile recovery. |
| SQL social security | Actual PGlite PostgreSQL role/RLS tests cover profile ownership and private columns, anonymous denial, duplicate/crossed requests, transactional acceptance, block/remove/unblock, invite ownership/expiry and deletion cascades. |
| Account browser integration | Passed using the official SDK, an isolated local Auth/OAuth fixture and real PostgreSQL/RLS: new/returning Google and email users, cancellation/invalid code, profile setup/conflicts/editing, persistence, friend search/request/accept/presence/remove/block/unblock, private search exclusion, room invites, token refresh/reconnect, inline Guest Host upgrade with the same local Blob, sign-out preserving local preferences/history, 320px/tablet/desktop navbar layouts, and invalid stored access/refresh credentials exposing sign-in instead of restoring forever. |
| Existing media/roles/recovery browser regressions | `browserSourceSelection.cjs`, `browserRoles.cjs`, `browserPlayback.cjs`, `browserPlaylist.cjs` and `browserRecovery.cjs` all passed in this implementation run. Coverage includes the actual ten-item YouTube playlist, direct/local playback and readiness, chat/queue, room permissions, voice/screensharing with synthetic capture, Classic/Cinema Luxe/mobile layouts, 5/60-second outages and unchanged local player/Blob recovery. |
| Live Supabase, Google and email delivery | Not tested: the user will configure the real project later. Local fixtures do not prove provider consent, actual SMTP delivery or the deployed environment. |

Rooms, chat, queue, YouTube, direct/local video, voice, screen sharing, readiness, appearance and the room permission matrix retain their existing architecture. Persistent cross-device history, public profiles/feed, messaging, uploads, payments and account deletion UI are outside this release.
