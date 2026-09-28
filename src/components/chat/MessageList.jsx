import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDown, Timer } from 'lucide-react';
import MessageBubble from './MessageBubble.jsx';
import { formatDayLabel, sameDay } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 160;

export default function MessageList({ conv }) {
  const me = useAuth((s) => s.user?.id);
  const thread = useChat((s) => s.threads[conv.id]);
  const highlight = useChat((s) => s.highlight);
  const loadMessages = useChat((s) => s.loadMessages);
  const scroller = useRef(null);
  const nearBottom = useRef(true);
  const prevEdges = useRef({ first: null, last: null, height: 0 });
  const [showJump, setShowJump] = useState(false);
  const [flashId, setFlashId] = useState(null);

  // Where the "unread messages" divider goes: captured once, when the chat is opened.
  const [unread] = useState(() => {
    const mine = conv.participants.find((p) => p.id === me);
    return conv.me?.unreadCount > 0 && mine ? { from: Date.parse(mine.lastReadAt), count: conv.me.unreadCount } : null;
  });

  const items = thread?.items || [];
  const firstUnreadId = useMemo(
    () => (unread ? items.find((m) => m.sender !== me && m.type !== 'system' && Date.parse(m.createdAt) > unread.from)?.id : null),
    [items, unread, me]
  );

  // Keep the viewport stable when older messages are prepended; stick to the bottom for new ones.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !items.length) return;
    const first = items[0].clientId || items[0].id;
    const lastMsg = items[items.length - 1];
    const last = lastMsg.clientId || lastMsg.id;
    const prev = prevEdges.current;

    if (prev.first === null) {
      const divider = el.querySelector('.unread-divider');
      if (divider) divider.scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
    } else if (first !== prev.first && last === prev.last) {
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (last !== prev.last && (nearBottom.current || lastMsg.sender === me)) {
      el.scrollTo({ top: el.scrollHeight, behavior: prev.last ? 'smooth' : 'auto' });
    }
    prevEdges.current = { first, last, height: el.scrollHeight };
  }, [items, me]);

  // Scroll to a message picked from search / starred / a reply quote.
  useEffect(() => {
    if (!highlight || highlight.convId !== conv.id) return undefined;
    const el = scroller.current?.querySelector(`[data-mid="${highlight.id}"]`);
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(highlight.id);
    const t = setTimeout(() => setFlashId(null), 1800);
    return () => clearTimeout(t);
  }, [highlight, conv.id, items.length]);

  function onScroll() {
    const el = scroller.current;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = distance < NEAR_BOTTOM_PX;
    setShowJump(distance > 600);
    if (el.scrollTop < 300 && thread?.hasMore && !thread.loading) loadMessages(conv.id, { older: true });
  }

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      <div className="messages-inner">
        {thread?.loading && <div className="loading-older">Loading…</div>}
        {thread?.loaded && !thread.hasMore && (
          <div className="system-pill intro">
            {conv.disappearingSeconds > 0 && <Timer size={13} />}
            {conv.type === 'group' ? 'Messages in this group sync in real time across all your devices.' : 'This is the beginning of your conversation.'}
          </div>
        )}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const grouped =
            !newDay &&
            prev &&
            prev.sender === m.sender &&
            prev.type !== 'system' &&
            Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
          return (
            <Fragment key={m.clientId || m.id}>
              {newDay && (
                <div className="day-divider">
                  <span>{formatDayLabel(m.createdAt)}</span>
                </div>
              )}
              {m.id === firstUnreadId && (
                <div className="unread-divider">
                  <span>
                    {unread.count} unread message{unread.count === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              <MessageBubble msg={m} conv={conv} me={me} grouped={grouped} flash={flashId === m.id} />
            </Fragment>
          );
        })}
      </div>
      {showJump && (
        <button
          className="jump-bottom"
          onClick={() => scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
          aria-label="Scroll to latest"
        >
          <ChevronsDown size={22} />
          {conv.me?.unreadCount > 0 && <span className="badge">{conv.me.unreadCount}</span>}
        </button>
      )}
    </div>
  );
}
