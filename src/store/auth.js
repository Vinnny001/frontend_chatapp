import { create } from 'zustand';
import { api, setApiToken, setUnauthorizedHandler } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { API_URL } from '../lib/config.js';
import { unregisterPush } from '../lib/push.js';
import { deviceInfo, tokenDeviceId } from '../lib/device.js';
import { stop as stopE2ee } from '../lib/e2ee/index.js';

const initialToken = storage.get('auth.token');
setApiToken(initialToken);

/**
 * Ends a session on the server. Until the server confirms, its token is kept here and the sign-out
 * is retried (on the next start and before the next sign-in): otherwise a failed request leaves the
 * device "signed in" there, and it keeps being asked to approve new sign-ins.
 */
async function signOutOnServer(token) {
  if (token) storage.set('auth.signOut', token);
  const pending = storage.get('auth.signOut');
  if (!pending) return;
  try {
    const res = await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${pending}` }, keepalive: true });
    // 401: that session had already ended.
    if (res.ok || res.status === 401) storage.set('auth.signOut', null);
  } catch {
    /* offline: retried later */
  }
}
signOutOnServer();

export const useAuth = create((set, get) => ({
  token: initialToken,
  user: storage.get('auth.user'),
  // A sign-in waiting for approval on another device: { request: { id, secret, match, expiresAt }, devices, email }
  approval: null,
  // Signed in on a new device next to my other ones: ask whether to sync before showing chats.
  syncChoice: !!storage.get('auth.syncChoice'),

  async login(identifier, password) {
    await signOutOnServer(); // a sign-out that didn't reach the server must not ask this device to approve itself
    const res = await api('/api/auth/login', { method: 'POST', body: { identifier, password, device: deviceInfo() } });
    if (res.approvalRequired) return set({ approval: { request: res.request, devices: res.devices, email: res.email } });
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
    if (res.token) get().setSession(res.token, get().user);
  },

  async signup(data) {
    const { token, user } = await api('/api/auth/signup', { method: 'POST', body: data });
    get().setSession(token, user);
  },

  /** Confirm the email with the 6-digit code (turns the pending login into a full one). */
  async verifyEmail(code) {
    const { token, user } = await api('/api/auth/verify-email', { method: 'POST', body: { code, device: deviceInfo() } });
    get().setSession(token, user);
  },

  resendCode: () => api('/api/auth/resend-code', { method: 'POST' }),

  /** Forgot password: email a reset code. */
  forgotPassword: (email) => api('/api/auth/forgot', { method: 'POST', body: { email } }),

  /** New password with the emailed code; signs in. */
  async resetPassword(data) {
    const { token, user } = await api('/api/auth/reset', { method: 'POST', body: { ...data, device: deviceInfo() } });
    get().setSession(token, user);
  },

  setSession(token, user) {
    setApiToken(token);
    storage.set('auth.token', token);
    storage.set('auth.user', user);
    set({ token, user });
  },

  setUser(user) {
    storage.set('auth.user', user);
    set({ user });
  },

  async refreshMe() {
    const { user } = await api('/api/auth/me');
    get().setUser(user);
  },

  /** Signs out here; `server: false` when the server already ended this session (signed out remotely). */
  logout({ server = true } = {}) {
    unregisterPush(); // uses the current login token, so it must start before it's cleared
    if (server && get().token) signOutOnServer(get().token);
    // This device's encryption keys and decrypted messages go with the session.
    stopE2ee({ wipe: true }).catch(() => {});
    setApiToken(null);
    storage.set('auth.token', null);
    storage.set('auth.user', null);
    storage.set('auth.syncChoice', null);
    set({ token: null, user: null, syncChoice: false });
  },
}));

setUnauthorizedHandler(() => useAuth.getState().logout({ server: false }));

export const useMe = () => useAuth((s) => s.user);
