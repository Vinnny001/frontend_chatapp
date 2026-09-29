import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { connectSocket, disconnectSocket } from './socket.js';
import { requestNotificationPermission } from './notify.js';
import { clearCache, loadCache, saveCache } from './cache.js';
import { closeLocalDb, openLocalDb } from './localdb.js';
import { autoSyncContacts } from './contacts.js';
import { useAuth } from '../store/auth.js';
import { useCall } from '../store/call.js';
import { useChat } from '../store/chat.js';
import { toast } from '../store/ui.js';

/** Owns the realtime connection for the signed-in session and routes events into the stores. */
export function useRealtime(token) {
  useEffect(() => {
    if (!token) return undefined;
    const userId = useAuth.getState().user?.id;
    const chat = useChat.getState();
    const calls = useCall.getState();
    const cleanups = [];

    // 1) Show the saved offline copy straight away, then refresh from the server.
    openLocalDb(userId);
    chat.hydrate(loadCache(userId));
    // Android: mark messages the background sender delivered while we were closed as sent.
    chat.absorbBackgroundDeliveries();
    let initialLoadOk = true;
    chat.loadConversations().catch((e) => {
      initialLoadOk = false;
      if (e.status !== 0) toast(e.message, 'error'); // offline is expected, not an error
    });
    requestNotificationPermission();
    // Phones: ask for contacts once and keep "who's on ChatApp" in sync.
    autoSyncContacts(userId).then((state) => {
      if (state === 'limited') {
        toast('ChatApp can only see some of your contacts. Allow full access in Settings → ChatApp → Contacts.');
      }
    });

    // 2) Keep the offline copy up to date (debounced).
    let saveTimer = null;
    const saveNow = () => {
      clearTimeout(saveTimer);
      saveCache(userId, useChat.getState());
    };
    cleanups.push(
      useChat.subscribe((s, prev) => {
        if (s.conversations === prev.conversations && s.threads === prev.threads && s.composer === prev.composer) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 1000);
      })
    );
    window.addEventListener('pagehide', saveNow);
    cleanups.push(() => window.removeEventListener('pagehide', saveNow));

    // 3) Realtime connection.
    const socket = connectSocket(token);
    let everConnected = false;

    socket.on('connect', () => {
      chat.setConnection('online');
      if (everConnected || !initialLoadOk) chat.resync();
      else chat.retryPending();
      everConnected = true;
    });
    socket.on('disconnect', () => chat.setConnection('offline'));
    socket.io.on('reconnect_attempt', () => chat.setConnection('connecting'));
    socket.on('connect_error', (err) => {
      chat.setConnection('offline');
      if (err.message === 'unauthorized') useAuth.getState().logout();
    });

    socket.on('message:new', (m) => useChat.getState().onMessageNew(m));
    socket.on('message:updated', (p) => useChat.getState().onMessageUpdated(p));
    socket.on('message:removed', (p) => useChat.getState().onMessageRemoved(p));
    socket.on('receipt', (r) => useChat.getState().onReceipt(r));
    socket.on('typing', (t) => useChat.getState().onTyping(t));
    socket.on('presence', (p) => useChat.getState().onPresence(p));
    socket.on('conversation:upsert', (c) => useChat.getState().upsertConversation(c));
    socket.on('conversation:removed', ({ conversationId }) => useChat.getState().removeConversation(conversationId));
    socket.on('user:updated', (u) => {
      useChat.getState().onUserUpdated(u);
      const me = useAuth.getState().user;
      if (me?.id === u.id) useAuth.getState().setUser({ ...me, ...u, lastSeen: me.lastSeen });
    });

    socket.on('call:incoming', calls.onIncoming);
    socket.on('call:accepted', calls.onAccepted);
    socket.on('call:rejected', calls.onRejected);
    socket.on('call:ended', calls.onEnded);
    socket.on('call:signal', calls.onSignal);
    socket.on('call:handled-elsewhere', calls.onHandledElsewhere);

    // 4) Follow the device's network state: drop the socket as soon as the phone goes offline
    //    (so new messages queue instead of waiting on a dead connection) and reconnect the
    //    moment it comes back instead of waiting for socket.io's backoff.
    const onOnline = () => {
      if (!socket.connected) socket.connect();
    };
    const onOffline = () => {
      socket.disconnect();
      chat.setConnection('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    cleanups.push(() => window.removeEventListener('online', onOnline));
    cleanups.push(() => window.removeEventListener('offline', onOffline));
    const netHandle = Network.addListener('networkStatusChange', (status) => (status.connected ? onOnline() : onOffline()));
    cleanups.push(() => netHandle.then((h) => h.remove()).catch(() => {}));

    // 5) App lifecycle (Capacitor): leaving → save + hand queued messages to the background
    //    sender; coming back → send whatever is still queued.
    const appHandle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        saveNow();
        useChat.getState().queueAllInBackground();
      } else {
        onOnline();
        useChat.getState().retryPending();
      }
    });
    cleanups.push(() => appHandle.then((h) => h.remove()).catch(() => {}));

    const onVisible = () => {
      const { activeId, markRead } = useChat.getState();
      if (document.visibilityState === 'visible' && activeId) markRead(activeId);
    };
    document.addEventListener('visibilitychange', onVisible);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));

    return () => {
      cleanups.forEach((fn) => fn());
      if (useAuth.getState().token) saveNow();
      else {
        // Signed out: don't leave their chats or media on the device.
        clearCache(userId);
        closeLocalDb(userId, { erase: true });
      }
      disconnectSocket();
      useCall.getState().call && useCall.getState().finish('Signed out');
      useChat.getState().reset();
    };
  }, [token]);
}
