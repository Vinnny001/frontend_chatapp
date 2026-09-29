import { deleteDB, openDB } from 'idb';

// On-device store (IndexedDB) for offline use:
//  - messages: every confirmed message the app has seen, indexed by chat + time, so chats
//    can be opened and scrolled back through without a connection.
//  - media: downloaded photos, videos, voice notes, files and avatars, keyed by their URL.
// One database per signed-in user; it is deleted on sign-out.

const MEDIA_BUDGET_BYTES = 1024 * 1024 * 1024; // least recently viewed media is evicted beyond 1 GB
const dbName = (userId) => `chatapp-${userId}`;

let dbPromise = null;
let openFor = null;

export function openLocalDb(userId) {
  if (!userId || openFor === userId) return;
  openFor = userId;
  dbPromise = openDB(dbName(userId), 1, {
    upgrade(db) {
      const messages = db.createObjectStore('messages', { keyPath: 'id' });
      messages.createIndex('byConv', ['conversationId', 'createdAt']);
      const media = db.createObjectStore('media', { keyPath: 'url' });
      media.createIndex('byUsed', 'usedAt');
    },
  }).catch((err) => {
    console.warn('Offline storage unavailable', err);
    return null;
  });
  // Ask the browser/WebView not to clear our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export async function closeLocalDb(userId, { erase = false } = {}) {
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
  openFor = null;
  if (erase && userId) await deleteDB(dbName(userId)).catch(() => {});
}

const db = () => dbPromise ?? Promise.resolve(null);

// ------------------------------------------------------------------ messages

// Only confirmed messages are stored here; unsent ones live in the localStorage outbox cache.
const storable = (m) => m?.id && !m.pending;
const clean = ({ progress, error, status, remoteMedia, ...m }) => m;

export async function saveMessages(list) {
  const d = await db();
  const rows = list.filter(storable);
  if (!d || !rows.length) return;
  const tx = d.transaction('messages', 'readwrite');
  for (const m of rows) tx.store.put(clean(m));
  await tx.done.catch(() => {});
}

export async function patchStoredMessage(patch) {
  const d = await db();
  if (!d || !patch?.id) return;
  const tx = d.transaction('messages', 'readwrite');
  const cur = await tx.store.get(patch.id);
  if (cur) await tx.store.put({ ...cur, ...patch });
  await tx.done.catch(() => {});
}

export async function deleteStoredMessage(id) {
  const d = await db();
  if (d && id) await d.delete('messages', id).catch(() => {});
}

export async function deleteStoredConversation(conversationId) {
  const d = await db();
  if (!d) return;
  const tx = d.transaction('messages', 'readwrite');
  const range = IDBKeyRange.bound([conversationId, ''], [conversationId, '￿']);
  for (let c = await tx.store.index('byConv').openCursor(range); c; c = await c.continue()) c.delete();
  await tx.done.catch(() => {});
}

/** Newest `limit` messages of a chat (oldest first), optionally only those before `beforeIso`. */
export async function readMessages(conversationId, { before, limit = 40 } = {}) {
  const d = await db();
  if (!d) return [];
  const upper = before ? [conversationId, before] : [conversationId, '￿'];
  const range = IDBKeyRange.bound([conversationId, ''], upper, false, !!before);
  const out = [];
  let cursor = await d.transaction('messages').store.index('byConv').openCursor(range, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out.reverse();
}

// ------------------------------------------------------------------ media

export async function getStoredMedia(url) {
  const d = await db();
  if (!d || !url) return null;
  const rec = await d.get('media', url).catch(() => null);
  if (!rec) return null;
  // Remember it was viewed (for eviction order); no need to wait for this.
  d.put('media', { ...rec, usedAt: Date.now() }).catch(() => {});
  return rec.blob;
}

export async function hasStoredMedia(url) {
  const d = await db();
  return !!(d && url && (await d.getKey('media', url).catch(() => null)));
}

export async function deleteStoredMedia(url) {
  const d = await db();
  if (d && url) await d.delete('media', url).catch(() => {});
}

export async function putStoredMedia(url, blob) {
  const d = await db();
  if (!d || !url || !blob) return;
  await d.put('media', { url, blob, size: blob.size, usedAt: Date.now() }).catch(() => {});
  evictMedia();
}

/** Bytes used by downloaded media (files still waiting to be sent aren't counted). */
export async function mediaUsage() {
  const d = await db();
  if (!d) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (let c = await d.transaction('media').store.openCursor(); c; c = await c.continue()) {
    if (String(c.key).startsWith('pending:')) continue;
    bytes += c.value.size || 0;
    files += 1;
  }
  return { bytes, files };
}

/** Frees space: removes downloaded media, but never files that are still waiting to be sent. */
export async function clearDownloadedMedia() {
  const d = await db();
  if (!d) return;
  const tx = d.transaction('media', 'readwrite');
  for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
    if (!String(c.key).startsWith('pending:')) c.delete();
  }
  await tx.done.catch(() => {});
}

let evicting = false;
async function evictMedia() {
  if (evicting) return;
  evicting = true;
  try {
    const d = await db();
    if (!d) return;
    const tx = d.transaction('media', 'readwrite');
    const index = tx.store.index('byUsed');
    let total = 0;
    for (let c = await index.openCursor(); c; c = await c.continue()) total += c.value.size || 0;
    // Oldest-viewed first.
    for (let c = await index.openCursor(); c && total > MEDIA_BUDGET_BYTES; c = await c.continue()) {
      total -= c.value.size || 0;
      c.delete();
    }
    await tx.done;
  } catch {
    /* best effort */
  } finally {
    evicting = false;
  }
}
