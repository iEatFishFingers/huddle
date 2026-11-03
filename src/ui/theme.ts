export const colors = {
  bg: '#121212',
  surface: '#1b1b1b',
  surfaceHigh: '#262626',
  surfacePressed: '#303030',
  border: '#2e2e2e',
  text: '#ffffff',
  textDim: '#b3b3b3',
  textMuted: '#7c7c7c',
  accent: '#1db954',
  accentPressed: '#18a34a',
  onAccent: '#0b0b0b',
  danger: '#f26d78',
  info: '#2a2f3a',
  infoText: '#c9d3e6',
  warnBg: '#3a3222',
  warnText: '#f3d9a4',
  track: '#3a3a3a',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  title: { fontSize: 28, fontWeight: '800' as const, color: colors.text, letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textDim },
  caption: { fontSize: 12, color: colors.textMuted },
  label: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
};

/** Minimum touch target (pt). */
export const HIT = 44;

/** Keeps content readable on tablets / web. */
export const MAX_CONTENT_WIDTH = 640;

/** "1:05" from milliseconds. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = ['#e8115b', '#1e3264', '#8d67ab', '#e1118c', '#148a08', '#bc5900', '#509bf5', '#27856a'];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
