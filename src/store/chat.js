import { create } from 'zustand';
import { api, uploadFile } from '../lib/api.js';
import { emitAck, emitVolatile, getSocket } from '../lib/socket.js';
import { cancelBackground, queueInBackground, sendPayload, takeDeliveredInBackground } from '../lib/outbox.js';
import { uid } from '../lib/format.js';
import {
  deleteStoredConversation,
  deleteStoredMedia,
  deleteStoredMessage,
  getStoredMedia,
  patchStoredMessage,
  putStoredMedia,
  readMessages,
  saveMessages,
} from '../lib/localdb.js';
import { ensureMedia, mediaItemsOf, pendingKey, prefetchMedia, rememberMedia } from '../lib/media.js';
import { connectionKind } from '../lib/network.js';
import { playIncoming, playSent, showNotification } from '../lib/notify.js';
import { clearChatNotifications, setNativeNames } from '../lib/native.js';
import { useContactMatches } from '../lib/contacts.js';
import { displayName, knownPhone, savedNames, usePeople } from './people.js';
import { useAuth } from './auth.js';
import { toast, useUI } from './ui.js';

const meId = () => useAuth.getState().user?.id;
const ts = (v) => (v ? Date.parse(v) : 0);
const maxIso = (a, b) => (ts(a) >= ts(b) ? a : b);
const emptyThread = () => ({ items: [], hasMore: true, loaded: false, loading: false });
const keyOf = (m) => m.clientId || m.id;

// Files for optimistic media messages, kept outside state so a failed upload can be retried.
const pendingFiles = new Map();
const typingTimers = new Map();
// clientIds currently being sent, so a retry never runs twice in parallel.
const inFlight = new Set();

const isOnline = () => !!getSocket()?.connected;
const authToken = () => useAuth.getState().token;
// Errors that mean "no connection" (keep queued) rather than "server refused" (show failed).
const isNetworkError = (e) => e?.status === 0 || /respond|connect|network|fetch/i.test(e?.message || '');

const PAGE = 40;

/** The not-yet-uploaded file of a queued message: in memory, or saved on the device. */
const fileFor = (clientId) => async () => pendingFiles.get(clientId) || getStoredMedia(pendingKey(clientId));

/**
 * Keep messages on the device and download their media for offline viewing, following the
 * user's auto-download rules for the current connection (mobile data / Wi-Fi).
 */
function keepOffline(messages) {
  saveMessages(messages);
  const allowed = new Set(useUI.getState().autoDownloadRules[connectionKind()] || []);
  prefetchMedia(mediaItemsOf(messages).filter((item) => allowed.has(item.kind)).map((item) => item.url));
}

/** Merges message lists by clientId/id. Confirmed messages replace their pending copies. */
function mergeItems(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const m of list) {
      const key = keyOf(m);
      const prev = byKey.get(key);
      if (prev && !prev.pending && m.pending) continue;
      byKey.set(key, prev && !(prev.pending && !m.pending) ? { ...prev, ...m } : m);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (!!a.pending !== !!b.pending) return a.pending ? 1 : -1;
    return ts(a.createdAt) - ts(b.createdAt);
  });
}

export function replyPreview(m) {
  return {
    id: m.id,
    sender: m.sender,
    type: m.type,
    text: (m.text || '').slice(0, 200),
    mediaName: m.media?.name,
    mediaUrl: m.type === 'image' ? m.media?.url : undefined,
    deletedForEveryone: !!m.deletedForEveryone,
  };
}

/**
 * Participants as I see them: `name` is the name shown to me (address book, saved contact,
 * @username or number; the server never sends other people's registered names) and
 * `phone` includes numbers I know from my address book.
 */
function present(conv) {
  if (!conv?.participants) return conv;
  return {
    ...conv,
    participants: conv.participants.map((p) => ({ ...p, name: displayName(p), phone: knownPhone(p) || undefined })),
  };
}

export function conversationTitle(conv, me) {
  if (!conv) return '';
  if (conv.type === 'group') return conv.name || 'Group';
  return peerOf(conv, me)?.name || 'Unknown';
}

export function peerOf(conv, me) {
  return conv?.type === 'direct' ? conv.participants.find((p) => p.id !== me) || null : null;
}

export function canSendIn(conv, me) {
  if (conv.type !== 'group' || !conv.onlyAdminsCanSend) return true;
  return conv.participants.find((p) => p.id === me)?.role === 'admin';
}

// While we're offline our presence info is stale, so nobody is shown as online.
export const presenceSelector = (userId) => (s) =>
  userId && s.connection === 'online' ? s.presence[userId] ?? null : null;
export const isOnlineSelector = (userId) => (s) => !!presenceSelector(userId)(s)?.online;

/** sent → delivered → read, derived from every other member's receipt watermark. */
export function messageStatus(msg, conv, me) {
  if (msg.pending) return msg.status === 'failed' ? 'failed' : 'pending';
  if (msg.sender !== me || !conv) return null;
  const others = conv.participants.filter((p) => p.id !== me);
  if (!others.length) return 'sent';
  const t = ts(msg.createdAt);
  if (others.every((p) => ts(p.lastReadAt) >= t)) return 'read';
  if (others.every((p) => ts(p.lastDeliveredAt) >= t)) return 'delivered';
  return 'sent';
}

export const useChat = create((set, get) => {
  const patchConversation = (id, patch) =>
    set((s) => {
      const c = s.conversations[id];
      if (!c) return {};
      const next = typeof patch === 'function' ? patch(c) : patch;
      return { conversations: { ...s.conversations, [id]: { ...c, ...next } } };
    });

  const patchThread = (convId, fn) =>
    set((s) => {
      const cur = s.threads[convId] || emptyThread();
      return { threads: { ...s.threads, [convId]: { ...cur, ...fn(cur) } } };
    });

  const addItems = (convId, items) =>
    patchThread(convId, (t) => ({ items: mergeItems(t.items, items) }));

  const patchItem = (convId, key, patch) =>
    patchThread(convId, (t) => ({
      items: t.items.map((m) => (keyOf(m) === key || m.id === key ? { ...m, ...patch } : m)),
    }));

  const isViewing = (convId) =>
    get().activeId === convId && document.visibilityState === 'visible' && get().threads[convId]?.loaded;

  return {
    conversations: {},
    loaded: false,
    activeId: null,
    threads: {},
    typing: {}, // convId -> { userId: 'typing' | 'recording' }
    presence: {}, // userId -> { online, lastSeen }
    composer: {}, // convId -> { replyTo, editing }
    highlight: null, // { convId, id, at } message to scroll to
    unreadMarker: null, // { convId, from, count } the "unread messages" line of the open chat
    connection: 'connecting',

    reset() {
      pendingFiles.clear();
      inFlight.clear();
      set({
        conversations: {},
        loaded: false,
        activeId: null,
        threads: {},
        typing: {},
        presence: {},
        composer: {},
        highlight: null,
        unreadMarker: null,
        connection: 'connecting',
      });
    },

    setConnection: (connection) => set({ connection }),

    /** Shows the saved offline copy immediately; fresh data replaces it once online. */
    hydrate(cache) {
      if (!cache?.conversations?.length || get().loaded) return;
      set({
        conversations: Object.fromEntries(cache.conversations.map((c) => [c.id, present(c)])),
        loaded: true,
        threads: Object.fromEntries(
          Object.entries(cache.threads || {}).map(([id, items]) => [
            id,
            { items, hasMore: true, loaded: true, loading: false, stale: true },
          ])
        ),
        composer: cache.drafts || {},
      });
    },

    // ---------------------------------------------------------------- conversations

    async loadConversations() {
      const { conversations } = await api('/api/conversations');
      set({ conversations: Object.fromEntries(conversations.map((c) => [c.id, present(c)])), loaded: true });
      get().fetchPresence(conversations.flatMap((c) => c.participants.map((p) => p.id)));
      // Latest message of every chat + profile/group photos, so the list works offline too.
      keepOffline(conversations.map((c) => c.lastMessage).filter(Boolean));
      prefetchMedia(conversations.flatMap((c) => [c.avatarUrl, ...c.participants.map((p) => p.avatarUrl)]));
    },

    /** After a reconnect: refresh the list and the open chat, drop other cached threads. */
    async resync() {
      await get().loadConversations().catch(() => {});
      const { activeId } = get();
      // Keep what we have for offline use, but refetch each chat when it is next opened
      // (and allow scrolling further back again, now from the server).
      set((s) => ({
        threads: Object.fromEntries(
          Object.entries(s.threads).map(([id, t]) => [id, { ...t, stale: true, hasMore: true }])
        ),
      }));
      if (activeId) await get().loadMessages(activeId);
      get().retryPending();
    },

    async fetchPresence(userIds) {
      const me = meId();
      const ids = [...new Set(userIds)].filter((id) => id && id !== me).slice(0, 500);
      if (!ids.length) return;
      try {
        const { presence } = await emitAck('presence:get', { userIds: ids });
        set((s) => ({
          presence: {
            ...s.presence,
            ...Object.fromEntries(presence.map((p) => [p.userId, { online: p.online, lastSeen: p.lastSeen }])),
          },
        }));
      } catch {
        /* presence is best-effort */
      }
    },

    upsertConversation(conv) {
      const known = get().conversations[conv.id];
      set((s) => ({ conversations: { ...s.conversations, [conv.id]: present(conv) } }));
      if (!known) get().fetchPresence(conv.participants.map((p) => p.id));
    },

    removeConversation(id) {
      set((s) => {
        const conversations = { ...s.conversations };
        delete conversations[id];
        return { conversations, activeId: s.activeId === id ? null : s.activeId };
      });
    },

    async ensureConversation(id) {
      const existing = get().conversations[id];
      if (existing) return { conversation: existing, fetched: false };
      const { conversation } = await api(`/api/conversations/${id}`);
      get().upsertConversation(conversation);
      return { conversation, fetched: true };
    },

    async openDirect(userId) {
      const { conversation } = await api('/api/conversations/direct', { method: 'POST', body: { userId } });
      get().upsertConversation(conversation);
      get().openConversation(conversation.id);
    },

    async createGroup(data) {
      const { conversation } = await api('/api/conversations/group', { method: 'POST', body: data });
      get().upsertConversation(conversation);
      get().openConversation(conversation.id);
      return conversation;
    },

    async updateConversation(id, data) {
      const { conversation } = await api(`/api/conversations/${id}`, { method: 'PATCH', body: data });
      get().upsertConversation(conversation);
    },

    async setPrefs(id, prefs) {
      patchConversation(id, (c) => ({ me: { ...c.me, ...prefs } }));
      try {
        const { conversation } = await api(`/api/conversations/${id}/prefs`, { method: 'PATCH', body: prefs });
        get().upsertConversation(conversation);
      } catch (e) {
        toast(e.message, 'error');
        get().loadConversations().catch(() => {});
      }
    },

    async clearChat(id) {
      const { conversation } = await api(`/api/conversations/${id}/clear`, { method: 'POST' });
      get().upsertConversation(conversation);
      patchThread(id, () => ({ items: [], hasMore: false, loaded: true }));
      deleteStoredConversation(id);
    },

    openConversation(id) {
      // Where the "N unread messages" line goes: remembered before the chat is marked read,
      // and kept while the chat stays open.
      const conv = id ? get().conversations[id] : null;
      const mine = conv?.participants.find((p) => p.id === meId());
      const unreadMarker =
        conv?.me?.unreadCount > 0 ? { convId: id, from: ts(mine?.lastReadAt), count: conv.me.unreadCount } : null;
      if (get().activeId !== id || unreadMarker) set({ unreadMarker });
      set({ activeId: id });
      useUI.getState().setInfoOpen(false);
      if (!id) return;
      const t = get().threads[id];
      if ((!t?.loaded || t.stale) && !t?.loading) get().loadMessages(id);
      if (t?.loaded) get().markRead(id);
    },

    closeConversation: () => set({ activeId: null }),

    // ---------------------------------------------------------------- messages

    async loadMessages(convId, { older = false } = {}) {
      const thread = get().threads[convId] || emptyThread();
      if (thread.loading || (older && !thread.hasMore)) return;
      patchThread(convId, () => ({ loading: true }));
      const oldest = thread.items.find((m) => !m.pending);

      // Opening a chat: show what's stored on the device straight away, then refresh.
      if (!older && !thread.loaded) {
        const local = await readMessages(convId, { limit: PAGE });
        if (local.length) {
          patchThread(convId, (t) => ({ items: mergeItems(local, t.items), loaded: true, stale: true, hasMore: true }));
        }
      }

      try {
        const q = new URLSearchParams({ limit: String(PAGE) });
        if (older && oldest) q.set('before', oldest.createdAt);
        const { messages, hasMore } = await api(`/api/conversations/${convId}/messages?${q}`);
        keepOffline(messages);
        patchThread(convId, (t) => {
          if (older) return { items: mergeItems(messages, t.items), hasMore, loading: false };
          // A stale offline copy may have a gap before the newest page: replace it, keeping
          // only messages that are still waiting to be sent.
          const base = t.stale ? t.items.filter((m) => m.pending) : t.items;
          return {
            items: mergeItems(base, messages),
            hasMore: t.stale || !t.loaded ? hasMore : t.hasMore,
            loaded: true,
            loading: false,
            stale: false,
          };
        });
        if (!older) get().markRead(convId);
      } catch (e) {
        if (!isNetworkError(e)) {
          patchThread(convId, () => ({ loading: false }));
          toast(e.message, 'error');
          return;
        }
        // Offline: keep going from the copy stored on the device.
        if (older) {
          const local = oldest ? await readMessages(convId, { before: oldest.createdAt, limit: PAGE }) : [];
          patchThread(convId, (t) => ({
            items: mergeItems(local, t.items),
            hasMore: local.length === PAGE,
            loading: false,
          }));
        } else {
          patchThread(convId, () => ({ loaded: true, loading: false }));
        }
      }
    },

    /**
     * 'Save chat for offline': downloads a chat's whole history and every photo, video, voice
     * note and document in it (an explicit request, so the auto-download rules don't apply).
     * onProgress({ messages, files, saved, done }).
     */
    async saveChatOffline(convId, onProgress) {
      let before;
      let count = 0;
      const urls = new Set();
      for (;;) {
        const q = new URLSearchParams({ limit: '100' });
        if (before) q.set('before', before);
        const { messages, hasMore } = await api(`/api/conversations/${convId}/messages?${q}`);
        await saveMessages(messages);
        for (const item of mediaItemsOf(messages)) urls.add(item.url);
        count += messages.length;
        onProgress?.({ messages: count, files: urls.size, saved: 0, done: false });
        if (!hasMore || !messages.length) break;
        before = messages[0].createdAt;
      }
      let saved = 0;
      for (const url of urls) {
        await ensureMedia(url);
        onProgress?.({ messages: count, files: urls.size, saved: ++saved, done: false });
      }
      onProgress?.({ messages: count, files: urls.size, saved, done: true });
    },

    /** Loads older pages until the message is present, then asks the list to scroll to it. */
    async jumpTo(convId, messageId) {
      for (let i = 0; i < 25; i++) {
        const t = get().threads[convId];
        if (t?.items.some((m) => m.id === messageId)) break;
        if (t && !t.hasMore) break;
        await get().loadMessages(convId, { older: !!t?.loaded });
      }
      set({ highlight: { convId, id: messageId, at: Date.now() } });
    },

    markRead(convId) {
      const me = meId();
      const conv = get().conversations[convId];
      if (!conv?.me) return;
      clearChatNotifications(convId); // its notifications go, here and (via the server) on my other phones
      const items = get().threads[convId]?.items || [];
      const latest = [...items].reverse().find((m) => !m.pending);
      const upTo = latest?.createdAt || conv.lastMessage?.createdAt;
      if (!upTo) return;
      const mine = conv.participants.find((p) => p.id === me);
      if (conv.me.unreadCount === 0 && mine && ts(mine.lastReadAt) >= ts(upTo)) return;
      patchConversation(convId, (c) => ({ me: { ...c.me, unreadCount: 0 } }));
      emitAck('conversation:read', { conversationId: convId, upTo }).catch(() => {});
    },

    sendMessage(convId, { type = 'text', text = '', media, replyTo, forwarded = false }) {
      const clientId = uid();
      const optimistic = {
        id: clientId,
        clientId,
        conversationId: convId,
        sender: meId(),
        type,
        text,
        media: media || null,
        replyTo: replyTo ? replyPreview(replyTo) : null,
        forwarded,
        reactions: [],
        starred: false,
        createdAt: new Date().toISOString(),
        pending: true,
        status: 'pending',
      };
      addItems(convId, [optimistic]);
      patchConversation(convId, { lastMessage: optimistic, lastMessageAt: optimistic.createdAt });
      return get().deliver(optimistic);
    },

    /** Optimistically shows a media message while the file uploads, then sends it. */
    sendMedia(convId, file, { type, text = '', duration, replyTo } = {}) {
      const clientId = uid();
      const optimistic = {
        id: clientId,
        clientId,
        conversationId: convId,
        sender: meId(),
        type,
        text,
        media: { url: URL.createObjectURL(file), name: file.name, size: file.size, mime: file.type, duration },
        replyTo: replyTo ? replyPreview(replyTo) : null,
        forwarded: false,
        reactions: [],
        starred: false,
        createdAt: new Date().toISOString(),
        pending: true,
        status: 'pending',
        progress: 0,
        needsUpload: true,
      };
      pendingFiles.set(clientId, file);
      // Also on the device, so it can still be sent after the app is closed and reopened.
      putStoredMedia(pendingKey(clientId), file);
      addItems(convId, [optimistic]);
      patchConversation(convId, { lastMessage: optimistic, lastMessageAt: optimistic.createdAt });
      return get().deliver(optimistic);
    },

    async deliver(msg) {
      const convId = msg.conversationId;
      if (inFlight.has(msg.clientId)) return;
      // Always work from the latest copy: a retry may pass a stale snapshot.
      const current = () => get().threads[convId]?.items.find((m) => m.clientId === msg.clientId) || msg;
      patchItem(convId, msg.clientId, { status: 'pending' });

      // Offline: keep it queued (clock icon). It is sent on reconnect, or on Android by the
      // background worker as soon as the network returns, even if the app is closed.
      if (!isOnline()) {
        queueInBackground(current(), authToken(), fileFor(msg.clientId));
        return;
      }

      inFlight.add(msg.clientId);
      try {
        if (current().needsUpload) {
          // In memory normally; after an app restart it comes back from on-device storage.
          const file = pendingFiles.get(msg.clientId) || (await getStoredMedia(pendingKey(msg.clientId)));
          if (!file) throw new Error('File is no longer available');
          const uploaded = await uploadFile(file, {
            name: msg.media?.name,
            onProgress: (progress) => patchItem(convId, msg.clientId, { progress }),
          });
          // Keep our own copy under the real URL so it never needs downloading again.
          await rememberMedia(uploaded.url, file);
          pendingFiles.delete(msg.clientId);
          deleteStoredMedia(pendingKey(msg.clientId));
          patchItem(convId, msg.clientId, {
            needsUpload: false,
            remoteMedia: { ...uploaded, duration: msg.media?.duration },
          });
        }

        const { message } = await emitAck('message:send', { conversationId: convId, ...sendPayload(current()) }, 20000);
        cancelBackground(msg.clientId);
        saveMessages([message]);
        addItems(convId, [message]);
        patchConversation(convId, (c) =>
          c.lastMessage?.clientId === message.clientId
            ? { lastMessage: message, lastMessageAt: message.createdAt }
            : {}
        );
        if (useUI.getState().sounds) playSent();
      } catch (e) {
        if (isNetworkError(e)) {
          // Connection dropped mid-send: stay queued and try again automatically.
          patchItem(convId, msg.clientId, { status: 'pending' });
          queueInBackground(current(), authToken(), fileFor(msg.clientId));
        } else {
          patchItem(convId, msg.clientId, { status: 'failed', error: e.message });
          toast(e.message, 'error');
        }
      } finally {
        inFlight.delete(msg.clientId);
      }
    },

    /**
     * Android: messages the background sender delivered while the app was closed. They are
     * marked as sent right away (works offline) and never uploaded or sent a second time.
     */
    async absorbBackgroundDeliveries() {
      const delivered = await takeDeliveredInBackground();
      for (const message of delivered) {
        const convId = message.conversationId;
        // Show it as sent straight away (the queued copy has the same clientId).
        addItems(convId, [message]);
        patchConversation(convId, (c) =>
          c.lastMessage?.clientId === message.clientId ? { lastMessage: message, lastMessageAt: message.createdAt } : {}
        );
        saveMessages([message]);
        // Then move our copy of the file under its real URL, so it never needs downloading.
        const clientId = message.clientId;
        pendingFiles.delete(clientId);
        (async () => {
          const file = await getStoredMedia(pendingKey(clientId));
          if (file && message.media?.url) await rememberMedia(message.media.url, file);
          await deleteStoredMedia(pendingKey(clientId));
        })().catch(() => {
          /* best effort: worst case the photo is downloaded again when viewed */
        });
      }
      return delivered.length;
    },

    /** Sends everything still queued (called on reconnect and when the app resumes). */
    async retryPending() {
      await get().absorbBackgroundDeliveries(); // don't resend what the background sender already sent
      for (const t of Object.values(get().threads)) {
        for (const m of t.items) if (m.pending && m.status === 'pending') get().deliver(m);
      }
    },

    /** Hands every queued message to the Android background sender (app going to background). */
    queueAllInBackground() {
      for (const t of Object.values(get().threads)) {
        for (const m of t.items) if (m.pending && m.status === 'pending') queueInBackground(m, authToken(), fileFor(m.clientId));
      }
    },

    async editMessage(msg, text) {
      patchItem(msg.conversationId, msg.id, { text, editedAt: new Date().toISOString() });
      try {
        await emitAck('message:edit', { messageId: msg.id, text });
      } catch (e) {
        patchItem(msg.conversationId, msg.id, { text: msg.text, editedAt: msg.editedAt });
        toast(e.message, 'error');
      }
    },

    async deleteMessage(msg, forEveryone) {
      if (msg.pending) {
        pendingFiles.delete(msg.clientId);
        deleteStoredMedia(pendingKey(msg.clientId));
        get().onMessageRemoved({ id: msg.id, conversationId: msg.conversationId });
        return;
      }
      try {
        await emitAck('message:delete', { messageId: msg.id, forEveryone });
      } catch (e) {
        toast(e.message, 'error');
      }
    },

    async react(msg, emoji) {
      try {
        await emitAck('message:react', { messageId: msg.id, emoji });
      } catch (e) {
        toast(e.message, 'error');
      }
    },

    async toggleStar(msg) {
      try {
        const { starred } = await api(`/api/messages/${msg.id}/star`, { method: 'POST' });
        patchItem(msg.conversationId, msg.id, { starred });
        patchStoredMessage({ id: msg.id, starred });
      } catch (e) {
        toast(e.message, 'error');
      }
    },

    forward(msg, convIds) {
      for (const convId of convIds) {
        get().sendMessage(convId, {
          type: msg.type,
          text: msg.text,
          media: msg.media ? { ...msg.media } : undefined,
          forwarded: true,
        });
      }
    },

    setComposer(convId, patch) {
      set((s) => ({ composer: { ...s.composer, [convId]: { ...s.composer[convId], ...patch } } }));
    },

    sendTyping(convId, state) {
      emitVolatile('typing', { conversationId: convId, state });
    },

    // ---------------------------------------------------------------- realtime events

    async onMessageNew(msg) {
      const me = meId();
      const convId = msg.conversationId;
      let fetched = false;
      if (!get().conversations[convId]) {
        try {
          ({ fetched } = await get().ensureConversation(convId));
        } catch {
          return;
        }
      }
      keepOffline([msg]);
      if (get().threads[convId]?.loaded) addItems(convId, [msg]);

      const mine = msg.sender === me;
      // Calls I answered or declined are logged in the chat but aren't "unread"; missed ones are.
      const counts = !isCallMessage(msg) || msg.call.status === 'missed';
      patchConversation(convId, (c) => ({
        lastMessage: msg,
        lastMessageAt: msg.createdAt,
        me:
          c.me && !mine && counts && !fetched && !isViewing(convId)
            ? { ...c.me, unreadCount: c.me.unreadCount + 1 }
            : c.me,
      }));
      if (mine) return; // sent from another of my devices

      get().onTyping({ conversationId: convId, userId: msg.sender, state: 'stop' });
      if (isViewing(convId)) {
        get().markRead(convId);
      } else {
        emitAck('message:delivered', { conversationId: convId, upTo: msg.createdAt }).catch(() => {});
      }

      const conv = get().conversations[convId];
      if (!conv || conv.me?.muted || isViewing(convId) || !counts) return;
      if (useUI.getState().sounds) playIncoming();
      if (document.visibilityState !== 'visible') {
        const sender = conv.participants.find((p) => p.id === msg.sender);
        const title = conv.type === 'group' ? `${sender?.name || 'Someone'} @ ${conv.name}` : sender?.name || 'New message';
        showNotification(title, previewText(msg), () => get().openConversation(convId));
      }
    },

    onMessageUpdated(patch) {
      const { id, conversationId } = patch;
      patchItem(conversationId, id, patch);
      patchStoredMessage(patch);
      patchConversation(conversationId, (c) =>
        c.lastMessage?.id === id ? { lastMessage: { ...c.lastMessage, ...patch } } : {}
      );
    },

    onMessageRemoved({ id, conversationId }) {
      deleteStoredMessage(id);
      patchThread(conversationId, (t) => ({ items: t.items.filter((m) => m.id !== id) }));
      const items = get().threads[conversationId]?.items || [];
      patchConversation(conversationId, (c) =>
        c.lastMessage?.id === id ? { lastMessage: items[items.length - 1] || null } : {}
      );
    },

    onReceipt({ conversationId, userId, kind, at, unreadCount }) {
      const me = meId();
      patchConversation(conversationId, (c) => ({
        participants: c.participants.map((p) =>
          p.id !== userId
            ? p
            : {
                ...p,
                lastDeliveredAt: maxIso(p.lastDeliveredAt, at),
                ...(kind === 'read' && { lastReadAt: maxIso(p.lastReadAt, at) }),
              }
        ),
        me: userId === me && kind === 'read' && c.me ? { ...c.me, unreadCount } : c.me,
      }));
    },

    onTyping({ conversationId, userId, state }) {
      const timerKey = `${conversationId}:${userId}`;
      clearTimeout(typingTimers.get(timerKey));
      set((s) => {
        const conv = { ...(s.typing[conversationId] || {}) };
        if (state === 'stop') delete conv[userId];
        else conv[userId] = state;
        return { typing: { ...s.typing, [conversationId]: conv } };
      });
      if (state !== 'stop') {
        // Clear automatically in case the "stop" event is lost.
        typingTimers.set(
          timerKey,
          setTimeout(() => get().onTyping({ conversationId, userId, state: 'stop' }), 7000)
        );
      }
    },

    onPresence({ userId, online, lastSeen }) {
      set((s) => ({ presence: { ...s.presence, [userId]: { online, lastSeen: lastSeen ?? null } } }));
    },

    onUserUpdated(user) {
      set((s) => ({
        conversations: Object.fromEntries(
          Object.entries(s.conversations).map(([id, c]) => [
            id,
            c.participants.some((p) => p.id === user.id)
              ? present({
                  ...c,
                  // phone/email are replaced, not merged: absent means they're now private.
                  participants: c.participants.map((p) =>
                    p.id === user.id ? { ...p, ...user, phone: user.phone, email: user.email } : p
                  ),
                })
              : c,
          ])
        ),
      }));
    },

    /** My contacts changed (address book sync, saved contact): show everyone's new names. */
    refreshNames() {
      set((s) => ({
        conversations: Object.fromEntries(Object.entries(s.conversations).map(([id, c]) => [id, present(c)])),
      }));
      setNativeNames(savedNames());
    },
  };
});

if (import.meta.env.DEV) window.__chat = useChat;

// Names follow my contacts: re-apply them when the address book or saved contacts change.
useContactMatches.subscribe((s, prev) => s.data !== prev.data && useChat.getState().refreshNames());
usePeople.subscribe((s, prev) => s.saved !== prev.saved && useChat.getState().refreshNames()); // handy for debugging in devtools

export const isCallMessage = (msg) => msg?.type === 'call' && !!msg.call;

const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * How a call entry reads for me: { title: 'Missed voice call', detail: 'No answer' | '2:31',
 * missed, outgoing }. The caller is the message's sender.
 */
export function callSummary(msg, me = meId()) {
  const { kind, status, duration } = msg.call;
  const outgoing = msg.sender === me;
  const noun = kind === 'video' ? 'video call' : 'voice call';
  const Noun = kind === 'video' ? 'Video call' : 'Voice call';
  if (status === 'answered') return { title: Noun, detail: clock(duration), missed: false, outgoing };
  if (outgoing) {
    return { title: Noun, detail: { declined: 'Declined', busy: 'Busy' }[status] || 'No answer', missed: false, outgoing };
  }
  if (status === 'declined') return { title: Noun, detail: 'Declined', missed: false, outgoing };
  return { title: `Missed ${noun}`, detail: '', missed: true, outgoing };
}

export function previewText(msg) {
  if (!msg) return '';
  if (msg.deletedForEveryone) return 'This message was deleted';
  if (isCallMessage(msg)) {
    const { title, detail } = callSummary(msg);
    return `📞 ${title}${detail ? ` · ${detail}` : ''}`;
  }
  const labels = { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', audio: '🎵 Audio', file: '📄 ' };
  if (msg.type === 'text' || msg.type === 'system') return msg.text;
  if (msg.type === 'file') return labels.file + (msg.media?.name || 'Document');
  return msg.text ? `${labels[msg.type]} · ${msg.text}` : labels[msg.type];
}
