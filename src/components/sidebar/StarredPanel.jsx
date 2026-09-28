import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { conversationTitle, previewText, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export default function StarredPanel() {
  const [messages, setMessages] = useState(null);
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const closePanel = useUI((s) => s.closePanel);

  useEffect(() => {
    api('/api/messages/starred')
      .then((d) => setMessages(d.messages))
      .catch((e) => {
        toast(e.message, 'error');
        setMessages([]);
      });
  }, []);

  function open(m) {
    const { openConversation, jumpTo } = useChat.getState();
    openConversation(m.conversationId);
    jumpTo(m.conversationId, m.id);
    closePanel();
  }

  return (
    <SidePanel title="Starred messages">
      {messages === null && <p className="panel-empty">Loading…</p>}
      {messages?.length === 0 && (
        <div className="panel-empty big">
          <Star size={40} />
          <p>Tap and hold (or right-click) any message and choose “Star” to find it here later.</p>
        </div>
      )}
      {messages?.map((m) => {
        const conv = conversations[m.conversationId];
        const sender = conv?.participants.find((p) => p.id === m.sender);
        return (
          <button key={m.id} className="starred-row" onClick={() => open(m)}>
            <span className="starred-meta">
              <strong>{m.sender === me ? 'You' : sender?.name || 'Someone'}</strong>
              {conv && conv.type === 'group' && <> › {conversationTitle(conv, me)}</>}
              <span className="starred-time">{formatListTime(m.createdAt)}</span>
            </span>
            <span className="starred-text">{previewText(m)}</span>
          </button>
        );
      })}
    </SidePanel>
  );
}
