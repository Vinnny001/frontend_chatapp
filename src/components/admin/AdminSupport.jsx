import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { onSupportUpdate } from '../../lib/supportEvents.js';
import { toast } from '../../store/ui.js';
import { TicketThread } from '../help/HelpPanel.jsx';

const FILTERS = [
  ['open', 'Waiting for us'],
  ['answered', 'Answered'],
  ['closed', 'Closed'],
  ['all', 'All'],
];

/** The support inbox: users' requests from Help → Contact support, and our replies. */
export default function AdminSupport({ onCount }) {
  const [state, setState] = useState('open');
  const [list, setList] = useState(null);
  const [current, setCurrent] = useState(null);
  const [sending, setSending] = useState(false);

  const load = () =>
    api(`/api/support/admin/tickets?state=${state}`).then(
      (d) => {
        setList(d.tickets);
        onCount?.(d.openCount);
        setCurrent((c) => (c ? d.tickets.find((t) => t.id === c.id) || c : c));
      },
      (e) => toast(e.message, 'error')
    );
  useEffect(() => {
    load();
    return onSupportUpdate(() => load());
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => {
    setSending(true);
    try {
      const { ticket } = await fn();
      setCurrent((c) => ({ ...ticket, user: c.user }));
      load();
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    } finally {
      setSending(false);
    }
  };

  if (current) {
    return (
      <div className="admin-support">
        <button className="btn btn-ghost" onClick={() => setCurrent(null)}>
          <ArrowLeft size={16} /> All requests
        </button>
        <div className="admin-support-user">
          <strong>{current.user?.name || current.user?.username || 'User'}</strong>
          <span>{[current.user?.username && `@${current.user.username}`, current.user?.email].filter(Boolean).join(' · ')}</span>
          <span>
            Topic: {current.topic}
            {current.device ? ` · ${current.device}` : ''}
          </span>
        </div>
        <TicketThread
          ticket={current}
          asSupport
          sending={sending}
          onReply={(text) => act(() => api(`/api/support/tickets/${current.id}/messages`, { method: 'POST', body: { text } }))}
          onClose={() => act(() => api(`/api/support/tickets/${current.id}/close`, { method: 'POST' }))}
        />
      </div>
    );
  }

  return (
    <div className="admin-support">
      <div className="segmented">
        {FILTERS.map(([v, label]) => (
          <button key={v} className={state === v ? 'active' : ''} onClick={() => setState(v)}>
            {label}
          </button>
        ))}
      </div>
      {!list && <p className="panel-empty">Loading…</p>}
      {list?.length === 0 && <p className="panel-empty">No requests here.</p>}
      {list?.map((t) => (
        <button key={t.id} className="admin-ticket" onClick={() => setCurrent(t)}>
          <span className="admin-ticket-top">
            <strong>{t.subject}</strong>
            <small>{formatListTime(t.updatedAt)}</small>
          </span>
          <span className="admin-ticket-sub">
            {t.user?.name || t.user?.username || 'User'} · {t.topic} · {t.messages.length} message{t.messages.length === 1 ? '' : 's'}
          </span>
          <span className="admin-ticket-last">{t.messages[t.messages.length - 1]?.text.slice(0, 140)}</span>
        </button>
      ))}
    </div>
  );
}
