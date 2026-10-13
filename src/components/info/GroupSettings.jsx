import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Send, UserCheck, UserPlus, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Modal from '../common/Modal.jsx';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { useChat } from '../../store/chat.js';
import { displayName } from '../../store/people.js';
import { toast } from '../../store/ui.js';

/** One "All members / Only admins" choice. */
function WhoCan({ icon: Icon, label, hint, value, onChange }) {
  return (
    <div className="group-setting">
      <span className="group-setting-label">
        <Icon size={18} />
        <span>
          {label}
          <small>{hint}</small>
        </span>
      </span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {[
          ['all', 'All members'],
          ['admins', 'Only admins'],
        ].map(([v, text]) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => value !== v && onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Group settings (admins), as on WhatsApp: who can edit info, send, add people; join approval. */
export default function GroupSettings({ conv }) {
  const { updateConversation } = useChat.getState();
  const [reviewing, setReviewing] = useState(false);
  const perms = conv.permissions || { editInfo: 'admins', addMembers: 'admins' };

  const save = async (data) => {
    try {
      await updateConversation(conv.id, data);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (conv.me?.role !== 'admin') return <p className="panel-empty">Only group admins can change these settings.</p>;

  return (
    <div className="group-settings">
      <section className="info-card">
        <h3 className="section-label">Members can</h3>
        <WhoCan
          icon={Pencil}
          label="Edit group info"
          hint="Name, photo, description and disappearing messages"
          value={perms.editInfo}
          onChange={(editInfo) => save({ editInfo })}
        />
        <WhoCan
          icon={Send}
          label="Send messages"
          hint="Admins can always send"
          value={conv.onlyAdminsCanSend ? 'admins' : 'all'}
          onChange={(v) => save({ onlyAdminsCanSend: v === 'admins' })}
        />
        <WhoCan icon={UserPlus} label="Add other members" hint="Admins can always add people" value={perms.addMembers} onChange={(addMembers) => save({ addMembers })} />
      </section>

      <section className="info-card">
        <h3 className="section-label">Joining</h3>
        <label className="toggle-row">
          <span>
            <UserCheck size={18} /> Approve new members
            <small>People who use the invite link wait until an admin lets them in</small>
          </span>
          <input type="checkbox" className="switch" checked={!!conv.approveJoins} onChange={(e) => save({ approveJoins: e.target.checked })} />
        </label>
        <button className="person-row action" onClick={() => setReviewing(true)}>
          <span className="action-icon">
            <UserCheck size={20} />
          </span>
          <span className="person-name">Pending requests</span>
          {conv.pendingJoins > 0 && <span className="badge">{conv.pendingJoins}</span>}
        </button>
      </section>

      {reviewing && <JoinRequests conv={conv} onClose={() => setReviewing(false)} />}
    </div>
  );
}

/** People who asked to join by invite link: approve or decline each. */
export function JoinRequests({ conv, onClose }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api(`/api/conversations/${conv.id}/join-requests`).then(
      (d) => setList(d.requests),
      (e) => {
        toast(e.message, 'error');
        setList([]);
      }
    );
  }, [conv.id]);

  // Fresh whenever the count changes (a new request, or another admin answered one).
  useEffect(load, [load, conv.pendingJoins]);

  async function answer(person, approve) {
    setBusy(person.id);
    try {
      await api(`/api/conversations/${conv.id}/join-requests/${person.id}`, { method: 'POST', body: { approve } });
      setList((l) => l.filter((p) => p.id !== person.id));
      toast(approve ? `${displayName(person)} joined the group` : 'Request declined');
    } catch (e) {
      toast(e.message, 'error');
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Pending requests" onClose={onClose}>
      {!list && <p className="panel-empty">Loading…</p>}
      {list?.length === 0 && <p className="panel-empty">Nobody is waiting to join.</p>}
      {list?.map((p) => (
        <div key={p.id} className="member-row">
          <Avatar name={displayName(p)} url={p.avatarUrl} size={40} />
          <span className="person-info">
            <span className="person-name">{displayName(p)}</span>
            <span className="person-sub">Asked {formatListTime(p.requestedAt)}</span>
          </span>
          <button className="icon-btn" aria-label={`Decline ${displayName(p)}`} title="Decline" disabled={busy === p.id} onClick={() => answer(p, false)}>
            <X size={20} />
          </button>
          <button className="icon-btn accent" aria-label={`Approve ${displayName(p)}`} title="Approve" disabled={busy === p.id} onClick={() => answer(p, true)}>
            <Check size={20} />
          </button>
        </div>
      ))}
    </Modal>
  );
}
