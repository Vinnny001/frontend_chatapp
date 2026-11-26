import { useEffect, useState } from 'react';
import { mediaUrl } from './config.js';
import { getStoredMedia, hasStoredMedia, onMediaStored, putStoredMedia } from './localdb.js';
import { decryptToBlob, mediaKeyFor } from './e2ee/files.js';

// Photos, videos, voice notes, files and avatars are downloaded once and kept on the device
// (see localdb.js), so they can be viewed later without a connection.

/** Storage key for a file the user sent that hasn't been uploaded yet. */
export const pendingKey = (clientId) => `pending:${clientId}`;

const inMemory = (url) => url.startsWith('blob:') || url.startsWith('data:');
const downloadable = (url) => !!url && !inMemory(url) && !url.startsWith('pending:');

const inflight = new Map(); // url -> Promise<Blob | null>

// How far each download has got: url -> { loaded, total } (total 0 when the server doesn't say).
const progress = new Map();
const progressListeners = new Set();
let notifyQueued = false;
function setProgress(url, value) {
  if (value) progress.set(url, value);
  else progress.delete(url);
  if (notifyQueued) return;
  notifyQueued = true; // at most once a frame, however fast the chunks come
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16))(() => {
    notifyQueued = false;
    progressListeners.forEach((fn) => fn());
  });
}

/** Reads a response, reporting how much has arrived. */
async function readWithProgress(url, res) {
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  setProgress(url, { loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    setProgress(url, { loaded, total });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/**
 * React hook: how far the download of `url` has got, as a fraction 0..1 (null when it isn't
 * downloading). `size` is used when the server doesn't give the length.
 */
export function useDownloadProgress(url, size) {
  const read = () => {
    const p = url && progress.get(url);
    if (!p) return null;
    const total = p.total || size || 0;
    return total ? Math.min(0.99, p.loaded / total) : 0;
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    update();
    progressListeners.add(update);
    return () => progressListeners.delete(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, size]);
  return value;
}

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
      const data = await readWithProgress(url, res);
      // End-to-end encrypted attachment: decrypt it here (the stored copy is the decrypted one).
      const key = mediaKeyFor(url);
      const blob = key ? await decryptToBlob(data, key) : new Blob([data], { type: res.headers.get('Content-Type') || '' });
      await putStoredMedia(url, blob);
      return blob;
    } catch {
      return null; // offline or blocked; try again next time
    } finally {
      inflight.delete(url);
      setProgress(url, null);
    }
  })();
  inflight.set(url, job);
  return job;
}

/** React hook: whether a file is saved on this device (so it opens offline). */
export function useIsStored(url) {
  const [stored, setStored] = useState(() => !!url && inMemory(url));
  useEffect(() => {
    if (!url || inMemory(url)) return undefined;
    let cancelled = false;
    hasStoredMedia(url).then((yes) => !cancelled && setStored(yes));
    const off = onMediaStored((u) => u === url && setStored(true));
    return () => {
      cancelled = true;
      off();
    };
  }, [url]);
  return stored;
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

/** Auto-download category of a message type: image | audio | video | file. */
export const mediaKind = (type) => (type === 'voice' || type === 'audio' ? 'audio' : type === 'image' || type === 'video' ? type : 'file');

/** Downloadable media in a list of messages (attachments + reply thumbnails) as { url, kind }. */
export const mediaItemsOf = (messages) =>
  messages
    .flatMap((m) => [
      m.media && !m.deletedForEveryone ? { url: m.media.url, kind: mediaKind(m.type) } : null,
      m.replyTo?.mediaUrl ? { url: m.replyTo.mediaUrl, kind: 'image' } : null,
    ])
    .filter((item) => item && downloadable(item.url));

/**
 * React hook: the best src for a media URL.
 *  - Stored on the device → that copy (works offline).
 *  - Not stored, auto-download allowed → stream from the network and keep a copy.
 *  - Not stored, auto-download not allowed → nothing yet; `needsDownload` is true and
 *    `download()` fetches it when the user taps (like WhatsApp's download button).
 * Returns { src, missing, needsDownload, downloading, download }; missing = not on the
 * device and we're offline.
 */
export function useMediaSrc(url, { auto = true } = {}) {
  const [state, setState] = useState(() => ({ src: url && inMemory(url) ? url : null, missing: false, needsDownload: false }));
  const [downloading, setDownloading] = useState(false);
  const [version, setVersion] = useState(0); // bumped after a manual download

  useEffect(() => {
    if (!url || inMemory(url)) {
      setState({ src: url || null, missing: false, needsDownload: false });
      return undefined;
    }
    let objectUrl = null;
    let cancelled = false;
    getStoredMedia(url).then((blob) => {
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, missing: false, needsDownload: false });
      } else if (!downloadable(url) || navigator.onLine === false) {
        setState({ src: null, missing: true, needsDownload: false });
      } else if (!auto) {
        setState({ src: null, missing: false, needsDownload: true });
      } else if (mediaKeyFor(url)) {
        // Encrypted: it has to be downloaded and decrypted before it can be shown.
        setState({ src: null, missing: false, needsDownload: false });
        ensureMedia(url).then((b) => {
          if (cancelled || !b) return;
          objectUrl = URL.createObjectURL(b);
          setState({ src: objectUrl, missing: false, needsDownload: false });
        });
      } else {
        setState({ src: mediaUrl(url), missing: false, needsDownload: false });
        ensureMedia(url); // keep a copy for offline use
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, auto, version]);

  async function download() {
    setDownloading(true);
    const blob = await ensureMedia(url);
    setDownloading(false);
    if (blob) setVersion((v) => v + 1);
    return !!blob;
  }

  return { ...state, downloading, download };
}
