import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import * as e2ee from '../../lib/e2ee/index.js';

/**
 * End-to-end encryption couldn't start on this device: say so (with the reason) instead of
 * quietly sending unencrypted messages. The reason is also reported to the server.
 */
export default function E2eeBanner() {
  const [status, setStatus] = useState(e2ee.getStatus);
  useEffect(() => e2ee.onStatus(setStatus), []);
  if (status.state !== 'error') return null;
  return (
    <div className="e2ee-banner" role="alert">
      <ShieldAlert size={18} />
      <span>
        <strong>Encryption couldn’t start on this device.</strong> Messages you send here aren’t end-to-end encrypted. <small>{status.message}</small>
      </span>
      <button className="link-btn" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}
