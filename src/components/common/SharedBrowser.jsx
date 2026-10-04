import { useEffect, useMemo, useState } from 'react';
import { FileText, Link2, Play, Search, Smartphone, Star } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatBytes, formatListTime } from '../../lib/format.js';
import { readMessages } from '../../lib/localdb.js';
import { useMediaSrc } from '../../lib/media.js';
import { openDocument } from '../../lib/deviceFiles.js';
import { useAuth } from '../../store/auth.js';
import { conversationTitle, previewText, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export const SHARED_TABS = [
  { id: 'all', label: 'All' },
  { id: 'media', label: 'Media' },
  { id: 'docs', label: 'Docs' },
  { id: 'links', label: 'Links' },
  { id: 'apps', label: 'Apps' },
  { id: 'starred', label: 'Favourites' },
];

const LINK = /(https?:\/\/|www\.)\S+/i;
const isApk = (m) => m.media?.mime === 'application/vnd.android.package-archive' || /\.apk$/i.test(m.media?.name || '');
const firstLink = (text) => {
  const url = (text || '').match(LINK)?.[0];
  return url && !/^https?:/i.test(url) ? `https://${url}` : url;
};

/** Same rules as the server's tabs, for browsing offline from the messages on this device. */
function matchesKind(m, kind) {
  if (m.deletedForEveryone) return false;
  const media = m.type === 'image' || m.type === 'video';
  const file = m.type === 'file' && !!m.media;
  const link = LINK.test(m.text || '');
  if (kind === 'media') return media;
  if (kind === 'docs') return file && !isApk(m);
  if (kind === 'apps') return file && isApk(m);
  if (kind === 'links') return link;
  if (kind === 'starred') return !!m.starred;
  return media || file || link;
}

function Thumb({ message: m }) {
  const { src } = useMediaSrc(m.media?.url);
  if (!src) return <span className="shared-thumb-empty" />;
  return m.type === 'image' ? <img src={src} alt="" loading="lazy" /> : <video src={`${src}#t=0.1`} preload="metadata" muted />;
}

/**
 * Media, docs, links, apps and favourites shared in one chat (conversationId) or in all
 * chats (the Media hub), with tabs and search. Works offline from what's on the device.
 */
export default function SharedBrowser({ conversationId = null, initialTab = 'all' }) {
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const openViewer = useUI((s) => s.openViewer);
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState({ items: null, hasMore: false, loading: true, offline: false });
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  async function load(before) {
    const params = new URLSearchParams({ kind: tab });
    if (conversationId) params.set('conversationId', conversationId);
    if (q) params.set('q', q);
    if (before) params.set('before', before);
    if (!before && !counts) params.set('counts', '1');
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(`/api/conversations/shared?${params}`);
      if (data.counts) setCounts(data.counts);
      setState((s) => ({ items: before ? [...(s.items || []), ...data.items] : data.items, hasMore: data.hasMore, loading: false, offline: false }));
    } catch (e) {
      if (e.status !== 0) {
        toast(e.message, 'error');
        setState((s) => ({ ...s, items: s.items || [], loading: false }));
        return;
      }
      // Offline: search the messages saved on this device.
      const ids = conversationId ? [conversationId] : Object.keys(useChat.getState().conversations);
      const all = (await Promise.all(ids.map((id) => readMessages(id, { limit: 2000 }).catch(() => [])))).flat();
      const needle = q.toLowerCase();
      const items = all
        .filter((m) => matchesKind(m, tab))
        .filter((m) => !needle || `${m.text || ''} ${m.media?.name || ''}`.toLowerCase().includes(needle))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setState({ items, hasMore: false, loading: false, offline: true });
    }
  }

  useEffect(() => {
    setState({ items: null, hasMore: false, loading: true, offline: false });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, conversationId]);

  const items = state.items || [];
  const chatName = (m) => (conversationId ? null : conversationTitle(conversations[m.conversationId], me));
  const showInChat = (m) => {
    const chat = useChat.getState();
    chat.openConversation(m.conversationId);
    chat.jumpTo(m.conversationId, m.id);
    useUI.getState().closePanel();
  };
  const open = (m) => {
    if (m.type === 'image' || m.type === 'video') return openViewer({ url: m.media.url, type: m.type, name: m.media.name });
    if (m.type === 'file' && tab !== 'links' && tab !== 'starred') return openDocument(m.media).catch((e) => toast(e.message, 'error'));
    const url = firstLink(m.text);
    if (url && tab !== 'starred') return window.open(url, '_blank', 'noopener');
    return showInChat(m);
  };

  const mediaOnly = tab === 'media';
  const grid = useMemo(() => (mediaOnly ? items : []), [mediaOnly, items]);

  return (
    <div className="shared-browser">
      <div className="panel-search shared-search">
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${SHARED_TABS.find((t) => t.id === tab).label.toLowerCase()}`} />
      </div>
      <div className="shared-tabs" role="tablist">
        {SHARED_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {counts && counts[t.id] > 0 && <span className="shared-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      {state.offline && <p className="hint shared-offline">Offline: showing what’s saved on this device.</p>}

      {mediaOnly ? (
        <div className="media-grid shared-grid">
          {grid.map((m) => (
            <button key={m.id} onClick={() => open(m)} title={chatName(m) || ''}>
              <Thumb message={m} />
              {m.type === 'video' && (
                <span className="grid-play">
                  <Play size={16} fill="currentColor" />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        items.map((m) => {
          const media = m.type === 'image' || m.type === 'video';
          const apk = m.type === 'file' && isApk(m);
          const link = !media && m.type !== 'file' ? firstLink(m.text) : null;
          let icon;
          let title;
          let sub;
          if (tab === 'starred') {
            icon = <Star size={18} />;
            title = previewText(m);
          } else if (media) {
            icon = (
              <span className="shared-row-thumb">
                <Thumb message={m} />
              </span>
            );
            title = m.type === 'image' ? 'Photo' : 'Video';
            sub = m.text || '';
          } else if (m.type === 'file') {
            icon = apk ? <Smartphone size={20} /> : <FileText size={20} />;
            title = m.media?.name || 'Document';
            sub = `${formatBytes(m.media?.size)} · ${apk ? 'Android app' : (m.media?.name?.split('.').pop() || 'file').toUpperCase()}`;
          } else {
            icon = <Link2 size={20} />;
            title = link ? link.replace(/^https?:\/\//, '').slice(0, 80) : m.text;
            sub = m.text && m.text !== link ? m.text.slice(0, 120) : '';
          }
          return (
            <div key={m.id} className="shared-row">
              <button className="shared-row-main" onClick={() => open(m)}>
                <span className="shared-row-icon">{icon}</span>
                <span className="shared-row-text">
                  <span className="shared-row-title">{title}</span>
                  {sub && <span className="shared-row-sub">{sub}</span>}
                  <span className="shared-row-meta">
                    {chatName(m) ? `${chatName(m)} · ` : ''}
                    {formatListTime(m.createdAt)}
                  </span>
                </span>
              </button>
              <button className="link-btn shared-goto" onClick={() => showInChat(m)}>
                Show in chat
              </button>
            </div>
          );
        })
      )}

      {state.loading && <p className="panel-empty">Loading…</p>}
      {!state.loading && !items.length && (
        <p className="panel-empty">{q ? `Nothing matches “${q}”.` : `No ${SHARED_TABS.find((t) => t.id === tab).label.toLowerCase()} yet.`}</p>
      )}
      {!state.loading && state.hasMore && (
        <button className="btn btn-ghost btn-block" onClick={() => load(items[items.length - 1]?.createdAt)}>
          Load more
        </button>
      )}
    </div>
  );
}
