import { useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import Avatar from '../common/Avatar.jsx';
import { useAuth } from '../../store/auth.js';
import { canSendIn, conversationTitle, peerOf, previewText, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export default function ForwardDialog() {
  const msg = useUI((s) => s.forwarding);
  const setForwarding = useUI((s) => s.setForwarding);
  const conversations = useChat((s) => s.conversations);
  const me = useAuth((s) => s.user?.id);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);

  const list = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => canSendIn(c, me))
        .filter((c) => conversationTitle(c, me).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)),
    [conversations, me, query]
  );

  if (!msg) return null;

  const close = () => {
    setForwarding(null);
    setSelected([]);
    setQuery('');
  };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  return (
    <Modal
      title="Forward message to"
      onClose={close}
      footer={
        <>
          <span className="hint">{previewText(msg).slice(0, 60)}</span>
          <button
            className="send-btn"
            disabled={!selected.length}
            onClick={() => {
              useChat.getState().forward(msg, selected);
              toast(`Forwarded to ${selected.length} chat${selected.length > 1 ? 's' : ''}`);
              close();
            }}
            aria-label="Forward"
          >
            <Send size={20} />
          </button>
        </>
      }
    >
      <div className="panel-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
      </div>
      <p className="hint">You can forward to up to 5 chats at once.</p>
      {list.map((c) => {
        const on = selected.includes(c.id);
        const title = conversationTitle(c, me);
        return (
          <button key={c.id} className={`person-row ${on ? 'selected' : ''}`} onClick={() => toggle(c.id)}>
            <Avatar name={title} url={c.type === 'group' ? c.avatarUrl : peerOf(c, me)?.avatarUrl} group={c.type === 'group'} size={40} />
            <span className="person-info">
              <span className="person-name">{title}</span>
            </span>
            <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
          </button>
        );
      })}
    </Modal>
  );
}
