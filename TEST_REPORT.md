# Watchly V2.1 test report

| Check | Evidence |
|---|---|
| Worker suite | PASS 66/66. Covers Drive revocation and byte quota, guest approval after kick, media isolation and removal concurrency, idle receipt alarms after reconstruction, presence notification coalescing, subscription expiry and compatible restore. |
| Frontend suite | PASS 136/136. |
| Backend on the latest locks | PASS 31/31 focused tests after a clean offline installation. Coverage includes the session migration, Turnstile, Drive access and upstream response handling, rate limits and media isolation. |
| Full legacy backend | Earlier PASS 67/67 before the latest lock changes. The corrected resume test covers rotation and 30-second recovery expiry. The new full run stopped before recording a result. |
| Frontend lint / production build / asset validation / Worker bundle | PASS. |
| Wrangler source bindings and staging preflight | PASS with local fixture inputs. |
| Direct workerd | PASS on the current source. Ran native WebSockets, SQLite hibernation, challenge enforcement and WebCrypto handlers. The longer soak is a separate check. |
| Wrangler HTTP integration and staging/production dry-runs | PASS. HTTP coverage includes the OAuth callback's no-store/no-referrer headers. |
| Chromium Workbox update | PASS. Installed worker stays active across two tabs while the new one waits. Activation follows closure of both old tabs. |
| Chromium branding | PASS. The logo decodes, multiple blended colors shift across buttons, and reduced-motion mode keeps the blend still. The buffering ring appears on a playback stall and clears on recovery. Both install icon sizes match the manifest and are precached. |
| Presence simulation | PASS at up to 500 accounts with 150 friends per account. That case dropped from 7,907 to 3,926 SQLite statements and delivered 10 notifications in both runs. The simulation measures local SQLite operations. |
| Dependency audit | OPEN. Recorded online findings predate the cached dependency upgrades. |
| Internal workerd soak pilot | PASS 12 seconds, 12 snapshots and one reconnect with rotated proof. Maximum sampled snapshot drift was 2 ms and p95 paired snapshot latency was 3 ms. The harness now skips late acknowledgements after close. |
| Long network and real media soak | OPEN. Automatic approval review interrupted the longer run. Provider and device measurements need staging access. |

The existing Chromium UI harness and browser wire checks have earlier V2.1 evidence. Remote bindings, real widgets, Supabase/Google/LiveKit/Drive/TURN services, mobile capture and operational recovery are covered in the staging acceptance checklist.
