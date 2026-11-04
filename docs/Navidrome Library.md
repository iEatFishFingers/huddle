# Navidrome Library

Back to [[Home]] · see also [[Uploads]], [[UI and Navigation]], [[Decisions#Offline library from Navidrome]]

Huddle's mission is listening together **with no internet**, for example on a plane. Streaming services can't be shared (their downloads are locked inside their own apps), so Huddle brings its own music: songs downloaded from a self-hosted **Navidrome** server onto the phone beforehand.

## Two moments
1. **Before you go, with internet:** open **Music library** on the home screen, sign in to Navidrome, browse albums, playlists or search, and download. Songs are saved on the phone.
2. **Offline, in a session:** **Add songs** opens a sheet that lists the downloaded songs ("works offline"). Pick some and they go through the normal `addFiles()` path ([[Uploads]]), exactly like files picked from the phone. Navidrome isn't involved at this point.

## Code
| File | What it does |
| --- | --- |
| `src/library/subsonic.ts` | Subsonic API client (Navidrome speaks Subsonic). Pure TypeScript, unit-tested. |
| `src/library/store.ts` | The offline library: sign-in, download queue, the index of downloaded songs, covers. `useLibrary(selector)` for React. |
| `src/components/library/LibraryScreen.tsx` | Route `/library`: On this phone, Albums, Playlists, Search, and the connect form. |
| `src/components/library/CollectionScreen.tsx` | Route `/collection/[kind]/[id]`: one album or playlist, with **Download all**. |
| `src/components/library/LibraryPicker.tsx` | The **Add songs** sheet in a session: multi-select from the library, or **From files**. |

## Talking to Navidrome
- **Auth:** token auth. On sign-in Huddle makes a random salt and sends `t = md5(password + salt)` with `s = salt` (MD5 via `expo-crypto`). Only the token and salt are saved, never the password. Every call also sends `u`, `v=1.16.1`, `c=huddle`, `f=json`.
- **Calls:** `ping` (sign-in check), `getAlbumList2`, `getAlbum`, `getPlaylists`, `getPlaylist`, `search3`, `stream`, `getCoverArt`.
- **Addresses:** whatever the user types is normalised. `music.example.com` → `https://…`; a LAN IP, `localhost` or `*.local` → `http://…`. A pasted web-app link (`/app/#/album/…`) or `/rest` path is stripped.
- **Errors** are turned into plain sentences: wrong password (code 40), no token auth (41), not a Subsonic server, can't reach it, timed out after 15 s.

## Downloads
- Songs come from `stream?format=mp3&maxBitRate=256`. Navidrome converts anything else to MP3 (it needs ffmpeg on the server), so every song plays on iOS and Android, and stays small to share. If the original is already a small enough MP3, Navidrome sends it untouched.
- Converted streams have no `Content-Length`, so progress is estimated from duration × bitrate.
- Two downloads at a time. Each can be cancelled; failures show **Retry**.
- A "successful" download under 4 KB that looks like JSON or XML is treated as a server error, not a song.
- Album art is downloaded once per album (300 px) for offline display.

## Storage
In the app's documents folder, which the OS doesn't clear (unlike the cache):
```
huddle-library/server.json   address, username, token + salt
huddle-library/index.json    downloaded songs (id, title, artist, album, duration, size, file)
huddle-library/songs/<id>.mp3
huddle-library/covers/<coverArt>.jpg
```
File paths are stored relative to that folder, because iOS changes the app's container path on reinstalls and updates. Signing out keeps the downloaded songs.

## In a session
- A library song becomes a `PickedFile` named `Artist - Title.mp3`, so the queue shows "Artist - Title".
- Track ids are still `name-size` ([[Uploads#Rules]]). If two phones downloaded the same song, the host recognises the second upload as a duplicate and drops it, but the upload still happens. See [[Open Items]].

## Tests
`src/library/subsonic.test.ts` (34 checks), run by `npm test`: address normalising, query encoding, error unwrapping, file names, and every client call against a fake `fetch`.
