import { useEffect, useState } from 'react';
import { Link2Off } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Modal from '../common/Modal.jsx';
import { api } from '../../lib/api.js';
import { useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

/** Opened from an invite link (in a message, or from another app): the group, then "Join". */
export default function JoinGroupDialog() {
  const code = useUI((s) => s.joinCode);
  const [info, setInfo] = useState(null); // { group, member } | { error }
  const [joining, setJoining] = useState(false);
  const close = () => useUI.getState().setJoinCode(null);

  useEffect(() => {
    if (!code) return undefined;
    let live = true;
    setInfo(null);
    api(`/api/invites/${code}`).then(
      (d) => live && setInfo(d),
      (e) => live && setInfo({ error: e.message })
    );
    return () => {
      live = false;
    };
  }, [code]);

  if (!code) return null;

  async function join() {
    setJoining(true);
    try {
      const { conversation } = await api(`/api/invites/${code}/join`, { method: 'POST' });
      const chat = useChat.getState();
      chat.upsertConversation(conversation);
      chat.openConversation(conversation.id);
      close();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setJoining(false);
    }
  }

  const g = info?.group;
  return (
    <Modal title="Group invite" onClose={close} className="join-dialog">
      {!info && <p className="panel-empty">Loading…</p>}
      {info?.error && (
        <div className="join-card">
          <Link2Off size={44} className="join-dead" />
          <strong>{info.error}</strong>
          <p className="hint">Ask a group admin for a new link.</p>
        </div>
      )}
      {g && (
        <div className="join-card">
          <Avatar name={g.name} url={g.avatarUrl} group size={96} />
          <h3>{g.name}</h3>
          <p className="hint">
            Group · {g.members} member{g.members === 1 ? '' : 's'}
          </p>
          {g.description && <p className="join-about">{g.description}</p>}
          {info.member ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                useChat.getState().openConversation(g.id);
                close();
              }}
            >
              Open group
            </button>
          ) : (
            <button className="btn btn-primary" onClick={join} disabled={joining}>
              {joining ? 'Joining…' : 'Join group'}
            </button>
          )}
          {info.member && <p className="hint">You're already in this group.</p>}
        </div>
      )}
    </Modal>
  );
}
