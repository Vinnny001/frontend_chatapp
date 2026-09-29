import { useMemo, useState } from 'react';
import { BookUser, RefreshCw, Share2, Users } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import SidePanel, { usePeopleSearch } from './SidePanel.jsx';
import { canReadContacts, invite, shareInvite, syncContacts, useContactMatchesFor } from '../../lib/contacts.js';
import { useAuth } from '../../store/auth.js';
import { useChat, isOnlineSelector } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export function PersonRow({ person, onClick, selected, right, sub }) {
  const online = useChat(isOnlineSelector(person.id));
  return (
    <button className={`person-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <Avatar name={person.name} url={person.avatarUrl} size={44} online={online} />
      <span className="person-info">
        <span className="person-name">{person.name}</span>
        <span className="person-sub">{sub ?? (person.about || person.phone)}</span>
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
          person={{ ...e.user, name: e.name }}
          sub={e.user.name !== e.name ? `~${e.user.name} · ${e.user.about || ''}` : e.user.about}
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
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or email" />
      </div>
      <button className="person-row action" onClick={() => openPanel('newGroup')}>
        <span className="action-icon">
          <Users size={22} />
        </span>
        <span className="person-name">New group</span>
      </button>
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
              {loading ? 'Searching…' : query ? 'No one found. Try their full phone number or email.' : 'Search for someone to start chatting.'}
            </p>
          )}
        </>
      )}

      {canReadContacts() && <ContactsSection query={query} onStart={start} />}
    </SidePanel>
  );
}
