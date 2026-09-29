import { Capacitor, registerPlugin } from '@capacitor/core';
import { API_URL, REALTIME_URL } from './config.js';

// Android only: the native notification code (see NativeSessionPlugin.java). It needs the
// session so notification buttons (Reply, Mark as read, Decline) work while the app is
// closed, and it hands back what the user tapped (open a chat, answer a call).

const NativeSession = registerPlugin('NativeSession');
const available = () => Capacitor.getPlatform() === 'android';
const quiet = (p) => p.catch(() => {});

export const isNativeApp = available;

export function setNativeSession(token) {
  if (available()) quiet(NativeSession.setSession({ token, apiUrl: API_URL, realtimeUrl: REALTIME_URL }));
}

export function clearNativeSession() {
  if (available()) return quiet(NativeSession.clearSession());
  return Promise.resolve();
}

/** Removes a chat's message and missed-call notifications (the chat was read). */
export function clearChatNotifications(conversationId) {
  if (available() && conversationId) quiet(NativeSession.clearConversation({ conversationId }));
}

/** Stops the ringing notification of a call that was answered or declined in the app. */
export function clearCallNotification(callId) {
  if (available() && callId) quiet(NativeSession.clearCall({ callId }));
}

/**
 * Runs `handler({ action, conversationId, callId, kind })` for notification taps: once for a
 * tap that launched the app, and again for every later one. Returns an unsubscribe function.
 */
export function onNativeAction(handler) {
  if (!available()) return () => {};
  const take = async () => {
    const { action } = await NativeSession.takePendingAction().catch(() => ({}));
    if (action) handler(action);
  };
  take();
  const listener = NativeSession.addListener('action', take);
  return () => quiet(listener.then((l) => l.remove()));
}
