import { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../../lib/api.js';
import { useChat } from '../../store/chat.js';
import { toast } from '../../store/ui.js';

const REASONS = [
  ['spam', 'Spam'],
  ['scam', 'Scam or fraud'],
  ['harassment', 'Harassment or bullying'],
  ['inappropriate', 'Inappropriate content'],
  ['impersonation', 'Pretending to be someone else'],
  ['other', 'Something else'],
];

/** Report someone; their last 5 messages in this chat go with the report (as on WhatsApp). */
export default function ReportDialog({ user, name, conversationId, onClose }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api(`/api/users/${user.id}/report`, {
        method: 'POST',
        body: { reason, details: details.trim() || undefined, conversationId, block },
      });
      if (block) await useChat.getState().loadConversations().catch(() => {});
      toast(block ? `${name} was reported and blocked` : `${name} was reported`);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Report ${name}`}
      onClose={onClose}
      className="report-dialog"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : 'Report'}
          </button>
        </>
      }
    >
      <p className="hint">The last 5 messages from {name} in this chat are sent with your report. {name} won’t be told.</p>
      <div className="report-reasons">
        {REASONS.map(([id, label]) => (
          <label key={id} className="radio-row">
            <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} />
            {label}
          </label>
        ))}
      </div>
      <textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="More details (optional)" />
      <label className="radio-row">
        <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
        Also block {name}
      </label>
    </Modal>
  );
}
