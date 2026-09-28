import { AlertCircle, Check, CheckCheck, Clock3 } from 'lucide-react';

/**
 * pending: clock · sent: one grey tick · delivered: two grey ticks · read: two blue ticks
 */
export default function Ticks({ status, size = 16 }) {
  if (!status) return null;
  if (status === 'pending') return <Clock3 className="tick tick-pending" size={size - 3} aria-label="Sending" />;
  if (status === 'failed') return <AlertCircle className="tick tick-failed" size={size - 2} aria-label="Not sent" />;
  if (status === 'sent') return <Check className="tick" size={size} aria-label="Sent" />;
  return (
    <CheckCheck
      className={`tick ${status === 'read' ? 'tick-read' : ''}`}
      size={size}
      aria-label={status === 'read' ? 'Read' : 'Delivered'}
    />
  );
}
