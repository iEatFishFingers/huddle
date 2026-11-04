# Huddle docs

Huddle lets up to four phones in the same room listen to the same music in sync. One phone hosts a session, others find it nearby and join, and everyone shares one queue and the controls.

These notes are linked with `[[wikilinks]]`. Open the `docs/` folder as an [Obsidian](https://obsidian.md) vault to browse them and see the graph. They also read fine on GitHub, where wikilinks show as plain text.

## Start here
- [[Architecture]]: the big picture, and how the pieces talk to each other
- [[Development Setup]]: get it running on two phones
- [[Glossary]]: terms used throughout

## How it works
- [[Discovery]]: finding nearby sessions over Bluetooth LE
- [[Session Protocol]]: the messages sent between the host and peers
- [[HostCore]]: the host's single source of truth
  - [[Queue]]: up next, history, skipping, auto-advance
  - [[Readiness and Pending Play]]: why play waits for everyone
- [[SyncClient]]: each phone's copy of the session state
  - [[Clock Sync]]: agreeing on what time it is
  - [[Playback and Drift Correction]]: keeping every speaker on the same beat
- [[Host Server]]: the HTTP and WebSocket server running inside the host app
- [[Transports]]: loopback (host) vs WebSocket (joiner)
- [[Uploads]]: how anyone can add a song
- [[Navidrome Library]]: downloading songs from Navidrome to share offline
- [[UI and Navigation]]: screens, components, and the session store

## Working on it
- [[Project History]]: everything built so far, in order, with the problems we hit
- [[Open Items]]: what's left to test, fix and decide
- [[Testing]]
- [[Troubleshooting]]
- [[Decisions]]: why things are the way they are
