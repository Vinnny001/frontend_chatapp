import { create } from 'zustand';
import { storage } from '../lib/storage.js';

export const WALLPAPERS = [
  { id: 'doodle', label: 'Doodle' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'plain', label: 'Plain' },
];

export const MEDIA_KINDS = [
  { id: 'image', label: 'Photos' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Videos' },
  { id: 'file', label: 'Documents' },
];

// Same defaults as WhatsApp: photos + audio on mobile data, everything on Wi-Fi.
// (An old "auto-download off" setting from the previous version carries over as "nothing".)
const DEFAULT_AUTO_DOWNLOAD =
  storage.get('ui.autoDownload', true) === false
    ? { cellular: [], wifi: [] }
    : { cellular: ['image', 'audio'], wifi: ['image', 'audio', 'video', 'file'] };

let toastId = 0;

export const useUI = create((set, get) => ({
  theme: storage.get('ui.theme', 'system'), // system | light | dark
  wallpaper: storage.get('ui.wallpaper', 'doodle'),
  enterToSend: storage.get('ui.enterToSend', true),
  sounds: storage.get('ui.sounds', true),
  // Which media downloads automatically (so it's available offline), per connection type.
  autoDownloadRules: storage.get('ui.autoDownloadRules', DEFAULT_AUTO_DOWNLOAD),
  // Sidebar overlay panels: newChat | newGroup | settings | starred | profile
  panel: null,
  infoOpen: false,
  viewer: null, // { url, type, name } for the full-screen media viewer
  forwarding: null, // message being forwarded
  phoneMenu: null, // { x, y, phone } for a tapped phone number in a message
  toasts: [],
  // In-app notification at the top of the screen (a message or reaction from another chat):
  // { id, title, text, avatarUrl, conversationId }
  banner: null,
  profilePreview: null, // conversation id whose photo was tapped in the chat list

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

  showBanner(banner) {
    const id = ++toastId;
    set({ banner: { ...banner, id } });
    setTimeout(() => get().banner?.id === id && set({ banner: null }), 4500);
  },
  hideBanner: () => set({ banner: null }),
  setProfilePreview: (profilePreview) => set({ profilePreview }),

  toast(message, kind = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500);
  },
}));

export const toast = (message, kind) => useUI.getState().toast(message, kind);
