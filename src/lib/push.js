import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api.js';
import { storage } from './storage.js';

// Phone push notifications (Firebase Cloud Messaging). The backend sends one for every new
// message; Android shows it on the "messages" channel, which is high importance so it pops
// up on screen (heads-up) with sound, even when the app is in the background or closed.

const supported = () => Capacitor.getPlatform() === 'android';
const TOKEN_KEY = 'push.token';
let listeners = [];

/** Registers this phone for notifications; `onOpen(conversationId)` runs when one is tapped. */
export async function setupPush(onOpen) {
  if (!supported()) return 'unsupported';
  await teardownListeners();

  await PushNotifications.createChannel({
    id: 'messages',
    name: 'Messages',
    description: 'New messages in your chats',
    importance: 5, // highest: pops up on screen
    visibility: 1, // show content on the lock screen, like WhatsApp
    vibration: true,
    lights: true,
    lightColor: '#0B8F6A',
  }).catch(() => {});

  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== 'granted') return receive;

  listeners = await Promise.all([
    PushNotifications.addListener('registration', async ({ value: token }) => {
      try {
        await api('/api/users/me/devices', { method: 'POST', body: { token, platform: Capacitor.getPlatform() } });
        storage.set(TOKEN_KEY, token);
      } catch (err) {
        console.warn('Could not register for notifications', err);
      }
    }),
    PushNotifications.addListener('registrationError', (err) => console.warn('Push registration failed', err)),
    PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversationId = notification?.data?.conversationId;
      if (conversationId) onOpen?.(conversationId);
    }),
  ]);
  await PushNotifications.register();
  return 'granted';
}

async function teardownListeners() {
  await Promise.all(listeners.map((l) => l.remove().catch(() => {})));
  listeners = [];
}

/** Sign-out: stop notifications for this account on this phone (call while still signed in). */
export async function unregisterPush() {
  if (!supported()) return;
  const token = storage.get(TOKEN_KEY);
  storage.set(TOKEN_KEY, null);
  // Start the request right away: it picks up the login token now, before sign-out clears it.
  const removal = token
    ? api(`/api/users/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {})
    : null;
  await teardownListeners();
  await removal;
  await PushNotifications.unregister().catch(() => {});
}

/** Removes this app's notifications from the tray (done when the app is opened). */
export const clearDeliveredNotifications = () =>
  supported() ? PushNotifications.removeAllDeliveredNotifications().catch(() => {}) : undefined;
