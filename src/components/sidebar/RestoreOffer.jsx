import { useState } from 'react';
import { CloudDownload, X } from 'lucide-react';
import { backupAvailable, restoreFromBackup } from '../../lib/googleBackup.js';
import { storage } from '../../lib/storage.js';
import { useAuth } from '../../store/auth.js';
import { toast } from '../../store/ui.js';

/** Restores the Google Drive backup; shared by the chat-list card and Settings. */
export async function restoreChats(me) {
  try {
    const { restored, backupAt } = await restoreFromBackup({ me });
    toast(
      restored
        ? `Restored ${restored} ${restored === 1 ? 'message' : 'messages'} from your backup of ${new Date(backupAt).toLocaleDateString()}`
        : 'Your chats are already up to date with the backup'
    );
    return true;
  } catch (e) {
    if (e.message !== 'Cancelled' && e.code !== 'CANCELLED') toast(e.message, 'error');
    return false;
  }
}

/**
 * Signed in on a new device: offer to restore chats from the Google Drive backup, so messages
 * from before ("Sent before this device was linked") can be read.
 */
export default function RestoreOffer() {
  const me = useAuth((s) => s.user?.id);
  const [offered, setOffered] = useState(() => storage.get('restore.offer') === me);
  const [busy, setBusy] = useState(false);
  if (!offered || !me || !backupAvailable()) return null;
  const dismiss = () => {
    storage.set('restore.offer', null);
    setOffered(false);
  };
  return (
    <div className="restore-offer" role="region" aria-label="Restore chats">
      <CloudDownload size={22} />
      <div className="restore-offer-text">
        <strong>Restore your chats?</strong>
        <span>If you backed up to Google Drive, older messages can be read on this device again.</span>
      </div>
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          if (await restoreChats(me)) dismiss();
          setBusy(false);
        }}
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
      <button className="icon-btn sm" onClick={dismiss} aria-label="Not now" disabled={busy}>
        <X size={16} />
      </button>
    </div>
  );
}
