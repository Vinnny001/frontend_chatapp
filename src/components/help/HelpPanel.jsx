import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Info, LifeBuoy, Lock, MessageCircleQuestion, Search, Send } from 'lucide-react';
import SidePanel from '../sidebar/SidePanel.jsx';
import { api } from '../../lib/api.js';
import { FAQ } from '../../lib/faq.js';
import { formatListTime } from '../../lib/format.js';
import { onSupportUpdate } from '../../lib/supportEvents.js';
import { toast } from '../../store/ui.js';

const TOPICS = [
  ['account', 'Account and signing in'],
  ['devices', 'Linked devices and sync'],
  ['messages', 'Messages and notifications'],
  ['calls', 'Calls'],
  ['groups', 'Groups'],
  ['status', 'Status'],
  ['privacy', 'Privacy and security'],
  ['other', 'Something else'],
];
const STATE_LABEL = { open: 'Waiting for support', answered: 'Support replied', closed: 'Closed' };

function Question({ item, open, onToggle }) {
  return (
    <div className={`faq-item ${open ? 'open' : ''}`}>
      <button className="faq-q" onClick={onToggle} aria-expanded={open}>
        <span>{item.q}</span>
        <ChevronDown size={18} />
      </button>
      {open && <p className="faq-a">{item.a}</p>}
    </div>
  );
}

/** A conversation with support: their replies and mine. */
export function TicketThread({ ticket, onReply, onClose, sending, asSupport = false }) {
  const [reply, setReply] = useState('');
  return (
    <div className="ticket">
      <div className="ticket-head">
        <strong>{ticket.subject}</strong>
        <span className={`ticket-state ${ticket.state}`}>{STATE_LABEL[ticket.state]}</span>
      </div>
      <div className="ticket-messages">
        {ticket.messages.map((m, i) => (
          <div key={i} className={`ticket-msg ${m.from === (asSupport ? 'support' : 'user') ? 'mine' : ''}`}>
            <span className="ticket-who">{m.from === 'support' ? 'ChatApp support' : asSupport ? 'User' : 'You'}</span>
            <p>{m.text}</p>
            <small>{formatListTime(m.at)}</small>
          </div>
        ))}
      </div>
      {ticket.state !== 'closed' ? (
        <form
          className="ticket-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            onReply(reply.trim()).then(() => setReply(''), () => {});
          }}
        >
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={asSupport ? 'Reply to the user…' : 'Add a message…'} rows={2} maxLength={4000} aria-label="Reply" />
          <div className="row-end">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close request
            </button>
            <button className="btn btn-primary" disabled={!reply.trim() || sending}>
              <Send size={16} /> Send
            </button>
          </div>
        </form>
      ) : (
        <p className="hint">This request is closed. Start a new one if you need more help.</p>
      )}
    </div>
  );
}

function NewRequest({ onDone }) {
  const [topic, setTopic] = useState('other');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [shareDevice, setShareDevice] = useState(true);
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { ticket } = await api('/api/support/tickets', {
        method: 'POST',
        body: { topic, subject, text, ...(shareDevice && { device: navigator.userAgent.slice(0, 300) }) },
      });
      toast('Sent. Support will reply here.');
      onDone(ticket);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="support-form" onSubmit={send}>
      <label>
        <span>Topic</span>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="In a few words" />
      </label>
      <label>
        <span>How can we help?</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000} placeholder="What happened, and what you expected" />
      </label>
      <label className="toggle-row">
        <span>
          Include my app and device version
          <small>Helps us find the problem faster</small>
        </span>
        <input type="checkbox" className="switch" checked={shareDevice} onChange={(e) => setShareDevice(e.target.checked)} />
      </label>
      <p className="hint support-note">
        <Info size={14} /> Messages to support are read by the ChatApp team, so they aren’t end-to-end encrypted. Never send your password or a sign-in code. Your
        chats stay private: support can’t see them.
      </p>
      <button className="btn btn-primary" disabled={busy || subject.trim().length < 3 || !text.trim()}>
        {busy ? 'Sending…' : 'Send to support'}
      </button>
    </form>
  );
}

/** Help: frequently asked questions, and contacting support (with my requests and their replies). */
export default function HelpPanel() {
  const [view, setView] = useState({ name: 'home' }); // home | new | ticket
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [sending, setSending] = useState(false);
  const shown = useRef(view);
  shown.current = view;

  const load = () => api('/api/support/tickets').then((d) => setTickets(d.tickets), () => setTickets([]));
  useEffect(() => {
    load();
    // A reply came in (or it was closed): refresh the list, and the request if it's open here.
    return onSupportUpdate(({ id }) => {
      load();
      if (shown.current.name === 'ticket' && shown.current.ticket.id === id) {
        api(`/api/support/tickets/${id}`).then((d) => setView({ name: 'ticket', ticket: d.ticket }), () => {});
      }
    });
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ;
    return FAQ.map((s) => ({ ...s, items: s.items.filter((i) => `${i.q} ${i.a}`.toLowerCase().includes(q)) })).filter((s) => s.items.length);
  }, [query]);

  async function openTicket(t) {
    const { ticket } = await api(`/api/support/tickets/${t.id}`);
    setView({ name: 'ticket', ticket });
    load();
  }

  if (view.name === 'new') {
    return (
      <SidePanel title="Contact support" onBack={() => setView({ name: 'home' })}>
        <NewRequest
          onDone={(ticket) => {
            load();
            setView({ name: 'ticket', ticket });
          }}
        />
      </SidePanel>
    );
  }
  if (view.name === 'ticket') {
    const { ticket } = view;
    const act = async (fn) => {
      setSending(true);
      try {
        const { ticket: next } = await fn();
        setView({ name: 'ticket', ticket: next });
        load();
      } catch (e) {
        toast(e.message, 'error');
        throw e;
      } finally {
        setSending(false);
      }
    };
    return (
      <SidePanel title="Support request" onBack={() => setView({ name: 'home' })}>
        <TicketThread
          ticket={ticket}
          sending={sending}
          onReply={(text) => act(() => api(`/api/support/tickets/${ticket.id}/messages`, { method: 'POST', body: { text } }))}
          onClose={() => act(() => api(`/api/support/tickets/${ticket.id}/close`, { method: 'POST' }))}
        />
      </SidePanel>
    );
  }

  return (
    <SidePanel title="Help">
      <div className="help-panel">
        <div className="panel-search help-search">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help" aria-label="Search help" />
        </div>

        {results.map((s) => (
          <section key={s.topic} className="faq-section">
            <h3 className="section-label">{s.topic}</h3>
            {s.items.map((item) => (
              <Question key={item.q} item={item} open={open === item.q || !!query.trim()} onToggle={() => setOpen((o) => (o === item.q ? null : item.q))} />
            ))}
          </section>
        ))}
        {!results.length && <p className="panel-empty">No answers match “{query}”. Ask support below.</p>}

        <section className="faq-section">
          <h3 className="section-label">Still need help?</h3>
          <button className="person-row action" onClick={() => setView({ name: 'new' })}>
            <span className="action-icon">
              <LifeBuoy size={20} />
            </span>
            <span className="person-info">
              <span className="person-name">Contact support</span>
              <span className="person-sub">Write to the ChatApp team; we reply here</span>
            </span>
            <ChevronRight size={18} />
          </button>
          {tickets?.length > 0 && <h3 className="section-label">My requests</h3>}
          {tickets?.map((t) => (
            <button key={t.id} className="person-row action ticket-row" onClick={() => openTicket(t).catch((e) => toast(e.message, 'error'))}>
              <span className="action-icon">
                <MessageCircleQuestion size={20} />
              </span>
              <span className="person-info">
                <span className="person-name">{t.subject}</span>
                <span className="person-sub">
                  {STATE_LABEL[t.state]} · {formatListTime(t.updatedAt)}
                </span>
              </span>
              {t.unread && <span className="badge badge-dot" aria-label="New reply" />}
            </button>
          ))}
        </section>
        <p className="hint status-e2ee">
          <Lock size={13} /> Your chats are end-to-end encrypted: support can never read them.
        </p>
      </div>
    </SidePanel>
  );
}
