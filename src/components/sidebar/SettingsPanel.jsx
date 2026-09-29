import { useState } from 'react';
import { Check, LogOut, Pencil } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import AvatarPicker from '../common/AvatarPicker.jsx';
import { api } from '../../lib/api.js';
import { requestNotificationPermission } from '../../lib/notify.js';
import { useAuth } from '../../store/auth.js';
import { WALLPAPERS, toast, useUI } from '../../store/ui.js';

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

export default function SettingsPanel() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const { theme, wallpaper, enterToSend, sounds, autoDownload, setPref } = useUI();

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
        <Toggle
          label="Auto-download media"
          hint="Save photos, videos and voice notes on this device so they open offline"
          checked={autoDownload}
          onChange={(v) => setPref('autoDownload', v)}
        />
        {notifications === 'default' && (
          <button className="btn btn-ghost" onClick={requestNotificationPermission}>
            Enable desktop notifications
          </button>
        )}
        {notifications === 'denied' && <p className="hint">Notifications are blocked in your browser settings.</p>}
      </div>

      <button className="btn btn-danger-ghost btn-block logout" onClick={logout}>
        <LogOut size={18} /> Log out
      </button>
    </SidePanel>
  );
}
