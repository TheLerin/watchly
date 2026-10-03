# Room drawer sizing and dismissal

1. **Root cause.** The Cinematic drawer used the right rail's width minus the icon dock and gap, leaving about 226–256px on laptop screens. The Members heading, account avatar and Invite button competed for that space. Some name, queue and readiness flex children also lacked `min-width: 0`. The account menu was aligned to the avatar rather than the whole header.

2. **Files changed.** Production changes:
   - `frontend/src/components/RoomLayout.jsx` — one active panel, refs, triggers, mobile/desktop dismissal boundaries and keyboard tab entry.
   - `frontend/src/hooks/useRoomPanelDismiss.js` — document pointer and Escape handling with cleanup and portal ownership.
   - `frontend/src/components/room-panels.css` — bounded drawers, internal sizing, header wrapping and popover alignment.
   - `frontend/src/components/AppearancePanel.jsx` — settings boundary and portal capture handlers.
   - `frontend/src/components/VideoPlayer.jsx` — existing movie drawer controls receive the shared panel state and refs; playback code is unchanged.
   - `frontend/src/components/UserQueueSidebar.jsx` — shrinking/truncating text, stable action buttons and sizing classes.
   - `frontend/src/components/player/ReadinessPanel.jsx` — shrinking names/statuses and stable counts.

   Browser checks:
   - `frontend/test/browserRoomPanels.cjs` — new drawer geometry and interaction matrix.
   - `frontend/test/browserRoles.cjs` — explicitly reopen dismissed controls and keep the short video fixture away from its end during queue checks.
   - `frontend/test/browserPlayback.cjs` — select the relevant drawer before using its controls.
   - `frontend/test/cinemaLuxeChecks.cjs` — explicitly close/open Watch for the intended checks.
   - `frontend/test/appearanceChecks.cjs` — check settings visibility during its exit animation.
   - `frontend/test/classicDesktopChecks.cjs` — select tabs without toggling them off and wait for the selected color transition.

   This report: `docs/room-panel-fixes.md`.

3. **Width and position.** Cinematic right drawers now use `min(360px, available viewport width)` and stay immediately inward of the existing icon dock. Their maximum width includes viewport margins and the right safe area. Classic retains its existing 360–420px rail. Mobile retains its existing full-width cards, padding and safe-area layout. Internal sections use `width: 100%`, `min-width: 0` and border-box sizing. Existing vertical scroll containers remain in use.

4. **Flex fixes.** Member names, usernames, queue titles and readiness names can shrink and truncate. Avatars, action buttons and count badges retain their space. The Members header wraps when necessary. Readiness reasons wrap even without spaces. The account popover aligns within the padded header; member menus have a parent-relative maximum width. These constraints fix the sizing itself without adding blanket overflow clipping.

5. **Outside clicks.** One `activePanel` covers the existing movie tools, Members, Voice, Share, Chat and Settings. A document `pointerdown` listener closes an open panel when the event belongs to neither its boundary nor a tool button. React capture handlers identify panel-owned portal dialogs. There is no dismiss overlay or global propagation cancellation. Another trigger switches panels, the same trigger toggles, and departing Settings becomes hidden immediately so it cannot overlap the next drawer.

6. **Escape.** Escape closes the current drawer and returns focus to its trigger. Nested dialogs handle Escape first, so closing Invite preserves the drawer beneath it. Listeners and queued Escape work are removed on closure/unmount. With no drawer open, the hook does not intercept player Escape. A closed Classic tab strip retains a keyboard entry point; arrow/Home/End keys select tabs.

7. **Mobile.** Outside taps use the same pointer listener. Room/Call/Chat close back to the existing Watch view. Inside inputs, menus and Invite dialogs stay usable. Existing portrait and landscape layouts are preserved.

8. **Verification.** ESLint, the production build and all 100 frontend unit tests pass. `browserAccounts.cjs`, `browserRoles.cjs` and the full `browserPlayback.cjs` suite pass, including account dialogs, role changes, queue actions, local playback, YouTube, playlists, fullscreen, synchronization and reconnects. The new drawer browser check passes for both Classic and Cinematic at 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844, 320×740 and 844×390. It also passes at emulated 125% and 150% zoom-equivalent logical viewports/DPR in both styles. It checks all visible child bounds, horizontal scrolling, Invite visibility, long names/queue titles, readiness, reachable popover actions, inside clicks, portal Escape, toggling/switching, mouse/touch dismissal, player click delivery, draft persistence, Settings exit, member promotion and queue removal. Screenshots are generated in the ignored `frontend/test/artifacts/` directory. The LiveKit button interaction uses a local backend without Cloud credentials; this task does not repeat the earlier Cloud audio test.
