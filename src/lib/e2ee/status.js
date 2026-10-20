// Status updates, end-to-end encrypted. Each update is sealed once with a random one-time key
// (AES-256-GCM), and that key is sealed again to each allowed device's status key (ECDH P-256,
// see link.js), one envelope per device. A device's status key is signed with its encryption
// identity, and checked against the identity pinned here (so the server can't slip in its
// own). A viewer only ever gets the envelope for its own device: it learns nothing about who
// else can see the update.

import * as mls from './mls.js';
import { api } from '../api.js';
import { newLinkKey, seal, unseal } from './link.js';

const keyText = (deviceId, pub) => `chatapp-status-key:${deviceId}:${pub}`;
const context = (deviceId) => `chatapp-status:${deviceId}`;

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const dec = new TextDecoder();

/** This device's status key: made once, published with a signature by the device's identity. */
export async function ensureStatusKey(db) {
  let key = await db.get('kv', 'statusKey');
  if (!key) {
    key = await newLinkKey();
    await db.put('kv', 'statusKey', key);
  }
  if (await db.get('kv', 'statusKeyPublished')) return;
  const sig = await mls.sign(keyText(mls.deviceId(), key.publicKey));
  await api('/api/status/key', { method: 'PUT', body: { pub: key.publicKey, sig } });
  await db.put('kv', 'statusKeyPublished', true);
}

/** Seals an update for everyone allowed to see it (and my own devices). → { id, createdAt, expiresAt, audience } */
export async function post(db, payload) {
  const { devices } = await api('/api/status/keys');
  // Only keys signed by the device's own (pinned) identity.
  const checked = await Promise.all(devices.map(async (d) => ((await mls.verify(keyText(d.deviceId, d.pub), d.sig, d.deviceId, d.userId)) ? d : null)));
  const targets = checked.filter(Boolean);
  if (!targets.some((d) => d.deviceId === mls.deviceId())) throw new Error('Encryption isn’t ready on this device yet. Try again in a moment.');

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ v: 1, ...payload }))));
  const content = b64(new Uint8Array([...iv, ...ct]));
  const k = b64(raw);
  raw.fill(0);
  const envelopes = await Promise.all(
    targets.map(async (d) => ({ device: d.deviceId, data: btoa(JSON.stringify(await seal(d.pub, { k }, context(d.deviceId)))) }))
  );
  const out = await api('/api/status', { method: 'POST', body: { content, envelopes } });
  await db.put('plain', `st:${out.id}`, { p: { v: 1, ...payload }, state: 'ok', at: out.createdAt }); // (no need to open my own again)
  return out;
}

/** What an update says, or null (not sealed for this device: it was linked after it was posted). */
export async function open(db, status) {
  const saved = await db.get('plain', `st:${status.id}`);
  if (saved?.state === 'ok') return saved.p;
  if (!status.envelope) return null;
  const mine = await db.get('kv', 'statusKey');
  if (!mine) return null;
  const { k } = await unseal(mine.privateJwk, JSON.parse(atob(status.envelope)), context(mls.deviceId()));
  const bytes = unb64(status.content);
  const key = await crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  const payload = JSON.parse(dec.decode(pt));
  await db.put('plain', `st:${status.id}`, { p: payload, state: 'ok', at: status.createdAt });
  return payload;
}

/** Updates expire after a day: forget what was decrypted for them (kept a little longer). */
export async function forgetOld(db) {
  const before = Date.now() - 2 * 24 * 3600 * 1000;
  for (const [id, rec] of await db.entries('plain')) {
    if (typeof id === 'string' && id.startsWith('st:') && Date.parse(rec.at) < before) await db.del('plain', id);
  }
}
