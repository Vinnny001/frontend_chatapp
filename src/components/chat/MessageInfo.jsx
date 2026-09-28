import { CheckCheck, Check } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import Avatar from '../common/Avatar.jsx';
import { formatDayLabel, formatTime } from '../../lib/format.js';

/** Who has received / read one of my messages, derived from each member's receipt watermark. */
export default function MessageInfo({ msg, conv, me, onClose }) {
  const t = Date.parse(msg.createdAt);
  const others = conv.participants.filter((p) => p.id !== me);
  const read = others.filter((p) => Date.parse(p.lastReadAt) >= t);
  const delivered = others.filter((p) => !read.includes(p) && Date.parse(p.lastDeliveredAt) >= t);
  const pending = others.filter((p) => !read.includes(p) && !delivered.includes(p));

  const section = (title, icon, people) =>
    people.length > 0 && (
      <section className="info-section">
        <h3 className="section-label">
          {icon} {title}
        </h3>
        {people.map((p) => (
          <div key={p.id} className="person-row static">
            <Avatar name={p.name} url={p.avatarUrl} size={38} />
            <span className="person-name">{p.name}</span>
          </div>
        ))}
      </section>
    );

  return (
    <Modal title="Message info" onClose={onClose}>
      <p className="hint">
        Sent {formatDayLabel(msg.createdAt).toLowerCase()} at {formatTime(msg.createdAt)}
      </p>
      {section('Read by', <CheckCheck size={16} className="tick-read" />, read)}
      {section('Delivered to', <CheckCheck size={16} />, delivered)}
      {section('Not delivered yet', <Check size={16} />, pending)}
    </Modal>
  );
}
