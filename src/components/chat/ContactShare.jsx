import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, Copy, MessageCircle, Phone, Search, UserPlus, UserRound, Send } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import { api } from '../../lib/api.js';
import { contactMatchesFor, invite, lookupPhone } from '../../lib/contacts.js';
import { MAX_CARD_PHONES, cardNumbers, cardTitle, makeCard, readAddressBook, readCard, saveCard } from '../../lib/contactCard.js';
import { useAuth } from '../../store/auth.js';
import { peerOf, useChat } from '../../store/chat.js';
import { displayName, knownPhone } from '../../store/people.js';
import { toast, useUI } from '../../store/ui.js';

const digits = (p) => String(p || '').replace(/[^\d+]/g, '');

/**
 * People this device can share: the phone's address book (in the app), else my ChatApp
 * contacts (names synced from my phone) and the people I chat with whose number I know.
 */
function useShareableContacts() {
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const [book, setBook] = useState(undefined); // undefined: loading; null: no address book here
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    readAddressBook()
      .then((list) => alive && setBook(list))
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setBook(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const list = useMemo(() => {
    if (book) return book;
    if (book === undefined) return [];
    const byNumber = new Map();
    for (const e of contactMatchesFor(me)?.registered || []) {
      if (e.phone) byNumber.set(digits(e.phone), { name: e.name, phones: [{ number: e.phone }] });
    }
    for (const c of Object.values(conversations)) {
      if (c.type !== 'direct') continue;
      const peer = peerOf(c, me);
      const phone = knownPhone(peer);
      if (phone && !byNumber.has(digits(phone))) byNumber.set(digits(phone), { name: displayName(peer), phones: [{ number: phone }] });
    }
    return [...byNumber.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [book, conversations, me]);
  return { list, loading: book === undefined, fromPhone: !!book, error };
}

/** Attach → Contact: pick someone, choose what to include, send it as a contact card. */
export function ShareContactDialog({ conv, onClose }) {
  const { list, loading, fromPhone, error } = useShareableContacts();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null); // { name, phones }
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState({ name: '', number: '' });
  const [withName, setWithName] = useState(true);
  const [numbers, setNumbers] = useState([]); // chosen numbers of the picked contact

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = digits(query);
    return list.filter((c) => !q || (c.name || '').toLowerCase().includes(q) || (qd.length > 2 && c.phones.some((p) => digits(p.number).includes(qd)))).slice(0, 300);
  }, [list, query]);

  const pick = (c) => {
    setPicked(c);
    setNumbers(c.phones.slice(0, MAX_CARD_PHONES).map((p) => p.number));
    setWithName(!!c.name);
  };

  function send() {
    const card = makeCard({ name: withName ? picked.name : '', phones: picked.phones.filter((p) => numbers.includes(p.number)) });
    if (!card.phones.length) return toast('Choose at least one number');
    useChat.getState().sendMessage(conv.id, { type: 'contact', contact: card });
    onClose();
    return undefined;
  }

  if (picked) {
    const preview = makeCard({ name: withName ? picked.name : '', phones: picked.phones.filter((p) => numbers.includes(p.number)) });
    return (
      <Modal
        title="Share contact"
        onClose={onClose}
        className="contact-share"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPicked(null)}>
              <ChevronLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={send} disabled={!numbers.length}>
              <Send size={16} /> Send
            </button>
          </>
        }
      >
        <div className="contact-share-preview">
          <ContactCard card={preview.phones.length ? preview : { ...preview, phones: [{ number: '—' }] }} preview />
        </div>
        <fieldset className="contact-share-choice">
          <legend>Share</legend>
          <label className={`radio-row ${!picked.name ? 'disabled' : ''}`}>
            <input type="radio" name="with" checked={withName} disabled={!picked.name} onChange={() => setWithName(true)} />
            <span>
              Name and number
              {picked.name && <small>{picked.name}</small>}
            </span>
          </label>
          <label className="radio-row">
            <input type="radio" name="with" checked={!withName} onChange={() => setWithName(false)} />
            <span>
              Number only
              <small>They see the number, not the name you saved it under</small>
            </span>
          </label>
        </fieldset>
        {picked.phones.length > 1 && (
          <fieldset className="contact-share-choice">
            <legend>Numbers</legend>
            {picked.phones.slice(0, MAX_CARD_PHONES).map((p) => (
              <label key={p.number} className="radio-row">
                <input
                  type="checkbox"
                  checked={numbers.includes(p.number)}
                  onChange={(e) => setNumbers((n) => (e.target.checked ? [...n, p.number] : n.filter((x) => x !== p.number)))}
                />
                <span>
                  {p.number}
                  {p.label && <small>{p.label}</small>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Modal>
    );
  }

  if (typing) {
    const ok = /\d{5,}/.test(digits(typed.number));
    return (
      <Modal
        title="Share a number"
        onClose={onClose}
        className="contact-share"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setTyping(false)}>
              <ChevronLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" disabled={!ok} onClick={() => pick({ name: typed.name.trim(), phones: [{ number: typed.number.trim() }] })}>
              Next
            </button>
          </>
        }
      >
        <label className="field">
          <span>Phone number</span>
          <input autoFocus type="tel" inputMode="tel" value={typed.number} onChange={(e) => setTyped((t) => ({ ...t, number: e.target.value }))} placeholder="+254 712 345678" />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input value={typed.name} onChange={(e) => setTyped((t) => ({ ...t, name: e.target.value }))} placeholder="Name" maxLength={80} />
        </label>
      </Modal>
    );
  }

  return (
    <Modal title="Share contact" onClose={onClose} className="contact-share">
      <div className="panel-search">
        <Search size={16} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number" aria-label="Search contacts" />
      </div>
      <button className="person-row contact-type-row" onClick={() => setTyping(true)}>
        <span className="contact-avatar">
          <Phone size={18} />
        </span>
        <span className="person-info">
          <span className="person-name">Type a number</span>
        </span>
      </button>
      {loading && <p className="panel-empty">Loading contacts…</p>}
      {error && <p className="hint">{error}</p>}
      {!loading && !fromPhone && !error && <p className="hint">Your ChatApp contacts and the people you chat with. On your phone, ChatApp also lists your phone’s contacts.</p>}
      {shown.map((c, i) => (
        <button key={`${c.name}-${c.phones[0].number}-${i}`} className="person-row" onClick={() => pick(c)}>
          <span className="contact-avatar">{(c.name || '#').trim().charAt(0).toUpperCase()}</span>
          <span className="person-info">
            <span className="person-name">{c.name || c.phones[0].number}</span>
            <span className="person-sub">{cardNumbers(c)}</span>
          </span>
        </button>
      ))}
      {!loading && !shown.length && <p className="panel-empty">{query ? `No contacts match “${query}”.` : 'No contacts to show.'}</p>}
    </Modal>
  );
}

/** Is this number on ChatApp? (asked once per number while the app is open) */
const onChatApp = new Map();
function useOnChatApp(number) {
  const [user, setUser] = useState(() => onChatApp.get(digits(number)) ?? undefined);
  useEffect(() => {
    if (!number || number === '—') return undefined;
    const key = digits(number);
    let alive = true;
    if (!onChatApp.has(key)) {
      onChatApp.set(
        key,
        lookupPhone(number)
          .then((m) => (m && !m.self ? m.user : null))
          .catch(() => {
            onChatApp.delete(key); // offline: ask again later
            return undefined;
          })
      );
    }
    Promise.resolve(onChatApp.get(key)).then((u) => alive && setUser(u));
    return () => {
      alive = false;
    };
  }, [number]);
  return user; // undefined: not known yet; null: not on ChatApp
}

async function messageUser(user) {
  try {
    const { conversation } = await api('/api/conversations/direct', { method: 'POST', body: { userId: user.id } });
    const chat = useChat.getState();
    chat.upsertConversation(conversation);
    chat.openConversation(conversation.id);
    useUI.getState().closePanel?.();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function save(card, name) {
  try {
    const how = await saveCard(card, { name });
    toast(how === 'saved' ? 'Saved to your contacts' : 'Contact file downloaded: open it to add to your contacts');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** A contact card in a chat bubble: tap to see it; Message (on ChatApp) / Invite, and Save. */
export function ContactCard({ card: raw, preview = false }) {
  const card = preview ? raw : readCard(raw);
  const [open, setOpen] = useState(false);
  const first = card?.phones[0]?.number;
  const user = useOnChatApp(preview ? null : first);
  if (!card) return <p className="contact-card-bad">Contact card couldn’t be read</p>;
  return (
    <div className={`contact-card ${preview ? 'preview' : ''}`}>
      <button type="button" className="contact-card-main" onClick={(e) => (e.stopPropagation(), !preview && setOpen(true))} disabled={preview}>
        <span className="contact-avatar big">{card.name ? card.name.trim().charAt(0).toUpperCase() : <UserRound size={22} />}</span>
        <span className="contact-card-text">
          <span className="contact-card-name">{cardTitle(card)}</span>
          {card.name && <span className="contact-card-sub">{cardNumbers(card)}</span>}
          {!card.name && card.phones.length > 1 && <span className="contact-card-sub">and {card.phones.length - 1} more</span>}
        </span>
      </button>
      {!preview && (
        <div className="contact-card-actions">
          {user ? (
            <button type="button" onClick={(e) => (e.stopPropagation(), messageUser(user))}>
              <MessageCircle size={15} /> Message
            </button>
          ) : user === null ? (
            <button type="button" onClick={(e) => (e.stopPropagation(), invite(first))}>
              <UserPlus size={15} /> Invite
            </button>
          ) : null}
          <button type="button" onClick={(e) => (e.stopPropagation(), setOpen(true))}>
            <UserPlus size={15} /> Save
          </button>
        </div>
      )}
      {open && <ContactDetails card={card} user={user} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The whole card: every number (copy / call), save it (name can be changed first), message. */
export function ContactDetails({ card, user, onClose }) {
  const [name, setName] = useState(card.name || '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Contact"
      onClose={onClose}
      className="contact-details"
      footer={
        <>
          {user && (
            <button className="btn btn-ghost" onClick={() => (onClose(), messageUser(user))}>
              <MessageCircle size={16} /> Message
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await save(card, name);
              setBusy(false);
              onClose();
            }}
          >
            <UserPlus size={16} /> {busy ? 'Saving…' : 'Save contact'}
          </button>
        </>
      }
    >
      <div className="contact-details-head">
        <span className="contact-avatar huge">{(name || card.name) ? (name || card.name).trim().charAt(0).toUpperCase() : <UserRound size={30} />}</span>
        {user && (
          <span className="contact-details-on">
            <Check size={13} /> On ChatApp
          </span>
        )}
      </div>
      <label className="field">
        <span>Name {card.name ? '' : '(they shared the number only)'}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name to save it under" maxLength={80} />
      </label>
      <ul className="contact-details-numbers">
        {card.phones.map((p) => (
          <li key={p.number}>
            <span>
              {p.number}
              {p.label && <small>{p.label}</small>}
            </span>
            <a className="icon-btn" href={`tel:${digits(p.number)}`} aria-label={`Call ${p.number}`}>
              <Phone size={17} />
            </a>
            <button
              className="icon-btn"
              aria-label={`Copy ${p.number}`}
              onClick={() => navigator.clipboard?.writeText(p.number).then(() => toast('Number copied'), () => toast('Couldn’t copy'))}
            >
              <Copy size={17} />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
