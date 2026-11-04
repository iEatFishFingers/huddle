# Glossary

Back to [[Home]]

## Session
A group of up to 4 phones listening together. It has one host. See [[Architecture]].

## Host
The phone that started the session. It runs the [[Host Server]] and [[HostCore]] and advertises over Bluetooth ([[Discovery]]). It's also a listener.

## Peer
Any member of a session, including the host's own UI. Also called a **joiner** when it isn't the host.

## Member
A peer that has joined [[HostCore]]. It has a name (from `hello`) and readiness.

## Library
Every track anyone added to the session, deduped by id. See [[Uploads]].

## Offline library
Songs downloaded to one phone from a Navidrome server, ready to add to any session with no internet. Not the same as the session's **Library** above. See [[Navidrome Library]].

## Navidrome / Subsonic
Navidrome is a self-hosted music server. It speaks the **Subsonic API**, which is what Huddle's client talks. See [[Navidrome Library]].

## Queue
Upcoming entries, in play order. **History** is what already played. See [[Queue]].

## Readiness
Whether a member has buffered the current track. See [[Readiness and Pending Play]].

## Pending play
"Play as soon as everyone is ready, or after 8 s." See [[Readiness and Pending Play]].

## Host clock / offset
The host's time is the reference for playback. **Offset** is host time minus local time, estimated by [[Clock Sync]].

## Drift
How far a phone's player is from where the shared timeline says it should be. See [[Playback and Drift Correction]].

## Start lead
How far ahead a phone starts playback to cancel out its own start latency. Each phone learns its own. See [[Playback and Drift Correction#Start lead]].

## Rate nudge
A small temporary speed change (±3%, pitch-corrected) to close drift without an audible seek.

## Transport
How a [[SyncClient]] reaches [[HostCore]]: **loopback** on the host, **WebSocket** on joiners. See [[Transports]].

## GATT server / characteristic
Bluetooth LE terms. The host exposes a "session info" value that joiners read. See [[Discovery]].

## Development build
A custom version of the app that includes Huddle's native modules. It replaces Expo Go. See [[Development Setup]].
