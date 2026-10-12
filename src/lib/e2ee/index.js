// What the rest of the app uses for end-to-end encryption.
//
// Encrypted messages arrive from the server with an empty text and an `e2ee` ciphertext.
// `reveal(message)` fills in the text from this device's saved copy, or queues the message
// for decryption (oldest first) and marks it `e2eeState: 'pending'`; listeners hear when it's
// done. Messages this device sent are saved in plain form when they're sent (a sender can't
// decrypt its own message).

import * as mls from './mls.js';
import { dbName, deleteDb, openDb } from './db.js';
import { MENTION_TOKEN } from '../mentions.js';

let session = null; // { userId, deviceId, db }
const plain = new Map(); // message id (or "c:"+clientId) -> { text, fp, state }
const queue = new Map();
const waiting = new Map(); // id -> [resolve] (revealNow)
const lastTry = new Map(); // id -> time of the last attempt that may succeed later
const listeners = new Set();
let draining = false;

const RETRY_AFTER_MS = 15_000;
const TRANSIENT = new Set(['waiting', 'retry']); // may work later: never saved

/** A short fingerprint of a ciphertext: an edit brings a new ciphertext (and a new decryption). */
const fpOf = (ciphertext) => ciphertext.slice(-32);

let starting = null; // { deviceId, promise }: one start per device, however often it's asked

export function start({ userId, deviceId }) {
  if (!deviceId || !window.indexedDB) return Promise.resolve();
  if (starting?.deviceId === deviceId) return starting.promise;
  const promise = startNow({ userId, deviceId });
  starting = { deviceId, promise };
  return promise;
}

async function startNow({ userId, deviceId }) {
  await stop();
  const db = await openDb(dbName(userId, deviceId));
  session = { userId, deviceId, db };
  for (const [id, rec] of await db.entries('plain')) plain.set(id, rec);
  try {
    await mls.init({ userId, deviceId, db });
  } catch (err) {
    console.warn('[e2ee] setup failed; messages stay unencrypted on this device for now', err);
  }
  drainSoon();
}

/** Signed out: forget everything this device knew (its keys are worthless now anyway). */
export async function stop({ wipe = false } = {}) {
  const s = session;
  session = null;
  if (wipe) starting = null;
  mls.stop();
  plain.clear();
  queue.clear();
  lastTry.clear();
  if (s) {
    s.db.close();
    if (wipe) await deleteDb(dbName(s.userId, s.deviceId));
  }
}

export const enabled = () => !!session && mls.active();

export function onRevealed(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function remember(id, rec) {
  plain.set(id, rec);
  if (!TRANSIENT.has(rec.state)) session?.db.put('plain', id, rec).catch(() => {});
}

/** The plain text I know for a message id ('' if none). */
export const plainText = (id) => plain.get(id)?.text || '';

/** Fills in an encrypted message's text (or queues it for decryption). */
export function reveal(m) {
  if (!m?.e2ee?.ciphertext || m.deletedForEveryone) return m;
  const fp = fpOf(m.e2ee.ciphertext);
  const rec = (m.id && plain.get(m.id)) || (m.clientId && plain.get(`c:${m.clientId}`));
  if (rec?.fp === fp && rec.state === 'ok') {
    return m.text === rec.text && m.e2eeState === 'ok' ? m : { ...m, text: rec.text, e2eeState: 'ok' };
  }
  if (rec?.fp === fp && !TRANSIENT.has(rec.state)) return { ...m, text: '', e2eeState: rec.state };
  enqueue(m);
  // An edit being decrypted keeps showing the previous text meanwhile.
  return { ...m, text: rec?.state === 'ok' ? rec.text : '', e2eeState: rec?.state === 'ok' ? 'ok' : rec?.state || 'pending' };
}

/** Like reveal, but waits (a few seconds at most) for the decryption: new messages, notifications. */
export function revealNow(m, timeoutMs = 8000) {
  const first = reveal(m);
  if (first.e2eeState === 'ok' || !m?.e2ee || !session) return Promise.resolve(first);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(reveal(m)), timeoutMs);
    waiting.set(m.id, [...(waiting.get(m.id) || []), () => (clearTimeout(timer), resolve(reveal(m)))]);
  });
}

function enqueue(m) {
  if (!session || !m.id || queue.has(m.id)) return;
  const at = lastTry.get(m.id);
  if (at && Date.now() - at < RETRY_AFTER_MS) return;
  queue.set(m.id, m);
  drainSoon();
}

function drainSoon() {
  if (!draining && queue.size) setTimeout(drain, 0);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.size && session) {
      // Oldest first: keys move forward with every message.
      const batch = [...queue.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      queue.clear();
      for (const m of batch) {
        if (!session) return;
        const fp = fpOf(m.e2ee.ciphertext);
        let res;
        if (m.e2ee.device === session.deviceId) res = { state: 'own' }; // sent from here, but the saved copy is gone
        else if (!mls.active()) res = { state: 'waiting' };
        else res = await mls.decrypt(m.conversationId, m.e2ee).catch((e) => ({ state: e?.status === 0 ? 'retry' : 'failed', error: e?.message }));
        const rec = res.state === 'ok' ? { text: String(res.payload?.text ?? ''), fp, state: 'ok' } : { text: '', fp, state: res.state };
        if (TRANSIENT.has(rec.state)) lastTry.set(m.id, Date.now());
        else lastTry.delete(m.id);
        if (rec.state !== 'ok' && plain.get(m.id)?.state === 'ok') {
          // A newer version (edit) couldn't be read: keep showing the text we have.
          if (!TRANSIENT.has(rec.state)) plain.set(m.id, { ...plain.get(m.id), fp });
        } else remember(m.id, rec);
        const shown = reveal(m);
        listeners.forEach((fn) => fn(shown));
        (waiting.get(m.id) || []).forEach((done) => done());
        waiting.delete(m.id);
      }
    }
  } finally {
    draining = false;
  }
}

/** Messages that couldn't be read yet (not in the group, offline): try again now. */
export function retryWaiting() {
  lastTry.clear();
}

/** Encrypts a text message for a chat. Null: this chat isn't encrypted (send it as before). */
export async function encryptText(convId, text, { offline = false } = {}) {
  if (!enabled()) return null;
  const out = await mls.encrypt(convId, { v: 1, text }, { offline });
  return out && { ...out, mentions: [...new Set([...text.matchAll(MENTION_TOKEN)].map((x) => x[2]))] };
}

/** Saves what I sent (by clientId now, by message id once the server confirms it). */
export function rememberSent(key, text, ciphertext) {
  remember(key, { text, fp: fpOf(ciphertext), state: 'ok' });
}

export const onWelcome = () => (enabled() ? mls.onWelcome().then(retryWaiting).catch(() => {}) : Promise.resolve());
export const forgetRosters = (convId) => mls.forgetRosters(convId);
/** Opening a chat: set up / refresh its encryption group early. */
export const prepare = (convId) => (enabled() ? mls.prepare(convId) : Promise.resolve(null));
