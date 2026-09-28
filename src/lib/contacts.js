import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import { Share } from '@capacitor/share';
import { api } from './api.js';
import { storage } from './storage.js';

export const canReadContacts = () => Capacitor.isNativePlatform();

const INVITE_URL =
  import.meta.env.VITE_INVITE_URL || (typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.origin : '');

export const inviteText = () =>
  `Let's chat on ChatApp! It's fast, free and works offline.${INVITE_URL ? ` Get it here: ${INVITE_URL}` : ''}`;

const digits = (p) => String(p).replace(/[^\d+]/g, '');
const cacheKey = (userId) => `contacts.matches.${userId}`;

export const cachedContactMatches = (userId) => storage.get(cacheKey(userId));

/**
 * Asks for contacts permission, reads the address book and splits it into people who
 * already have an account (can chat now) and people to invite.
 */
export async function syncContacts(userId) {
  const perm = await Contacts.requestPermissions();
  if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
    throw new Error('Contacts access was denied. You can allow it in your phone settings.');
  }
  const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } });

  const entries = new Map(); // digits -> { name, phone }
  for (const c of contacts) {
    const name = c.name?.display || [c.name?.given, c.name?.family].filter(Boolean).join(' ');
    for (const p of c.phones || []) {
      if (p.number && !entries.has(digits(p.number))) entries.set(digits(p.number), { name: name || p.number, phone: p.number });
    }
  }
  const list = [...entries.values()];

  const matches = [];
  for (let i = 0; i < list.length; i += 1000) {
    const { matches: found } = await api('/api/users/lookup', {
      method: 'POST',
      body: { phones: list.slice(i, i + 1000).map((e) => e.phone) },
    });
    matches.push(...found);
  }
  const byPhone = new Map(matches.map((m) => [m.phone, m]));

  const registered = new Map(); // user id -> entry (one row per person even with several numbers)
  const invite = [];
  for (const e of list) {
    const m = byPhone.get(e.phone);
    if (!m) invite.push(e);
    else if (!m.self && !registered.has(m.user.id)) registered.set(m.user.id, { ...e, user: m.user });
  }
  const result = {
    syncedAt: Date.now(),
    registered: [...registered.values()].sort((a, b) => a.name.localeCompare(b.name)),
    invite: invite.sort((a, b) => a.name.localeCompare(b.name)),
  };
  storage.set(cacheKey(userId), result);
  return result;
}

/** Is this phone number on ChatApp? Resolves to { user, self } or null. */
export async function lookupPhone(phone) {
  const { matches } = await api('/api/users/lookup', { method: 'POST', body: { phones: [phone] } });
  return matches[0] || null;
}

/** Invite one person by SMS (on phones), or share a generic invite. */
export async function invite(phone) {
  if (phone && Capacitor.isNativePlatform()) {
    const sep = Capacitor.getPlatform() === 'ios' ? '&' : '?';
    window.location.href = `sms:${digits(phone)}${sep}body=${encodeURIComponent(inviteText())}`;
    return;
  }
  return shareInvite();
}

export async function shareInvite() {
  try {
    await Share.share({ title: 'Join me on ChatApp', text: inviteText(), dialogTitle: 'Invite a friend' });
    return 'shared';
  } catch (err) {
    if (/cancel/i.test(err?.message || '')) return 'cancelled';
    await navigator.clipboard?.writeText(inviteText());
    return 'copied';
  }
}
