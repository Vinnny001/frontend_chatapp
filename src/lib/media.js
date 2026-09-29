import { useEffect, useState } from 'react';
import { mediaUrl } from './config.js';
import { getStoredMedia, putStoredMedia } from './localdb.js';

// Photos, videos, voice notes, files and avatars are downloaded once and kept on the device
// (see localdb.js), so they can be viewed later without a connection.

/** Storage key for a file the user sent that hasn't been uploaded yet. */
export const pendingKey = (clientId) => `pending:${clientId}`;

const inMemory = (url) => url.startsWith('blob:') || url.startsWith('data:');
const downloadable = (url) => !!url && !inMemory(url) && !url.startsWith('pending:');

const inflight = new Map(); // url -> Promise<Blob | null>

/** Returns the stored copy, downloading and storing it first if needed (null if unavailable). */
export async function ensureMedia(url) {
  if (!url || inMemory(url)) return null;
  const stored = await getStoredMedia(url);
  if (stored || !downloadable(url)) return stored;
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    try {
      const res = await fetch(mediaUrl(url), { mode: 'cors' });
      if (!res.ok) return null;
      const blob = await res.blob();
      await putStoredMedia(url, blob);
      return blob;
    } catch {
      return null; // offline or blocked; try again next time
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}

/** Store a file we already have (e.g. one this user just uploaded) under its final URL. */
export const rememberMedia = (url, blob) => (downloadable(url) && blob ? putStoredMedia(url, blob) : undefined);

// Background auto-download, a few at a time so it never hogs the connection.
const queue = [];
let running = 0;
const MAX_PARALLEL = 3;

export function prefetchMedia(urls) {
  for (const url of urls) if (downloadable(url) && !queue.includes(url)) queue.push(url);
  pump();
}

function pump() {
  while (running < MAX_PARALLEL && queue.length && navigator.onLine !== false) {
    const url = queue.shift();
    running++;
    ensureMedia(url).finally(() => {
      running--;
      pump();
    });
  }
}
if (typeof window !== 'undefined') window.addEventListener('online', pump);

/** Media URLs worth keeping for a list of messages (attachments + reply thumbnails). */
export const mediaUrlsOf = (messages) =>
  messages.flatMap((m) => [m.deletedForEveryone ? null : m.media?.url, m.replyTo?.mediaUrl]).filter(downloadable);

/**
 * React hook: the best src for a media URL. Uses the stored copy when there is one (works
 * offline); otherwise streams from the network while saving a copy for next time.
 * Returns { src, missing } where missing = not on the device and we're offline.
 */
export function useMediaSrc(url) {
  const [state, setState] = useState(() => ({ src: url && inMemory(url) ? url : null, missing: false }));

  useEffect(() => {
    if (!url || inMemory(url)) {
      setState({ src: url || null, missing: false });
      return undefined;
    }
    let objectUrl = null;
    let cancelled = false;
    getStoredMedia(url).then((blob) => {
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, missing: false });
      } else if (downloadable(url) && navigator.onLine !== false) {
        setState({ src: mediaUrl(url), missing: false });
        ensureMedia(url); // keep a copy for offline use
      } else {
        setState({ src: null, missing: true });
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return state;
}
