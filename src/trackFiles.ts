import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { Track } from './protocol';

/** Local playable URI for a track. Native: full download first. Web (dev): stream. */
export async function resolveLocalUri(track: Track): Promise<string> {
  if (Platform.OS === 'web' || !/^https?:/.test(track.url)) return track.url;
  const cacheDir = new Directory(Paths.cache, 'huddle-tracks');
  cacheDir.create({ intermediates: true, idempotent: true });
  const safe = track.id.replace(/[^\w.-]/g, '_');
  const file = new File(cacheDir, `${hash(track.url)}-${safe}`);
  if (file.exists) return file.uri;
  const done = await File.downloadFileAsync(track.url, file, { idempotent: true });
  return done.uri;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
