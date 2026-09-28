import { useEffect } from 'react';
import { connectSocket, disconnectSocket } from './socket.js';
import { requestNotificationPermission } from './notify.js';
import { useAuth } from '../store/auth.js';
import { useCall } from '../store/call.js';
import { useChat } from '../store/chat.js';
import { toast } from '../store/ui.js';

/** Owns the realtime connection for the signed-in session and routes events into the stores. */
export function useRealtime(token) {
  useEffect(() => {
    if (!token) return undefined;
    const chat = useChat.getState();
    const calls = useCall.getState();
    const socket = connectSocket(token);
    let everConnected = false;

    chat.loadConversations().catch((e) => toast(e.message, 'error'));
    requestNotificationPermission();

    socket.on('connect', () => {
      chat.setConnection('online');
      if (everConnected) chat.resync();
      else chat.retryFailed();
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

    const onVisible = () => {
      const { activeId, markRead } = useChat.getState();
      if (document.visibilityState === 'visible' && activeId) markRead(activeId);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      disconnectSocket();
      useCall.getState().call && useCall.getState().finish('Signed out');
      useChat.getState().reset();
    };
  }, [token]);
}
