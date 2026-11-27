import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';

// Shared contacts ("contact cards"). A card travels inside the end-to-end encrypted message:
//   { name?: string, phones: [{ number, label? }] }
// `name` is left out when the sender chose "Number only".

export const MAX_CARD_PHONES = 5;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** A card from what someone typed or picked (trimmed, at most 5 numbers, no empties). */
export function makeCard({ name, phones }) {
  const list = (phones || [])
    .map((p) => ({ number: clean(p.number, 32), ...(p.label && { label: clean(p.label, 24) }) }))
    .filter((p) => /\d{3,}/.test(p.number));
  const seen = new Set();
  const unique = list.filter((p) => {
    const key = p.number.replace(/[^\d+]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const card = { phones: unique.slice(0, MAX_CARD_PHONES) };
  const n = clean(name, 80);
  if (n) card.name = n;
  return card;
}

/** A received card, checked (it came from someone else's phone). null if unusable. */
export function readCard(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.phones)) return null;
  const card = makeCard(c);
  return card.phones.length ? card : null;
}

/** What the card is called: its name, or its first number ("Number only"). */
export const cardTitle = (c) => c?.name || c?.phones?.[0]?.number || 'Contact';

/** "+254 712 345678" or "+254 712 345678 and 1 more" */
export const cardNumbers = (c) => {
  const [first, ...rest] = c?.phones || [];
  if (!first) return '';
  return rest.length ? `${first.number} and ${rest.length} more` : first.number;
};

/** The card as a vCard (.vcf), which phones and computers can import. */
export function toVCard(c) {
  const esc = (s) => String(s).replace(/([\\;,])/g, '\\$1');
  const name = c.name || c.phones[0]?.number || 'Contact';
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(name)}`,
    `N:${esc(name)};;;;`,
    ...c.phones.map((p) => `TEL;TYPE=${/home|work/i.test(p.label || '') ? p.label.toUpperCase() : 'CELL'}:${p.number.replace(/[^\d+]/g, '')}`),
    'END:VCARD',
    '',
  ].join('\r\n');
}

/**
 * Saves the card: straight into the phone's contacts in the app (asks for permission first);
 * on a computer, downloads a .vcf file to open with its contacts app. → 'saved' | 'downloaded'.
 */
export async function saveCard(c, { name } = {}) {
  const finalName = clean(name, 80) || c.name || '';
  if (Capacitor.isNativePlatform()) {
    const perm = await Contacts.requestPermissions();
    if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
      throw new Error('ChatApp needs access to your contacts to save it. Allow it in Settings → Apps → ChatApp → Permissions.');
    }
    const [given, ...family] = finalName.split(/\s+/);
    await Contacts.createContact({
      contact: {
        ...(finalName && { name: { given: given || null, family: family.join(' ') || null } }),
        phones: c.phones.map((p, i) => ({ type: /home/i.test(p.label || '') ? 'home' : /work/i.test(p.label || '') ? 'work' : 'mobile', number: p.number, isPrimary: i === 0 })),
      },
    });
    return 'saved';
  }
  const blob = new Blob([toVCard({ ...c, name: finalName || undefined })], { type: 'text/vcard' });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: `${(finalName || c.phones[0].number).replace(/[^\w+ -]+/g, '_')}.vcf` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return 'downloaded';
}

/** The phone's address book (phone app only): [{ name, phones: [{ number, label }] }], A–Z. */
export async function readAddressBook() {
  if (!Capacitor.isNativePlatform()) return null;
  const perm = await Contacts.requestPermissions();
  if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
    throw new Error('Contacts access was denied. Allow it in Settings → Apps → ChatApp → Permissions → Contacts.');
  }
  const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } });
  return contacts
    .map((c) => ({
      name: c.name?.display || [c.name?.given, c.name?.family].filter(Boolean).join(' '),
      phones: (c.phones || []).filter((p) => p.number).map((p) => ({ number: p.number, ...(p.label || p.type ? { label: p.label || p.type } : {}) })),
    }))
    .filter((c) => c.phones.length)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
