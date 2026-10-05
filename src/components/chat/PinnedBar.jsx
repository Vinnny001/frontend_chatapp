import { useState } from 'react';
import { Pin } from 'lucide-react';
import { useChat } from '../../store/chat.js';

/** Pinned messages under the chat header: tap to jump there; with several, each tap moves to the next. */
export default function PinnedBar({ conv, me }) {
  const [index, setIndex] = useState(0);
  const pins = [...(conv.pinned || [])].reverse(); // newest first
  if (!pins.length) return null;
  const i = index % pins.length;
  const pin = pins[i];
  const who = pin.sender === me ? 'You' : conv.participants.find((p) => p.id === pin.sender)?.name || 'Someone';
  return (
    <button
      type="button"
      className="pinned-bar"
      onClick={() => {
        useChat.getState().jumpTo(conv.id, pin.messageId);
        setIndex(i + 1);
      }}
      aria-label={`Pinned message ${i + 1} of ${pins.length}`}
    >
      {pins.length > 1 && (
        <span className="pin-steps" aria-hidden="true">
          {pins.map((p, k) => (
            <span key={p.messageId} className={k === i ? 'on' : ''} />
          ))}
        </span>
      )}
      <Pin size={16} className="pin-icon" />
      <span className="pinned-body">
        <strong>{pins.length > 1 ? `Pinned message ${i + 1} of ${pins.length}` : 'Pinned message'}</strong>
        <span>
          {who}: {pin.preview || 'Message'}
        </span>
      </span>
    </button>
  );
}
