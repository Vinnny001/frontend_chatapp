import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, MessageCircle, Phone, Search, Send, UserPlus, UserRound, Users, X } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import { api } from '../../lib/api.js';
import { contactMatchesFor, invite } from '../../lib/contacts.js';
import { MAX_CARDS, MAX_CARD_PHONES, cardTitle, makeCard, phoneLabel, readAddressBook, saveCards } from '../../lib/contactCard.js';
import { useAuth } from '../../store/auth.js';
import { peerOf, useChat } from '../../store/chat.js';
import { displayName, knownPhone } from '../../store/people.js';
import { toast, useUI } from '../../store/ui.js';

const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
const initial = (c) => (c?.name ? c.name.trim().charAt(0).toUpperCase() : null);
const keyOf = (c) => `${c.name || ''}|${c.phones.map((p) => digits(p.number)).join(',')}`;

function Avatar({ card, size = '' }) {
  return <span className={`contact-avatar ${size}`}>{initial(card) || <UserRound size={size === 'huge' ? 30 : 20} />}</span>;
}

// ------------------------------------------------------------------ picking contacts

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

/**
 * Attach → Contact: pick one or more people (up to 10), choose "Name and number" or "Number
 * only" and which of each person's numbers to include, then send them in one card.
 */
export function ShareContactDialog({ conv, onClose }) {
  const { list, loading, fromPhone, error } = useShareableContacts();
  const [step, setStep] = useState('pick'); // pick | type | review
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]); // [{ key, name, phones, numbers: [chosen numbers] }]
  const [typed, setTyped] = useState({ name: '', number: '' });
  const [withName, setWithName] = useState(true);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = digits(query);
    return list.filter((c) => !q || (c.name || '').toLowerCase().includes(q) || (qd.length > 2 && c.phones.some((p) => digits(p.number).includes(qd)))).slice(0, 300);
  }, [list, query]);

  const isPicked = (c) => picked.some((p) => p.key === keyOf(c));
  function toggle(c) {
    const key = keyOf(c);
    if (picked.some((p) => p.key === key)) return setPicked((list) => list.filter((p) => p.key !== key));
    if (picked.length >= MAX_CARDS) return toast(`Up to ${MAX_CARDS} contacts at once`);
    setPicked((list) => [...list, { ...c, key, numbers: c.phones.slice(0, MAX_CARD_PHONES).map((p) => p.number) }]);
    return undefined;
  }

  const cards = picked.map((p) => makeCard({ name: withName ? p.name : '', phones: p.phones.filter((ph) => p.numbers.includes(ph.number)) }));
  const anyNamed = picked.some((p) => p.name);

  function send() {
    const ready = cards.filter((c) => c.phones.length);
    if (ready.length !== cards.length) return toast('Choose at least one number for each contact');
    useChat.getState().sendMessage(conv.id, { type: 'contact', contacts: ready });
    onClose();
    return undefined;
  }

  if (step === 'type') {
    const ok = /\d{5,}/.test(digits(typed.number));
    return (
      <Modal
        title="Add a number"
        onClose={onClose}
        className="contact-share"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setStep('pick')}>
              <ChevronLeft size={16} /> Back
            </button>
            <button
              className="btn btn-primary"
              disabled={!ok}
              onClick={() => {
                toggle({ name: typed.name.trim(), phones: [{ number: typed.number.trim() }] });
                setTyped({ name: '', number: '' });
                setStep('pick');
              }}
            >
              Add
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

  if (step === 'review') {
    return (
      <Modal
        title={picked.length === 1 ? 'Share contact' : `Share ${picked.length} contacts`}
        onClose={onClose}
        className="contact-share"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setStep('pick')}>
              <ChevronLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={send} disabled={!picked.length}>
              <Send size={16} /> Send
            </button>
          </>
        }
      >
        <div className="contact-share-preview">
          <ContactCards cards={cards.map((c) => (c.phones.length ? c : { ...c, phones: [{ number: '—' }] }))} preview />
        </div>
        <fieldset className="contact-share-choice">
          <legend>Share</legend>
          <label className={`radio-row ${!anyNamed ? 'disabled' : ''}`}>
            <input type="radio" name="with" checked={withName && anyNamed} disabled={!anyNamed} onChange={() => setWithName(true)} />
            <span>
              Name and number
              <small>As saved on your phone</small>
            </span>
          </label>
          <label className="radio-row">
            <input type="radio" name="with" checked={!withName || !anyNamed} onChange={() => setWithName(false)} />
            <span>
              Number only
              <small>They see the number{picked.length > 1 ? 's' : ''}, not the name{picked.length > 1 ? 's' : ''} you saved</small>
            </span>
          </label>
        </fieldset>
        <div className="contact-share-review">
          {picked.map((p) => (
            <div key={p.key} className="contact-review-item">
              <div className="contact-review-head">
                <Avatar card={withName ? p : null} />
                <span className="contact-review-name">
                  <strong>{withName && p.name ? p.name : p.numbers[0] || p.phones[0].number}</strong>
                  {withName && p.name && p.phones.length === 1 && <small>{p.phones[0].number}</small>}
                  {p.phones.length > 1 && <small>{p.numbers.length} of {Math.min(p.phones.length, MAX_CARD_PHONES)} numbers</small>}
                </span>
                <button className="icon-btn" aria-label={`Remove ${p.name || p.phones[0].number}`} onClick={() => setPicked((list) => list.filter((x) => x.key !== p.key))}>
                  <X size={16} />
                </button>
              </div>
              {/* Several numbers: choose which go in the card. */}
              {p.phones.length > 1 &&
                p.phones.slice(0, MAX_CARD_PHONES).map((ph) => (
                  <label key={ph.number} className="radio-row contact-review-number">
                    <input
                      type="checkbox"
                      checked={p.numbers.includes(ph.number)}
                      onChange={(e) =>
                        setPicked((list) =>
                          list.map((x) => (x.key !== p.key ? x : { ...x, numbers: e.target.checked ? [...x.numbers, ph.number] : x.numbers.filter((n) => n !== ph.number) }))
                        )
                      }
                    />
                    <span>
                      {ph.number}
                      {ph.label && <small>{phoneLabel(ph.label)}</small>}
                    </span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Share contacts"
      onClose={onClose}
      className="contact-share"
      footer={
        <>
          <span className="hint contact-picked-count">{picked.length ? `${picked.length} selected` : `Choose up to ${MAX_CARDS}`}</span>
          <button className="btn btn-primary" disabled={!picked.length} onClick={() => setStep('review')}>
            Next <ChevronRight size={16} />
          </button>
        </>
      }
    >
      <div className="panel-search">
        <Search size={16} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number" aria-label="Search contacts" />
      </div>
      {picked.length > 0 && (
        <div className="contact-chips" aria-label="Selected">
          {picked.map((p) => (
            <button key={p.key} className="contact-chip" onClick={() => setPicked((list) => list.filter((x) => x.key !== p.key))} title="Remove">
              {p.name || p.phones[0].number} <X size={13} />
            </button>
          ))}
        </div>
      )}
      <button className="person-row contact-type-row" onClick={() => setStep('type')}>
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
      {shown.map((c, i) => {
        const on = isPicked(c);
        return (
          <button key={`${keyOf(c)}-${i}`} className={`person-row ${on ? 'selected' : ''}`} onClick={() => toggle(c)} aria-pressed={on}>
            <Avatar card={c} />
            <span className="person-info">
              <span className="person-name">{c.name || c.phones[0].number}</span>
              <span className="person-sub">
                {c.phones[0].number}
                {c.phones.length > 1 ? ` · ${c.phones.length} numbers` : ''}
              </span>
            </span>
            <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
          </button>
        );
      })}
      {!loading && !shown.length && <p className="panel-empty">{query ? `No contacts match “${query}”.` : 'No contacts to show.'}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ who's on ChatApp

/** number (digits) -> user | null, asked once per number while the app is open */
const known = new Map();
async function lookupNumbers(numbers) {
  const todo = numbers.filter((n) => n && n !== '—' && !known.has(digits(n)));
  if (todo.length) {
    try {
      const { matches } = await api('/api/users/lookup', { method: 'POST', body: { phones: todo } });
      for (const n of todo) known.set(digits(n), null);
      for (const m of matches || []) {
        const sent = todo.find((n) => n === m.phone || digits(n) === digits(m.phone)) || m.phone;
        known.set(digits(sent), m.self ? null : m.user);
      }
    } catch {
      return null; // offline: ask again later
    }
  }
  return Object.fromEntries(numbers.map((n) => [n, known.get(digits(n)) ?? null]));
}

/** For each number of these cards: the ChatApp user it belongs to (null: not on ChatApp). */
function useOnChatApp(cards, enabled = true) {
  const numbers = enabled ? cards.flatMap((c) => c.phones.map((p) => p.number)) : [];
  const key = numbers.join(',');
  const [users, setUsers] = useState(null); // null: not known yet
  useEffect(() => {
    if (!numbers.length) return undefined;
    let alive = true;
    lookupNumbers(numbers).then((u) => alive && u && setUsers(u));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return users;
}
const userOfCard = (card, users) => (users ? card.phones.map((p) => users[p.number]).find(Boolean) || null : undefined);

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

async function save(cards) {
  try {
    const how = await saveCards(cards);
    const what = cards.length === 1 ? 'Contact' : `${cards.length} contacts`;
    toast(how === 'saved' ? `${what} saved to your phone` : `${what} downloaded: open the file to add ${cards.length === 1 ? 'it' : 'them'} to your contacts`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ------------------------------------------------------------------ the card in a chat

const stop = (fn) => (e) => {
  e.stopPropagation();
  fn();
};

/**
 * Shared contacts in a chat bubble. One contact: its name and numbers, Message (on ChatApp) or
 * Invite, and Save. Several: "Cara and 2 other contacts" with View all.
 */
export function ContactCards({ cards, preview = false }) {
  const [open, setOpen] = useState(false);
  const users = useOnChatApp(cards, !preview);
  if (!cards.length) return <p className="share-card-bad">Contact card couldn’t be read</p>;
  const single = cards.length === 1;
  const card = cards[0];
  const user = userOfCard(card, users);

  if (!single) {
    return (
      <div className={`share-card multi ${preview ? 'preview' : ''}`}>
        <button type="button" className="contact-card-main" onClick={stop(() => !preview && setOpen(true))} disabled={preview}>
          <span className="contact-avatars">
            {cards.slice(0, 3).map((c, i) => (
              <Avatar key={i} card={c} />
            ))}
          </span>
          <span className="contact-card-text">
            <span className="contact-card-name">
              {cardTitle(card)} and {cards.length - 1} other contact{cards.length > 2 ? 's' : ''}
            </span>
            <span className="contact-card-sub">{cards.slice(1, 4).map(cardTitle).join(', ')}{cards.length > 4 ? '…' : ''}</span>
          </span>
        </button>
        {!preview && (
          <div className="contact-card-actions">
            <button type="button" onClick={stop(() => setOpen(true))}>
              <Users size={15} /> View all
            </button>
          </div>
        )}
        {open && <ContactListModal cards={cards} users={users} onClose={() => setOpen(false)} />}
      </div>
    );
  }

  const shownPhones = card.phones.slice(0, 3);
  return (
    <div className={`share-card ${preview ? 'preview' : ''}`}>
      <button type="button" className="contact-card-main" onClick={stop(() => !preview && setOpen(true))} disabled={preview}>
        <Avatar card={card} size="big" />
        <span className="contact-card-text">
          <span className="contact-card-name">{cardTitle(card)}</span>
          {/* Its numbers (all of them when it's "Number only": the first is the title). */}
          {shownPhones.map((p, i) =>
            !card.name && i === 0 ? null : (
              <span key={p.number} className="contact-card-sub">
                {p.number}
                {p.label && <em>{phoneLabel(p.label)}</em>}
              </span>
            )
          )}
          {card.phones.length > 3 && <span className="contact-card-sub">+{card.phones.length - 3} more</span>}
        </span>
      </button>
      {!preview && (
        <div className="contact-card-actions">
          {user ? (
            <button type="button" onClick={stop(() => messageUser(user))}>
              <MessageCircle size={15} /> Message
            </button>
          ) : users ? (
            <button type="button" onClick={stop(() => invite(card.phones[0].number))}>
              <UserPlus size={15} /> Invite
            </button>
          ) : null}
          <button type="button" onClick={stop(() => setOpen(true))}>
            <UserPlus size={15} /> Save
          </button>
        </div>
      )}
      {open && <ContactDetails card={card} users={users} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Opens the contacts of a message (from lists such as Media, links and docs). */
export function ContactsModal({ cards, onClose }) {
  if (!cards.length) return null;
  return cards.length === 1 ? <ContactDetails card={cards[0]} onClose={onClose} /> : <ContactListModalLookup cards={cards} onClose={onClose} />;
}
function ContactListModalLookup({ cards, onClose }) {
  const users = useOnChatApp(cards);
  return <ContactListModal cards={cards} users={users} onClose={onClose} />;
}

/** Kept for older callers: one card. */
export const ContactCard = ({ card, preview }) => <ContactCards cards={card ? [card] : []} preview={preview} />;

/** Every contact in a multi-contact card: open one, save it, message it; or save all. */
function ContactListModal({ cards, users, onClose }) {
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  if (viewing) return <ContactDetails card={viewing} users={users} onClose={() => setViewing(null)} backLabel="All contacts" />;
  return (
    <Modal
      title={`${cards.length} contacts`}
      onClose={onClose}
      className="contact-details"
      footer={
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await save(cards);
            setBusy(false);
          }}
        >
          <UserPlus size={16} /> {busy ? 'Saving…' : 'Save all'}
        </button>
      }
    >
      <ul className="contact-list">
        {cards.map((c, i) => {
          const user = userOfCard(c, users);
          return (
            <li key={i}>
              <button className="contact-list-main" onClick={() => setViewing(c)}>
                <Avatar card={c} />
                <span className="contact-card-text">
                  <span className="contact-card-name">{cardTitle(c)}</span>
                  <span className="contact-card-sub">
                    {c.name ? c.phones[0].number : ''}
                    {c.phones.length > 1 ? `${c.name ? ' · ' : ''}${c.phones.length} numbers` : ''}
                  </span>
                </span>
              </button>
              {user && (
                <button className="icon-btn" aria-label={`Message ${cardTitle(c)}`} title="Message" onClick={() => (onClose(), messageUser(user))}>
                  <MessageCircle size={18} />
                </button>
              )}
              <button className="icon-btn" aria-label={`Save ${cardTitle(c)}`} title="Save" onClick={() => save([c])}>
                <UserPlus size={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/**
 * One contact in full: every number (call, copy, and message the ones on ChatApp), and save it
 * (the name can be changed first, e.g. when only the number was shared).
 */
export function ContactDetails({ card, users: given, onClose, backLabel }) {
  const looked = useOnChatApp([card], given === undefined);
  const users = given ?? looked;
  const [name, setName] = useState(card.name || '');
  const [busy, setBusy] = useState(false);
  const onApp = users && card.phones.some((p) => users[p.number]);
  return (
    <Modal
      title="Contact"
      onClose={onClose}
      className="contact-details"
      footer={
        <>
          {backLabel && (
            <button className="btn btn-ghost" onClick={onClose}>
              <ChevronLeft size={16} /> {backLabel}
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await save([{ ...card, name: name.trim() || card.name }]);
              setBusy(false);
              if (!backLabel) onClose();
            }}
          >
            <UserPlus size={16} /> {busy ? 'Saving…' : 'Save contact'}
          </button>
        </>
      }
    >
      <div className="contact-details-head">
        <Avatar card={{ name: name || card.name }} size="huge" />
        {onApp && (
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
        {card.phones.map((p) => {
          const user = users?.[p.number];
          return (
            <li key={p.number}>
              <span>
                {p.number}
                <small>
                  {phoneLabel(p.label) || 'Phone'}
                  {user ? ' · on ChatApp' : ''}
                </small>
              </span>
              {user && (
                <button className="icon-btn" aria-label={`Message ${p.number}`} title="Message on ChatApp" onClick={() => (onClose(), messageUser(user))}>
                  <MessageCircle size={17} />
                </button>
              )}
              <a className="icon-btn" href={`tel:${digits(p.number)}`} aria-label={`Call ${p.number}`} title="Call">
                <Phone size={17} />
              </a>
              <button
                className="icon-btn"
                aria-label={`Copy ${p.number}`}
                title="Copy"
                onClick={() => navigator.clipboard?.writeText(p.number).then(() => toast('Number copied'), () => toast('Couldn’t copy'))}
              >
                <Copy size={17} />
              </button>
            </li>
          );
        })}
      </ul>
      {users && !onApp && (
        <button className="btn btn-ghost btn-block" onClick={() => invite(card.phones[0].number)}>
          <UserPlus size={16} /> Invite to ChatApp
        </button>
      )}
    </Modal>
  );
}
