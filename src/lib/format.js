const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function daysAgo(value) {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(value))) / DAY);
}

/** Label for the date separators inside a chat. */
export function formatDayLabel(value) {
  const days = daysAgo(value);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(value);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Compact timestamp for the chat list. */
export function formatListTime(value) {
  if (!value) return '';
  const days = daysAgo(value);
  if (days === 0) return formatTime(value);
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(value).toLocaleDateString([], { weekday: 'short' });
  return new Date(value).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatLastSeen(value) {
  if (!value) return '';
  const days = daysAgo(value);
  if (days === 0) return `last seen today at ${formatTime(value)}`;
  if (days === 1) return `last seen yesterday at ${formatTime(value)}`;
  return `last seen ${new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${formatTime(value)}`;
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds = 0) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; plain-http LAN testing falls back to this.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Splits text into plain strings and {url} parts so links can be rendered clickable. */
export function linkify(text) {
  const parts = [];
  const re = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/gi;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ url: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Message type for an attached file. */
export function fileKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}
