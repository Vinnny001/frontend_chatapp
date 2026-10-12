import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import * as e2ee from '../../lib/e2ee/index.js';
import { formatListTime } from '../../lib/format.js';
import { plainMentions } from '../../lib/mentions.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';
import { useUI } from '../../store/ui.js';

function Highlight({ text, query }) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0 || !query) return text;
  const start = Math.max(0, i - 40);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length, i + query.length + 120)}
    </>
  );
}

export default function SearchPanel({ conv }) {
  const me = useAuth((s) => s.user?.id);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return undefined;
    }
    const t = setTimeout(() => {
      // Encrypted messages can only be searched on this device (the server can't read them).
      const needle = q.toLowerCase();
      const local = e2ee.localMessages({ conversationId: conv.id }).filter((m) => (m.text || '').toLowerCase().includes(needle));
      const merge = (server) => [...server, ...local].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      api(`/api/conversations/${conv.id}/search?q=${encodeURIComponent(q)}`)
        .then((d) => setResults(merge(d.messages)))
        .catch(() => setResults(merge([])));
    }, 250);
    return () => clearTimeout(t);
  }, [query, conv.id]);

  function open(m) {
    useChat.getState().jumpTo(conv.id, m.id);
    if (window.matchMedia('(max-width: 1100px)').matches) useUI.getState().setInfoOpen(false);
  }

  return (
    <div className="search-panel">
      <div className="panel-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in this chat" />
      </div>
      {results === null && <p className="panel-empty">Search for messages in this chat.</p>}
      {results?.length === 0 && <p className="panel-empty">No messages found.</p>}
      {results?.map((m) => (
        <button key={m.id} className="search-result" onClick={() => open(m)}>
          <span className="search-meta">
            <strong>{m.sender === me ? 'You' : conv.participants.find((p) => p.id === m.sender)?.name || 'Someone'}</strong>
            <span>{formatListTime(m.createdAt)}</span>
          </span>
          <span className="search-text">
            <Highlight text={plainMentions(m.text, conv, me)} query={query.trim()} />
          </span>
        </button>
      ))}
    </div>
  );
}
