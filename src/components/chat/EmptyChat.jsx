import { Lock, MessageCircle } from 'lucide-react';

export default function EmptyChat() {
  return (
    <div className="empty-chat">
      <div className="empty-art">
        <MessageCircle size={64} strokeWidth={1.4} />
      </div>
      <h2>ChatApp for web</h2>
      <p>Send and receive messages in real time. Pick a chat on the left, or start a new one.</p>
      <p className="empty-foot">
        <Lock size={14} /> Your messages sync instantly across web and mobile.
      </p>
    </div>
  );
}
