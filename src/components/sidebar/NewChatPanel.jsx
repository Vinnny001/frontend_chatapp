import { useState } from 'react';
import { Users } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import SidePanel, { usePeopleSearch } from './SidePanel.jsx';
import { useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export function PersonRow({ person, onClick, selected, right }) {
  const online = useChat((s) => s.presence[person.id]?.online);
  return (
    <button className={`person-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <Avatar name={person.name} url={person.avatarUrl} size={44} online={online} />
      <span className="person-info">
        <span className="person-name">{person.name}</span>
        <span className="person-sub">{person.about || person.phone}</span>
      </span>
      {right}
    </button>
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
      <h3 className="section-label">{query ? 'Results' : 'Your contacts'}</h3>
      {people.map((p) => (
        <PersonRow key={p.id} person={p} onClick={() => start(p)} />
      ))}
      {!people.length && (
        <p className="panel-empty">
          {loading ? 'Searching…' : query ? 'No one found. Try their full phone number or email.' : 'Search for someone to start chatting.'}
        </p>
      )}
    </SidePanel>
  );
}
