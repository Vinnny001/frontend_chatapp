import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { HardDrive, Home, LogOut, RotateCw, ShieldAlert } from 'lucide-react';
import * as e2ee from '../lib/e2ee/index.js';
import { tokenDeviceId } from '../lib/device.js';
import { canGoHome, canOpenStorageSettings, formatBytes, freeSpace, goHome, openStorageSettings } from '../lib/storageSpace.js';
import { useAuth } from '../store/auth.js';

/** Encryption's state on this device; re-renders when it changes. */
export function useE2eeStatus() {
  const [status, setStatus] = useState(e2ee.getStatus);
  useEffect(() => e2ee.onStatus(setStatus), []);
  return status;
}

function retry() {
  const { token, user } = useAuth.getState();
  if (token && user && e2ee.getStatus().state === 'error') e2ee.retryStart({ userId: user.id, deviceId: tokenDeviceId(token) });
}

/**
 * Messages are always end-to-end encrypted, so a device where encryption can't run can't be
 * used for chats: this screen takes the place of the app and says what to do (usually: free
 * up storage). It tries again on its own when the user comes back to the app.
 */
export default function E2eeGate() {
  const status = useE2eeStatus();
  const [space, setSpace] = useState(null);
  const [showSteps, setShowSteps] = useState(false);
  const lowSpace = status.stage === 'space';
  const damaged = status.stage === 'storage' && !/tab/.test(status.message || '');

  useEffect(() => {
    freeSpace().then(setSpace);
    const handle = CapacitorApp.addListener('resume', retry);
    return () => {
      handle.then((h) => h.remove()).catch(() => {});
    };
  }, [status]);

  return (
    <div className="e2ee-gate" role="alertdialog" aria-labelledby="e2ee-gate-title">
      <div className="e2ee-gate-card">
        {lowSpace ? <HardDrive size={48} className="e2ee-gate-icon" /> : <ShieldAlert size={48} className="e2ee-gate-icon" />}
        <h2 id="e2ee-gate-title">
          {lowSpace
            ? canOpenStorageSettings()
              ? 'Your phone is almost out of storage'
              : 'This browser is almost out of storage'
            : 'Encryption couldn’t start on this device'}
        </h2>
        <p>
          Every ChatApp message is end-to-end encrypted, so this device can’t send or read messages until encryption works here.{' '}
          {lowSpace
            ? 'ChatApp needs room to keep your encryption keys and messages. Free up some space, then come back.'
            : damaged
              ? canOpenStorageSettings()
                ? 'The app’s storage on this phone couldn’t be opened. Free up space or clear ChatApp’s storage, then try again.'
                : 'The browser couldn’t open its storage for this site. Clear the site’s data, then sign in again.'
              : 'Try again in a moment.'}
        </p>
        {space && (
          <p className="e2ee-gate-space">
            {formatBytes(space.free)} free{lowSpace ? ' (ChatApp needs at least 100 MB)' : ''}
          </p>
        )}
        <p className="e2ee-gate-reason">{status.message}</p>

        <div className="e2ee-gate-actions">
          {canOpenStorageSettings() ? (
            <button className="btn btn-primary" onClick={openStorageSettings}>
              <HardDrive size={18} /> Manage storage
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setShowSteps((v) => !v)}>
              <HardDrive size={18} /> Manage storage
            </button>
          )}
          <button className="btn btn-ghost" onClick={retry} disabled={status.state === 'starting'}>
            <RotateCw size={18} /> {status.state === 'starting' ? 'Checking…' : 'Try again'}
          </button>
          {canGoHome() ? (
            <button className="btn btn-ghost" onClick={goHome}>
              <Home size={18} /> Go to home screen
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => useAuth.getState().logout()}>
              <LogOut size={18} /> Sign out
            </button>
          )}
        </div>

        {showSteps && (
          <ol className="e2ee-gate-steps">
            {damaged ? (
              <>
                <li>Click the icon just left of the address bar, then <strong>Site settings</strong>.</li>
                <li>Click <strong>Delete data</strong> (or <strong>Clear data</strong>) and confirm.</li>
                <li>Reload this page and sign in again.</li>
              </>
            ) : (
              <>
                <li>Free up space on this computer’s drive: empty the Recycle Bin, remove large downloads or apps you don’t use.</li>
                <li>In the browser, clear browsing data you don’t need (cached images and files).</li>
                <li>Come back here and click <strong>Try again</strong>.</li>
              </>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
