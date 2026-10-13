import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { App as CapacitorApp } from '@capacitor/app';
import { QrCode, ShieldAlert } from 'lucide-react';
import Modal from './common/Modal.jsx';
import QrScanner from './common/QrScanner.jsx';
import { api } from '../lib/api.js';
import { rememberLink } from '../lib/e2ee/index.js';
import { parseLinkCode } from '../lib/e2ee/link.js';
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
 * "Allow sign-in on Edge on Windows?": scan the QR code the new device shows, or tap its
 * number. A wrong number blocks the sign-in (someone may be trying to trick you into approving).
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
  return <RequestDialog key={request.id} request={request} />;
}

function RequestDialog({ request }) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const handled = useRef(false);

  /** A code from the new device's screen: it approves that sign-in (and carries its key). */
  async function onCode(text) {
    if (handled.current) return;
    const link = parseLinkCode(text);
    if (!link) return setScanError('That isn’t a ChatApp sign-in code.');
    const target = useLoginRequests.getState().requests.find((r) => r.id === link.requestId);
    if (!target) return setScanError('That code is for another sign-in. Scan the code on the device you’re signing in.');
    handled.current = true;
    await rememberLink(link.requestId, link.publicKey).catch(() => {});
    answer(true, link.match, target);
  }

  async function answer(approve, match, req = request) {
    loginRequests.done(req);
    try {
      await api(`/api/devices/requests/${req.id}`, { method: 'POST', body: { approve, ...(match != null && { match }) } });
      toast(approve ? `${req.name} is now signed in` : 'Sign-in blocked');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (scanning) {
    return (
      <Modal title="Scan the code" onClose={() => setScanning(false)} className="login-request">
        <div className="login-request-body">
          <p>
            Point the camera at the QR code on <strong>{request.name}</strong>.
          </p>
          <QrScanner onCode={onCode} />
          {scanError && <p className="form-error">{scanError}</p>}
          <button className="link-btn" onClick={() => setScanning(false)}>
            Tap the number instead
          </button>
        </div>
      </Modal>
    );
  }

  return <RequestChoices request={request} answer={answer} onScan={() => setScanning(true)} />;
}

function RequestChoices({ request, answer, onScan }) {
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
        <p>If this is you, scan the QR code on that device, or tap the number it shows:</p>
        <button className="btn btn-primary login-request-scan" onClick={onScan}>
          <QrCode size={18} /> Scan QR code
        </button>
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
