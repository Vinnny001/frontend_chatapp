import { useState } from 'react';
import { BarChart3, Check, Plus, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Modal from '../common/Modal.jsx';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';

const MAX_OPTIONS = 12;

/** A poll in a chat: tap an option to vote (again to take it back); bars show the counts. */
export function PollBody({ msg, conv, me }) {
  const [votesOpen, setVotesOpen] = useState(false);
  const { question, options, multiple, votes } = msg.poll;
  const mine = votes.filter((v) => v.user === me).map((v) => v.option);
  const voters = new Set(votes.map((v) => v.user)).size;
  const count = (id) => votes.filter((v) => v.option === id).length;
  const top = Math.max(1, ...options.map((o) => count(o.id)));
  const pending = !!msg.pending;

  function pick(id) {
    if (pending) return;
    const next = mine.includes(id) ? mine.filter((o) => o !== id) : multiple ? [...mine, id] : [id];
    useChat.getState().vote(msg, next);
  }

  return (
    <div className="poll" onClick={(e) => e.stopPropagation()}>
      <div className="poll-question">
        <BarChart3 size={16} />
        <strong>{question}</strong>
      </div>
      <span className="poll-hint">{multiple ? 'Select one or more' : 'Select one'}</span>
      <div className="poll-options" role={multiple ? 'group' : 'radiogroup'} aria-label={question}>
        {options.map((o) => {
          const n = count(o.id);
          const on = mine.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`poll-option ${on ? 'on' : ''}`}
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={on}
              disabled={pending}
              onClick={() => pick(o.id)}
            >
              <span className={`poll-check ${multiple ? 'square' : ''}`}>{on && <Check size={13} strokeWidth={3} />}</span>
              <span className="poll-text">
                <span className="poll-row">
                  <span>{o.text}</span>
                  <span className="poll-count">{n}</span>
                </span>
                <span className="poll-bar">
                  <span style={{ width: `${(n / top) * 100}%` }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="poll-votes-btn" disabled={!voters} onClick={() => setVotesOpen(true)}>
        {voters ? `View votes · ${voters} ${voters === 1 ? 'person' : 'people'}` : 'No votes yet'}
      </button>
      {votesOpen && <PollVotes poll={msg.poll} conv={conv} me={me} onClose={() => setVotesOpen(false)} />}
    </div>
  );
}

/** Who voted for what (like WhatsApp's "View votes"). */
function PollVotes({ poll, conv, me, onClose }) {
  const person = (id) => (id === me ? { name: 'You', avatarUrl: useAuth.getState().user?.avatarUrl } : conv.participants.find((p) => p.id === id) || { name: 'Someone' });
  return (
    <Modal title="Poll details" onClose={onClose} className="poll-details">
      <h3 className="poll-details-q">{poll.question}</h3>
      {poll.options.map((o) => {
        const who = poll.votes.filter((v) => v.option === o.id).map((v) => v.user);
        return (
          <section key={o.id} className="poll-details-option">
            <header>
              <strong>{o.text}</strong>
              <span>
                {who.length} vote{who.length === 1 ? '' : 's'}
              </span>
            </header>
            {who.map((id) => {
              const p = person(id);
              return (
                <div key={id} className="reaction-person">
                  <Avatar name={p.name} url={p.avatarUrl} size={36} />
                  <span className="person-name">{p.name}</span>
                </div>
              );
            })}
          </section>
        );
      })}
    </Modal>
  );
}

/** "Create poll": a question, 2–12 options, and whether people may pick several. */
export function PollComposer({ onSend, onClose }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const ready = question.trim() && filled.length >= 2 && !duplicate;

  const setOption = (i, v) =>
    setOptions((list) => {
      const next = list.map((o, k) => (k === i ? v : o));
      // A new empty row appears once the last one is used (up to 12).
      if (i === next.length - 1 && v.trim() && next.length < MAX_OPTIONS) next.push('');
      return next;
    });

  return (
    <Modal
      title="Create poll"
      onClose={onClose}
      className="poll-composer"
      footer={
        <button className="btn btn-primary" disabled={!ready} onClick={() => onSend({ question: question.trim(), options: filled, multiple })}>
          Send
        </button>
      }
    >
      <label className="field">
        <span>Question</span>
        <input autoFocus value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" />
      </label>
      <span className="field-label">Options</span>
      {options.map((o, i) => (
        <div key={i} className="poll-composer-option">
          <input value={o} maxLength={100} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} />
          {options.length > 2 && (
            <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((l) => l.filter((_, k) => k !== i))}>
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      {options.length < MAX_OPTIONS && options.every((o) => o.trim()) && (
        <button type="button" className="link-btn" onClick={() => setOptions((l) => [...l, ''])}>
          <Plus size={14} /> Add option
        </button>
      )}
      {duplicate && <p className="hint error-text">Options must be different.</p>}
      <label className="toggle-row">
        <span>Allow multiple answers</span>
        <input type="checkbox" className="switch" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
      </label>
    </Modal>
  );
}
