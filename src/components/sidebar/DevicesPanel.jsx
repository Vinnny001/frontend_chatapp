import { useEffect, useState } from 'react';
import { Globe, LogOut, MonitorSmartphone, Smartphone } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import { api } from '../../lib/api.js';
import { formatLastSeen } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { toast, useUI } from '../../store/ui.js';

const HOW = { first: 'Password', device: 'Approved on another device', email: 'Email code', reset: 'Password reset', signup: 'Account created here', legacy: 'Signed in before linked devices' };

/** Settings → Privacy → Linked devices: everything signed in to this account. */
export default function DevicesPanel() {
  const [devices, setDevices] = useState(null);
  const load = () =>
    api('/api/devices')
      .then((d) => setDevices(d.devices))
      .catch((e) => {
        toast(e.message, 'error');
        setDevices([]);
      });
  useEffect(() => {
    load();
  }, []);

  async function signOut(d) {
    if (!window.confirm(`Sign out ${d.name}?`)) return;
    try {
      await api(`/api/devices/${d.id}`, { method: 'DELETE' });
      toast(`${d.name} signed out`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function signOutOthers() {
    if (!window.confirm('Sign out all other devices? They will need your approval to sign in again.')) return;
    try {
      const { token } = await api('/api/devices/revoke-others', { method: 'POST' });
      useAuth.getState().setSession(token, useAuth.getState().user);
      toast('Signed out of all other devices');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const current = devices?.find((d) => d.current);
  const others = devices?.filter((d) => !d.current) || [];
  const Row = ({ d }) => {
    const Icon = d.platform === 'web' ? Globe : Smartphone;
    return (
      <div className="device-row">
        <span className="action-icon">
          <Icon size={20} />
        </span>
        <span className="person-info">
          <span className="person-name">{d.name}</span>
          <span className="person-sub">
            {d.current ? 'This device' : `Active ${formatLastSeen(d.lastActiveAt).replace(/^last seen /, '')}`} · {HOW[d.approvedBy] || ''}
          </span>
        </span>
        {!d.current && (
          <button className="icon-btn danger" onClick={() => signOut(d)} aria-label={`Sign out ${d.name}`} title="Sign out">
            <LogOut size={18} />
          </button>
        )}
      </div>
    );
  };

  return (
    <SidePanel title="Linked devices" onBack={() => useUI.getState().openPanel('settings')}>
      <div className="devices-intro">
        <MonitorSmartphone size={40} />
        <p>Devices signed in to your account. A new device has to be approved here, or with a code sent to your email, and you get an email every time one signs in.</p>
      </div>
      {devices === null && <p className="panel-empty">Loading…</p>}
      {current && (
        <>
          <h3 className="section-label">This device</h3>
          <Row d={current} />
        </>
      )}
      {devices && (
        <>
          <h3 className="section-label">Other devices</h3>
          {others.length === 0 && <p className="hint devices-none">No other devices are signed in.</p>}
          {others.map((d) => (
            <Row key={d.id} d={d} />
          ))}
          {others.length > 0 && (
            <button className="settings-link danger devices-out-all" onClick={signOutOthers}>
              <span>Sign out all other devices</span>
              <LogOut size={18} />
            </button>
          )}
        </>
      )}
    </SidePanel>
  );
}
