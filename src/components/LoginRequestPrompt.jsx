import { useEffect } from 'react';
import { create } from 'zustand';
import { App as CapacitorApp } from '@capacitor/app';
import { ShieldAlert } from 'lucide-react';
import Modal from './common/Modal.jsx';
import { api } from '../lib/api.js';
import { formatListTime } from '../lib/format.js';
import { toast } from '../store/ui.js';

/** Sign-in requests from new devices, waiting for this device's answer. */
export const useLoginRequests = create(() => ({ requests: [] }));

export const loginRequests = {
  add(r) {
    useLoginRequests.setState((s) => ({ requests: [r, ...s.requests.filter((x) => x.id !== r.id)] }));
  },
  done({ id }) {
    useLoginRequests.setState((s) => ({ requests: s.requests.filter((x) => x.id !== id) }));
  },
  async refresh() {
    try {
      const { requests } = await api('/api/devices/requests');
      useLoginRequests.setState({ requests });
    } catch {
      /* offline: the socket / next resume brings them */
    }
  },
};

/**
 * "Allow sign-in on Edge on Windows?": tap the number the new device shows. A wrong number
 * blocks the sign-in (someone may be trying to trick you into approving).
 */
export default function LoginRequestPrompt() {
  const request = useLoginRequests((s) => s.requests[0]);

  // Requests made while this app was closed (a notification may have brought us here).
  useEffect(() => {
    loginRequests.refresh();
    const handle = CapacitorApp.addListener('resume', () => loginRequests.refresh());
    return () => {
      handle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  if (!request) return null;

  async function answer(approve, match) {
    loginRequests.done(request);
    try {
      await api(`/api/devices/requests/${request.id}`, { method: 'POST', body: { approve, ...(match != null && { match }) } });
      toast(approve ? `${request.name} is now signed in` : 'Sign-in blocked');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal title="New sign-in request" onClose={() => answer(false)} className="login-request">
      <div className="login-request-body">
        <ShieldAlert size={40} className="login-request-icon" />
        <p>
          <strong>{request.name}</strong> wants to sign in to your account.
        </p>
        <p className="hint">
          {formatListTime(request.createdAt)}
          {request.ip ? ` · network ${request.ip}` : ''}
        </p>
        <p>If this is you, tap the number shown on that device:</p>
        <div className="login-request-choices">
          {request.choices.map((n) => (
            <button key={n} className="login-request-choice" onClick={() => answer(true, n)}>
              {n}
            </button>
          ))}
        </div>
        <button className="btn btn-danger" onClick={() => answer(false)}>
          No, it wasn’t me
        </button>
        <p className="hint">If it wasn’t you, someone knows your password: change it with “Forgot password?” on the sign-in screen.</p>
      </div>
    </Modal>
  );
}
