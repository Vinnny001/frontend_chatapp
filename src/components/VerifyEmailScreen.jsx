import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { toast } from '../store/ui.js';

const RESEND_SECONDS = 60;

/** After sign-up (or signing in before confirming): enter the 6-digit code we emailed. */
export default function VerifyEmailScreen() {
  const user = useAuth((s) => s.user);
  const { verifyEmail, resendCode, logout } = useAuth.getState();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyEmail(code);
      toast('Email confirmed. Welcome to ChatApp!');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    try {
      await resendCode();
      setWait(RESEND_SECONDS);
      toast('We sent you a new code');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth verify-screen">
      <section className="auth-card">
        <div className="verify-icon">
          <MailCheck size={36} />
        </div>
        <h2>Confirm your email</h2>
        <p className="hint">
          We sent a 6-digit code to <strong>{user?.email}</strong>. Enter it below to start using ChatApp. Check
          your spam folder if you don’t see it.
        </p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              if (v.length === 6) setTimeout(() => document.getElementById('verify-submit')?.click(), 0);
            }}
            placeholder="••••••"
            aria-label="6-digit code"
            autoFocus
          />
          {error && <p className="form-error">{error}</p>}
          <button id="verify-submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </form>
        <div className="verify-links">
          <button className="link-btn" onClick={resend} disabled={wait > 0}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
          <button className="link-btn" onClick={logout}>
            Use a different account
          </button>
        </div>
      </section>
    </div>
  );
}
