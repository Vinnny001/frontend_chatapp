import { Capacitor, registerPlugin } from '@capacitor/core';
import { API_URL } from './config.js';
import { writeNativeFile } from './deviceFiles.js';

// Native background sender that delivers a queued message as soon as the phone is back
// online, even if the app has been closed: Android WorkManager (OutboxPlugin.java) and iOS
// background URLSession transfers (OutboxPlugin.swift). Photos, videos and voice notes are
// copied into native storage so it can upload them itself. The server dedupes by clientId,
// so it is harmless if the app also sends the same message itself.
const Outbox = registerPlugin('Outbox');
const supported = () => ['android', 'ios'].includes(Capacitor.getPlatform());

// Files already copied for the background sender in this session (copying is the slow part).
const copied = new Set();

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

/**
 * Hands a queued message to the background sender. `getFile` returns the not-yet-uploaded
 * file for photo/video/voice messages (from memory or on-device storage).
 */
export async function queueInBackground(msg, token, getFile) {
  if (!supported() || !token) return;
  const job = {
    id: msg.clientId,
    url: `${API_URL}/api/conversations/${msg.conversationId}/messages`,
    token,
    body: JSON.stringify(sendPayload(msg)),
  };
  try {
    if (msg.needsUpload) {
      const file = await getFile?.();
      if (!file) return; // nothing we can hand over; the app sends it when it's open again
      const filePath = `outbox/${msg.clientId}`;
      if (!copied.has(msg.clientId)) {
        await writeNativeFile(filePath, file);
        copied.add(msg.clientId);
      }
      Object.assign(job, {
        uploadUrl: `${API_URL}/api/uploads`,
        filePath,
        fileName: msg.media?.name || file.name || 'file',
        mime: msg.media?.mime || file.type || 'application/octet-stream',
        mediaExtra: JSON.stringify(msg.media?.duration ? { duration: msg.media.duration } : {}),
      });
    }
    await Outbox.enqueue(job);
  } catch (err) {
    console.warn('Could not queue message in background', err);
  }
}

/** Messages the background sender delivered while the app was closed (server replies). */
export async function takeDeliveredInBackground() {
  if (!supported()) return [];
  try {
    const { replies } = await Outbox.takeDelivered();
    return replies
      .map((r) => {
        try {
          return JSON.parse(r).message;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The app delivered it itself: drop the background job (and its copied file). */
export function cancelBackground(clientId) {
  if (!supported()) return;
  copied.delete(clientId);
  Outbox.cancel({ id: clientId }).catch(() => {});
}
