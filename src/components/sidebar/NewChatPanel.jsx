import { useEffect, useMemo, useState } from 'react';
import { BookUser, RefreshCw, Share2, Users } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import SidePanel, { usePeopleSearch } from './SidePanel.jsx';
import { autoSyncContacts, canReadContacts, invite, shareInvite, syncContacts, useContactMatchesFor } from '../../lib/contacts.js';
import { useAuth } from '../../store/auth.js';
import { useChat, isOnlineSelector } from '../../store/chat.js';
import { displayName, handleOf, knownPhone, usePeople } from '../../store/people.js';
import { toast, useUI } from '../../store/ui.js';

/** Second line: their @username (when the name shown is something else), else about / number. */
export function personSub(person, name) {
  const handle = handleOf(person);
  if (handle && handle !== name) return [handle, person.about].filter(Boolean).join(' · ');
  return person.about || knownPhone(person) || '';
}

export function PersonRow({ person, onClick, selected, right, sub, name: nameOverride }) {
  const online = useChat(isOnlineSelector(person.id));
  usePeople((s) => s.saved[person.id]); // re-render when I save or rename them
  const name = nameOverride || displayName(person);
  return (
    <button className={`person-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <Avatar name={name} url={person.avatarUrl} size={44} online={online} />
      <span className="person-info">
        <span className="person-name">{name}</span>
        <span className="person-sub">{sub ?? personSub(person, name)}</span>
      </span>
      {right}
    </button>
  );
}

function InviteRow({ entry }) {
  return (
    <div className="person-row static">
      <Avatar name={entry.name} size={44} />
      <span className="person-info">
        <span className="person-name">{entry.name}</span>
        <span className="person-sub">{entry.phone}</span>
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => invite(entry.phone)}>
        Invite
      </button>
    </div>
  );
}

/** Address-book section (Android/iOS): who is already on ChatApp, and who to invite. */
function ContactsSection({ query, onStart }) {
  const userId = useAuth((s) => s.user?.id);
  // Updates by itself when the automatic background sync finishes.
  const data = useContactMatchesFor(userId);
  const [busy, setBusy] = useState(false);
  // Opening New chat refreshes the list in the background (new numbers saved on the phone).
  useEffect(() => {
    autoSyncContacts(userId, { minAgeMs: 30 * 1000 }).catch(() => {});
  }, [userId]);
  const [showAllInvites, setShowAllInvites] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      await syncContacts(userId);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const { registered, invites } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const matches = (e) =>
      !q || e.name.toLowerCase().includes(q) || (qDigits && e.phone.replace(/\D/g, '').includes(qDigits));
    return { registered: (data?.registered || []).filter(matches), invites: (data?.invite || []).filter(matches) };
  }, [data, query]);
  const q = query.trim();

  if (!data) {
    return (
      <div className="contacts-cta">
        <BookUser size={28} />
        <p>See which of your contacts are on ChatApp and invite the rest.</p>
        <button className="btn btn-primary" onClick={sync} disabled={busy}>
          {busy ? 'Reading contacts…' : 'Find friends from contacts'}
        </button>
      </div>
    );
  }

  const visibleInvites = showAllInvites || q ? invites : invites.slice(0, 30);
  return (
    <>
      <h3 className="section-label with-action">
        Contacts on ChatApp
        <button className="icon-btn sm" onClick={sync} disabled={busy} aria-label="Refresh contacts" title="Refresh contacts">
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
      </h3>
      {registered.map((e) => (
        <PersonRow
          key={e.user.id}
          person={{ ...e.user, phone: e.phone }}
          name={e.name}
          onClick={() => onStart(e.user)}
        />
      ))}
      {!registered.length && <p className="panel-empty">None of your contacts{q ? ' matching that' : ''} are on ChatApp yet.</p>}

      {invites.length > 0 && <h3 className="section-label">Invite to ChatApp</h3>}
      {visibleInvites.map((e) => (
        <InviteRow key={e.phone} entry={e} />
      ))}
      {visibleInvites.length < invites.length && (
        <button className="btn btn-ghost btn-block" onClick={() => setShowAllInvites(true)}>
          Show all {invites.length} contacts
        </button>
      )}
    </>
  );
}

/** Like WhatsApp: a chat with yourself for notes, links and files. */
function MessageYourselfRow({ onStart }) {
  const me = useAuth((s) => s.user);
  if (!me) return null;
  return (
    <PersonRow
      person={{ id: me.id, avatarUrl: me.avatarUrl }}
      name={`${me.name} (You)`}
      sub="Message yourself"
      onClick={() => onStart({ id: me.id })}
    />
  );
}

/** People I saved in ChatApp (by username or number), on every device. */
function SavedContactsSection({ onStart }) {
  const saved = usePeople((s) => s.saved);
  const list = Object.values(saved)
    .map((c) => ({ user: c.user, name: displayName(c.user) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return null;
  return (
    <>
      <h3 className="section-label">Saved contacts</h3>
      {list.map(({ user, name }) => (
        <PersonRow key={user.id} person={user} name={name} onClick={() => onStart(user)} />
      ))}
    </>
  );
}

export default function NewChatPanel() {
  const [query, setQuery] = useState('');
  const { people, loading } = usePeopleSearch(query);
  const openPanel = useUI((s) => s.openPanel);
  const closePanel = useUI((s) => s.closePanel);
  const openDirect = useChat((s) => s.openDirect);

  async function start(person) {
    try {
      await openDirect(person.id);
      closePanel();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function shareLink() {
    const result = await shareInvite();
    if (result === 'copied') toast('Invite message copied, paste it anywhere');
  }

  return (
    <SidePanel title="New chat">
      <div className="panel-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search @username, phone number or email" />
      </div>
      <button className="person-row action" onClick={() => openPanel('newGroup')}>
        <span className="action-icon">
          <Users size={22} />
        </span>
        <span className="person-name">New group</span>
      </button>
      {!query && <MessageYourselfRow onStart={start} />}
      <button className="person-row action" onClick={shareLink}>
        <span className="action-icon">
          <Share2 size={20} />
        </span>
        <span className="person-name">Invite a friend</span>
      </button>

      {(query || !canReadContacts()) && (
        <>
          <h3 className="section-label">{query ? 'People on ChatApp' : 'Your chats'}</h3>
          {people.map((p) => (
            <PersonRow key={p.id} person={p} onClick={() => start(p)} />
          ))}
          {!people.length && (
            <p className="panel-empty">
              {loading ? 'Searching…' : query ? 'No one found. Try their @username or full phone number.' : 'Search for someone to start chatting.'}
            </p>
          )}
        </>
      )}

      {!query && <SavedContactsSection onStart={start} />}
      {canReadContacts() && <ContactsSection query={query} onStart={start} />}
    </SidePanel>
  );
}
