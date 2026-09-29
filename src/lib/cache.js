import { storage } from './storage.js';
import { pendingKey } from './media.js';

// Offline copy of the chat list, recent messages, unsent messages and drafts, so the app
// opens with your chats (and keeps queued messages) without a network connection.

const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 60;
const key = (userId) => `chat.cache.v1.${userId}`;

export function loadCache(userId) {
  return userId ? storage.get(key(userId)) : null;
}

export function saveCache(userId, { conversations, threads, composer }) {
  if (!userId) return;
  const convs = Object.values(conversations)
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
    .slice(0, MAX_CONVERSATIONS);

  const savedThreads = {};
  for (const c of convs) {
    const items = (threads[c.id]?.items || [])
      .slice(-MAX_MESSAGES)
      .map(({ progress, error, ...m }) => {
        if (!m.pending) return m;
        // Not uploaded yet: the file itself is kept in on-device storage under pendingKey,
        // because the in-memory blob: URL is gone after the app restarts.
        const media = m.needsUpload && m.media ? { ...m.media, url: pendingKey(m.clientId) } : m.media;
        return { ...m, media, status: m.status === 'failed' ? 'failed' : 'pending' };
      });
    if (items.length) savedThreads[c.id] = items;
  }

  const drafts = Object.fromEntries(
    Object.entries(composer)
      .filter(([, v]) => v?.draft)
      .map(([id, v]) => [id, { draft: v.draft }])
  );

  storage.set(key(userId), { savedAt: Date.now(), conversations: convs, threads: savedThreads, drafts });
}

export function clearCache(userId) {
  if (userId) storage.set(key(userId), null);
}
