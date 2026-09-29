import { useMemo, useState } from 'react';
import { Archive, LogOut, MessageSquarePlus, MoreVertical, Phone, Search, Settings, Star, Users, X } from 'lucide-react';
import CallsPanel from './CallsPanel.jsx';
import Avatar from '../common/Avatar.jsx';
import Menu from '../common/Menu.jsx';
import ConversationItem from './ConversationItem.jsx';
import NewChatPanel from './NewChatPanel.jsx';
import NewGroupPanel from './NewGroupPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import StarredPanel from './StarredPanel.jsx';
import { useAuth } from '../../store/auth.js';
import { conversationTitle, previewText, useChat } from '../../store/chat.js';
import { useUI } from '../../store/ui.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
];

const PANELS = { newChat: NewChatPanel, newGroup: NewGroupPanel, settings: SettingsPanel, starred: StarredPanel, calls: CallsPanel };

export default function Sidebar() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const conversations = useChat((s) => s.conversations);
  const loaded = useChat((s) => s.loaded);
  const activeId = useChat((s) => s.activeId);
  const connection = useChat((s) => s.connection);
  const panel = useUI((s) => s.panel);
  const openPanel = useUI((s) => s.openPanel);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [menu, setMenu] = useState(null);

  const me = user?.id;
  const all = useMemo(() => Object.values(conversations), [conversations]);
  const archivedCount = all.filter((c) => c.me?.archived).length;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((c) => (filter === 'archived' ? c.me?.archived : !c.me?.archived))
      .filter((c) => filter !== 'unread' || c.me?.unreadCount > 0)
      .filter((c) => filter !== 'groups' || c.type === 'group')
      // Hide empty direct chats (someone opened a chat but nobody has written yet).
      .filter((c) => c.type === 'group' || c.lastMessage || c.id === activeId)
      .filter(
        (c) =>
          !q ||
          conversationTitle(c, me).toLowerCase().includes(q) ||
          previewText(c.lastMessage).toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (!!a.me?.pinned !== !!b.me?.pinned) return a.me?.pinned ? -1 : 1;
        return Date.parse(b.lastMessage?.createdAt || b.lastMessageAt) - Date.parse(a.lastMessage?.createdAt || a.lastMessageAt);
      });
  }, [all, query, filter, me, activeId]);

  const Panel = panel && PANELS[panel];

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <Avatar name={user?.name} url={user?.avatarUrl} size={40} onClick={() => openPanel('settings')} />
        <div className="sidebar-title">
          <h1>Chats</h1>
          {connection !== 'online' && (
            <span className={`conn conn-${connection}`}>{connection === 'offline' ? 'Offline – waiting for network' : 'Connecting…'}</span>
          )}
        </div>
        <button className="icon-btn" onClick={() => openPanel('calls')} aria-label="Calls" title="Calls">
          <Phone size={20} />
        </button>
        <button className="icon-btn" onClick={() => openPanel('newChat')} aria-label="New chat" title="New chat">
          <MessageSquarePlus size={20} />
        </button>
        <button
          className="icon-btn"
          aria-label="Menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 200, y: r.bottom + 4 });
          }}
        >
          <MoreVertical size={20} />
        </button>
      </header>

      <div className="sidebar-search">
        <Search size={17} className="search-icon" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        {query && (
          <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.id === 'archived' && <Archive size={14} />}
            {f.label}
            {f.id === 'archived' && archivedCount > 0 && <span className="chip-count">{archivedCount}</span>}
          </button>
        ))}
      </div>

      <div className="conv-list">
        {!loaded && Array.from({ length: 7 }, (_, i) => <div key={i} className="conv-skeleton" />)}
        {loaded && list.map((c) => <ConversationItem key={c.id} conv={c} me={me} active={c.id === activeId} />)}
        {loaded && !list.length && (
          <div className="list-empty">
            {query ? (
              <p>No chats match “{query}”.</p>
            ) : filter === 'all' ? (
              <>
                <p>No conversations yet.</p>
                <button className="btn btn-primary" onClick={() => openPanel('newChat')}>
                  Start a chat
                </button>
              </>
            ) : (
              <p>Nothing here.</p>
            )}
          </div>
        )}
      </div>

      <button className="fab" onClick={() => openPanel('newChat')} aria-label="New chat">
        <MessageSquarePlus size={24} />
      </button>

      {Panel && <Panel />}

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'New group', icon: Users, onClick: () => openPanel('newGroup') },
            { label: 'Calls', icon: Phone, onClick: () => openPanel('calls') },
            { label: 'Starred messages', icon: Star, onClick: () => openPanel('starred') },
            { label: 'Settings', icon: Settings, onClick: () => openPanel('settings') },
            { label: 'Log out', icon: LogOut, danger: true, onClick: logout },
          ]}
        />
      )}
    </aside>
  );
}
