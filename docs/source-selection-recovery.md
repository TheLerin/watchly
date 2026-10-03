# Local source selection and foreground recovery

The live site's backend was reachable when the reconnect error was investigated. A foreground room snapshot can begin when the native file picker or title dialog returns focus. Local-file selection previously rejected that transient `resyncing` phase as a disconnect and replaced/revoked the existing private Blob URL before checking connection readiness.

Local selection now waits up to ten seconds for the existing foreground snapshot and player restoration. It does not wait through a transport disconnect, membership rejoin, room change, leave, or failed restoration. Those transitions cancel the pending selection; reconnecting never replays it. The latest server-published permissions are checked before installing the private file and emitting `media:declare`.

A member without a matching local file previously remained in room `resyncing` indefinitely. Restoring the room snapshot now completes independently of selecting that device's copy. The same-file readiness gate still blocks playback until the member supplies the matching file; this change does not declare anyone ready. Role/control events received during snapshot recovery retain their newer capabilities when a delayed snapshot arrives.

Browsers that throw on native `prompt()` use `Local movie` as the public title. Device filenames remain private. Cancelling a selection before declaration keeps the current private file URL intact.

Validation:

- `frontend/test/roomRecovery.test.js`: waits for both snapshot and player completion; bounded timeout; cancellation on disconnect, leave, disposal, failed sync, membership rebind and identity change.
- `frontend/test/browserSourceSelection.cjs`: actual file picker/real Socket.IO snapshot with delayed ACK; single declaration after foreground sync; unsupported prompt fallback; disconnect cancellation with previous Blob preserved and no replay; missing-file member completes room sync without becoming ready; demotion during the wait emits no source declaration.
- All 78 frontend unit tests, ESLint and the production build pass.
- `frontend/test/browserRecovery.cjs` passes, using a one-second long-outage parameter plus the existing five-second outage tests, covering local/direct playback, foreground recovery, stable identity, voice, screen capture, chat/queue, leave and expired rooms.
- `frontend/test/browserRoles.cjs` passes for Host/Moderator/Viewer direct and local playback, immediate role changes, queue, real YouTube and playlists, tablet/mobile interactions and Cinema Luxe control visibility.

The role browser test now waits for the new tablet YouTube instance after a responsive remount before changing volume. Its volume/mute assertions tolerate API initialization and wait for the actual acknowledged values.
