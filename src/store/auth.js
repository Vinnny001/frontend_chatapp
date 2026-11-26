import { create } from 'zustand';
import { api, setApiToken, setUnauthorizedHandler } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { API_URL } from '../lib/config.js';
import { unregisterPush } from '../lib/push.js';
import { deviceInfo, tokenDeviceId } from '../lib/device.js';
import { eraseDevice, stop as stopE2ee } from '../lib/e2ee/index.js';
import { eraseLocalDb } from '../lib/localdb.js';
import { clearCache } from '../lib/cache.js';
import { clearNativeSession, setNativeSession } from '../lib/native.js';
import { canLink, linkCode, newLinkKey } from '../lib/e2ee/link.js';

const initialToken = storage.get('auth.token');
setApiToken(initialToken);

/**
 * Ends a session on the server. Until the server confirms, its token is kept here and the sign-out
 * is retried (on the next start and before the next sign-in): otherwise a failed request leaves the
 * device "signed in" there, and it keeps being asked to approve new sign-ins.
 */
async function signOutOnServer(token, { keep = false } = {}) {
  if (token) storage.set('auth.signOut', { token, keep });
  let pending = storage.get('auth.signOut');
  if (typeof pending === 'string') pending = { token: pending, keep: false }; // (older app)
  if (!pending?.token) return;
  try {
    const res = await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pending.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: !!pending.keep }),
      keepalive: true,
    });
    // 401: that session had already ended.
    if (res.ok || res.status === 401) storage.set('auth.signOut', null);
  } catch {
    /* offline: retried later */
  }
}
signOutOnServer();

// Chats kept on this device from an earlier sign-in (it ran out, or "Log out" kept them):
// { userId, deviceId, token }. Signing in again with that account resumes the same device.
const kept = () => storage.get('auth.resume');

/** Erases the chats kept from an earlier sign-in (another account signed in, or they can't be resumed). */
function eraseKept() {
  const k = kept();
  if (!k) return;
  storage.set('auth.resume', null);
  eraseDevice(k.userId, k.deviceId);
  eraseLocalDb(k.userId);
  clearCache(k.userId);
}

const RENEW_AFTER_MS = 24 * 3600 * 1000; // a login is renewed once it's a day old
const tokenAge = (token) => {
  try {
    const { iat } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Date.now() - iat * 1000;
  } catch {
    return 0;
  }
};

export const useAuth = create((set, get) => ({
  token: initialToken,
  user: storage.get('auth.user'),
  // A sign-in waiting for approval on another device: { request: { id, secret, match, expiresAt }, devices, email }
  approval: null,
  // Signed in on a new device next to my other ones: ask whether to sync before showing chats.
  syncChoice: !!storage.get('auth.syncChoice'),

  async login(identifier, password) {
    await signOutOnServer(); // a sign-out that didn't reach the server must not ask this device to approve itself
    const res = await api('/api/auth/login', { method: 'POST', body: { identifier, password, device: deviceInfo(), resume: kept()?.token } });
    if (res.resumed) {
      // The same device as before: its keys and chats are still here.
      storage.set('auth.resume', null);
      return get().setSession(res.token, res.user, { fresh: false });
    }
    // A new device for this sign-in: chats kept from before can't be used by it.
    eraseKept();
    if (res.approvalRequired) {
      // A QR code to scan on the other device: approves this sign-in and carries a one-time key
      // that the history it sends here is sealed to.
      let linkQr = null;
      if (canLink()) {
        const key = await newLinkKey().catch(() => null);
        if (key) {
          storage.set('e2ee.link', { requestId: res.request.id, privateJwk: key.privateJwk });
          linkQr = linkCode(res.request.id, res.request.match, key.publicKey);
        }
      }
      return set({ approval: { request: res.request, devices: res.devices, email: res.email, linkQr } });
    }
    get().setSession(res.token, res.user);
  },

  /** Asks whether the waiting sign-in was approved: 'pending' | 'denied' | 'expired' (or signs in). */
  async checkApproval() {
    const a = get().approval;
    if (!a) return null;
    const res = await api(`/api/auth/login-requests/${a.request.id}`, { headers: { 'x-request-secret': a.request.secret } });
    if (res.status === 'approved') {
      set({ approval: null });
      get().askSync();
      get().setSession(res.token, res.user);
    }
    return res.status;
  },

  /** Can't reach the other device: email a code instead. */
  emailApprovalCode() {
    const { request } = get().approval;
    return api(`/api/auth/login-requests/${request.id}/email`, { method: 'POST', body: { secret: request.secret } });
  },

  async approveWithEmailCode(code) {
    const { request } = get().approval;
    const res = await api(`/api/auth/login-requests/${request.id}/email/verify`, { method: 'POST', body: { secret: request.secret, code } });
    set({ approval: null });
    get().askSync();
    get().setSession(res.token, res.user);
  },

  cancelApproval() {
    const a = get().approval;
    set({ approval: null });
    storage.set('e2ee.link', null);
    if (a) api(`/api/auth/login-requests/${a.request.id}`, { method: 'DELETE', body: { secret: a.request.secret } }).catch(() => {});
  },

  askSync() {
    storage.set('auth.syncChoice', true);
    set({ syncChoice: true });
  },

  /** Sync this device with my other devices (history + contacts), or start fresh. */
  async chooseSync(sync) {
    await api('/api/devices/me', { method: 'PATCH', body: { sync } });
    storage.set('auth.syncChoice', null);
    set({ syncChoice: false });
  },

  /** Sessions from before linked devices: register this device once (keeps you signed in). */
  async ensureDevice() {
    const { token } = get();
    if (!token || tokenDeviceId(token)) return;
    const res = await api('/api/devices/register', { method: 'POST', body: deviceInfo() });
    if (res.token) get().setSession(res.token, get().user, { fresh: false });
  },

  async signup(data) {
    const { token, user } = await api('/api/auth/signup', { method: 'POST', body: data });
    get().setSession(token, user, { fresh: false });
  },

  /** Confirm the email with the 6-digit code (turns the pending login into a full one). */
  async verifyEmail(code) {
    const { token, user } = await api('/api/auth/verify-email', { method: 'POST', body: { code, device: deviceInfo() } });
    get().setSession(token, user, { fresh: false });
  },

  resendCode: () => api('/api/auth/resend-code', { method: 'POST' }),

  /** Forgot password: email a reset code. */
  forgotPassword: (email) => api('/api/auth/forgot', { method: 'POST', body: { email } }),

  /** New password with the emailed code; signs in. */
  async resetPassword(data) {
    const { token, user } = await api('/api/auth/reset', { method: 'POST', body: { ...data, device: deviceInfo() } });
    get().setSession(token, user);
  },

  /** `fresh`: a new device for this account (it's offered to restore the Google Drive backup). */
  setSession(token, user, { fresh = true } = {}) {
    if (kept() && kept().userId !== user?.id) eraseKept(); // (another account on this device)
    if (fresh && user?.id && token !== get().token) storage.set('restore.offer', user.id);
    setApiToken(token);
    storage.set('auth.token', token);
    storage.set('auth.user', user);
    set({ token, user });
  },

  /**
   * Keeps the sign-in from running out while the app is used: once a day it's swapped for a
   * fresh one (90 days). Quietly does nothing offline; the next try is on the next start.
   */
  async renewSession() {
    const { token } = get();
    if (!token || !tokenDeviceId(token) || tokenAge(token) < RENEW_AFTER_MS) return;
    try {
      const res = await api('/api/auth/refresh', { method: 'POST' });
      if (!res.token || get().token !== token) return;
      setApiToken(res.token);
      storage.set('auth.token', res.token);
      set({ token: res.token });
      setNativeSession(res.token); // (notification replies use it too)
    } catch {
      /* offline or server asleep: tried again later */
    }
  },

  setUser(user) {
    storage.set('auth.user', user);
    set({ user });
  },

  async refreshMe() {
    const { user } = await api('/api/auth/me');
    get().setUser(user);
  },

  /**
   * Signs out here. `keep`: leave this device's chats (keys and messages) on it, so signing in
   * again here picks them up. `server: false` when the server already ended the session; then
   * `reason` says why: a sign-in that ran out ('expired') keeps the chats, one signed out from
   * elsewhere (or a password change) doesn't.
   */
  logout({ server = true, keep = false, reason } = {}) {
    const { token, user } = get();
    if (!token) return; // already signed out (two requests can both find the sign-in ended)
    const keepChats = keep || reason === 'expired' || reason === 'signed-out';
    unregisterPush(); // uses the current login token, so it must start before it's cleared
    if (server && token) signOutOnServer(token, { keep: keepChats });
    if (keepChats && token && user && tokenDeviceId(token)) {
      storage.set('auth.resume', { userId: user.id, deviceId: tokenDeviceId(token), token });
      stopE2ee({ wipe: false }).catch(() => {});
    } else {
      storage.set('auth.resume', null);
      // This device's encryption keys and decrypted messages go with the session.
      stopE2ee({ wipe: true }).catch(() => {});
    }
    clearNativeSession();
    setApiToken(null);
    storage.set('auth.token', null);
    storage.set('auth.user', null);
    storage.set('auth.syncChoice', null);
    set({ token: null, user: null, syncChoice: false });
  },
}));

setUnauthorizedHandler((reason) => useAuth.getState().logout({ server: false, reason }));

/** Whether "Log out" (or a sign-in running out) left this device's chats here for next time. */
export const keepingChats = () => !!storage.get('auth.resume');

export const useMe = () => useAuth((s) => s.user);
