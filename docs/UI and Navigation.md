# UI and Navigation

Back to [[Home]] · see also [[Queue]], [[Discovery]]

Navigation uses **Expo Router**. Route files in `src/app/` stay thin; screens and components live outside it, as the project's `AGENTS.md` asks.

## Routes
| Route | File | Screen |
| --- | --- | --- |
| `/` | `src/app/index.tsx` → `components/HomeScreen.tsx` | Find or host a session |
| `/session` | `src/app/session.tsx` → `components/SessionScreen.tsx` | The live session |
| layout | `src/app/_layout.tsx` | Stack, safe areas, dark theme |

## Home: "Find a session"
- Your display name.
- **Nearby sessions** from `useNearbySessions()` ([[Discovery]]): cards sorted by signal strength, with full sessions disabled. Pull to refresh rescans.
- **Host a session:** name it, which creates a loopback [[Transports|transport]].
- **Join with address instead:** the fallback when Bluetooth isn't available.
- Going to the session uses `router.replace`, so Home unmounts and the Bluetooth scan stops.

## Session
- **Header:** session name, member avatars (host and "you" marked), and **Leave**, which asks for confirmation. Back gestures are blocked; Android's back button opens the same confirmation.
- **Host only:** shows the join address and advertises over Bluetooth ([[Discovery]]), updating the member count as it changes.
- **Now playing:** title, who added it, a **seek bar** (pure JS `PanResponder`: drag to preview, one seek on release), and previous / play-pause / next.
- **Status line:** "Buffering…" or "Waiting for everyone (1/2 ready)". See [[Readiness and Pending Play]].
- **Up next:** the [[Queue]]. Tap to play now, use the arrows to reorder, × to remove. There's also a collapsible **Played** list with re-queue.
- **Add songs:** for everyone, with a progress bar. See [[Uploads]].
- **Toasts** for `notice` messages ([[SyncClient]]).

## Session store
`src/session/store.ts` holds things that can't travel through route params: the display name and the **active session** (`{ role: 'host' | 'joiner', transport, sessionName }`). Screens read it with `useSyncExternalStore`. Leaving unmounts the session screen; `useSession`'s cleanup disconnects, and the store is cleared.

## Components
`src/components/`: SeekBar, QueueRow, HistoryRow, SessionCard, NowPlaying, Toast, Banner, Button, Avatar, ProgressBar, ScanningDot, TextField. Theme, colours and `formatTime` are in `src/ui/theme.ts`. Icons are drawn with plain Views, so there's no icon library dependency (`src/ui/Icon.tsx`).
