// Pure-logic checks for the Navidrome (Subsonic) client. Run with `npm test`.
import { buildQuery, normalizeServerUrl, songFileName, SubsonicClient, SubsonicError, unwrapResponse } from './subsonic';

let failures = 0;
let passes = 0;
function check(cond: unknown, label: string) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
}
function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${label} (expected ${e}, got ${a})`);
}
async function rejects(p: Promise<unknown>, match: RegExp, label: string) {
  try {
    await p;
    check(false, `${label} (expected an error)`);
  } catch (e) {
    check(e instanceof SubsonicError && match.test(e.message), `${label} (got ${e instanceof Error ? e.message : String(e)})`);
  }
}

const ok = (body: Record<string, unknown>) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });

type Call = { url: string };
function fakeFetch(responses: Record<string, unknown>, calls: Call[] = [], status = 200) {
  return async (url: string) => {
    calls.push({ url });
    const endpoint = /\/rest\/([a-zA-Z0-9]+)\?/.exec(url)?.[1] ?? '';
    return { ok: status >= 200 && status < 300, status, json: async () => responses[endpoint] ?? ok({}) };
  };
}

async function main() {
  console.log('normalizeServerUrl');
  eq(normalizeServerUrl('music.example.com'), 'https://music.example.com', 'bare domain gets https');
  eq(normalizeServerUrl('  192.168.1.5:4533 '), 'http://192.168.1.5:4533', 'LAN IP gets http');
  eq(normalizeServerUrl('nas.local:4533'), 'http://nas.local:4533', '.local gets http');
  eq(normalizeServerUrl('http://host:4533/app/#/album/123'), 'http://host:4533', 'strips the web app path');
  eq(normalizeServerUrl('https://example.com/navidrome/'), 'https://example.com/navidrome', 'keeps a sub-path, drops trailing slash');
  eq(normalizeServerUrl('https://example.com/rest/ping.view'), 'https://example.com', 'strips /rest');
  eq(normalizeServerUrl('HTTPS://Example.com'), 'https://Example.com', 'lower-cases the scheme');
  eq(normalizeServerUrl(''), null, 'empty');
  eq(normalizeServerUrl('not a server'), null, 'spaces');

  console.log('buildQuery / unwrapResponse / songFileName');
  eq(buildQuery({ a: 1, b: 'x y&z', c: undefined, d: true }), 'a=1&b=x%20y%26z&d=true', 'encodes and skips undefined');
  eq(unwrapResponse(ok({ ping: 1 })).ping, 1, 'ok response');
  try {
    unwrapResponse({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } });
    check(false, 'failed response throws');
  } catch (e) {
    check(e instanceof SubsonicError && e.code === 40 && /Wrong username/.test(e.message), 'code 40 → readable message');
  }
  try {
    unwrapResponse({ hello: 'world' });
    check(false, 'non-Subsonic JSON throws');
  } catch (e) {
    check(e instanceof SubsonicError && /isn't a Navidrome/.test(e.message), 'non-Subsonic JSON → readable message');
  }
  eq(songFileName({ title: 'Song/Name?', artist: 'AC:DC' }), 'AC DC - Song Name.mp3', 'unsafe characters removed');
  eq(songFileName({ title: 'Solo' }), 'Solo.mp3', 'no artist');
  eq(songFileName({ title: '' }), 'Untitled.mp3', 'no title');

  console.log('SubsonicClient');
  const config = { url: 'https://music.example.com', username: 'yo han', token: 'abc', salt: 'def' };
  const calls: Call[] = [];
  const client = new SubsonicClient(
    config,
    fakeFetch(
      {
        getAlbumList2: ok({ albumList2: { album: { id: 'a1', name: 'Only One' } } }),
        getAlbum: ok({ album: { id: 'a1', name: 'Album', artist: 'Band', song: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }] } }),
        getPlaylists: ok({ playlists: {} }),
        getPlaylist: ok({ playlist: { id: 'p1', name: 'Plane', entry: { id: 's9', title: 'Nine' } } }),
        search3: ok({ searchResult3: { album: [{ id: 'a2', name: 'Found' }], song: [{ id: 's3', title: 'Hit' }] } }),
      },
      calls,
    ),
  );
  await client.ping();
  const u = calls[0].url;
  check(u.startsWith('https://music.example.com/rest/ping?'), 'ping URL');
  for (const part of ['u=yo%20han', 't=abc', 's=def', 'v=1.16.1', 'c=huddle', 'f=json']) check(u.includes(part), `ping URL has ${part}`);
  eq((await client.albums('newest', 10)).map((a) => a.id), ['a1'], 'single album object becomes an array');
  check(calls[1].url.includes('type=newest') && calls[1].url.includes('size=10'), 'album list params');
  const album = await client.album('a1');
  eq([album.album.name, album.songs.length], ['Album', 2], 'album with songs');
  check(!('song' in album.album), 'songs split out of the album');
  eq(await client.playlists(), [], 'no playlists');
  eq((await client.playlist('p1')).songs.map((s) => s.id), ['s9'], 'playlist entries');
  const found = await client.search('hit');
  eq([found.albums.length, found.songs.length], [1, 1], 'search results');
  const stream = client.streamUrl('s1');
  check(stream.includes('/rest/stream?') && stream.includes('id=s1') && stream.includes('format=mp3') && stream.includes('maxBitRate=256'), 'stream URL asks for MP3');

  await rejects(new SubsonicClient(config, fakeFetch({}, [], 404)).ping(), /no music server/, 'HTTP 404');
  await rejects(
    new SubsonicClient(config, async () => {
      throw new Error('Network request failed');
    }).ping(),
    /Couldn't reach the server/,
    'network failure',
  );
  await rejects(
    new SubsonicClient(config, fakeFetch({ ping: { 'subsonic-response': { status: 'failed', error: { code: 40 } } } })).ping(),
    /Wrong username or password/,
    'bad password',
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) throw new Error(`${failures} check(s) failed`);
}

// an unhandled rejection makes node exit non-zero, which fails `npm test`
void main();
