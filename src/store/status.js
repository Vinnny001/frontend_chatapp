import { create } from 'zustand';
import { api, uploadFile } from '../lib/api.js';
import * as e2ee from '../lib/e2ee/index.js';
import { encryptFile } from '../lib/e2ee/files.js';
import { rememberMedia } from '../lib/media.js';

/** Background colours for text updates (white text reads on all of them). */
export const STATUS_COLORS = ['#0b8f6a', '#5b45c2', '#c2410c', '#be185d', '#1d4ed8', '#374151', '#7c3aed', '#0f766e'];
export const MAX_VIDEO_SECONDS = 60;

const live = (s) => Date.parse(s.expiresAt) > Date.now();

/** Each update with what it says (decrypted here); ones this device can't read are left out. */
async function withContent(list) {
  const out = await Promise.all(list.filter(live).map(async (s) => ({ ...s, payload: await e2ee.openStatus(s) })));
  return out.filter((s) => s.payload);
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve(v.duration);
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

let reloadTimer = null;

export const useStatus = create((set, get) => ({
  mine: [], // my updates: { id, payload, createdAt, expiresAt, audience, viewers: [{ user, at }] }
  others: [], // [{ user, muted, statuses: [{ id, payload, createdAt, viewed }] }]
  loaded: false,
  viewer: null, // { owner: 'me' | userId, index }
  composing: null, // null | 'text' | 'media'

  async load() {
    const feed = await api('/api/status/feed');
    const mine = await withContent(feed.mine);
    const others = (await Promise.all(feed.others.map(async (g) => ({ ...g, statuses: await withContent(g.statuses) })))).filter((g) => g.statuses.length);
    set({ mine, others, loaded: true });
  },

  /** Shortly after something changed (several events often come together). */
  reloadSoon() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => get().load().catch(() => {}), 400);
  },

  /** A text update ({ text, bg }) or a photo / video with an optional caption ({ file, text }). */
  async post({ text = '', bg, file }) {
    let payload;
    if (file) {
      const video = file.type.startsWith('video/');
      if (!video && !file.type.startsWith('image/')) throw new Error('Choose a photo or a video');
      const duration = video ? await videoDuration(file) : undefined;
      if (video && duration > MAX_VIDEO_SECONDS) throw new Error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds long`);
      // The file is encrypted before it leaves the device; its key travels inside the update.
      const sealed = await encryptFile(file);
      const up = await uploadFile(sealed.blob, { name: 'encrypted' });
      await rememberMedia(up.url, file);
      payload = {
        type: 'status',
        kind: video ? 'video' : 'image',
        text: text.trim(),
        media: { url: up.url, key: sealed.key, iv: sealed.iv, mime: file.type, size: file.size, ...(duration && { duration }) },
      };
    } else {
      if (!text.trim()) throw new Error('Write something');
      payload = { type: 'status', kind: 'text', text: text.trim(), bg: bg || STATUS_COLORS[0] };
    }
    await e2ee.postStatus(payload);
    await get().load();
  },

  async markViewed(ownerId, id) {
    const g = get().others.find((x) => x.user.id === ownerId);
    const s = g?.statuses.find((x) => x.id === id);
    if (!s || s.viewed) return;
    set({ others: get().others.map((x) => (x === g ? { ...x, statuses: x.statuses.map((y) => (y.id === id ? { ...y, viewed: true } : y)) } : x)) });
    await api(`/api/status/${id}/view`, { method: 'POST' }).catch(() => {});
  },

  async remove(id) {
    await api(`/api/status/${id}`, { method: 'DELETE' });
    set({ mine: get().mine.filter((s) => s.id !== id) });
  },

  async mute(userId, muted) {
    await api(`/api/status/mute/${userId}`, { method: 'PUT', body: { muted } });
    set({ others: get().others.map((g) => (g.user.id === userId ? { ...g, muted } : g)) });
  },

  openViewer: (owner, index = 0) => set({ viewer: { owner, index } }),
  closeViewer: () => set({ viewer: null }),
  compose: (kind) => set({ composing: kind }),

  // Live events
  onRemoved({ id }) {
    set({ mine: get().mine.filter((s) => s.id !== id), others: get().others.map((g) => ({ ...g, statuses: g.statuses.filter((s) => s.id !== id) })).filter((g) => g.statuses.length) });
  },
}));

/** People with updates I haven't seen (not muted): for the dot on the Status button. */
export const unseenCount = (s) => s.others.filter((g) => !g.muted && g.statuses.some((x) => !x.viewed)).length;
