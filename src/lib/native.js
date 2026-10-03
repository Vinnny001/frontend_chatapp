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

/**
 * Names I saved people under ({ userId: name }), so notifications and incoming calls show
 * them instead of the @username / number the server sends. Kept on the device only.
 */
export function setNativeNames(names) {
  if (available()) quiet(NativeSession.setNames({ names: JSON.stringify(names) }));
}

export function clearNativeSession() {
  if (available()) return quiet(NativeSession.clearSession());
  return Promise.resolve();
}

/** Removes a chat's message and missed-call notifications (the chat was read). */
export function clearChatNotifications(conversationId) {
  if (available() && conversationId) quiet(NativeSession.clearConversation({ conversationId }));
}

/** Messages that arrived by push since last time (Android keeps them for the app). */
export async function takeReceivedMessages() {
  if (!available()) return [];
  const { messages = [] } = await NativeSession.takeReceivedMessages().catch(() => ({}));
  return messages.map((m) => {
    try {
      return JSON.parse(m);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** Ring with the phone's ringtone / vibration, following its ring mode (app on screen). */
export const startNativeRinging = () => available() && quiet(NativeSession.startRinging());
export const stopNativeRinging = () => available() && quiet(NativeSession.stopRinging());

/** Caller side: the phone's ringing tone while waiting, and the busy tone when it doesn't connect. */
export const startNativeRingback = () => available() && quiet(NativeSession.startRingback());
export const stopNativeRingback = () => available() && quiet(NativeSession.stopRingback());
export const playNativeEndTone = () => available() && quiet(NativeSession.playEndTone());

/** A call answered on the lock screen: the call-only screen is up, uncover it. */
export const nativeCallScreenShown = () => available() && quiet(NativeSession.callScreenShown());

/** A call answered from outside the app ended: back to the lock screen / previous app. */
export const leaveNativeCall = () => available() && quiet(NativeSession.leaveCall());

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
