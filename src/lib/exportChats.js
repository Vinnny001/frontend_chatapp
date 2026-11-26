import { api } from './api.js';
import { allStoredMessages } from './localdb.js';
import { plainMentions } from './mentions.js';
import * as e2ee from './e2ee/index.js';
import { conversationTitle } from '../store/chat.js';

// Chat export as JSON. Messages are end-to-end encrypted, so the export is made here on the
// device: the chat's messages are fetched (or read from the device when offline), decrypted,
// and written out as a file. Nothing readable ever goes to the server.

const PAGE = 100;
const isNetworkError = (e) => e?.status === 0 || /respond|connect|network|fetch/i.test(e?.message || '');

/** The chat's messages between `from` and `to` (ISO strings, either may be empty), oldest first. */
async function messagesOf(convId, { from = '', to = '' } = {}) {
  try {
    const out = [];
    let before = to ? new Date(Date.parse(to) + 1).toISOString() : '';
    for (;;) {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (before) q.set('before', before);
      const { messages, hasMore } = await api(`/api/conversations/${convId}/messages?${q}`);
      out.unshift(...messages.filter((m) => !from || m.createdAt >= from));
      if (!hasMore || !messages.length || (from && messages[0].createdAt < from)) break;
      before = messages[0].createdAt;
    }
    return out;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    // Offline: what's saved on this device.
    return allStoredMessages(convId, { from: from || '', to: to || '￿' });
  }
}

/** Decrypted copies, a batch at a time (each waits a few seconds at most). */
async function decrypted(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i += 50) {
    out.push(...(await Promise.all(messages.slice(i, i + 50).map((m) => (m.e2ee ? e2ee.revealNow(m, 6000) : m)))));
  }
  return out;
}

function nameOf(conv, id, me) {
  if (!id) return null;
  if (id === me) return 'You';
  return conv.participants.find((p) => p.id === id)?.name || 'Someone';
}

/** What a new device needs to show this message again (restoring a backup): its content and which copy it is. */
function restoreData(m) {
  if (!m.e2ee?.ciphertext || m.e2eeState !== 'ok' || m.deletedForEveryone || m.viewOnce) return undefined;
  return {
    fp: e2ee.fingerprint(m.e2ee.ciphertext),
    p: {
      type: m.type,
      text: m.text || '',
      ...(m.media && { media: m.media }),
      ...(m.poll && { poll: { question: m.poll.question, options: m.poll.options.map((o) => o.text), multiple: !!m.poll.multiple } }),
      ...(m.forwarded && { forwarded: true }),
      ...(m.statusRef && { statusRef: m.statusRef }),
      ...(m.quoteRef && { quoteRef: m.quoteRef }),
    },
  };
}

function messageJson(m, conv, me, { restore = false } = {}) {
  const unreadable = m.e2ee && m.e2eeState && m.e2eeState !== 'ok';
  return {
    id: m.id,
    sentAt: m.createdAt,
    sender: m.sender ? { id: m.sender, name: nameOf(conv, m.sender, me) } : null,
    type: m.type,
    ...(m.deletedForEveryone
      ? { deleted: true }
      : {
          text: unreadable ? null : plainMentions(m.text || '', conv, me) || undefined,
          ...(unreadable && { note: 'Couldn’t be decrypted on this device' }),
          ...(m.media && !m.viewOnce && { file: { name: m.media.name || null, mime: m.media.mime || null, size: m.media.size || null } }),
          ...(m.viewOnce && { viewOnce: true }),
          ...(m.poll && { poll: { question: m.poll.question, options: m.poll.options.map((o) => ({ text: o.text, votes: m.poll.votes.filter((v) => v.option === o.id).length })) } }),
          ...(m.call && { call: { kind: m.call.kind, status: m.call.status, duration: m.call.duration || 0 } }),
        }),
    ...(m.replyTo?.id && { replyTo: m.replyTo.id }),
    ...(m.forwarded && { forwarded: true }),
    ...(m.editedAt && { editedAt: m.editedAt }),
    ...(m.reactions?.length && { reactions: m.reactions.map((r) => ({ emoji: r.emoji, by: nameOf(conv, r.user, me) })) }),
    ...(restore && restoreData(m) && { restore: restoreData(m) }),
  };
}

/** One chat as an object for the export (range optional: { from, to } as ISO strings). */
export async function chatExport(conv, me, range = {}, { restore = false } = {}) {
  const messages = (await decrypted(await messagesOf(conv.id, range))).filter((m) => m.type !== 'system' || m.text);
  return {
    id: conv.id,
    type: conv.type,
    title: conversationTitle(conv, me),
    participants: conv.participants.map((p) => ({ id: p.id, name: p.id === me ? 'You' : p.name, ...(p.username && { username: p.username }) })),
    ...((range.from || range.to) && { range: { from: range.from || null, to: range.to || null } }),
    messageCount: messages.length,
    messages: messages.map((m) => messageJson(m, conv, me, { restore })),
  };
}

const fileSafe = (s) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'chat';
const stamp = () => new Date().toISOString().slice(0, 10);

/** The export file for one or more chats: { blob, name }. onProgress(done, total). */
export async function buildExport(convs, me, { range = {}, onProgress, restore = false } = {}) {
  const chats = [];
  for (const conv of convs) {
    chats.push(await chatExport(conv, me, range, { restore }));
    onProgress?.(chats.length, convs.length);
  }
  const data = { app: 'ChatApp', format: 1, exportedAt: new Date().toISOString(), chats };
  const name =
    convs.length === 1 ? `ChatApp ${fileSafe(chats[0].title)} ${stamp()}.json` : `ChatApp ${convs.length} chats ${stamp()}.json`;
  return { blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name, data };
}

/** The restore records in an export / backup file: [id, { p, fp, conv, sender, at }]. */
export function restoreRecords(data) {
  const records = [];
  for (const chat of data?.chats || []) {
    for (const m of chat?.messages || []) {
      if (m?.restore) records.push([m.id, { ...m.restore, conv: chat.id, sender: m.sender?.id || null, at: m.sentAt }]);
    }
  }
  return records;
}

/**
 * "Import chats": reads an export file (from this or another device) and makes its messages
 * readable here again: ones that show "Sent before this device was linked" or couldn't be
 * decrypted. Only chats you're still in show them. → { chats, messages, restored, readable }.
 */
export async function importChats(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This isn’t a ChatApp export file.');
  }
  if (data?.app !== 'ChatApp' || !Array.isArray(data.chats)) throw new Error('This isn’t a ChatApp export file.');
  const records = restoreRecords(data);
  const messages = data.chats.reduce((n, c) => n + (c.messages?.length || 0), 0);
  if (messages && !records.length) {
    throw new Error('This export was made by an older version of ChatApp and can only be read, not imported. Export the chat again.');
  }
  const restored = e2ee.importRestored(records);
  return { chats: data.chats.length, messages, restored, readable: records.length };
}

/**
 * Exports, including what's needed to import the chats again on another device (or after
 * erasing this one): the same file can be read by people and by "Import chats".
 */
export const exportChats = (convs, me, options) => buildExport(convs, me, { ...options, restore: true });
