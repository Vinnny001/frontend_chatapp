import { useEffect, useState } from 'react';
import { ArrowLeft, Ban, ChevronRight, Flag, Archive, Bell, BellOff, Check, CloudDownload, Crown, Eraser, FileText, LogOut, MoreVertical, Pencil, Phone, Search, ShieldCheck, Timer, UserMinus, UserPlus, Video, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import AvatarPicker from '../common/AvatarPicker.jsx';
import Menu from '../common/Menu.jsx';
import Modal from '../common/Modal.jsx';
import SearchPanel from './SearchPanel.jsx';
import SharedBrowser from '../common/SharedBrowser.jsx';
import ReportDialog from '../common/ReportDialog.jsx';
import { PersonRow } from '../sidebar/NewChatPanel.jsx';
import { usePeopleSearch } from '../sidebar/SidePanel.jsx';
import { api } from '../../lib/api.js';
import { useMediaSrc } from '../../lib/media.js';
import { openDocument } from '../../lib/deviceFiles.js';
import { readMessages } from '../../lib/localdb.js';
import { formatLastSeen } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useCall } from '../../store/call.js';
import { chatAvatarUrl, conversationTitle, isSelfChat, peerOf, useChat, isOnlineSelector, presenceSelector } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';
import { canSaveToPhone, contactSource, handleOf, knownPhone, removeContact, saveContact, saveToPhone, usePeople } from '../../store/people.js';
import { canReadContacts } from '../../lib/contacts.js';

const DISAPPEARING = [
  { value: 0, label: 'Off' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '24 hours' },
  { value: 604800, label: '7 days' },
  { value: 7776000, label: '90 days' },
];

function GridThumb({ message: m }) {
  const { src } = useMediaSrc(m.media.url);
  if (!src) return null;
  return m.type === 'image' ? <img src={src} alt="" loading="lazy" /> : <video src={`${src}#t=0.1`} preload="metadata" muted />;
}

/** A few recent photos/videos; the rest (and docs, links, apps, favourites) under "View all". */
function MediaGrid({ convId }) {
  const [state, setState] = useState(null); // { items, total }
  const lastMessageAt = useChat((s) => s.conversations[convId]?.lastMessageAt);
  const openViewer = useUI((s) => s.openViewer);
  const setInfoOpen = useUI((s) => s.setInfoOpen);

  useEffect(() => {
    api(`/api/conversations/shared?kind=media&limit=6&counts=1&conversationId=${convId}`)
      .then((d) => setState({ items: d.items, total: d.counts?.all ?? d.items.length }))
      // Offline: from the messages saved on the device.
      .catch(() =>
        readMessages(convId, { limit: 2000 })
          .then((all) => {
            const shared = all.filter((m) => !m.deletedForEveryone && (m.media || /(https?:\/\/|www\.)\S+/i.test(m.text || '')));
            const visual = shared.filter((m) => m.type === 'image' || m.type === 'video').reverse();
            setState({ items: visual.slice(0, 6), total: shared.length });
          })
          .catch(() => setState({ items: [], total: 0 }))
      );
  }, [convId, lastMessageAt]);

  if (!state?.total) return null;
  return (
    <section className="info-card">
      <button className="section-link" onClick={() => setInfoOpen('media')}>
        <span>Media, links and docs</span>
        <span className="section-link-count">
          {state.total} <ChevronRight size={18} />
        </span>
      </button>
      {state.items.length > 0 && (
        <div className="media-grid compact">
          {state.items.map((m) => (
            <button key={m.id} onClick={() => openViewer({ url: m.media.url, type: m.type, name: m.media.name })}>
              <GridThumb message={m} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Downloads this chat's full history and all its media so everything opens offline. */
function SaveOffline({ convId }) {
  const [progress, setProgress] = useState(null);
  const busy = progress && !progress.done;

  async function save() {
    setProgress({ messages: 0, files: 0, saved: 0, done: false });
    try {
      await useChat.getState().saveChatOffline(convId, setProgress);
    } catch (e) {
      setProgress(null);
      toast(e.status === 0 ? 'Connect to the internet to save this chat for offline.' : e.message, 'error');
    }
  }

  let status = 'Download every message, photo, video, voice note and document in this chat to this device.';
  if (progress && !progress.done) {
    status =
      progress.files && progress.saved
        ? `Downloading files… ${progress.saved} of ${progress.files}`
        : `Saving messages… ${progress.messages}`;
  } else if (progress?.done) {
    status = `Saved: ${progress.messages} messages and ${progress.files} files are available offline.`;
  }

  return (
    <section className="info-card">
      <button className="save-offline" onClick={save} disabled={busy}>
        <CloudDownload size={20} className={busy ? 'pulse' : ''} />
        <span>
          <strong>{busy ? 'Saving chat for offline…' : 'Save chat for offline'}</strong>
          <small>{status}</small>
        </span>
      </button>
    </section>
  );
}

function AddMembersModal({ conv, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const { people } = usePeopleSearch(query);
  const candidates = people.filter((p) => !conv.participants.some((m) => m.id === p.id));

  async function add() {
    try {
      await api(`/api/conversations/${conv.id}/members`, { method: 'POST', body: { userIds: selected } });
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title="Add members"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!selected.length} onClick={add}>
          Add {selected.length || ''}
        </button>
      }
    >
      <div className="panel-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or email" />
      </div>
      {candidates.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          selected={selected.includes(p.id)}
          onClick={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
        />
      ))}
      {!candidates.length && <p className="panel-empty">Search for people to add.</p>}
    </Modal>
  );
}

function MemberRow({ member, conv, me, amAdmin }) {
  const [menu, setMenu] = useState(null);
  const online = useChat(isOnlineSelector(member.id));
  const openDirect = useChat((s) => s.openDirect);
  const isMe = member.id === me;

  const call = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const items = [
    !isMe && { label: `Message ${member.name.split(' ')[0]}`, icon: Pencil, onClick: () => call(() => openDirect(member.id)) },
    amAdmin && !isMe && member.role !== 'admin' && {
      label: 'Make group admin',
      icon: ShieldCheck,
      onClick: () => call(() => api(`/api/conversations/${conv.id}/members/${member.id}`, { method: 'PATCH', body: { role: 'admin' } })),
    },
    amAdmin && !isMe && member.role === 'admin' && {
      label: 'Dismiss as admin',
      icon: Crown,
      onClick: () => call(() => api(`/api/conversations/${conv.id}/members/${member.id}`, { method: 'PATCH', body: { role: 'member' } })),
    },
    amAdmin && !isMe && {
      label: 'Remove from group',
      icon: UserMinus,
      danger: true,
      onClick: () =>
        window.confirm(`Remove ${member.name} from the group?`) &&
        call(() => api(`/api/conversations/${conv.id}/members/${member.id}`, { method: 'DELETE' })),
    },
  ].filter(Boolean);

  return (
    <div className="member-row">
      <Avatar name={member.name} url={member.avatarUrl} size={40} online={online} />
      <span className="person-info">
        <span className="person-name">{isMe ? 'You' : member.name}</span>
        <span className="person-sub">{member.about || member.phone}</span>
      </span>
      {member.role === 'admin' && <span className="admin-badge">Admin</span>}
      {items.length > 0 && (
        <button
          className="icon-btn"
          aria-label="Member options"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom });
          }}
        >
          <MoreVertical size={18} />
        </button>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * The other person in a one-to-one chat: their @username, number and email (when I may see
 * them), and saving them to my ChatApp contacts or my phone's address book.
 */
function ContactCard({ peer, conv }) {
  const [reporting, setReporting] = useState(false);
  const blocked = !!conv?.me?.blocked;
  const who = peer.name;
  const toggleBlock = async () => {
    if (!blocked && !window.confirm(`Block ${who}? They won’t be able to call you or send you messages.`)) return;
    try {
      await useChat.getState().setBlocked(peer.id, !blocked);
      toast(blocked ? `${who} unblocked` : `${who} blocked`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const saved = usePeople((s) => s.saved[peer.id]);
  const source = contactSource(peer.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const handle = handleOf(peer);
  const phone = knownPhone(peer);
  const identity = handle || phone;

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setName(saved?.name || '');
    setEditing(true);
  };

  return (
    <section className="info-card contact-card">
      <h3 className="section-label">Contact info</h3>
      {handle && (
        <div className="contact-line">
          <span>Username</span>
          <strong>{handle}</strong>
        </div>
      )}
      <div className="contact-line">
        <span>Phone</span>
        {phone ? <strong>{phone}</strong> : <em>Private</em>}
      </div>
      {peer.email && (
        <div className="contact-line">
          <span>Email</span>
          <a href={`mailto:${peer.email}`}>{peer.email}</a>
        </div>
      )}

      {editing ? (
        <div className="contact-save">
          <p className="hint">
            Saving <strong>{identity}</strong> to your ChatApp contacts
            {handle && !phone ? ' (they keep their phone number private)' : ''}.
          </p>
          <input
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Name (optional, else shown as ${identity})`}
            onKeyDown={(e) => e.key === 'Enter' && run(() => saveContact(peer, name).then(() => setEditing(false)), 'Contact saved')}
          />
          <div className="row-end">
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => saveContact(peer, name).then(() => setEditing(false)), 'Contact saved')}
            >
              Save
            </button>
          </div>
        </div>
      ) : source === 'phone' ? (
        <p className="hint">In your phone contacts.</p>
      ) : saved ? (
        <div className="contact-actions">
          <span className="hint">Saved in ChatApp{saved.name ? ` as “${saved.name}”` : ''}.</span>
          <button className="btn btn-ghost btn-sm" onClick={startEdit}>
            <Pencil size={15} /> Edit name
          </button>
          <button className="btn btn-ghost btn-sm danger" disabled={busy} onClick={() => run(() => removeContact(peer.id), 'Removed from contacts')}>
            <UserMinus size={15} /> Remove
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost" onClick={startEdit}>
          <UserPlus size={16} /> Add to contacts
        </button>
      )}

      {!editing && canSaveToPhone(peer) && (
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => run(() => saveToPhone(peer, saved?.name), 'Saved to your phone contacts')}
        >
          <Phone size={16} /> Save to phone contacts
        </button>
      )}
      {!editing && canReadContacts() && !phone && handle && (
        <p className="hint">{handle} keeps their phone number private, so they can’t be saved to your phone contacts.</p>
      )}
      <div className="contact-danger">
        <button className="btn btn-ghost danger" onClick={toggleBlock}>
          <Ban size={16} /> {blocked ? `Unblock ${who}` : `Block ${who}`}
        </button>
        <button className="btn btn-ghost danger" onClick={() => setReporting(true)}>
          <Flag size={16} /> Report {who}
        </button>
      </div>
      {reporting && <ReportDialog user={peer} name={who} conversationId={conv?.id} onClose={() => setReporting(false)} />}
    </section>
  );
}

function InfoContent({ conv }) {
  const me = useAuth((s) => s.user?.id);
  const { setPrefs, clearChat, updateConversation } = useChat.getState();
  const setInfoOpen = useUI((s) => s.setInfoOpen);
  const startCall = useCall((s) => s.startCall);
  const [adding, setAdding] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(conv.description);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(conv.name || '');
  const peer = peerOf(conv, me);
  const presence = useChat(presenceSelector(peer?.id));
  const iHideLastSeen = useAuth((s) => s.user?.settings?.showLastSeen === false);
  const isGroup = conv.type === 'group';
  const amAdmin = isGroup && conv.me?.role === 'admin';
  const canEdit = !isGroup || amAdmin;
  const title = conversationTitle(conv, me);

  const save = async (data) => {
    try {
      await updateConversation(conv.id, data);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  function saveName() {
    if (!name.trim()) return;
    save({ name: name.trim() });
    setEditingName(false);
  }

  async function leave() {
    if (!window.confirm(`Leave "${conv.name}"?`)) return;
    try {
      await api(`/api/conversations/${conv.id}/members/${me}`, { method: 'DELETE' });
      useChat.getState().removeConversation(conv.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const members = [...conv.participants].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.role === b.role ? (a.name || '').localeCompare(b.name || '') : a.role === 'admin' ? -1 : 1));

  return (
    <>
      <section className="info-hero">
        {isGroup ? (
          <AvatarPicker url={conv.avatarUrl} name={title} group size={150} disabled={!amAdmin} onChange={(avatarUrl) => save({ avatarUrl })} />
        ) : (
          <Avatar name={title} url={chatAvatarUrl(conv, me)} size={150} onClick={chatAvatarUrl(conv, me) ? () => useUI.getState().openViewer({ url: chatAvatarUrl(conv, me), type: 'image', name: title, noDownload: !isSelfChat(conv, me) }) : undefined} />
        )}
        {editingName ? (
          <div className="editable-row center">
            <input autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
            <button className="icon-btn" onClick={saveName} aria-label="Save name">
              <Check size={20} />
            </button>
          </div>
        ) : (
          <h2>
            {title}
            {amAdmin && (
              <button className="icon-btn sm" onClick={() => setEditingName(true)} aria-label="Edit group name">
                <Pencil size={16} />
              </button>
            )}
          </h2>
        )}
        <p className="info-sub">
          {isGroup
            ? `Group · ${conv.participants.length} members`
            : isSelfChat(conv, me)
              ? 'Message yourself: notes, links and files you want to keep'
              : [
                handleOf(peer) !== title && handleOf(peer),
                peer?.phone !== title && peer?.phone,
                presence?.online
                  ? 'online'
                  : !iHideLastSeen && presence?.lastSeen && formatLastSeen(presence.lastSeen),
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
        <div className="info-actions">
          {!isGroup && peer && (
            <>
              <button onClick={() => startCall(conv.id, peer, 'audio')}>
                <Phone size={20} />
                Audio
              </button>
              <button onClick={() => startCall(conv.id, peer, 'video')}>
                <Video size={20} />
                Video
              </button>
            </>
          )}
          {amAdmin && (
            <button onClick={() => setAdding(true)}>
              <UserPlus size={20} />
              Add
            </button>
          )}
          <button onClick={() => setInfoOpen('search')}>
            <Search size={20} />
            Search
          </button>
        </div>
      </section>

      {!isGroup && peer && <ContactCard peer={peer} conv={conv} />}

      {(isGroup || peer?.about) && (
        <section className="info-card">
          {isGroup ? (
            editingDesc ? (
              <div className="desc-edit">
                <textarea autoFocus maxLength={500} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
                <div className="row-end">
                  <button className="btn btn-ghost" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      save({ description: desc.trim() });
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button className="desc" disabled={!amAdmin} onClick={() => setEditingDesc(true)}>
                {conv.description || (amAdmin ? 'Add group description' : 'No description')}
              </button>
            )
          ) : (
            <>
              <h3 className="section-label">About</h3>
              <p>{peer.about}</p>
            </>
          )}
        </section>
      )}

      <MediaGrid convId={conv.id} />

      <SaveOffline convId={conv.id} />

      <section className="info-card">
        <label className="toggle-row">
          <span>
            {conv.me?.muted ? <BellOff size={18} /> : <Bell size={18} />} Mute notifications
          </span>
          <input type="checkbox" className="switch" checked={!!conv.me?.muted} onChange={(e) => setPrefs(conv.id, { muted: e.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>
            <Timer size={18} /> Disappearing messages
            <small>{canEdit ? 'New messages vanish after the chosen time' : 'Only admins can change this'}</small>
          </span>
          <select value={conv.disappearingSeconds} disabled={!canEdit} onChange={(e) => save({ disappearingSeconds: Number(e.target.value) })}>
            {DISAPPEARING.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {amAdmin && (
          <label className="toggle-row">
            <span>
              <ShieldCheck size={18} /> Only admins can send messages
            </span>
            <input type="checkbox" className="switch" checked={conv.onlyAdminsCanSend} onChange={(e) => save({ onlyAdminsCanSend: e.target.checked })} />
          </label>
        )}
      </section>

      {isGroup && (
        <section className="info-card">
          <h3 className="section-label">{conv.participants.length} members</h3>
          {amAdmin && (
            <button className="person-row action" onClick={() => setAdding(true)}>
              <span className="action-icon">
                <UserPlus size={20} />
              </span>
              <span className="person-name">Add members</span>
            </button>
          )}
          {members.map((m) => (
            <MemberRow key={m.id} member={m} conv={conv} me={me} amAdmin={amAdmin} />
          ))}
        </section>
      )}

      <section className="info-card danger-zone">
        <button onClick={() => setPrefs(conv.id, { archived: !conv.me?.archived })}>
          <Archive size={18} /> {conv.me?.archived ? 'Unarchive chat' : 'Archive chat'}
        </button>
        <button onClick={() => window.confirm('Clear all messages in this chat for you?') && clearChat(conv.id).catch((e) => toast(e.message, 'error'))}>
          <Eraser size={18} /> Clear chat
        </button>
        {isGroup && (
          <button className="danger" onClick={leave}>
            <LogOut size={18} /> Exit group
          </button>
        )}
      </section>

      {adding && <AddMembersModal conv={conv} onClose={() => setAdding(false)} />}
    </>
  );
}

export default function InfoPanel({ convId }) {
  const conv = useChat((s) => s.conversations[convId]);
  const mode = useUI((s) => s.infoOpen);
  const setInfoOpen = useUI((s) => s.setInfoOpen);
  if (!conv) return null;

  return (
    <aside className="info-panel">
      <header className="info-header">
        <button className="icon-btn" onClick={() => setInfoOpen(false)} aria-label="Close">
          <X size={22} />
        </button>
        {mode === 'media' && (
          <button className="icon-btn" onClick={() => setInfoOpen('info')} aria-label="Back to info">
            <ArrowLeft size={20} />
          </button>
        )}
        <h2>
          {mode === 'search' ? 'Search messages' : mode === 'media' ? 'Media, links and docs' : conv.type === 'group' ? 'Group info' : 'Contact info'}
        </h2>
      </header>
      <div className="info-body">
        {mode === 'search' ? (
          <SearchPanel conv={conv} />
        ) : mode === 'media' ? (
          <SharedBrowser key={conv.id} conversationId={conv.id} />
        ) : (
          <InfoContent key={conv.id} conv={conv} />
        )}
      </div>
    </aside>
  );
}
