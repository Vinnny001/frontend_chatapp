import { Capacitor, registerPlugin } from '@capacitor/core';
import { buildExport } from './exportChats.js';
import { storage } from './storage.js';
import * as e2ee from './e2ee/index.js';

// Chat backup to the user's Google account (Google Drive, in its hidden app folder, as
// WhatsApp does). Chats are end-to-end encrypted, so the backup is made on this device (the
// same JSON as "Export chats") and uploaded straight to Drive: it never passes our server.
//  - Phone: the phone's Google account (GoogleDrivePlugin.java).
//  - Web: Google's sign-in (needs VITE_GOOGLE_CLIENT_ID, a "Web application" OAuth client).

const GoogleDrive = registerPlugin('GoogleDrive');
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'chatapp-backup.json';
const DAY_MS = 24 * 3600 * 1000;
const native = () => Capacitor.getPlatform() === 'android';
const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const key = (userId) => `backup.${userId}`;
/** { enabled, lastAt, lastError } for this account on this device. */
export const backupState = (userId) => ({ enabled: false, lastAt: null, lastError: null, ...(storage.get(key(userId)) || {}) });
const saveState = (userId, patch) => storage.set(key(userId), { ...backupState(userId), ...patch });

/** Can this device back up to Google at all? */
export const backupAvailable = () => native() || !!WEB_CLIENT_ID;

// ---------------------------------------------------------------- access token

let webToken = null; // { token, expiresAt }
let gisLoading = null;

function loadGis() {
  gisLoading ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Couldn’t reach Google. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

async function webAccessToken(interactive) {
  if (webToken && webToken.expiresAt > Date.now() + 60_000) return webToken.token;
  if (!WEB_CLIENT_ID) throw new Error('Google backup isn’t set up on this site yet.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: WEB_CLIENT_ID,
      scope: SCOPE,
      callback: (res) => {
        if (res.error || !res.access_token) return reject(Object.assign(new Error('Google didn’t allow access'), { code: 'DENIED' }));
        webToken = { token: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
        return resolve(res.access_token);
      },
      error_callback: (err) => reject(Object.assign(new Error(err?.type === 'popup_closed' ? 'Cancelled' : 'Couldn’t open Google sign-in'), { code: 'CANCELLED' })),
    });
    // Without a tap, only when access was given before (no consent screen).
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function accessToken(interactive) {
  if (native()) {
    const { accessToken: token } = await GoogleDrive.authorize({ interactive });
    return token;
  }
  return webAccessToken(interactive);
}

// ---------------------------------------------------------------- Drive

async function drive(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 401) {
    webToken = null;
    throw Object.assign(new Error('Google access expired. Turn backup on again.'), { code: 'NEEDS_CONSENT' });
  }
  if (!res.ok) throw new Error(`Google Drive refused the backup (${res.status})`);
  return res.json();
}

/** The backup file in Drive's app folder: { id, modifiedTime, size } or null. */
async function findBackup(token) {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const { files } = await drive(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`);
  return files?.[0] || null;
}

/** Uploads (replacing the previous backup). */
async function upload(token, blob) {
  const existing = (await findBackup(token))?.id;
  const meta = existing ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=multipart&fields=id,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size';
  return drive(token, url, { method: existing ? 'PATCH' : 'POST', body: form });
}

// ---------------------------------------------------------------- backup

let running = null;

/**
 * Backs up every chat now. `interactive`: may show Google's screens (the user tapped).
 * `chats`: the conversations; `me`: my user id. → { at, size }.
 */
export function backUpNow({ chats, me, interactive = false, onProgress }) {
  running ??= (async () => {
    try {
      const token = await accessToken(interactive);
      // (With what a new device needs to show each message again: see restoreFromBackup.)
      const { blob } = await buildExport(chats, me, { onProgress, restore: true });
      const file = await upload(token, blob);
      const at = new Date().toISOString();
      saveState(me, { lastAt: at, lastError: null });
      return { at, size: Number(file.size) || blob.size };
    } catch (err) {
      saveState(me, { lastError: err.message });
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Restores chats from the Google Drive backup onto this device (signed in again, or a new
 * phone): messages it couldn't read ("Sent before this device was linked") become readable.
 * → { restored, backupAt } ; throws { code: 'NO_BACKUP' } when there's none.
 */
export async function restoreFromBackup({ me, interactive = true }) {
  const token = await accessToken(interactive);
  const file = await findBackup(token);
  if (!file) throw Object.assign(new Error('No ChatApp backup found in this Google account'), { code: 'NO_BACKUP' });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Couldn’t download the backup (${res.status})`);
  const data = await res.json();
  const records = [];
  for (const chat of data.chats || []) {
    for (const m of chat.messages || []) {
      if (m.restore) records.push([m.id, { ...m.restore, conv: chat.id, sender: m.sender?.id || null, at: m.sentAt }]);
    }
  }
  const restored = e2ee.importRestored(records);
  storage.set(`backup.restored.${me}`, new Date().toISOString());
  return { restored, backupAt: file.modifiedTime };
}

/** Turns backup on (asks Google for access, then backs up) or off. */
export async function setBackupEnabled({ enabled, chats, me, onProgress }) {
  if (!enabled) {
    saveState(me, { enabled: false });
    return null;
  }
  const result = await backUpNow({ chats, me, interactive: true, onProgress });
  saveState(me, { enabled: true });
  return result;
}

/** Daily backup in the background (when on, online, and the last one is a day old). */
export async function backUpIfDue({ chats, me }) {
  const state = backupState(me);
  if (!state.enabled || !backupAvailable() || navigator.onLine === false) return;
  if (state.lastAt && Date.now() - Date.parse(state.lastAt) < DAY_MS) return;
  // Web: a silent token needs Google's script, which shows nothing when access was given.
  await backUpNow({ chats, me, interactive: false }).catch(() => {});
}
