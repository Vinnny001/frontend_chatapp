import { useState } from 'react';
import { AlertCircle, Clock, Pencil, Trash2 } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import { plainMentions } from '../../lib/mentions.js';
import { useChat } from '../../store/chat.js';
import { toast } from '../../store/ui.js';

// Scheduled messages: written now, sent by the server at the chosen time (encrypted on this
// device first, so the server never sees what they say).

const pad = (n) => String(n).padStart(2, '0');
/** A Date as the value of <input type="datetime-local"> (local time). */
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MAX_DAYS = 30;

function presets() {
  const now = new Date();
  const inHour = new Date(Math.ceil((+now + 3600_000) / 300_000) * 300_000); // next 5 minutes after +1 h
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { label: 'In 1 hour', at: inHour },
    +tonight > +now + 60_000 && { label: 'Tonight 8:00 pm', at: tonight },
    { label: 'Tomorrow 9:00 am', at: tomorrow },
  ].filter(Boolean);
}

export function formatWhen(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** Picks a time (presets or any date/time up to 30 days ahead). */
function WhenPicker({ value, onChange }) {
  const min = localInput(new Date(Date.now() + 60_000));
  const max = localInput(new Date(Date.now() + MAX_DAYS * 864e5 - 60_000));
  return (
    <div className="when-picker">
      <div className="when-presets">
        {presets().map((p) => (
          <button key={p.label} type="button" className={`chip ${value === localInput(p.at) ? 'active' : ''}`} onClick={() => onChange(localInput(p.at))}>
            {p.label}
          </button>
        ))}
      </div>
      <input type="datetime-local" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} aria-label="Send at" />
    </div>
  );
}

/**
 * Schedule a message. `text` is what's in the message box (it can be changed here);
 * `toTokens` turns its @mentions into the form that's sent.
 */
export function ScheduleDialog({ conv, text: initialText = '', replyTo, toTokens = (t) => t, onClose, onScheduled }) {
  const [text, setText] = useState(initialText);
  const [when, setWhen] = useState(() => localInput(presets()[0].at));
  const [busy, setBusy] = useState(false);

  async function schedule() {
    const body = text.trim();
    if (!body) return toast('Write the message first');
    const at = new Date(when);
    if (Number.isNaN(+at) || +at < Date.now() + 30_000) return toast('Choose a time in the future');
    if (+at > Date.now() + MAX_DAYS * 864e5) return toast(`Messages can be scheduled up to ${MAX_DAYS} days ahead`);
    setBusy(true);
    try {
      await useChat.getState().scheduleMessage(conv.id, { text: toTokens(body), replyTo }, at);
      toast(`Scheduled for ${formatWhen(at.toISOString())}`);
      onScheduled?.();
      onClose();
    } catch (e) {
      toast(e.status === 0 ? 'Connect to the internet to schedule a message.' : e.message, 'error');
      setBusy(false);
    }
    return undefined;
  }

  return (
    <Modal
      title="Schedule message"
      onClose={busy ? () => {} : onClose}
      className="schedule-dialog"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={schedule} disabled={busy || !text.trim()}>
            <Clock size={16} /> {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </>
      }
    >
      <textarea autoFocus rows={3} maxLength={65536} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message to schedule" />
      <WhenPicker value={when} onChange={setWhen} />
      <p className="hint">It’s sent at that time even if your phone is off. Only you see it until then.</p>
    </Modal>
  );
}

/** "2 scheduled messages" above the message box; opens the list. */
export function ScheduledBar({ conv, me }) {
  const list = useChat((s) => s.scheduled[conv.id]);
  const [open, setOpen] = useState(false);
  if (!list?.length) return null;
  const failed = list.filter((x) => x.state === 'failed').length;
  return (
    <>
      <button className={`scheduled-bar ${failed ? 'failed' : ''}`} onClick={() => setOpen(true)}>
        {failed ? <AlertCircle size={16} /> : <Clock size={16} />}
        <span>
          {list.length} scheduled {list.length === 1 ? 'message' : 'messages'}
          {failed ? ` · ${failed} couldn’t be sent` : ` · next ${formatWhen(list[0].sendAt)}`}
        </span>
      </button>
      {open && <ScheduledList conv={conv} me={me} onClose={() => setOpen(false)} />}
    </>
  );
}

function ScheduledRow({ item, conv, me }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => localInput(new Date(Math.max(Date.parse(item.sendAt), Date.now() + 3600_000))));
  const [busy, setBusy] = useState(false);
  const chat = useChat.getState();

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`scheduled-row ${item.state}`}>
      <div className="scheduled-text">
        {item.text != null ? plainMentions(item.text, conv, me) : <em>Scheduled on another of your devices</em>}
      </div>
      <div className="scheduled-meta">
        <Clock size={14} /> {formatWhen(item.sendAt)}
        {item.state === 'failed' && <span className="scheduled-error">Not sent: {item.error || 'failed'}</span>}
      </div>
      {editing ? (
        <div className="scheduled-edit">
          <WhenPicker value={when} onChange={setWhen} />
          <div className="row-end">
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => act(() => chat.rescheduleMessage(conv.id, item.id, new Date(when)).then(() => setEditing(false)), 'Time changed')}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="scheduled-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil size={14} /> {item.state === 'failed' ? 'Try again at…' : 'Change time'}
          </button>
          <button
            className="btn btn-ghost btn-sm danger"
            disabled={busy}
            onClick={() => window.confirm('Delete this scheduled message?') && act(() => chat.cancelScheduled(conv.id, item.id), 'Scheduled message deleted')}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </li>
  );
}

function ScheduledList({ conv, me, onClose }) {
  const list = useChat((s) => s.scheduled[conv.id]) || [];
  return (
    <Modal title="Scheduled messages" onClose={onClose} className="scheduled-list">
      {list.length ? (
        <ul>
          {list.map((item) => (
            <ScheduledRow key={item.id} item={item} conv={conv} me={me} />
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing scheduled.</p>
      )}
    </Modal>
  );
}
