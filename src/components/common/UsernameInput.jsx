import { useEffect, useState } from 'react';
import { AtSign, Check, X } from 'lucide-react';
import { api } from '../../lib/api.js';

const RULES = '3–30 characters: lowercase letters, numbers, "." and "_". Starts with a letter.';

/** Same rules as the server (shared/people.js). Returns the problem, or null. */
export function usernameProblem(u) {
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 30) return 'At most 30 characters';
  if (!/^[a-z0-9._]+$/.test(u)) return 'Only lowercase letters, numbers, "." and "_"';
  if (!/^[a-z]/.test(u)) return 'Must start with a letter';
  if (/[._]$/.test(u)) return 'Cannot end with "." or "_"';
  if (u.includes('..')) return 'No two dots in a row';
  return null;
}

/**
 * Username field with the rules and a live "available / taken" check. Typing is lowercased;
 * `onValid(ok)` reports whether the current value can be used (empty counts as ok when optional).
 */
export default function UsernameInput({ value, onChange, onValid, current = '', optional = false, autoFocus }) {
  const [check, setCheck] = useState({ state: 'idle' }); // idle | checking | ok | bad

  useEffect(() => {
    const u = value.trim();
    if (!u || u === current) {
      setCheck({ state: 'idle' });
      onValid?.(!u ? optional : true);
      return undefined;
    }
    const problem = usernameProblem(u);
    if (problem) {
      setCheck({ state: 'bad', message: problem });
      onValid?.(false);
      return undefined;
    }
    setCheck({ state: 'checking' });
    onValid?.(false);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api(`/api/auth/username/${encodeURIComponent(u)}`);
        if (cancelled) return;
        setCheck(r.available ? { state: 'ok', message: 'Available' } : { state: 'bad', message: r.reason || 'That username is taken' });
        onValid?.(!!r.available);
      } catch {
        if (!cancelled) {
          setCheck({ state: 'idle' }); // offline: the server checks again when saving
          onValid?.(true);
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, current, optional]);

  return (
    <div className="username-field">
      <div className={`username-input ${check.state}`}>
        <AtSign size={16} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@/, '').toLowerCase().replace(/\s/g, ''))}
          placeholder={optional ? 'username (optional)' : 'username'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={30}
          autoFocus={autoFocus}
          aria-label="Username"
        />
        {check.state === 'ok' && <Check size={16} className="ok" />}
        {check.state === 'bad' && <X size={16} className="bad" />}
      </div>
      <small className={`field-hint ${check.state === 'bad' ? 'bad' : check.state === 'ok' ? 'ok' : ''}`}>
        {check.state === 'checking' ? 'Checking…' : check.message || RULES}
      </small>
    </div>
  );
}
