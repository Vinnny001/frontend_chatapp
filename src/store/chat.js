import { create } from 'zustand';
import { api, uploadFile } from '../lib/api.js';
import { emitAck, emitVolatile } from '../lib/socket.js';
import { uid } from '../lib/format.js';
import { playIncoming, playSent, showNotification } from '../lib/notify.js';
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
    connection: 'connecting',

    reset() {
      pendingFiles.clear();
      set({
        conversations: {},
        loaded: false,
        activeId: null,
        threads: {},
        typing: {},
        presence: {},
        composer: {},
        highlight: null,
        connection: 'connecting',
      });
    },

    setConnection: (connection) => set({ connection }),

    // ---------------------------------------------------------------- conversations

    async loadConversations() {
      const { conversations } = await api('/api/conversations');
      set({ conversations: Object.fromEntries(conversations.map((c) => [c.id, c])), loaded: true });
      get().fetchPresence(conversations.flatMap((c) => c.participants.map((p) => p.id)));
    },

    /** After a reconnect: refresh the list and the open chat, drop other cached threads. */
    async resync() {
      await get().loadConversations().catch(() => {});
      const { activeId } = get();
      set((s) => ({
        threads: Object.fromEntries(
          Object.entries(s.threads)
            .filter(([id]) => id === activeId)
            .map(([id, t]) => [id, { ...t, loaded: true }])
        ),
      }));
      if (activeId) await get().loadMessages(activeId);
      get().retryFailed();
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
      set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
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
    },

    openConversation(id) {
      set({ activeId: id });
      useUI.getState().setInfoOpen(false);
      if (!id) return;
      const t = get().threads[id];
      if (!t?.loaded && !t?.loading) get().loadMessages(id);
      else get().markRead(id);
    },

    closeConversation: () => set({ activeId: null }),

    // ---------------------------------------------------------------- messages

    async loadMessages(convId, { older = false } = {}) {
      const thread = get().threads[convId] || emptyThread();
      if (thread.loading || (older && !thread.hasMore)) return;
      patchThread(convId, () => ({ loading: true }));
      try {
        const q = new URLSearchParams({ limit: '40' });
        const oldest = thread.items.find((m) => !m.pending);
        if (older && oldest) q.set('before', oldest.createdAt);
        const { messages, hasMore } = await api(`/api/conversations/${convId}/messages?${q}`);
        patchThread(convId, (t) => ({
          items: older ? mergeItems(messages, t.items) : mergeItems(t.items, messages),
          hasMore: older || !t.loaded ? hasMore : t.hasMore,
          loaded: true,
          loading: false,
        }));
        if (!older) get().markRead(convId);
      } catch (e) {
        patchThread(convId, () => ({ loading: false }));
        toast(e.message, 'error');
      }
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
      addItems(convId, [optimistic]);
      patchConversation(convId, { lastMessage: optimistic, lastMessageAt: optimistic.createdAt });
      return get().deliver(optimistic);
    },

    async deliver(msg) {
      const convId = msg.conversationId;
      // Always work from the latest copy: a retry may pass a stale snapshot.
      const current = () => get().threads[convId]?.items.find((m) => m.clientId === msg.clientId) || msg;
      patchItem(convId, msg.clientId, { status: 'pending' });
      try {
        let media = current().remoteMedia || current().media;
        if (current().needsUpload) {
          const file = pendingFiles.get(msg.clientId);
          if (!file) throw new Error('File is no longer available');
          const uploaded = await uploadFile(file, {
            onProgress: (progress) => patchItem(convId, msg.clientId, { progress }),
          });
          media = { ...uploaded, duration: msg.media?.duration };
          pendingFiles.delete(msg.clientId);
          patchItem(convId, msg.clientId, { needsUpload: false, remoteMedia: media });
        }

        const { message } = await emitAck(
          'message:send',
          {
            conversationId: convId,
            clientId: msg.clientId,
            type: msg.type,
            text: msg.text,
            media: media || undefined,
            replyTo: msg.replyTo?.id ?? null,
            forwarded: msg.forwarded,
          },
          20000
        );
        addItems(convId, [message]);
        patchConversation(convId, (c) =>
          c.lastMessage?.clientId === message.clientId
            ? { lastMessage: message, lastMessageAt: message.createdAt }
            : {}
        );
        if (useUI.getState().sounds) playSent();
      } catch (e) {
        patchItem(convId, msg.clientId, { status: 'failed', error: e.message });
        if (!/respond|connect/i.test(e.message)) toast(e.message, 'error');
      }
    },

    retryFailed() {
      for (const t of Object.values(get().threads)) {
        for (const m of t.items) if (m.pending && m.status === 'failed') get().deliver(m);
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
      if (get().threads[convId]?.loaded) addItems(convId, [msg]);

      const mine = msg.sender === me;
      patchConversation(convId, (c) => ({
        lastMessage: msg,
        lastMessageAt: msg.createdAt,
        me:
          c.me && !mine && !fetched && !isViewing(convId)
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
      if (!conv || conv.me?.muted || isViewing(convId)) return;
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
      patchConversation(conversationId, (c) =>
        c.lastMessage?.id === id ? { lastMessage: { ...c.lastMessage, ...patch } } : {}
      );
    },

    onMessageRemoved({ id, conversationId }) {
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
              ? { ...c, participants: c.participants.map((p) => (p.id === user.id ? { ...p, ...user } : p)) }
              : c,
          ])
        ),
      }));
    },
  };
});

if (import.meta.env.DEV) window.__chat = useChat; // handy for debugging in devtools

export function previewText(msg) {
  if (!msg) return '';
  if (msg.deletedForEveryone) return 'This message was deleted';
  const labels = { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', audio: '🎵 Audio', file: '📄 ' };
  if (msg.type === 'text' || msg.type === 'system') return msg.text;
  if (msg.type === 'file') return labels.file + (msg.media?.name || 'Document');
  return msg.text ? `${labels[msg.type]} · ${msg.text}` : labels[msg.type];
}
