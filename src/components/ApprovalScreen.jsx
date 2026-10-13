import { useEffect, useState } from 'react';
import { Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { useAuth } from '../store/auth.js';

/**
 * A new device waiting to be let in: approve it on a device that's already signed in (by
 * scanning the QR code or tapping the number shown here), or use a code sent to the account's email.
 */
export default function ApprovalScreen() {
  const approval = useAuth((s) => s.approval);
  const { checkApproval, emailApprovalCode, approveWithEmailCode, cancelApproval } = useAuth.getState();
  const [state, setState] = useState('pending'); // pending | denied | expired
  const [emailMode, setEmailMode] = useState(false);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState(null);

  useEffect(() => {
    if (!approval?.linkQr) return undefined;
    let live = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(approval.linkQr, { width: 400, margin: 1, errorCorrectionLevel: 'M' }))
      .then((url) => live && setQr(url))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [approval?.linkQr]);

  // Check every 2 seconds until it's answered.
  useEffect(() => {
    if (state !== 'pending') return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const status = await checkApproval();
        if (!stop && status && status !== 'pending') setState(status);
      } catch {
        /* offline for a moment: keep waiting */
      }
      if (!stop) timer = setTimeout(tick, 2000);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [state, checkApproval]);

  async function sendCode() {
    setError('');
    setBusy(true);
    try {
      const { email } = await emailApprovalCode();
      setSentTo(email);
      setEmailMode(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await approveWithEmailCode(code);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!approval) return null;
  const others = approval.devices?.length ? approval.devices.join(', ') : 'your other device';

  if (state !== 'pending') {
    return (
      <div className="approval">
        <ShieldCheck size={44} className="approval-icon muted" />
        <h2>{state === 'denied' ? 'Sign-in not approved' : 'Request expired'}</h2>
        <p className="hint">
          {state === 'denied'
            ? 'The sign-in was declined on your other device.'
            : 'Nobody approved this sign-in within 10 minutes.'}
        </p>
        <button className="btn btn-primary" onClick={cancelApproval}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="approval">
      {!emailMode ? (
        <>
          <Smartphone size={44} className="approval-icon" />
          <h2>Approve on your other device</h2>
          <p>
            Open ChatApp on <strong>{others}</strong> and allow this sign-in.{' '}
            {qr ? 'Scan this code with it, or tap the number below:' : 'When asked, tap this number:'}
          </p>
          {qr && <img className="approval-qr" src={qr} alt="QR code to scan with your other device" width={200} height={200} />}
          <div className="approval-number" aria-label={`Number ${approval.request.match}`}>
            {approval.request.match}
          </div>
          <p className="hint approval-waiting">
            <span className="rec-dot" /> Waiting for approval…
          </p>
          {error && <p className="form-error">{error}</p>}
          <button className="link-btn" onClick={sendCode} disabled={busy}>
            <Mail size={15} /> Can’t use your other device? Email me a code
          </button>
        </>
      ) : (
        <form onSubmit={submitCode} className="approval-email">
          <Mail size={44} className="approval-icon" />
          <h2>Check your email</h2>
          <p>
            We sent a 6-digit code to <strong>{sentTo || approval.email}</strong>.
          </p>
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="••••••"
            aria-label="Code"
            autoFocus
          />
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" className="link-btn" onClick={sendCode} disabled={busy}>
            Send a new code
          </button>
        </form>
      )}
      <button type="button" className="link-btn approval-cancel" onClick={cancelApproval}>
        Cancel
      </button>
    </div>
  );
}
