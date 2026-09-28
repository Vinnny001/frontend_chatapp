import { create } from 'zustand';
import { storage } from '../lib/storage.js';

export const WALLPAPERS = [
  { id: 'doodle', label: 'Doodle' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'plain', label: 'Plain' },
];

let toastId = 0;

export const useUI = create((set, get) => ({
  theme: storage.get('ui.theme', 'system'), // system | light | dark
  wallpaper: storage.get('ui.wallpaper', 'doodle'),
  enterToSend: storage.get('ui.enterToSend', true),
  sounds: storage.get('ui.sounds', true),
  // Sidebar overlay panels: newChat | newGroup | settings | starred | profile
  panel: null,
  infoOpen: false,
  viewer: null, // { url, type, name } for the full-screen media viewer
  forwarding: null, // message being forwarded
  phoneMenu: null, // { x, y, phone } for a tapped phone number in a message
  toasts: [],

  setPref(key, value) {
    storage.set(`ui.${key}`, value);
    set({ [key]: value });
  },
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  setInfoOpen: (infoOpen) => set({ infoOpen }),
  openViewer: (viewer) => set({ viewer }),
  closeViewer: () => set({ viewer: null }),
  setForwarding: (forwarding) => set({ forwarding }),
  openPhoneMenu: (phoneMenu) => set({ phoneMenu }),
  closePhoneMenu: () => set({ phoneMenu: null }),

  toast(message, kind = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500);
  },
}));

export const toast = (message, kind) => useUI.getState().toast(message, kind);
