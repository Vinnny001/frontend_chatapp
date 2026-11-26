import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Pencil, Trash2 } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import { plainMentions } from '../../lib/mentions.js';
import { SCHEDULE_PER_CHAT, scheduleLimitText, useChat } from '../../store/chat.js';
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

/** A message box that grows with its text (up to about half the screen, then scrolls). */
function GrowingText({ value, onChange, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`; // (+ the border)
  }, [value]);
  return <textarea ref={ref} className="schedule-text" rows={3} maxLength={65536} value={value} onChange={(e) => onChange(e.target.value)} {...props} />;
}

/** The current time, updated every second while shown. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "2d 4h", "3h 05m", "4m 09s", "12s" until `at`. */
export function countdown(at, now = Date.now()) {
  const s = Math.max(0, Math.round((Date.parse(at) - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

/**
 * Picks when to send: a preset, or any date and time (up to 30 days ahead). Separate date and
 * time fields open the phone's own calendar and clock pickers.
 */
function WhenPicker({ value, onChange }) {
  const [date, time] = value.split('T');
  const minDay = localInput(new Date()).slice(0, 10);
  const maxDay = localInput(new Date(Date.now() + MAX_DAYS * 864e5 - 60_000)).slice(0, 10);
  const at = new Date(value);
  const valid = !Number.isNaN(+at) && +at > Date.now() + 30_000;
  return (
    <div className="when-picker">
      <div className="when-presets">
        {presets().map((p) => (
          <button key={p.label} type="button" className={`chip ${value === localInput(p.at) ? 'active' : ''}`} onClick={() => onChange(localInput(p.at))}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="when-fields">
        <label>
          Date
          <input type="date" value={date} min={minDay} max={maxDay} onChange={(e) => e.target.value && onChange(`${e.target.value}T${time}`)} />
        </label>
        <label>
          Time
          <input type="time" value={time} onChange={(e) => e.target.value && onChange(`${date}T${e.target.value}`)} />
        </label>
      </div>
      <p className={`when-summary ${valid ? '' : 'invalid'}`}>
        {valid ? `Sends ${formatWhen(at.toISOString())}` : 'Choose a time in the future'}
      </p>
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
  const full = useChat((s) => (s.scheduled[conv.id] || []).length >= SCHEDULE_PER_CHAT);

  async function schedule() {
    if (full) return toast(scheduleLimitText, 'error');
    const body = text.trim();
    if (!body) return toast('Write the message first');
    const at = new Date(when);
    if (Number.isNaN(+at) || +at < Date.now() + 30_000) return toast('Choose a time in the future');
    if (+at > Date.now() + MAX_DAYS * 864e5) return toast(`Messages can be scheduled up to ${MAX_DAYS} days ahead`);
    setBusy(true);
    try {
      const item = await useChat.getState().scheduleMessage(conv.id, { text: toTokens(body), replyTo }, at);
      toast(
        item?.local
          ? `Scheduled for ${formatWhen(at.toISOString())}. You’re offline: it’s handed over as soon as you’re connected.`
          : `Scheduled for ${formatWhen(at.toISOString())}`
      );
      onScheduled?.();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
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
          <button className="btn btn-primary" onClick={schedule} disabled={busy || full || !text.trim()}>
            <Clock size={16} /> {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </>
      }
    >
      {full && <p className="when-summary invalid">{scheduleLimitText}</p>}
      <GrowingText autoFocus value={text} onChange={setText} placeholder="Message" aria-label="Message to schedule" />
      <WhenPicker value={when} onChange={setWhen} />
      <p className="hint">
        It’s sent at that time even if your phone is off or offline then. Only you see it until then, and you can edit it
        until it goes out. Up to {SCHEDULE_PER_CHAT} per chat.
      </p>
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

function ScheduledRow({ item, conv, me, now }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const chat = useChat.getState();
  // Its text is only known on the device it was scheduled on (it's encrypted there).
  const canEditText = item.text != null;
  const due = Date.parse(item.sendAt) <= now;
  // (Too close to its time: it may be going out right now.)
  const locked = item.state === 'pending' && Date.parse(item.sendAt) - now < 5000;

  const startEditing = () => {
    const at = Date.parse(item.sendAt);
    setWhen(localInput(new Date(item.state === 'failed' || at < Date.now() + 60_000 ? Math.max(at, Date.now() + 3600_000) : at)));
    setText(item.text ?? '');
    setEditing(true);
  };

  async function save() {
    const at = new Date(when);
    if (Number.isNaN(+at) || +at < Date.now() + 30_000) return toast('Choose a time in the future');
    if (+at > Date.now() + MAX_DAYS * 864e5) return toast(`Messages can be scheduled up to ${MAX_DAYS} days ahead`);
    const body = canEditText ? text.trim() : null;
    if (canEditText && !body) return toast('The message can’t be empty. Delete it instead.');
    const textChanged = canEditText && body !== item.text;
    const timeChanged = localInput(new Date(item.sendAt)) !== when || item.state === 'failed';
    if (!textChanged && !timeChanged) return setEditing(false);
    setBusy(true);
    try {
      await chat.editScheduled(conv.id, item.id, { ...(textChanged && { text: body }), ...(timeChanged && { sendAt: at }) });
      toast(textChanged ? 'Scheduled message changed' : 'Time changed');
      setEditing(false);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
    return undefined;
  }

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
      {editing && canEditText ? (
        <GrowingText autoFocus value={text} onChange={setText} placeholder="Message" aria-label="Scheduled message" disabled={busy} />
      ) : (
        <div className="scheduled-text">
          {item.text != null ? plainMentions(item.text, conv, me) : <em>Scheduled on another of your devices</em>}
        </div>
      )}
      <div className="scheduled-meta">
        <Clock size={14} /> {formatWhen(item.sendAt)}
        {item.editedAt && <span className="scheduled-edited">· edited</span>}
        {item.state === 'failed' && <span className="scheduled-error">Not sent: {item.error || 'failed'}</span>}
        {item.state === 'waiting' && (
          <span className="scheduled-waiting">
            Waiting for a connection{due ? ' · sends as soon as you’re online' : ''}
          </span>
        )}
        {item.state !== 'failed' && (
          <span className={`scheduled-countdown ${due ? 'due' : ''}`} aria-label="Time left">
            {due ? (item.state === 'waiting' ? 'Due' : 'Sending…') : `in ${countdown(item.sendAt, now)}`}
          </span>
        )}
      </div>
      {editing ? (
        <div className="scheduled-edit">
          <WhenPicker value={when} onChange={setWhen} />
          <div className="row-end">
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy || (canEditText && !text.trim())} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="scheduled-actions">
          <button className="btn btn-ghost btn-sm" onClick={startEditing} disabled={busy || locked}>
            <Pencil size={14} /> {item.state === 'failed' ? 'Try again at…' : canEditText ? 'Edit' : 'Change time'}
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
  const now = useNow();
  return (
    <Modal title="Scheduled messages" onClose={onClose} className="scheduled-list">
      {list.length ? (
        <ul>
          {list.map((item) => (
            <ScheduledRow key={item.id} item={item} conv={conv} me={me} now={now} />
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing scheduled.</p>
      )}
    </Modal>
  );
}
