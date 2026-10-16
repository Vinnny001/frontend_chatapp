// End-to-end encryption with MLS (RFC 9420), via the ts-mls library.
//
// Every signed-in device is a member ("leaf") of each of its chats' encryption groups, and a
// message is encrypted ONCE for the whole group however many devices there are. Keys move
// forward with every message and every key change (epoch), and used keys are deleted:
//   - a stolen key can't decrypt earlier messages (forward secrecy);
//   - after the device that leaked a key updates its own keys, or is removed, the thief can't
//     decrypt later ones either (post-compromise security). Devices refresh their keys at least
//     daily, and signed-out devices are removed before the next message is sent.
// The server only orders key changes and relays ciphertext; it never holds a key.

import { api } from '../api.js';

// P-256 (not X25519/Ed25519): every Android WebView's built-in crypto supports it; older ones lack
// X25519/Ed25519, which this library would otherwise use when the browser has WebCrypto at all.
const SUITE = 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256';
const KEY_PACKAGE_TARGET = 40; // published for others to add this device while it's offline
const KEY_PACKAGE_REFILL = 15;
const UPDATE_EVERY_MS = 24 * 3600 * 1000; // fresh own keys at least once a day per chat
// The chat's devices and current epoch, kept between messages: the server says when they change
// (devices: "mls:roster"; epoch: "mls:commit", see noteEpoch), so sending needs no round trip.
const ROSTER_TTL_MS = 10 * 60_000;
// How much a device that was away can still read. It reads missed messages in order (each with
// the keys of its own epoch, see decryptMany), so these are only a safety net for messages that
// arrive out of order: keys of the last 32 key changes, up to 1000 skipped messages per sender,
// and jumping at most 5000 messages ahead. (Library defaults: 4, 10 and 200.)
const KEY_RETENTION = { retainKeysForEpochs: 32, retainKeysForGenerations: 1000, maximumForwardRatchetSteps: 5000 };
const LAST_RESORT = 'lr-'; // KeyPackage ids: the reusable one, for when the one-time ones run out

let M; // ts-mls
let ctx = null; // { userId, deviceId, db, impl, identity, config }
const rosters = new Map(); // convId -> { at, info }

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
export const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const wire = (m) => b64(M.encodeMlsMessage({ version: 'mls10', ...m }));
const unwire = (s) => M.decodeMlsMessage(unb64(s), 0)[0];
const epochOf = (g) => Number(g.state.groupContext.epoch);
const zero = (list) => list?.forEach((b) => M.zeroOutUint8Array(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One MLS operation at a time per chat (and across the app's copies on this device: tabs, the
// background one for notifications), always on the latest saved state: two operations on the
// same group state would fork it. Per chat, so a slow one (setting a chat up over the network)
// never holds up reading messages in another. `scope`: a chat id, or 'kps' (this device's
// KeyPackages).
const chains = new Map();
const lockedChat = (convId, fn) => locked(fn, convId);
export function locked(fn, scope) {
  const name = `chatapp-mls-${ctx.deviceId}-${scope}`;
  const run = () => (navigator.locks ? navigator.locks.request(name, () => fn()) : fn());
  const p = (chains.get(scope) || Promise.resolve()).then(run, run);
  chains.set(scope, p.catch(() => {}));
  return p;
}

// ------------------------------------------------------------------ setup

export async function init({ userId, deviceId, db, background = false }) {
  M ??= await import('ts-mls');
  const { defaultClientConfig } = await import('ts-mls/clientConfig.js');
  const impl = await M.getCiphersuiteImpl(M.getCiphersuiteFromName(SUITE), M.nobleCryptoProvider);
  ctx = { userId, deviceId, db, impl, identity: null, background };
  ctx.config = {
    ...defaultClientConfig,
    keyRetentionConfig: KEY_RETENTION,
    authService: { validateCredential: (cred, key) => checkCredential(cred, key) },
  };

  let identity = await db.get('kv', 'identity');
  if (!identity) {
    const kp = await impl.signature.keygen();
    identity = { publicKey: kp.publicKey, signKey: kp.signKey };
    await db.put('kv', 'identity', identity);
  }
  ctx.identity = identity;
  if (!(await db.get('kv', 'registered'))) {
    await api('/api/mls/identity', { method: 'POST', body: { key: b64(identity.publicKey) } });
    await db.put('kv', 'registered', true);
  }
  // Housekeeping in the background: reading messages never waits for it (a chat this device
  // was added to is joined when its first message is read, see decryptMany). The short-lived
  // background copy of the app (notifications) leaves it to the app.
  if (!background) {
    locked(() => topUpKeyPackages(), 'kps')
      .then(() => processWelcomes())
      .catch((err) => console.warn('[e2ee] key upkeep failed', err));
  }
}

export function stop() {
  ctx = null;
  rosters.clear();
}

export const active = () => !!ctx;

const credential = () => ({ credentialType: 'basic', identity: enc(`${ctx.userId}:${ctx.deviceId}`) });

async function newKeyPackage() {
  const kp = await M.generateKeyPackageWithKey(
    credential(),
    M.defaultCapabilities(),
    M.defaultLifetime,
    [],
    { publicKey: ctx.identity.publicKey, signKey: ctx.identity.signKey },
    ctx.impl
  );
  return { pub: kp.publicPackage, priv: kp.privatePackage };
}

/**
 * Keeps enough one-time KeyPackages on the server for others to add this device offline, plus
 * one "last resort" KeyPackage that can be used again (RFC 9420), so a device that stays away
 * long enough to run out can still be added to new chats.
 */
async function topUpKeyPackages() {
  const { count, lastResort } = await api('/api/mls/key-packages/count');
  const packages = [];
  if (!lastResort) {
    const kp = await newKeyPackage();
    const id = LAST_RESORT + hex(crypto.getRandomValues(new Uint8Array(14)));
    await ctx.db.put('kps', id, kp);
    packages.push({ id, data: wire({ keyPackage: kp.pub, wireformat: 'mls_key_package' }), lastResort: true });
  }
  for (let i = count < KEY_PACKAGE_REFILL ? count : KEY_PACKAGE_TARGET; i < KEY_PACKAGE_TARGET; i++) {
    const kp = await newKeyPackage();
    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    await ctx.db.put('kps', id, kp);
    packages.push({ id, data: wire({ keyPackage: kp.pub, wireformat: 'mls_key_package' }) });
  }
  if (packages.length) await api('/api/mls/key-packages', { method: 'POST', body: { packages } });
}

// ------------------------------------------------------------------ identities

/**
 * Who a group member really is: identity "userId:deviceId", signed with that device's key.
 * The key must be the one the device registered (pinned here the first time it's seen, so the
 * server can't swap in another key later).
 */
async function checkCredential(cred, signaturePublicKey) {
  if (cred.credentialType !== 'basic') return false;
  const [userId, deviceId] = dec(cred.identity).split(':');
  if (!userId || !deviceId) return false;
  const known = await deviceKey(deviceId);
  return !!known && known.userId === userId && known.key === b64(signaturePublicKey);
}

async function deviceKey(deviceId) {
  if (deviceId === ctx.deviceId) return { userId: ctx.userId, key: b64(ctx.identity.publicKey) };
  const pinned = await ctx.db.get('kv', `pin:${deviceId}`);
  if (pinned) return pinned;
  const { keys } = await api(`/api/mls/keys?devices=${deviceId}`);
  const k = keys.find((x) => x.deviceId === deviceId);
  if (!k) return null;
  const pin = { userId: k.userId, key: k.key };
  await ctx.db.put('kv', `pin:${deviceId}`, pin);
  return pin;
}

const identityOf = (leaf) => {
  const [userId, deviceId] = dec(leaf.credential.identity).split(':');
  return { userId, deviceId };
};

/** The devices currently in a group, with their leaf positions. */
function leavesOf(state) {
  const out = [];
  state.ratchetTree.forEach((node, i) => {
    if (node?.nodeType === 'leaf') out.push({ leafIndex: i / 2, ...identityOf(node.leaf) });
  });
  return out;
}

// ------------------------------------------------------------------ group state on this device

async function loadGroup(convId) {
  const rec = await ctx.db.get('groups', convId);
  if (!rec) return null;
  return { state: { ...M.decodeGroupState(rec.bytes, 0)[0], clientConfig: ctx.config }, meta: rec.meta || {} };
}

async function saveGroup(convId, g) {
  await ctx.db.put('groups', convId, { bytes: M.encodeGroupState(g.state), meta: g.meta });
}

/** The chat's encryption status and devices (cached briefly; dropped when devices change). */
async function rosterInfo(convId, { fresh = false } = {}) {
  const hit = rosters.get(convId);
  if (!fresh && hit && Date.now() - hit.at < ROSTER_TTL_MS) return hit.info;
  const info = await api(`/api/mls/${convId}`);
  rosters.set(convId, { at: Date.now(), info });
  return info;
}

/** Another device changed the chat's keys (to `epoch`): catch up before the next message. */
export function noteEpoch(convId, epoch) {
  const hit = rosters.get(convId);
  if (hit && hit.info.epoch < epoch) hit.info = { ...hit.info, epoch };
}

export function forgetRosters(convId) {
  if (convId) rosters.delete(convId);
  else rosters.clear();
}

/**
 * Applies the key changes this device missed (in order), all of them or up to epoch `upTo`
 * (to read a message with the keys it was sent with). Null if we were removed.
 */
async function catchUp(convId, g, { upTo = Infinity, known = null } = {}) {
  for (;;) {
    if (epochOf(g) >= upTo) return g;
    // `known`: key changes fetched earlier in the same go (fetched once, not once per epoch).
    let commits = known?.filter((c) => c.epoch >= epochOf(g)) || [];
    if (!commits.length) {
      ({ commits } = await api(`/api/mls/${convId}/commits?from=${epochOf(g)}`));
      known?.push(...commits);
    }
    let applied = 0;
    for (const c of commits) {
      if (epochOf(g) >= upTo) break;
      if (c.epoch !== epochOf(g)) continue;
      if (c.device === ctx.deviceId) {
        // Our own change was accepted but never saved here (the app closed in between):
        // this copy of the group is unusable. Rejoin.
        await ctx.db.del('groups', convId);
        return null;
      }
      const r = await M.processMessage(unwire(c.data), g.state, M.emptyPskIndex, M.acceptAll, ctx.impl);
      zero(r.consumed);
      g = { state: r.newState, meta: g.meta };
      applied++;
      if (g.state.groupActiveState?.kind === 'removedFromGroup') {
        await ctx.db.del('groups', convId);
        return null;
      }
    }
    if (applied) await saveGroup(convId, g);
    if (!applied || epochOf(g) >= upTo) return g; // (nothing more there yet, or far enough)
  }
}

/**
 * Joins the chats this device was added to while it was away. `only`: just that chat (called
 * while holding its lock); otherwise each chat's join takes that chat's lock.
 */
async function processWelcomes({ only } = {}) {
  const { welcomes } = await api('/api/mls/welcomes/mine');
  const mine = welcomes.filter((w) => !only || w.conversationId === only);
  for (const w of mine) {
    if (only) await useWelcome(w);
    else await locked(() => useWelcome(w), w.conversationId);
  }
  // Used KeyPackages are replaced in the background (not by the notifications' copy of the app).
  if (mine.length && !ctx.background) locked(() => topUpKeyPackages(), 'kps').catch(() => {});
  return mine.length;
}

async function useWelcome(w) {
  {
    try {
      const kp = await ctx.db.get('kps', w.keyId);
      const existing = await ctx.db.get('groups', w.conversationId);
      const have = existing ? Number(M.decodeGroupState(existing.bytes, 0)[0].groupContext.epoch) : -1;
      if (kp && have < w.epoch) {
        const state = await M.joinGroup(unwire(w.data).welcome, kp.pub, kp.priv, M.emptyPskIndex, ctx.impl, undefined, undefined, ctx.config);
        await saveGroup(w.conversationId, { state, meta: { joinedEpoch: w.epoch, updatedAt: Date.now() } });
      }
      if (kp && !w.keyId.startsWith(LAST_RESORT)) await ctx.db.del('kps', w.keyId); // (the last resort one is kept)
    } catch (err) {
      console.warn('[e2ee] could not use a welcome', err);
    }
    api(`/api/mls/welcomes/${w.id}`, { method: 'DELETE' }).catch(() => {}); // (not waited for)
  }
}

/** Sends a key change; 409 means the group moved on first (the caller catches up and retries). */
async function postCommit(convId, epoch, commitMessage, newState, welcomes = []) {
  const groupInfo = await M.createGroupInfoWithExternalPubAndRatchetTree(newState, [], ctx.impl);
  await api(`/api/mls/${convId}/commits`, {
    method: 'POST',
    body: { epoch, commit: wire(commitMessage), groupInfo: wire({ groupInfo, wireformat: 'mls_group_info' }), welcomes },
  });
}

/** Turns encryption on for a chat: this device creates the group (the next step adds everyone). */
async function startGroup(convId) {
  try {
    await api(`/api/mls/${convId}/start`, { method: 'POST' });
  } catch (e) {
    if (e.status === 409) return null; // someone else started it
    throw e;
  }
  const kp = await newKeyPackage();
  const state = await M.createGroup(enc(convId), kp.pub, kp.priv, [], ctx.impl, ctx.config);
  const g = { state, meta: { joinedEpoch: 0, updatedAt: 0 } };
  await saveGroup(convId, g);
  return g;
}

/** Joins a group by itself (nobody added this device, e.g. it was offline or new). */
async function externalJoin(convId, groupInfoB64) {
  const groupInfo = unwire(groupInfoB64).groupInfo;
  const epoch = Number(groupInfo.groupContext.epoch);
  const kp = await newKeyPackage();
  let joined;
  try {
    joined = await M.joinGroupExternal(groupInfo, kp.pub, kp.priv, false, ctx.impl, undefined, ctx.config);
  } catch {
    // This device is still in the group from before (its saved state was lost): replace it.
    joined = await M.joinGroupExternal(groupInfo, kp.pub, kp.priv, true, ctx.impl, undefined, ctx.config);
  }
  await postCommit(convId, epoch, { publicMessage: joined.publicMessage, wireformat: 'mls_public_message' }, joined.newState);
  const g = { state: joined.newState, meta: { joinedEpoch: epoch + 1, updatedAt: Date.now() } };
  await saveGroup(convId, g);
  return g;
}

/**
 * Makes the group match who should read the chat: adds devices that are missing, removes
 * signed-out devices and people who left, and refreshes this device's own keys once a day.
 */
/** The group already matches the chat's devices, and this device's keys are fresh enough. */
function inStep(g, info) {
  const wanted = new Set(info.devices.map((d) => d.deviceId));
  const leaves = leavesOf(g.state);
  const present = new Set(leaves.map((l) => l.deviceId));
  if ([...wanted].some((id) => !present.has(id) && id !== ctx.deviceId)) return false;
  if (leaves.some((l) => !wanted.has(l.deviceId) && l.deviceId !== ctx.deviceId)) return false;
  return Date.now() - (g.meta.updatedAt || 0) <= UPDATE_EVERY_MS;
}

async function reconcile(convId, g, info) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wanted = new Map(info.devices.map((d) => [d.deviceId, d]));
    const leaves = leavesOf(g.state);
    const present = new Set(leaves.map((l) => l.deviceId));
    const missing = [...wanted.keys()].filter((id) => !present.has(id) && id !== ctx.deviceId);
    const extra = leaves.filter((l) => !wanted.has(l.deviceId) && l.deviceId !== ctx.deviceId);
    const due = Date.now() - (g.meta.updatedAt || 0) > UPDATE_EVERY_MS;
    if (!missing.length && !extra.length && !due) return g;

    let claimed = [];
    if (missing.length) {
      ({ packages: claimed } = await api('/api/mls/key-packages/claim', {
        method: 'POST',
        body: { conversationId: convId, deviceIds: missing },
      }));
    }
    // Only KeyPackages that really belong to the device they're for.
    const adds = [];
    for (const p of claimed) {
      const keyPackage = unwire(p.data).keyPackage;
      const who = identityOf(keyPackage.leafNode);
      if (who.deviceId === p.deviceId && (await checkCredential(keyPackage.leafNode.credential, keyPackage.leafNode.signaturePublicKey))) {
        adds.push({ ...p, keyPackage });
      }
    }
    const proposals = [
      ...adds.map((p) => ({ proposalType: 'add', add: { keyPackage: p.keyPackage } })),
      ...extra.map((l) => ({ proposalType: 'remove', remove: { removed: l.leafIndex } })),
    ];
    if (!proposals.length && !due) return g; // missing devices had no KeyPackages: they'll join by themselves

    const epoch = epochOf(g);
    const c = await M.createCommit({ state: g.state, cipherSuite: ctx.impl }, { extraProposals: proposals, ratchetTreeExtension: true });
    const welcome = c.welcome ? wire({ welcome: c.welcome, wireformat: 'mls_welcome' }) : null;
    try {
      await postCommit(convId, epoch, c.commit, c.newState, welcome ? adds.map((p) => ({ deviceId: p.deviceId, keyId: p.keyId, data: welcome })) : []);
    } catch (e) {
      if (e.status !== 409) throw e;
      g = await catchUp(convId, g); // someone changed the group first: look again
      if (!g) return null;
      continue;
    }
    zero(c.consumed);
    g = { state: c.newState, meta: { ...g.meta, updatedAt: Date.now() } };
    await saveGroup(convId, g);
    return g;
  }
  throw new Error('Couldn’t update the encryption keys. Try again.');
}

/** Gets this device's group for a chat ready to send: joins or creates it as needed, catches up and reconciles. */
async function ready(convId) {
  for (let tries = 0; tries < 8; tries++) {
    const info = await rosterInfo(convId, { fresh: tries > 0 });
    // Usual case: nothing changed since the last message, so no network at all.
    if (tries === 0 && info.enabled) {
      const g = await loadGroup(convId);
      if (g && epochOf(g) >= info.epoch && inStep(g, info)) return { ...g, roster: info };
    }
    if (!info.enabled) {
      // Encryption is required: start now with the devices there are (members without one
      // get the messages sent again when they have one).
      const started = await startGroup(convId);
      if (!started) continue;
      const g = await reconcile(convId, started, info);
      if (g) return { ...g, roster: info };
      continue;
    }
    let g = await loadGroup(convId);
    if (!g && (await processWelcomes({ only: convId }))) g = await loadGroup(convId);
    if (g) g = await catchUp(convId, g);
    if (g && epochOf(g) < info.epoch) {
      // Away so long that the key changes it missed have expired: start again by rejoining.
      await ctx.db.del('groups', convId);
      g = null;
    }
    if (!g) {
      if (!info.groupInfo) {
        await sleep(700); // the device that turned encryption on hasn't sent its first key change yet
        continue;
      }
      try {
        g = await externalJoin(convId, info.groupInfo);
      } catch (e) {
        if (e.status === 409) continue;
        throw e;
      }
    }
    const done = await reconcile(convId, g, info);
    // (with the roster it was checked against: who should be able to read the chat)
    if (done) return { ...done, roster: info };
  }
  throw new Error('Encryption is still being set up for this chat. Try again in a moment.');
}

// ------------------------------------------------------------------ messages

/**
 * Members with no device in the group right now (signed out everywhere, or not set up yet):
 * a message encrypted now can't reach them, so it's sent again once they have a device. Uses
 * the roster the group was just checked against (the shared cache can be cleared meanwhile by
 * a "devices changed" event). Null when unknown (encrypted offline).
 */
function membersWithoutDevice(g) {
  const users = g.roster?.users;
  if (!users) return null;
  const present = new Set(leavesOf(g.state).map((l) => l.userId));
  return users.filter((u) => !present.has(u));
}

/**
 * Encrypts once for every device in the chat. Null: the chat isn't encrypted.
 * `missing`: members it couldn't reach (no device in the group).
 */
export async function encrypt(convId, payload, { offline = false } = {}) {
  // (Fetched before taking the lock, so decrypting never waits on the network for it.)
  if (!offline) await rosterInfo(convId).catch(() => {});
  return lockedChat(convId, async () => {
    const g = offline ? await loadGroup(convId) : await ready(convId);
    if (!g) return null;
    const m = await M.createApplicationMessage(g.state, enc(JSON.stringify(payload)), ctx.impl);
    zero(m.consumed);
    await saveGroup(convId, { state: m.newState, meta: g.meta });
    return {
      ciphertext: wire({ privateMessage: m.privateMessage, wireformat: 'mls_private_message' }),
      epoch: epochOf(g),
      missing: membersWithoutDevice(g),
    };
  });
}

/**
 * Decrypts a message: { state: 'ok', payload } | 'waiting' (not in the group yet) | 'before'
 * (sent before this device joined) | 'failed'.
 */
export async function decrypt(convId, e2ee, { id } = {}) {
  const key = id || '_';
  return (await decryptMany(convId, [{ id: key, e2ee, saved: !!id }])).get(key);
}

/**
 * Decrypts a chat's messages (oldest first) in one go: the group is loaded and saved once, and
 * each message is read with the keys of its own epoch (key changes are applied as they come).
 * Returns id -> result (as decrypt).
 */
export function decryptMany(convId, items) {
  return lockedChat(convId, async () => {
    const out = new Map();
    let g = await loadGroup(convId);
    if (!g && (await processWelcomes({ only: convId }))) g = await loadGroup(convId);
    let dirty = false;
    const known = []; // key changes, fetched once for the whole batch
    for (const it of items) {
      // Another copy of the app on this device (the background one that fills in
      // notifications, or another tab) may have read it already: its keys are gone then.
      if (it.saved !== false) {
        const rec = await ctx.db.get('plain', it.id);
        if (rec?.state === 'ok' && rec.fp === it.e2ee.ciphertext.slice(-32)) {
          out.set(it.id, { state: 'ok', payload: rec.p || { type: 'text', text: rec.text } });
          continue;
        }
      }
      if (!g) {
        out.set(it.id, { state: 'waiting' });
        continue;
      }
      if (it.e2ee.epoch < (g.meta.joinedEpoch ?? 0)) {
        out.set(it.id, { state: 'before' });
        continue;
      }
      if (it.e2ee.epoch > epochOf(g)) {
        if (dirty) await saveGroup(convId, g);
        dirty = false;
        g = await catchUp(convId, g, { upTo: it.e2ee.epoch, known });
        if (!g || it.e2ee.epoch > epochOf(g)) {
          out.set(it.id, { state: 'waiting' }); // removed, or the key change isn't there yet
          continue;
        }
      }
      try {
        const r = await M.processMessage(unwire(it.e2ee.ciphertext), g.state, M.emptyPskIndex, M.acceptAll, ctx.impl);
        zero(r.consumed);
        g = { state: r.newState, meta: g.meta };
        dirty = true;
        out.set(it.id, r.kind === 'applicationMessage' ? { state: 'ok', payload: JSON.parse(dec(r.message)) } : { state: 'failed' });
      } catch (err) {
        out.set(it.id, { state: 'failed', error: err.message });
      }
    }
    if (dirty) await saveGroup(convId, g);
    return out;
  });
}

/** Gets a chat's group ready in the background (opening a chat), so sending is instant. */
export const prepare = (convId) =>
  rosterInfo(convId)
    .catch(() => {})
    .then(() => locked(() => ready(convId), convId))
    .catch(() => null);

/** A welcome arrived: join that chat's group now. */
export const onWelcome = () => processWelcomes(); // (each chat's join takes that chat's lock)

// ------------------------------------------------------------------ calls

/** Signs with this device's identity key (call setup: proves the call's keys are mine). */
export async function sign(text) {
  return b64(await ctx.impl.signature.sign(ctx.identity.signKey, enc(text)));
}

/** Checks a signature by one of `userId`'s devices, using its pinned identity key. */
export async function verify(text, signature, deviceId, userId) {
  const known = await deviceKey(deviceId).catch(() => null);
  if (!known || known.userId !== userId) return false;
  try {
    return await ctx.impl.signature.verify(unb64(known.key), enc(text), unb64(signature));
  } catch {
    return false;
  }
}

export const deviceId = () => ctx?.deviceId || null;
