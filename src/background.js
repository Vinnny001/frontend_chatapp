// The app's encryption without its screens, for the phone's notifications (like WhatsApp):
// Android loads this page in a hidden WebView (BackgroundCrypto.java) when a message arrives or
// a reply is typed in a notification, while ChatApp itself isn't open. It shares the app's
// storage (same origin), so it uses this device's keys and saves what it decrypts for the app.
//
// Native calls window.__bg.decrypt / reply and gets the answer through ChatAppBg.done(id, json).

import { api, setApiToken } from './lib/api.js';
import { storage } from './lib/storage.js';
import { tokenDeviceId } from './lib/device.js';
import { MENTION_TOKEN } from './lib/mentions.js';
import { sendPayload } from './lib/outbox.js';
import * as e2ee from './lib/e2ee/index.js';

const native = window.ChatAppBg;
const answer = (id, result) => native?.done(id, JSON.stringify(result));

let ready = null;
/** This device's encryption, started once per page. */
function ensure() {
  ready ??= (async () => {
    const token = storage.get('auth.token');
    const user = storage.get('auth.user');
    if (!token || !user?.id) throw new Error('Signed out');
    setApiToken(token);
    await e2ee.start({ userId: user.id, deviceId: tokenDeviceId(token), background: true });
    if (!e2ee.enabled()) throw new Error(e2ee.getStatus().message || 'Encryption isn’t running');
    return user;
  })().catch((err) => {
    ready = null; // try again next time
    throw err;
  });
  return ready;
}

const LABELS = { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', audio: '🎵 Audio' };

/** What the notification says for a decrypted message. */
function preview(m) {
  const text = (m.text || '').replace(MENTION_TOKEN, (_, label) => `@${label}`);
  if (m.type === 'poll') return `📊 ${m.poll?.question || 'Poll'}`;
  if (m.viewOnce) return m.type === 'video' ? '🎥 Video (view once)' : '📷 Photo (view once)';
  if (m.type === 'file') return `📄 ${m.media?.name || 'Document'}`;
  if (LABELS[m.type]) return text ? `${LABELS[m.type]} · ${text}` : LABELS[m.type];
  return text;
}

/** The message from the push, or else from the server (pushes leave out long ones). */
async function messageFor(conversationId, messageId, pushed) {
  if (pushed?.e2ee) return pushed;
  const { messages } = await api(`/api/conversations/${conversationId}/messages?limit=50`);
  return messages.find((m) => m.id === messageId) || null;
}

window.__bg = {
  /** → { ok, text } (the notification's text) or { ok: false, error }. */
  async decrypt(id, conversationId, messageId, pushedJson) {
    try {
      await ensure();
      const m = await messageFor(conversationId, messageId, pushedJson ? JSON.parse(pushedJson) : null);
      if (!m?.e2ee) return answer(id, { ok: false, error: 'not found' });
      const shown = await e2ee.revealNow(m, 10_000);
      if (shown.e2eeState !== 'ok') {
        console.warn('[bg] could not decrypt', messageId, shown.e2eeState);
        return answer(id, { ok: false, error: shown.e2eeState });
      }
      answer(id, { ok: true, text: preview(shown) });
    } catch (err) {
      console.warn('[bg] decrypt failed', err?.message || err);
      answer(id, { ok: false, error: String(err?.message || err) });
    }
  },

  /** A reply typed in the notification: encrypted here and sent. → { ok } or { ok: false, error }. */
  async reply(id, conversationId, text) {
    try {
      const user = await ensure();
      const payload = { type: 'text', text };
      const out = await e2ee.encryptMessage(conversationId, payload);
      if (!out) throw new Error('Couldn’t encrypt the reply');
      const clientId = `n${crypto.randomUUID().replace(/-/g, '')}`;
      const body = sendPayload({ clientId, e2eeOut: { ...out, payload } });
      // Saved before it's sent: the app (if it's running) may get the message first.
      e2ee.rememberSent(`c:${clientId}`, payload, out.ciphertext, { conv: conversationId, sender: user.id, at: new Date().toISOString() });
      const { message } = await api(`/api/conversations/${conversationId}/messages`, { method: 'POST', body });
      // Kept like any message sent from the app (a sender can't decrypt its own message).
      e2ee.rememberSent(message.id, payload, out.ciphertext, { conv: conversationId, sender: user.id, at: message.createdAt }, out.missing);
      answer(id, { ok: true });
    } catch (err) {
      answer(id, { ok: false, error: String(err?.message || err) });
    }
  },
};

native?.ready();
