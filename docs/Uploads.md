# Uploads

Back to [[Home]] · see also [[Host Server]], [[Transports]], [[Queue]]

Anyone in a session can add songs. The host serves every track, so a joiner's song is first **uploaded to the host**, which then streams it to everyone like any other track.

## Flow
1. *Add songs* opens the document picker (`audio/*`, multiple). See [[UI and Navigation]].
2. `useSession.addFiles(files)` calls `transport.addFiles(files, name, onProgress)`.
   - **Host:** builds tracks from the local files and adds them to [[HostCore]] directly.
   - **Joiner:** for each file, `File.upload()` from `expo-file-system` with `BINARY_CONTENT` (a raw body) to:
     ```
     POST /upload?name=<file name>&addedBy=<your name>
     Content-Type: <audio mime>
     Content-Length: <bytes>
     X-Huddle-Duration-Ms: <ms or 0>
     ```
     It checks the 50 MB limit before sending. `onProgress` reports 0..1 across all files, which drives the progress bar.
3. The [[Host Server]] streams the body **straight to a file** in the cache directory (`huddle-uploads/`). It applies back-pressure (pauses the socket at 8 pending writes, resumes at 2) and never holds the whole song in memory.
4. On completion: the host makes a track and calls `addTracks(..., { enqueue: true })`, then replies `200 {"trackId": …}`. The song lands at the end of the [[Queue]], and everyone sees "Sam added Song".

## Rules
- **Track id = `name-size`**, so uploading the same file again doesn't duplicate it. The extra copy is deleted, and the existing track is queued again instead.
- **Rejections:** `411` (no Content-Length, or chunked), `413` (over 50 MB), `400` (missing name or empty file).
- An interrupted upload deletes its partial file and reports a `[host]` error.
- Uploaded songs only live as long as the session. They're deleted when the host ends it, and any left over from a crash are deleted the next time someone hosts.
