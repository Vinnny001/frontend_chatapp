import { Capacitor, registerPlugin } from '@capacitor/core';
import { API_URL } from './config.js';

// Android only: a native WorkManager job (android/.../OutboxPlugin.java) that POSTs a queued
// message as soon as the phone is back online, even if the app has been closed. The server
// dedupes by clientId, so it is harmless if the app also sends the same message itself.
const Outbox = registerPlugin('Outbox');
const supported = () => Capacitor.getPlatform() === 'android';

/** Body for sending a message (socket `message:send` and REST POST share it). */
export function sendPayload(msg) {
  const media = msg.remoteMedia || msg.media;
  return {
    clientId: msg.clientId,
    type: msg.type,
    text: msg.text,
    // Only files already uploaded (blob:/pending: are still on this device).
    media: media && !/^(blob|pending):/.test(String(media.url)) ? media : undefined,
    replyTo: msg.replyTo?.id ?? null,
    forwarded: !!msg.forwarded,
  };
}

export async function queueInBackground(msg, token) {
  // Files still waiting to upload can't be sent from the background.
  if (!supported() || !token || msg.needsUpload) return;
  try {
    await Outbox.enqueue({
      id: msg.clientId,
      url: `${API_URL}/api/conversations/${msg.conversationId}/messages`,
      token,
      body: JSON.stringify(sendPayload(msg)),
    });
  } catch (err) {
    console.warn('Could not queue message in background', err);
  }
}

export function cancelBackground(clientId) {
  if (supported()) Outbox.cancel({ id: clientId }).catch(() => {});
}
