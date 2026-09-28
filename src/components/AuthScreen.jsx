import { useState } from 'react';
import { Lock, MessageCircle, Phone, Sparkles, Zap } from 'lucide-react';
import { useAuth } from '../store/auth.js';

const EMPTY = { name: '', email: '', phone: '', gender: '', password: '', confirm: '', identifier: '' };

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, signup } = useAuth();

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.identifier.trim(), form.password);
      else
        await signup({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password,
          ...(form.gender && { gender: form.gender }),
        });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="auth-brand">
          <span className="brand-mark">
            <MessageCircle size={26} />
          </span>
          ChatApp
        </div>
        <h1>Conversations that feel instant.</h1>
        <p>Real-time messaging, voice notes, groups and HD calls, on the web and on your phone.</p>
        <ul className="auth-features">
          <li>
            <Zap size={18} /> Dedicated realtime engine for instant delivery
          </li>
          <li>
            <Phone size={18} /> Voice and video calls
          </li>
          <li>
            <Sparkles size={18} /> Reactions, replies, edits and disappearing messages
          </li>
          <li>
            <Lock size={18} /> Your chats, synced across all your devices
          </li>
        </ul>
      </section>

      <section className="auth-card">
        <div className="auth-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
            Sign in
          </button>
          <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'login' ? (
            <label>
              Email or phone
              <input autoComplete="username" required {...field('identifier')} placeholder="you@example.com or +254…" />
            </label>
          ) : (
            <>
              <label>
                Full name
                <input autoComplete="name" required maxLength={60} {...field('name')} />
              </label>
              <label>
                Email
                <input type="email" autoComplete="email" required {...field('email')} />
              </label>
              <div className="row-2">
                <label>
                  Phone
                  <input type="tel" autoComplete="tel" required {...field('phone')} placeholder="+254712345678" />
                </label>
                <label>
                  Gender
                  <select {...field('gender')}>
                    <option value="">Prefer not to say</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 6 : undefined}
              {...field('password')}
            />
          </label>
          {mode === 'signup' && (
            <label>
              Confirm password
              <input type="password" autoComplete="new-password" required {...field('confirm')} />
            </label>
          )}

          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </div>
  );
}
