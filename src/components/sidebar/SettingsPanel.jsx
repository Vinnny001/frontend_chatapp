import { useEffect, useState } from 'react';
import { Check, LogOut, Pencil } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import AvatarPicker from '../common/AvatarPicker.jsx';
import { api } from '../../lib/api.js';
import { formatBytes } from '../../lib/format.js';
import { clearDownloadedMedia, mediaUsage } from '../../lib/localdb.js';
import { requestNotificationPermission } from '../../lib/notify.js';
import { useAuth } from '../../store/auth.js';
import { MEDIA_KINDS, WALLPAPERS, toast, useUI } from '../../store/ui.js';

function EditableField({ label, value, maxLength, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  async function save() {
    if (draft.trim() && draft !== value) await onSave(draft.trim());
    setEditing(false);
  }

  return (
    <div className="editable">
      <span className="editable-label">{label}</span>
      {editing ? (
        <div className="editable-row">
          <input
            autoFocus
            maxLength={maxLength}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <span className="counter">{maxLength - draft.length}</span>
          <button className="icon-btn" onClick={save} aria-label="Save">
            <Check size={20} />
          </button>
        </div>
      ) : (
        <div className="editable-row">
          <span className="editable-value">{value}</span>
          <button
            className="icon-btn"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            aria-label={`Edit ${label}`}
          >
            <Pencil size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** One auto-download rule: which kinds of media download automatically on this connection. */
function AutoDownloadRow({ label, kinds, onChange }) {
  const toggle = (id) => onChange(kinds.includes(id) ? kinds.filter((k) => k !== id) : [...kinds, id]);
  const summary = kinds.length ? MEDIA_KINDS.filter((k) => kinds.includes(k.id)).map((k) => k.label).join(', ') : 'No media';
  return (
    <div className="auto-download">
      <span className="auto-download-label">
        {label}
        <small>{summary}</small>
      </span>
      <div className="auto-download-kinds">
        {MEDIA_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`chip ${kinds.includes(k.id) ? 'active' : ''}`}
            aria-pressed={kinds.includes(k.id)}
            onClick={() => toggle(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Space used by downloaded media, with a button to free it. */
function StorageRow() {
  const [usage, setUsage] = useState(null);
  const refresh = () => mediaUsage().then(setUsage).catch(() => setUsage({ bytes: 0, files: 0 }));
  useEffect(() => {
    refresh();
  }, []);

  async function clear() {
    if (!window.confirm('Remove downloaded photos, videos, voice notes and documents from this device? Messages stay, and media downloads again when you open it online.')) return;
    await clearDownloadedMedia();
    refresh();
    toast('Downloaded media removed');
  }

  return (
    <div className="settings-group">
      <div className="editable">
        <span className="editable-label">Downloaded media on this device</span>
        <span className="editable-value">
          {usage ? `${formatBytes(usage.bytes)} · ${usage.files} file${usage.files === 1 ? '' : 's'}` : 'Calculating…'}
        </span>
      </div>
      <button className="btn btn-ghost" onClick={clear} disabled={!usage?.files}>
        Clear downloaded media
      </button>
    </div>
  );
}

export default function SettingsPanel() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const { theme, wallpaper, enterToSend, sounds, autoDownloadRules, setPref } = useUI();

  async function update(body) {
    try {
      const { user: updated } = await api('/api/users/me', { method: 'PATCH', body });
      setUser(updated);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const notifications = 'Notification' in window ? Notification.permission : 'unsupported';

  return (
    <SidePanel title="Settings">
      <div className="profile-card">
        <AvatarPicker url={user.avatarUrl} name={user.name} onChange={(avatarUrl) => update({ avatarUrl })} />
        {user.avatarUrl && (
          <button className="link-btn" onClick={() => update({ avatarUrl: null })}>
            Remove photo
          </button>
        )}
      </div>
      <div className="settings-group">
        <EditableField label="Your name" value={user.name} maxLength={60} onSave={(name) => update({ name })} />
        <EditableField label="About" value={user.about || ''} maxLength={140} onSave={(about) => update({ about })} />
        <div className="editable">
          <span className="editable-label">Phone</span>
          <span className="editable-value">{user.phone}</span>
        </div>
      </div>

      <h3 className="section-label">Privacy</h3>
      <div className="settings-group">
        <Toggle
          label="Show my last seen"
          hint="When off, nobody sees when you were last online"
          checked={user.settings?.showLastSeen !== false}
          onChange={(showLastSeen) => update({ settings: { showLastSeen } })}
        />
      </div>

      <h3 className="section-label">Appearance</h3>
      <div className="settings-group">
        <div className="segmented">
          {['system', 'light', 'dark'].map((t) => (
            <button key={t} className={theme === t ? 'active' : ''} onClick={() => setPref('theme', t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <span className="editable-label">Chat wallpaper</span>
        <div className="wallpapers">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              className={`wallpaper-swatch wall-${w.id} ${wallpaper === w.id ? 'active' : ''}`}
              onClick={() => setPref('wallpaper', w.id)}
              aria-label={w.label}
              title={w.label}
            />
          ))}
        </div>
      </div>

      <h3 className="section-label">Chats & notifications</h3>
      <div className="settings-group">
        <Toggle label="Enter key sends message" hint="Shift+Enter adds a new line" checked={enterToSend} onChange={(v) => setPref('enterToSend', v)} />
        <Toggle label="Sounds" checked={sounds} onChange={(v) => setPref('sounds', v)} />
        {notifications === 'default' && (
          <button className="btn btn-ghost" onClick={requestNotificationPermission}>
            Enable desktop notifications
          </button>
        )}
        {notifications === 'denied' && <p className="hint">Notifications are blocked in your browser settings.</p>}
      </div>

      <h3 className="section-label">Media auto-download</h3>
      <div className="settings-group">
        <p className="hint">
          Downloaded media is saved on this device and opens offline. Anything not downloaded automatically is
          downloaded when you open it, or with “Save chat for offline” in a chat’s info.
        </p>
        <AutoDownloadRow
          label="When using mobile data"
          kinds={autoDownloadRules.cellular}
          onChange={(cellular) => setPref('autoDownloadRules', { ...autoDownloadRules, cellular })}
        />
        <AutoDownloadRow
          label="When connected on Wi-Fi"
          kinds={autoDownloadRules.wifi}
          onChange={(wifi) => setPref('autoDownloadRules', { ...autoDownloadRules, wifi })}
        />
      </div>

      <h3 className="section-label">Storage</h3>
      <StorageRow />

      <button className="btn btn-danger-ghost btn-block logout" onClick={logout}>
        <LogOut size={18} /> Log out
      </button>
    </SidePanel>
  );
}
