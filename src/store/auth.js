import { create } from 'zustand';
import { api, setApiToken, setUnauthorizedHandler } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { unregisterPush } from '../lib/push.js';

const initialToken = storage.get('auth.token');
setApiToken(initialToken);

export const useAuth = create((set, get) => ({
  token: initialToken,
  user: storage.get('auth.user'),

  async login(identifier, password) {
    const { token, user } = await api('/api/auth/login', { method: 'POST', body: { identifier, password } });
    get().setSession(token, user);
  },

  async signup(data) {
    const { token, user } = await api('/api/auth/signup', { method: 'POST', body: data });
    get().setSession(token, user);
  },

  /** Confirm the email with the 6-digit code (turns the pending login into a full one). */
  async verifyEmail(code) {
    const { token, user } = await api('/api/auth/verify-email', { method: 'POST', body: { code } });
    get().setSession(token, user);
  },

  resendCode: () => api('/api/auth/resend-code', { method: 'POST' }),

  /** Forgot password: email a reset code. */
  forgotPassword: (email) => api('/api/auth/forgot', { method: 'POST', body: { email } }),

  /** New password with the emailed code; signs in. */
  async resetPassword(data) {
    const { token, user } = await api('/api/auth/reset', { method: 'POST', body: data });
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

  logout() {
    unregisterPush(); // uses the current login token, so it must start before it's cleared
    setApiToken(null);
    storage.set('auth.token', null);
    storage.set('auth.user', null);
    set({ token: null, user: null });
  },
}));

setUnauthorizedHandler(() => useAuth.getState().logout());

export const useMe = () => useAuth((s) => s.user);
