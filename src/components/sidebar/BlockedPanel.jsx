import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import { PersonRow } from './NewChatPanel.jsx';
import { api } from '../../lib/api.js';
import { useChat } from '../../store/chat.js';
import { displayName } from '../../store/people.js';
import { toast, useUI } from '../../store/ui.js';

/** Settings → Privacy → Blocked contacts: who I blocked; unblock them here. */
export default function BlockedPanel() {
  const [users, setUsers] = useState(null);
  const load = () =>
    api('/api/users/me/blocked')
      .then((d) => setUsers(d.users))
      .catch((e) => {
        toast(e.message, 'error');
        setUsers([]);
      });
  useEffect(() => {
    load();
  }, []);

  async function unblock(user) {
    try {
      await useChat.getState().setBlocked(user.id, false);
      toast(`${displayName(user)} unblocked`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <SidePanel title="Blocked contacts" onBack={() => useUI.getState().openPanel('settings')}>
      {users === null && <p className="panel-empty">Loading…</p>}
      {users?.length === 0 && (
        <div className="panel-empty big">
          <Ban size={40} />
          <p>People you block can’t call you, send you messages or see when you’re online.</p>
        </div>
      )}
      {users?.map((u) => (
        <PersonRow
          key={u.id}
          person={u}
          onClick={() => window.confirm(`Unblock ${displayName(u)}?`) && unblock(u)}
          right={<span className="link-btn">Unblock</span>}
        />
      ))}
    </SidePanel>
  );
}
