// What the rest of the app uses for end-to-end encryption.
//
// An encrypted message reaches the server as an opaque "text" message with an `e2ee`
// ciphertext; everything it contains travels inside: its kind, text or caption, the attachment
// (address and the file's own key), poll question and options, view-once and forwarded flags.
// `reveal(message)` fills all of that in from this device's saved copy, or queues the message
// for decryption (oldest first) and marks it `e2eeState: 'pending'`; listeners hear when it's
// done. A message can be decrypted only once, so the result is kept (in IndexedDB), and what
// this device sends is kept when it's sent (a sender can't decrypt its own message).

import * as mls from './mls.js';
import { dbName, deleteDb, openDb } from './db.js';
import { forgetMediaKeys, registerMediaKey } from './files.js';
import { MENTION_TOKEN } from '../mentions.js';
import { api } from '../api.js';
import { publishContacts, pullSync, startSync, stopSync } from './sync.js';

// Set by the app: where synced contacts go, and this phone's own address-book matches.
const appHooks = { onContacts: () => {}, ownContacts: () => null, onHistory: () => {} };
export function setSyncHooks(hooks) {
  Object.assign(appHooks, hooks);
}

let session = null; // { userId, deviceId, db }
// message id (or "c:"+clientId) -> { p: payload, fp, state, conv, sender, at }
const plain = new Map();
const queue = new Map();
const waiting = new Map(); // id -> [resolve] (revealNow)
const lastTry = new Map(); // id -> time of the last attempt that may succeed later
const listeners = new Set();
let draining = false;

const RETRY_AFTER_MS = 15_000;
const TRANSIENT = new Set(['waiting', 'retry']); // may work later: never saved

/** A short fingerprint of a ciphertext: an edit brings a new ciphertext (and a new decryption). */
const fpOf = (ciphertext) => ciphertext.slice(-32);
const payloadOf = (rec) => rec?.p || (rec?.text != null ? { type: 'text', text: rec.text } : null);

let starting = null; // { deviceId, promise }: one start per device, however often it's asked

// Whether encryption is running on this device: { state: 'starting' | 'ready' | 'error', message }.
let status = { state: 'idle' };
const statusListeners = new Set();
function setStatus(next) {
  status = next;
  statusListeners.forEach((fn) => fn(status));
}
export const getStatus = () => status;
export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Tells the server why encryption couldn't start here (so it can be looked into), and shows it. */
function failed(stage, err) {
  const message = String(err?.message || err || 'Unknown error').slice(0, 500);
  console.warn(`[e2ee] ${stage} failed:`, err);
  setStatus({ state: 'error', stage, message });
  api('/api/mls/diagnostic', { method: 'POST', body: { stage, message, browser: navigator.userAgent.slice(0, 300) } }).catch(() => {});
}

export function start({ userId, deviceId }) {
  if (!deviceId) return Promise.resolve();
  if (!window.indexedDB) {
    failed('storage', 'This browser has no IndexedDB storage (private mode or storage switched off)');
    return Promise.resolve();
  }
  if (starting?.deviceId === deviceId) return starting.promise;
  const promise = startNow({ userId, deviceId }).catch((err) => {
    failed('start', err);
    starting = null; // a later retry starts again (a failure is never kept)
  });
  starting = { deviceId, promise };
  return promise;
}

/** "Retry" after a failure. */
export function retryStart({ userId, deviceId }) {
  starting = null;
  return start({ userId, deviceId });
}

async function startNow({ userId, deviceId }) {
  setStatus({ state: 'starting' });
  await stop();
  let db;
  try {
    db = await openDb(dbName(userId, deviceId));
  } catch (err) {
    // The browser's own failure (e.g. Chrome's "Internal error." on damaged files): unreadable
    // data is lost anyway, so start this device's database over once. Not when another tab holds it.
    if (err instanceof DOMException) {
      console.warn('[e2ee] storage damaged, starting it over', err);
      await deleteDb(dbName(userId, deviceId));
      db = await openDb(dbName(userId, deviceId)).catch((again) => {
        failed('storage', again);
        return null;
      });
    } else failed('storage', err);
    if (!db) {
      starting = null;
      return;
    }
  }
  session = { userId, deviceId, db };
  for (const [id, rec] of await db.entries('plain')) {
    plain.set(id, rec);
    const p = payloadOf(rec);
    if (p?.media && !p.viewOnce) registerMediaKey(p.media);
  }
  try {
    await mls.init({ userId, deviceId, db });
    setStatus({ state: 'ready' });
    resendSoon(5000); // anything still waiting for someone's device
  } catch (err) {
    failed('keys', err);
    starting = null;
  }
  drainSoon();
}

/**
 * The encrypted channel between my own devices (history for a new device, contacts). Only for
 * devices that sync (the user chooses on a new device; Settings → Linked devices).
 */
export async function startOwnDevices() {
  if (!session || !mls.active()) return;
  await startSync({
    deviceId: session.deviceId,
    db: session.db,
    hooks: {
      records: () => [...plain.entries()],
      importRecords: importHistory,
      onContacts: (...args) => appHooks.onContacts(...args),
      ownContacts: () => appHooks.ownContacts(),
    },
  }).catch((err) => console.warn('[e2ee] own-devices channel unavailable', err));
}

export const stopOwnDevices = () => stopSync();

/** History from another of my devices: what it decrypted (I couldn't: I joined later). */
function importHistory(records) {
  let added = 0;
  for (const [id, rec] of records) {
    if (typeof id !== 'string' || id.startsWith('c:') || rec?.state !== 'ok') continue;
    if (plain.get(id)?.state === 'ok') continue;
    remember(id, rec);
    added++;
  }
  if (added) appHooks.onHistory(added);
}

export const pullOwnDevices = () => pullSync();
export const shareContacts = (entries) => publishContacts(entries);

/** Signed out: forget everything this device knew (its keys are worthless now anyway). */
export async function stop({ wipe = false } = {}) {
  const s = session;
  session = null;
  if (wipe) starting = null;
  stopSync();
  mls.stop();
  plain.clear();
  queue.clear();
  lastTry.clear();
  forgetMediaKeys();
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
  const p = payloadOf(rec);
  if (p?.media && !p.viewOnce) registerMediaKey(p.media);
  if (!TRANSIENT.has(rec.state)) session?.db.put('plain', id, rec).catch(() => {});
}

/** What an encrypted message contained, applied to the server's copy. */
function apply(m, p) {
  // View-once keeps its file address on the server (handed out once); the rest is in here.
  const media = p.media ? { ...p.media, url: p.media.url || m.media?.url } : null;
  return {
    ...m,
    type: p.type || 'text',
    text: p.text || '',
    media,
    ...(p.poll && {
      poll: {
        question: p.poll.question,
        options: p.poll.options.map((text, i) => ({ id: String(i), text })),
        multiple: !!p.poll.multiple,
        votes: m.poll?.votes || [], // votes are counted by the server (by option number)
      },
    }),
    viewOnce: !!(m.viewOnce || p.viewOnce),
    forwarded: !!(m.forwarded || p.forwarded),
    e2eeState: 'ok',
  };
}

/** Fills in an encrypted message (or queues it for decryption). */
export function reveal(m) {
  if (!m?.e2ee?.ciphertext || m.deletedForEveryone) return m;
  const fp = fpOf(m.e2ee.ciphertext);
  const rec = (m.id && plain.get(m.id)) || (m.clientId && plain.get(`c:${m.clientId}`));
  if (rec?.fp === fp && rec.state === 'ok') return { ...apply(m, payloadOf(rec)), e2eePending: !!rec.pendingFor?.length };
  if (rec?.fp === fp && !TRANSIENT.has(rec.state)) return { ...m, text: '', e2eeState: rec.state };
  enqueue(m);
  // An edit being decrypted keeps showing the previous version meanwhile.
  if (rec?.state === 'ok') return apply(m, payloadOf(rec));
  return { ...m, text: '', e2eeState: rec?.state || 'pending' };
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
        const where = { conv: m.conversationId, sender: m.sender, at: m.createdAt };
        const rec = res.state === 'ok' ? { p: res.payload || {}, fp, state: 'ok', ...where } : { fp, state: res.state, ...where };
        if (TRANSIENT.has(rec.state)) lastTry.set(m.id, Date.now());
        else lastTry.delete(m.id);
        if (rec.state !== 'ok' && plain.get(m.id)?.state === 'ok') {
          // A newer version (edit) couldn't be read: keep showing what we have.
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

/** Mentioned user ids (the server needs them for the notification). */
const mentionsIn = (text = '') => [...new Set([...text.matchAll(MENTION_TOKEN)].map((x) => x[2]))];

/**
 * Encrypts a message for a chat: payload { type, text, media, poll, viewOnce, forwarded }.
 * Null: this chat isn't encrypted (send it as before).
 */
export async function encryptMessage(convId, payload, { offline = false } = {}) {
  if (!enabled()) return null;
  const out = await mls.encrypt(convId, { v: 1, ...payload }, { offline });
  return out && { ...out, mentions: mentionsIn(payload.text) };
}

/** Is (or becomes) this chat encrypted? Sets up its group if needed. */
export async function willEncrypt(convId) {
  if (!enabled()) return false;
  return !!(await mls.prepare(convId));
}

/**
 * Saves what I sent (by clientId now, by message id once the server confirms it). `missing`:
 * members it couldn't reach yet (they had no device); it's sent again when they have one.
 */
export function rememberSent(key, payload, ciphertext, where = {}, missing = []) {
  remember(key, { p: { v: 1, ...payload }, fp: fpOf(ciphertext), state: 'ok', ...where, ...(missing.length && { pendingFor: missing }) });
  if (missing.length) resendSoon();
}

const RESEND_WITHIN_MS = 30 * 24 * 3600 * 1000; // as long as the server accepts it
let resendTimer = null;
let resending = null;

/** Devices changed somewhere (someone signed in): look at what's waiting for them shortly. */
export function resendSoon(delayMs = 3000) {
  clearTimeout(resendTimer);
  resendTimer = setTimeout(() => resendPending().catch((err) => console.warn('[e2ee] resend failed', err)), delayMs);
}

/**
 * My messages that couldn't reach someone (no device of theirs in the chat's group when sent):
 * once they have a device, encrypt them again for the group as it is now and replace the copy
 * on the server. Their new device reads the new copy; until then the message shows one tick.
 */
export function resendPending() {
  resending ??= (async () => {
    const due = [...plain.entries()].filter(
      ([id, rec]) => !id.startsWith('c:') && rec.pendingFor?.length && rec.sender === session?.userId && Date.now() - Date.parse(rec.at) < RESEND_WITHIN_MS
    );
    const byChat = new Map();
    for (const entry of due) byChat.set(entry[1].conv, [...(byChat.get(entry[1].conv) || []), entry]);
    for (const [convId, list] of byChat) {
      if (!session) return;
      mls.forgetRosters(convId);
      if (!(await mls.prepare(convId))) continue; // adds the devices that appeared
      // Oldest first, so they arrive in order.
      list.sort((a, b) => Date.parse(a[1].at) - Date.parse(b[1].at));
      for (const [id, rec] of list) {
        const out = await mls.encrypt(convId, rec.p);
        if (!out || out.missing.length >= rec.pendingFor.length) continue; // nobody new can read it yet
        try {
          await api(`/api/mls/${convId}/messages/${id}/resend`, { method: 'POST', body: { ciphertext: out.ciphertext, epoch: out.epoch } });
        } catch (err) {
          if (![403, 404, 410].includes(err.status)) throw err;
          out.missing = []; // gone, or not this device's to send: stop trying
        }
        const { pendingFor, ...rest } = rec;
        remember(id, { ...rest, fp: fpOf(out.ciphertext), ...(out.missing.length && { pendingFor: out.missing }) });
        const shown = { id, conversationId: convId, e2eePending: out.missing.length > 0, e2ee: { ciphertext: out.ciphertext, epoch: out.epoch, device: session.deviceId } };
        resendListeners.forEach((fn) => fn(shown));
      }
    }
  })().finally(() => (resending = null));
  return resending;
}

const resendListeners = new Set();
/** A message of mine was sent again: { id, conversationId, e2ee, e2eePending }. */
export function onResent(fn) {
  resendListeners.add(fn);
  return () => resendListeners.delete(fn);
}

/** What a message contained (for reply quotes and pins), or null. */
export function contentOf(id) {
  const rec = plain.get(id);
  return rec?.state === 'ok' ? payloadOf(rec) : null;
}

/** Text (or caption) of a message, '' if unknown. */
export const plainText = (id) => contentOf(id)?.text || '';

/** View once: the file's key is thrown away once it has been viewed. */
export function forgetViewOnceKey(id) {
  const rec = plain.get(id);
  const p = payloadOf(rec);
  if (!p?.media) return;
  remember(id, { ...rec, p: { ...p, media: { ...p.media, key: null, iv: null } } });
}

/** Encrypted messages this device has read, newest first: { id, conversationId, sender, createdAt, ...content }. */
export function localMessages({ conversationId } = {}) {
  const out = [];
  for (const [id, rec] of plain) {
    if (id.startsWith('c:') || rec.state !== 'ok' || !rec.conv) continue;
    if (conversationId && rec.conv !== conversationId) continue;
    const p = payloadOf(rec);
    out.push({ ...p, id, conversationId: rec.conv, sender: rec.sender, createdAt: rec.at, e2ee: true });
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export const onWelcome = () => (enabled() ? mls.onWelcome().then(retryWaiting).catch(() => {}) : Promise.resolve());
export const forgetRosters = (convId) => mls.forgetRosters(convId);
/** Opening a chat: set up / refresh its encryption group early. */
export const prepare = (convId) => (enabled() ? mls.prepare(convId) : Promise.resolve(null));

// ------------------------------------------------------------------ calls

/**
 * One-to-one calls: the media is encrypted between the two phones by WebRTC (DTLS-SRTP), keyed
 * by the certificates whose fingerprints are in each side's call setup. Signing those with the
 * device's identity key means the server relaying the setup can't swap them (no man in the middle).
 */
const fingerprintsOf = (sdp = '') => [...sdp.matchAll(/a=fingerprint:(\S+) (\S+)/g)].map((m) => `${m[1].toLowerCase()} ${m[2].toUpperCase()}`).sort().join(',');
const callText = (callId, sdp) => `chatapp-call:${callId}:${sdp.type}:${fingerprintsOf(sdp.sdp)}`;

export async function signCallSetup(callId, sdp) {
  if (!enabled() || !fingerprintsOf(sdp.sdp)) return null;
  return { device: mls.deviceId(), sig: await mls.sign(callText(callId, sdp)) };
}

/** true: signed by one of the peer's devices; false: missing or wrong. */
export async function verifyCallSetup(callId, sdp, auth, peerUserId) {
  if (!enabled() || !auth?.device || !auth?.sig || !fingerprintsOf(sdp.sdp)) return false;
  return mls.verify(callText(callId, sdp), auth.sig, auth.device, peerUserId);
}

/**
 * Group calls: one random media key per call, shared with the group inside its MLS group (so
 * neither the server nor LiveKit can read it), kept on this device for the call.
 */
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

export async function rememberedCallKey(callId) {
  return (await session?.db.get('kv', `callkey:${callId}`)) || null;
}

export async function shareCallKey(convId, callId, key) {
  const out = await mls.encrypt(convId, { v: 1, callKey: key, callId });
  if (!out) throw new Error('This chat isn’t end-to-end encrypted');
  await session.db.put('kv', `callkey:${callId}`, key);
  return out; // { ciphertext, epoch } for the server
}

export function newCallKey() {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

/** Reads the call's key from the encrypted copies shared so far (null if none is readable here). */
export async function readCallKey(convId, callId, keys) {
  const known = await rememberedCallKey(callId);
  if (known) return known;
  for (const k of [...keys].reverse()) {
    if (k.device === mls.deviceId()) continue;
    const res = await mls.decrypt(convId, { ciphertext: k.ciphertext, epoch: k.epoch }).catch(() => null);
    if (res?.state === 'ok' && res.payload?.callId === callId && res.payload.callKey) {
      await session.db.put('kv', `callkey:${callId}`, res.payload.callKey);
      return res.payload.callKey;
    }
  }
  return null;
}

// Development builds only: lets the automated tests reach this module in the running app.
if (import.meta.env.DEV) window.__e2ee = { signCallSetup, verifyCallSetup, enabled, shareContacts: (e) => publishContacts(e) };
