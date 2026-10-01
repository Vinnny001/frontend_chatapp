import { useEffect } from 'react';
import { create } from 'zustand';
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

/** Latest contact matches, shared so every screen updates when a (background) sync finishes. */
export const useContactMatches = create(() => ({ data: null, userId: null }));
const publish = (userId, data) => useContactMatches.setState({ userId, data });

/** React hook: this user's contact matches (saved copy first, then live background syncs). */
export function useContactMatchesFor(userId) {
  useEffect(() => {
    if (useContactMatches.getState().userId !== userId) publish(userId, cachedContactMatches(userId));
  }, [userId]);
  return useContactMatches((s) => (s.userId === userId ? s.data : null));
}

/**
 * Asks for contacts permission, reads the address book and splits it into people who
 * already have an account (can chat now) and people to invite.
 */
export async function syncContacts(userId) {
  const perm = await Contacts.requestPermissions();
  if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
    throw new Error('Contacts access was denied. Allow it in Settings → Apps → ChatApp → Permissions → Contacts.');
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
  publish(userId, result);
  return result;
}

const ASK_AGAIN_MS = 24 * 3600 * 1000;
let running = null;

/**
 * Keeps "who's on ChatApp" in sync with the phone's address book without the user tapping
 * anything: asks for contacts access when needed (again a day later if the prompt was
 * dismissed or never shown), then re-reads the address book when the app starts, comes back
 * to the foreground or the New chat screen opens, if the last sync is older than `minAgeMs`.
 * Returns the permission state so the UI can explain "limited" access on iOS.
 */
export async function autoSyncContacts(userId, { minAgeMs = 0 } = {}) {
  if (!canReadContacts() || !userId) return null;
  if (running) return running;
  running = (async () => {
    const { contacts: state } = await Contacts.checkPermissions();
    if (state === 'denied') return state;
    const allowed = state === 'granted' || state === 'limited';
    if (!allowed) {
      const askedKey = `contacts.asked.${userId}`;
      const askedAt = Number(storage.get(askedKey)) || 0; // (older versions stored `true`)
      if (Date.now() - askedAt < ASK_AGAIN_MS) return state;
      storage.set(askedKey, Date.now());
    }
    const cached = cachedContactMatches(userId);
    if (allowed && cached && Date.now() - cached.syncedAt < minAgeMs) return state;
    try {
      await syncContacts(userId); // shows the system permission dialog if not decided yet
      return (await Contacts.checkPermissions()).contacts;
    } catch {
      return (await Contacts.checkPermissions().catch(() => ({}))).contacts || 'denied';
    }
  })().finally(() => {
    running = null;
  });
  return running;
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
