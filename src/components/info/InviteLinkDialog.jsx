import { useEffect, useState } from 'react';
import { Share } from '@capacitor/share';
import { Copy, Link2, RotateCw, Share2 } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import { api } from '../../lib/api.js';
import { inviteLink } from '../../lib/invites.js';
import { toast } from '../../store/ui.js';

/** Group admins: the invite link, to copy, share or reset (the old link then stops working). */
export default function InviteLinkDialog({ conv, onClose }) {
  const [code, setCode] = useState(null);

  useEffect(() => {
    api(`/api/conversations/${conv.id}/invite`).then(
      (d) => setCode(d.code),
      (e) => {
        toast(e.message, 'error');
        onClose();
      }
    );
  }, [conv.id, onClose]);

  const link = code ? inviteLink(code) : '';
  const text = `Follow this link to join my ChatApp group "${conv.name}": ${link}`;

  async function share() {
    try {
      await Share.share({ title: conv.name, text, dialogTitle: 'Share invite link' });
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) navigator.clipboard?.writeText(link).then(() => toast('Link copied'));
    }
  }

  async function reset() {
    if (!window.confirm('Reset the invite link? The current link will stop working.')) return;
    try {
      const d = await api(`/api/conversations/${conv.id}/invite/reset`, { method: 'POST' });
      setCode(d.code);
      toast('New link created');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal title="Invite via link" onClose={onClose} className="invite-dialog">
      <p className="hint">Anyone with ChatApp can follow this link to join this group. Only share it with people you trust.</p>
      <div className="invite-link">
        <Link2 size={20} />
        <span>{link || 'Loading…'}</span>
      </div>
      <div className="invite-actions">
        <button className="person-row action" disabled={!code} onClick={share}>
          <span className="action-icon">
            <Share2 size={20} />
          </span>
          <span className="person-name">Share link</span>
        </button>
        <button
          className="person-row action"
          disabled={!code}
          onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'), () => toast('Could not copy', 'error'))}
        >
          <span className="action-icon">
            <Copy size={20} />
          </span>
          <span className="person-name">Copy link</span>
        </button>
        <button className="person-row action danger" disabled={!code} onClick={reset}>
          <span className="action-icon">
            <RotateCw size={20} />
          </span>
          <span className="person-name">Reset link</span>
        </button>
      </div>
    </Modal>
  );
}
