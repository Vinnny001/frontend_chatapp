import { useEffect, useState } from 'react';
import { Check, CheckCheck, Clock3 } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import Avatar from '../common/Avatar.jsx';
import { api } from '../../lib/api.js';
import { formatDayLabel, formatTime } from '../../lib/format.js';

const SHOW_FIRST = 20; // a longer list opens with "Show N more"

const when = (iso) => (iso ? `${formatDayLabel(iso)}, ${formatTime(iso)}` : null);

/** A group's list of people (read by / delivered to / remaining), expandable past 20. */
function Section({ title, icon, people, timeOf, empty }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, SHOW_FIRST);
  return (
    <section className="info-section msg-info-section">
      <h3 className="section-label">
        {icon} {title} <span className="msg-info-count">{people.length}</span>
      </h3>
      {!people.length && <p className="hint">{empty}</p>}
      {shown.map((p) => (
        <div key={p.id} className="person-row static">
          <Avatar name={p.name} url={p.avatarUrl} size={38} />
          <span className="person-info">
            <span className="person-name">{p.name}</span>
            {timeOf && <span className="person-sub">{when(timeOf(p)) || 'Time not recorded'}</span>}
          </span>
        </div>
      ))}
      {people.length > SHOW_FIRST && (
        <button className="link-btn msg-info-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${people.length - SHOW_FIRST} more`}
        </button>
      )}
    </section>
  );
}

function Line({ icon, label, at, missing }) {
  return (
    <div className="msg-info-line">
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{at ? when(at) : missing}</small>
      </span>
    </div>
  );
}

/**
 * Message info (for my messages): one to one, when it was sent, delivered and read; in a group,
 * who read it and when, who got it and when, and who hasn't yet.
 */
export default function MessageInfo({ msg, conv, me, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!msg.id || msg.pending) return;
    api(`/api/messages/${msg.id}/info`).then(setInfo, (e) => setError(e.message));
  }, [msg.id, msg.pending]);

  const people = (info?.recipients || []).map((r) => ({ ...r, ...(conv.participants.find((p) => p.id === r.id) || { name: 'Someone' }) , id: r.id }));
  const group = conv.type === 'group';

  return (
    <Modal title="Message info" onClose={onClose}>
      {msg.pending ? (
        <p className="hint">Not sent yet.</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : !info ? (
        <p className="panel-empty">Loading…</p>
      ) : !group ? (
        <div className="msg-info-lines">
          <Line icon={<Check size={18} />} label="Sent" at={info.sentAt} />
          <Line
            icon={<CheckCheck size={18} />}
            label="Delivered"
            at={people[0]?.deliveredAt}
            missing={msg.e2eePending ? 'Not yet: waiting for their device' : people[0]?.delivered ? 'Delivered (time not recorded)' : 'Not yet'}
          />
          <Line
            icon={<CheckCheck size={18} className="tick-read" />}
            label="Read"
            at={people[0]?.readAt}
            missing={people[0]?.read ? 'Read (time not recorded)' : 'Not yet'}
          />
        </div>
      ) : (
        <>
          <p className="hint">
            Sent {formatDayLabel(info.sentAt).toLowerCase()} at {formatTime(info.sentAt)}
          </p>
          <Section
            title="Read by"
            icon={<CheckCheck size={16} className="tick-read" />}
            people={people.filter((p) => p.read).sort((a, b) => Date.parse(a.readAt || 0) - Date.parse(b.readAt || 0))}
            timeOf={(p) => p.readAt}
            empty="Nobody yet."
          />
          <Section
            title="Delivered to"
            icon={<CheckCheck size={16} />}
            people={people.filter((p) => p.delivered && !p.read).sort((a, b) => Date.parse(a.deliveredAt || 0) - Date.parse(b.deliveredAt || 0))}
            timeOf={(p) => p.deliveredAt}
            empty="Nobody else."
          />
          <Section
            title="Remaining"
            icon={<Clock3 size={16} />}
            people={people.filter((p) => !p.delivered).sort((a, b) => (a.name || '').localeCompare(b.name || ''))}
            empty="Everyone got it."
          />
        </>
      )}
    </Modal>
  );
}
