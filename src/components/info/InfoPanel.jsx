import { useEffect, useState } from 'react';
import { Archive, Bell, BellOff, Check, Crown, Eraser, FileText, LogOut, MoreVertical, Pencil, Phone, Search, ShieldCheck, Timer, UserMinus, UserPlus, Video, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import AvatarPicker from '../common/AvatarPicker.jsx';
import Menu from '../common/Menu.jsx';
import Modal from '../common/Modal.jsx';
import SearchPanel from './SearchPanel.jsx';
import { PersonRow } from '../sidebar/NewChatPanel.jsx';
import { usePeopleSearch } from '../sidebar/SidePanel.jsx';
import { api } from '../../lib/api.js';
import { mediaUrl } from '../../lib/config.js';
import { formatLastSeen } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useCall } from '../../store/call.js';
import { conversationTitle, peerOf, useChat, isOnlineSelector, presenceSelector } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

const DISAPPEARING = [
  { value: 0, label: 'Off' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '24 hours' },
  { value: 604800, label: '7 days' },
  { value: 7776000, label: '90 days' },
];

function MediaGrid({ convId }) {
  const [items, setItems] = useState(null);
  const lastMessageAt = useChat((s) => s.conversations[convId]?.lastMessageAt);
  const openViewer = useUI((s) => s.openViewer);

  useEffect(() => {
    api(`/api/conversations/${convId}/media`)
      .then((d) => setItems(d.messages))
      .catch(() => setItems([]));
  }, [convId, lastMessageAt]);

  if (!items?.length) return null;
  const visual = items.filter((m) => m.type === 'image' || m.type === 'video');
  const docs = items.filter((m) => m.type === 'file' || m.type === 'audio');

  return (
    <section className="info-card">
      <h3 className="section-label">Media, docs & files</h3>
      {visual.length > 0 && (
        <div className="media-grid">
          {visual.slice(0, 12).map((m) => (
            <button key={m.id} onClick={() => openViewer({ url: m.media.url, type: m.type, name: m.media.name })}>
              {m.type === 'image' ? <img src={mediaUrl(m.media.url)} alt="" loading="lazy" /> : <video src={`${mediaUrl(m.media.url)}#t=0.1`} preload="metadata" muted />}
            </button>
          ))}
        </div>
      )}
      {docs.slice(0, 6).map((m) => (
        <a key={m.id} className="doc-row" href={mediaUrl(m.media.url)} target="_blank" rel="noreferrer" download={m.media.name}>
          <FileText size={20} />
          <span>{m.media.name}</span>
        </a>
      ))}
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

  const members = [...conv.participants].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1));

  return (
    <>
      <section className="info-hero">
        {isGroup ? (
          <AvatarPicker url={conv.avatarUrl} name={title} group size={150} disabled={!amAdmin} onChange={(avatarUrl) => save({ avatarUrl })} />
        ) : (
          <Avatar name={title} url={peer?.avatarUrl} size={150} onClick={peer?.avatarUrl ? () => useUI.getState().openViewer({ url: peer.avatarUrl, type: 'image', name: peer.name }) : undefined} />
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
          {isGroup ? `Group · ${conv.participants.length} members` : peer?.phone}
          {!isGroup && (presence?.online ? ' · online' : presence?.lastSeen ? ` · ${formatLastSeen(presence.lastSeen)}` : '')}
        </p>
        <div className="info-actions">
          {!isGroup && (
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
        <h2>{mode === 'search' ? 'Search messages' : conv.type === 'group' ? 'Group info' : 'Contact info'}</h2>
      </header>
      <div className="info-body">{mode === 'search' ? <SearchPanel conv={conv} /> : <InfoContent key={conv.id} conv={conv} />}</div>
    </aside>
  );
}
