import { useEffect, useMemo, useState } from 'react';
import { BellOff, Camera, ChevronDown, Lock, Pencil, Plus, Shield } from 'lucide-react';
import SidePanel from '../sidebar/SidePanel.jsx';
import Avatar from '../common/Avatar.jsx';
import StatusRing from './StatusRing.jsx';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { displayName } from '../../store/people.js';
import { useStatus } from '../../store/status.js';
import { toast } from '../../store/ui.js';

function Row({ group, onOpen }) {
  const seen = group.statuses.filter((s) => s.viewed).length;
  const last = group.statuses[group.statuses.length - 1];
  return (
    <button className="person-row status-row" onClick={onOpen}>
      <StatusRing name={displayName(group.user)} url={group.user.avatarUrl} count={group.statuses.length} seen={seen} size={44} />
      <span className="person-info">
        <span className="person-name">{displayName(group.user)}</span>
        <span className="person-sub">{formatListTime(last.createdAt)}</span>
      </span>
    </button>
  );
}

/** Status privacy: my contacts / my contacts except… / only share with… */
function Privacy({ onDone }) {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('contacts');
  const [picked, setPicked] = useState({ except: [], only: [] });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/status/settings').then(
      (d) => {
        setData(d);
        setMode(d.mode);
        setPicked({ except: d.except, only: d.only });
      },
      (e) => toast(e.message, 'error')
    );
  }, []);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.contacts || []).filter((u) => !q || displayName(u).toLowerCase().includes(q)).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [data, query]);

  async function save() {
    setSaving(true);
    try {
      const res = await api('/api/status/settings', { method: 'PUT', body: { mode, except: picked.except, only: picked.only } });
      toast(`Your next status updates will be seen by ${res.audience} ${res.audience === 1 ? 'person' : 'people'}`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const list = mode === 'except' ? 'except' : mode === 'only' ? 'only' : null;
  const toggle = (id) => setPicked((p) => ({ ...p, [list]: p[list].includes(id) ? p[list].filter((x) => x !== id) : [...p[list], id] }));

  return (
    <SidePanel title="Status privacy" onBack={onDone}>
      {!data ? (
        <p className="panel-empty">Loading…</p>
      ) : (
        <div className="status-privacy">
          <p className="hint">Who can see my status updates. Changes apply to updates you post from now on.</p>
          {[
            ['contacts', 'My contacts', 'People you saved in ChatApp and people you chat with'],
            ['except', 'My contacts except…', `${picked.except.length} excluded`],
            ['only', 'Only share with…', `${picked.only.length} included`],
          ].map(([v, label, sub]) => (
            <label key={v} className="radio-row">
              <input type="radio" name="status-privacy" checked={mode === v} onChange={() => setMode(v)} />
              <span>
                {label}
                <small>{sub}</small>
              </span>
            </label>
          ))}
          {list && (
            <>
              <div className="panel-search">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" aria-label="Search contacts" />
              </div>
              {people.map((u) => (
                <label key={u.id} className="person-row pick-row">
                  <Avatar name={displayName(u)} url={u.avatarUrl} size={36} />
                  <span className="person-name">{displayName(u)}</span>
                  <input type="checkbox" checked={picked[list].includes(u.id)} onChange={() => toggle(u.id)} />
                </label>
              ))}
              {!people.length && <p className="panel-empty">No contacts yet.</p>}
            </>
          )}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      )}
    </SidePanel>
  );
}

/** The Status tab: my updates, then everyone else's (unseen first, viewed, muted). */
export default function StatusPanel() {
  const user = useAuth((s) => s.user);
  const { mine, others, loaded } = useStatus();
  const { load, openViewer, compose } = useStatus.getState();
  const [privacy, setPrivacy] = useState(false);
  const [showMuted, setShowMuted] = useState(false);

  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [load]);

  if (privacy) return <Privacy onDone={() => setPrivacy(false)} />;

  const active = others.filter((g) => !g.muted);
  const recent = active.filter((g) => g.statuses.some((s) => !s.viewed));
  const viewed = active.filter((g) => g.statuses.every((s) => s.viewed));
  const muted = others.filter((g) => g.muted);

  return (
    <SidePanel title="Status">
      <div className="status-panel">
        <div className="person-row status-row mine">
          <button className="status-mine-open" onClick={() => (mine.length ? openViewer('me') : compose('media'))}>
            <StatusRing name={user?.name} url={user?.avatarUrl} count={mine.length} seen={mine.length} size={48}>
              {!mine.length && (
                <span className="status-add-badge">
                  <Plus size={14} />
                </span>
              )}
            </StatusRing>
            <span className="person-info">
              <span className="person-name">My status</span>
              <span className="person-sub">
                {mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'} · ${formatListTime(mine[mine.length - 1].createdAt)}` : 'Tap to add a status update'}
              </span>
            </span>
          </button>
          <button className="icon-btn" onClick={() => compose('text')} aria-label="New text status" title="Write a status">
            <Pencil size={19} />
          </button>
          <button className="icon-btn" onClick={() => compose('media')} aria-label="New photo or video status" title="Photo or video">
            <Camera size={19} />
          </button>
        </div>

        {!loaded && <p className="panel-empty">Loading…</p>}
        {loaded && !others.length && <p className="panel-empty">No updates from your contacts in the last 24 hours.</p>}

        {recent.length > 0 && <h3 className="section-label">Recent updates</h3>}
        {recent.map((g) => (
          <Row key={g.user.id} group={g} onOpen={() => openViewer(g.user.id, Math.max(0, g.statuses.findIndex((s) => !s.viewed)))} />
        ))}
        {viewed.length > 0 && <h3 className="section-label">Viewed updates</h3>}
        {viewed.map((g) => (
          <Row key={g.user.id} group={g} onOpen={() => openViewer(g.user.id)} />
        ))}
        {muted.length > 0 && (
          <button className="section-label status-muted-toggle" onClick={() => setShowMuted((v) => !v)}>
            <BellOff size={14} /> Muted updates ({muted.length}) <ChevronDown size={14} className={showMuted ? 'open' : ''} />
          </button>
        )}
        {showMuted && muted.map((g) => <Row key={g.user.id} group={g} onOpen={() => openViewer(g.user.id)} />)}

        <button className="person-row action" onClick={() => setPrivacy(true)}>
          <span className="action-icon">
            <Shield size={20} />
          </span>
          <span className="person-name">Status privacy</span>
        </button>
        <p className="hint status-e2ee">
          <Lock size={13} /> Your status updates are end-to-end encrypted. They disappear after 24 hours.
        </p>
      </div>
    </SidePanel>
  );
}
