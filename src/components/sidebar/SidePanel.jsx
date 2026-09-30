import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';
import { displayName, usePeople } from '../../store/people.js';
import { useUI } from '../../store/ui.js';

export default function SidePanel({ title, children, onBack }) {
  const closePanel = useUI((s) => s.closePanel);
  return (
    <div className="side-panel">
      <header className="side-panel-header">
        <button className="icon-btn" onClick={onBack || closePanel} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <h2>{title}</h2>
      </header>
      <div className="side-panel-body">{children}</div>
    </div>
  );
}

/** People you already chat with, plus server search results for the query. */
export function usePeopleSearch(query) {
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const saved = usePeople((s) => s.saved);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const contacts = useMemo(() => {
    const byId = new Map();
    for (const c of Object.values(conversations)) {
      for (const p of c.participants) if (p.id !== me) byId.set(p.id, p);
    }
    for (const { user } of Object.values(saved)) if (!byId.has(user.id)) byId.set(user.id, { ...user, name: displayName(user) });
    return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [conversations, saved, me]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        setResults(users.map((u) => ({ ...u, name: displayName(u) }))); // registered names are private
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const q = query.trim().toLowerCase();
  const people = q
    ? [
        ...contacts.filter(
          (c) =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.username && c.username.includes(q.replace(/^@/, ''))) ||
            (c.phone && q.replace(/\D/g, '') && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
        ),
        ...results,
      ].filter(
        (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i
      )
    : contacts;

  return { people, loading };
}
