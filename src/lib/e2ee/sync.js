// The encrypted channel between this user's own devices: an MLS group of just their devices
// (a hidden "self" conversation on the server, which only relays ciphertext). Used for:
//   - history: a newly linked device asks; another of my devices sends it the messages it has
//     decrypted from the last 90 days (old encrypted messages can't be decrypted again by a
//     new device: their keys are gone, by design);
//   - contacts: each phone shares the names from its address book, so every device of mine
//     shows the same names, and keeps them up to date when they change.

import * as mls from './mls.js';
import { api } from '../api.js';
import { seal, unseal } from './link.js';

const HISTORY_DAYS = 90;
const ANSWER_WITHIN_MS = 7 * 24 * 3600 * 1000;
const CHUNK_CHARS = 120_000;

let ctx = null; // { deviceId, db, convId, hooks }
let pulling = null;

/**
 * hooks: { records(): [[id, rec]] (decrypted messages), importRecords(list), onContacts(deviceId,
 * entries, at), ownContacts(): entries | null }
 */
export async function startSync({ deviceId, db, hooks }) {
  const { conversationId } = await api('/api/mls/self', { method: 'POST' });
  ctx = { deviceId, db, convId: conversationId, hooks };
  await mls.prepare(conversationId); // join (or create) my own devices' group
  await pullSync();
  if (!ctx) return;
  // A device asks for history once, when it's new (naming the QR code it was linked with, if any).
  const link = (await db.get('kv', 'linkKey'))?.requestId;
  if (!(await db.get('kv', 'historyAsked')) && (await send({ kind: 'history-request', device: deviceId, ...(link && { link }) }))) {
    await db.put('kv', 'historyAsked', Date.now());
  }
  publishContacts(hooks.ownContacts?.());
}

export function stopSync() {
  ctx = null;
}

async function send(body) {
  if (!ctx) return false;
  const out = await mls.encrypt(ctx.convId, { v: 1, sync: body });
  if (!out) return false;
  await api('/api/mls/sync', { method: 'POST', body: { ciphertext: out.ciphertext, epoch: out.epoch } });
  return true;
}

/** Reads what my other devices sent since last time (also on every "mls:sync" event). */
export function pullSync() {
  if (!ctx) return Promise.resolve();
  pulling ??= pullNow()
    .catch((err) => console.warn('[e2ee] own-devices sync failed', err))
    .finally(() => (pulling = null));
  return pulling;
}

async function pullNow() {
  for (;;) {
    if (!ctx) return;
    const after = (await ctx.db.get('kv', 'syncAfter')) || '';
    const { messages } = await api(`/api/mls/sync${after ? `?after=${after}` : ''}`);
    for (const m of messages) {
      if (!ctx) return;
      if (m.device !== ctx.deviceId) {
        const res = await mls.decrypt(ctx.convId, { ciphertext: m.ciphertext, epoch: m.epoch }).catch(() => ({ state: 'failed' }));
        if (res.state === 'waiting') return; // not in the group yet: read it later
        if (res.state === 'ok' && res.payload?.sync) await handle(res.payload.sync, m).catch((e) => console.warn('[e2ee] sync message', e));
      }
      await ctx.db.put('kv', 'syncAfter', m.id);
    }
    if (messages.length < 50) return;
  }
}

async function handle(body, m) {
  if (body.kind === 'history-request' && body.device !== ctx.deviceId) {
    if (Date.now() - Date.parse(m.at) > ANSWER_WITHIN_MS) return;
    if (await ctx.db.get('kv', `answered:${body.device}`)) return;
    // Linked by scanning its QR code here: seal the history to the key that code carried.
    const sealTo = body.link ? await ctx.db.get('kv', `link:${body.link}`) : null;
    await sendHistory(body.device, sealTo && { publicKey: sealTo, context: `${body.device}:${body.link}` });
    // and my contacts (it couldn't read what I shared before it joined)
    const last = await ctx.db.get('kv', 'contactsList');
    if (last) await send({ kind: 'contacts', entries: last }).catch(() => {});
    await ctx.db.put('kv', `answered:${body.device}`, Date.now());
  } else if (body.kind === 'history' && body.to === ctx.deviceId) {
    if (body.sealed) {
      const key = await ctx.db.get('kv', 'linkKey');
      if (!key) return;
      ctx.hooks.importRecords(await unseal(key.privateJwk, body.sealed, `${ctx.deviceId}:${key.requestId}`));
    } else ctx.hooks.importRecords(body.records || []);
  } else if (body.kind === 'contacts') {
    ctx.hooks.onContacts(m.device, body.entries || [], m.at);
  }
}

/**
 * What I've decrypted from the last 90 days, for a newly linked device of mine. `sealTo`
 * ({ publicKey, context }): it was linked by QR code, so only that device can open it.
 */
async function sendHistory(to, sealTo) {
  const since = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
  const records = ctx.hooks
    .records()
    .filter(([id, rec]) => !id.startsWith('c:') && rec.state === 'ok' && rec.conv && Date.parse(rec.at) >= since && !rec.p?.viewOnce);
  // In pieces small enough for one message each.
  const parts = [];
  let current = [];
  let size = 0;
  for (const r of records) {
    const n = JSON.stringify(r).length;
    if (size + n > CHUNK_CHARS && current.length) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(r);
    size += n;
  }
  if (current.length) parts.push(current);
  if (!parts.length) parts.push([]);
  for (let i = 0; i < parts.length; i++) {
    const content = sealTo ? { sealed: await seal(sealTo.publicKey, parts[i], sealTo.context) } : { records: parts[i] };
    await send({ kind: 'history', to, part: i + 1, parts: parts.length, ...content });
  }
}

/** Shares this phone's address-book matches with my other devices (only when they changed). */
export async function publishContacts(entries) {
  if (!ctx || !entries) return;
  const list = entries
    .map((e) => ({ name: e.name, phone: e.phone, user: { id: e.user.id, username: e.user.username, avatarUrl: e.user.avatarUrl, phone: e.user.phone } }))
    .sort((a, b) => a.user.id.localeCompare(b.user.id));
  const hash = JSON.stringify(list);
  if ((await ctx.db.get('kv', 'contactsSent')) === hash) return;
  if (await send({ kind: 'contacts', entries: list }).catch(() => false)) {
    await ctx.db.put('kv', 'contactsSent', hash);
    await ctx.db.put('kv', 'contactsList', list); // re-sent to a device that syncs later
  }
}
