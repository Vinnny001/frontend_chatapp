import { useState } from 'react';
import { History, RefreshCw, Smartphone } from 'lucide-react';
import { useAuth } from '../store/auth.js';

/**
 * A newly linked device chooses whether to sync with my other devices (over our encrypted
 * channel): my recent chat history and contact names. Not syncing still gets every message
 * from now on, end-to-end encrypted.
 */
export default function SyncChoiceScreen() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function choose(sync) {
    setBusy(sync ? 'sync' : 'skip');
    setError('');
    try {
      await useAuth.getState().chooseSync(sync);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="verify-screen">
      <section className="auth-card sync-choice">
        <RefreshCw size={44} className="sync-choice-icon" />
        <h2>Sync this device?</h2>
        <p>Your messages are end-to-end encrypted, so only your own devices can give this one your past chats.</p>
        <div className="sync-choice-options">
          <button className="sync-option" onClick={() => choose(true)} disabled={!!busy}>
            <History size={22} />
            <span>
              <strong>{busy === 'sync' ? 'Syncing…' : 'Sync'}</strong>
              <small>Get your recent chats (last 90 days) and contact names from your other devices, and keep contacts in sync.</small>
            </span>
          </button>
          <button className="sync-option" onClick={() => choose(false)} disabled={!!busy}>
            <Smartphone size={22} />
            <span>
              <strong>{busy === 'skip' ? 'Please wait…' : 'Don’t sync'}</strong>
              <small>Start fresh: new messages from now on only, no earlier messages or contacts. You can turn sync on later in Settings → Linked devices.</small>
            </span>
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
