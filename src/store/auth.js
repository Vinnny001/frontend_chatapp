import { create } from 'zustand';
import { api, setApiToken, setUnauthorizedHandler } from '../lib/api.js';
import { storage } from '../lib/storage.js';

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
    setApiToken(null);
    storage.set('auth.token', null);
    storage.set('auth.user', null);
    set({ token: null, user: null });
  },
}));

setUnauthorizedHandler(() => useAuth.getState().logout());

export const useMe = () => useAuth((s) => s.user);
