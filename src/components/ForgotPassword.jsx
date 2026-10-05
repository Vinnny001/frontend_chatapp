import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { toast } from '../store/ui.js';

/** Forgot password: email → code + new password → signed in. */
export default function ForgotPassword({ initialEmail = '', onBack }) {
  const { forgotPassword, resetPassword } = useAuth.getState();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(initialEmail.includes('@') ? initialEmail : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e) => {
    e.preventDefault();
    run(async () => {
      await forgotPassword(email.trim());
      setStep('reset');
    });
  };

  const reset = (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    run(async () => {
      await resetPassword({ email: email.trim(), code, password });
      toast('Password changed. You’re signed in.');
    });
  };

  return (
    <div className="forgot">
      <button type="button" className="link-btn forgot-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to sign in
      </button>
      <h2>Reset your password</h2>
      {step === 'email' ? (
        <form onSubmit={sendCode} className="auth-form">
          <p className="hint">Enter the email of your account and we’ll send you a code.</p>
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={reset} className="auth-form">
          <p className="hint">
            If <strong>{email}</strong> has an account, we sent it a 6-digit code. Check your spam folder if you don’t see it.
          </p>
          <label>
            Code
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              required
              autoFocus
            />
          </label>
          <label>
            New password
            <input type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Confirm new password
            <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
          <button type="button" className="link-btn" onClick={() => run(() => forgotPassword(email.trim()).then(() => toast('If the email has an account, a new code is on its way')))}>
            Send a new code
          </button>
        </form>
      )}
    </div>
  );
}
