import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { Contacts, EmailType, PhoneType } from '@capacitor-community/contacts';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { canReadContacts, syncContacts, useContactMatches } from '../lib/contacts.js';
import { useAuth } from './auth.js';

// How other people are shown to me. Registered names are private, so a person appears as:
//   1. the name I saved them under in my phone's address book,
//   2. else the name I saved them under in ChatApp,
//   3. else their @username,
//   4. else their phone number (people without a username always share it).
// Phone numbers the server hides are still known for people in my address book (I have
// their number), so those are filled in from the device.

const savedKey = (userId) => `people.saved.${userId}`;
const meId = () => useAuth.getState().user?.id;

/** Saved ChatApp contacts: { [userId]: { name, user } }. */
export const usePeople = create(() => ({ saved: {}, loaded: false }));

// Address-book matches indexed by user id (rebuilt when a contacts sync finishes).
let phoneBookFor = null;
let phoneBook = new Map();
function phoneBookIndex() {
  const data = useContactMatches.getState().data;
  if (data !== phoneBookFor) {
    phoneBookFor = data;
    phoneBook = new Map((data?.registered || []).map((e) => [e.user.id, { name: e.name, phone: e.phone }]));
  }
  return phoneBook;
}

/** What I have for this person in my phone's address book: { name, phone } or undefined. */
export const phoneBookEntry = (userId) => phoneBookIndex().get(userId);
export const savedContact = (userId) => usePeople.getState().saved[userId];

export const handleOf = (user) => (user?.username ? `@${user.username}` : '');

/** The number I may see for this person: shared by them, or from my address book. */
export const knownPhone = (user) => user?.phone || phoneBookEntry(user?.id)?.phone || null;

/** The name to show for another person (see the order at the top of this file). */
export function displayName(user) {
  if (!user) return 'Unknown';
  if (user.id && user.id === meId()) return useAuth.getState().user?.name || 'You';
  const book = phoneBookEntry(user.id);
  if (book?.name) return book.name;
  const saved = savedContact(user.id);
  if (saved?.name) return saved.name;
  if (user.username) return `@${user.username}`;
  return knownPhone(user) || user.name || 'Unknown';
}

/** Where this person is saved: 'phone' (address book), 'app' (ChatApp contacts) or null. */
export function contactSource(userId) {
  if (phoneBookEntry(userId)) return 'phone';
  if (savedContact(userId)) return 'app';
  return null;
}

/** Name overrides for native notifications (only names I chose, not handles or numbers). */
export function savedNames() {
  const out = {};
  for (const [id, c] of Object.entries(usePeople.getState().saved)) if (c.name) out[id] = c.name;
  for (const [id, e] of phoneBookIndex()) if (e.name) out[id] = e.name;
  return out;
}

// ------------------------------------------------------------------ saved ChatApp contacts

const toMap = (contacts) => Object.fromEntries(contacts.map((c) => [c.user.id, { name: c.name || '', user: c.user }]));

function publishSaved(saved) {
  usePeople.setState({ saved, loaded: true });
  const userId = meId();
  if (userId) storage.set(savedKey(userId), saved);
}

/** Shows the saved copy at once, then refreshes from the server. */
export async function loadSavedContacts(userId) {
  const cached = storage.get(savedKey(userId));
  if (cached) usePeople.setState({ saved: cached, loaded: true });
  const { contacts } = await api('/api/users/me/contacts');
  publishSaved(toMap(contacts));
}

/** Adds (or renames) someone in my ChatApp contacts. An empty name shows their @username. */
export async function saveContact(user, name = '') {
  const { contact } = await api(`/api/users/me/contacts/${user.id}`, { method: 'PUT', body: { name: name.trim() } });
  publishSaved({ ...usePeople.getState().saved, [user.id]: { name: contact.name, user: contact.user } });
}

export async function removeContact(userId) {
  await api(`/api/users/me/contacts/${userId}`, { method: 'DELETE' });
  const saved = { ...usePeople.getState().saved };
  delete saved[userId];
  publishSaved(saved);
}

export function resetPeople() {
  usePeople.setState({ saved: {}, loaded: false });
}

// ------------------------------------------------------------------ phone address book

/**
 * Only people whose number I can see (they have no username or chose to show it) can be
 * saved to the phone's address book; a username-only contact has no number to save.
 */
export const canSaveToPhone = (user) => canReadContacts() && !!knownPhone(user) && !phoneBookEntry(user?.id);

/** Saves this person to the phone's address book, then refreshes the "who's on ChatApp" list. */
export async function saveToPhone(user, name) {
  const phone = knownPhone(user);
  if (!phone) throw new Error('This person keeps their phone number private');
  const perm = await Contacts.requestPermissions();
  if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
    throw new Error('Allow ChatApp to access your contacts in Settings to save to your phone.');
  }
  const [given, ...rest] = (name || displayName(user)).replace(/^@/, '').trim().split(/\s+/);
  await Contacts.createContact({
    contact: {
      // No family name when there's only one word (Android would store "null").
      name: rest.length ? { given, family: rest.join(' ') } : { given },
      phones: [{ type: PhoneType.Mobile, isPrimary: true, number: phone }],
      ...(user.email && { emails: [{ type: EmailType.Other, address: user.email }] }),
    },
  });
  if (Capacitor.isNativePlatform()) await syncContacts(meId()).catch(() => {});
}
