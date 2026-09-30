import { useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import SidePanel, { usePeopleSearch } from './SidePanel.jsx';
import { PersonRow } from './NewChatPanel.jsx';
import AvatarPicker from '../common/AvatarPicker.jsx';
import { useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export default function NewGroupPanel() {
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const { people } = usePeopleSearch(query);
  const createGroup = useChat((s) => s.createGroup);
  const closePanel = useUI((s) => s.closePanel);

  const isSelected = (p) => selected.some((s) => s.id === p.id);
  const toggle = (p) => setSelected((cur) => (isSelected(p) ? cur.filter((s) => s.id !== p.id) : [...cur, p]));

  async function create() {
    setBusy(true);
    try {
      await createGroup({ name: name.trim(), avatarUrl, memberIds: selected.map((s) => s.id) });
      closePanel();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (step === 2) {
    return (
      <SidePanel title="New group" onBack={() => setStep(1)}>
        <div className="group-setup">
          <AvatarPicker url={avatarUrl} name={name} group onChange={setAvatarUrl} size={120} />
          <input autoFocus className="underline-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
          <p className="hint">
            {selected.length} member{selected.length === 1 ? '' : 's'}: {selected.map((s) => s.name.split(' ')[0]).join(', ')}
          </p>
          <button className="fab static" disabled={!name.trim() || busy} onClick={create} aria-label="Create group">
            <Check size={26} />
          </button>
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel title="Add group members">
      {selected.length > 0 && (
        <div className="selected-chips">
          {selected.map((p) => (
            <button key={p.id} className="chip active" onClick={() => toggle(p)}>
              {p.name.split(' ')[0]} <X size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="panel-search">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search @username, phone number or email" />
      </div>
      {people.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          selected={isSelected(p)}
          onClick={() => toggle(p)}
          right={<span className={`check ${isSelected(p) ? 'on' : ''}`}>{isSelected(p) && <Check size={14} />}</span>}
        />
      ))}
      {!people.length && <p className="panel-empty">Search for people to add.</p>}
      {selected.length > 0 && (
        <button className="fab" onClick={() => setStep(2)} aria-label="Next">
          <ArrowRight size={24} />
        </button>
      )}
    </SidePanel>
  );
}
