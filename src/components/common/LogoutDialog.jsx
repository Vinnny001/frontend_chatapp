import { useState } from 'react';
import { LogOut } from 'lucide-react';
import Modal from './Modal.jsx';
import { useAuth } from '../../store/auth.js';
import { useUI } from '../../store/ui.js';

/**
 * "Log out": keep this device's chats for next time (signing in here again picks them up), or
 * erase them (a shared, sold or lost device).
 */
export default function LogoutDialog() {
  const open = useUI((s) => s.logoutOpen);
  const [keep, setKeep] = useState(true);
  if (!open) return null;
  const close = () => useUI.getState().setLogoutOpen(false);
  const logout = () => {
    close();
    useAuth.getState().logout({ keep });
  };
  return (
    <Modal
      title="Log out?"
      onClose={close}
      className="logout-dialog"
      footer={
        <>
          <button className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className={`btn ${keep ? 'btn-primary' : 'btn-danger'}`} onClick={logout}>
            <LogOut size={16} /> Log out
          </button>
        </>
      }
    >
      <label className={`logout-option ${keep ? 'active' : ''}`}>
        <input type="radio" name="logout" checked={keep} onChange={() => setKeep(true)} />
        <span>
          <strong>Keep my chats on this device</strong>
          <small>Sign in again here with the same account and your chats are all still there, readable.</small>
        </span>
      </label>
      <label className={`logout-option ${!keep ? 'active' : ''}`}>
        <input type="radio" name="logout" checked={!keep} onChange={() => setKeep(false)} />
        <span>
          <strong>Erase my chats from this device</strong>
          <small>For a shared or sold device. Chats sent before you sign in here again can then only be read if another of your devices syncs them.</small>
        </span>
      </label>
    </Modal>
  );
}
