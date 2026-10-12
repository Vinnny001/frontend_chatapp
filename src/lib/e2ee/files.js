// Encrypted attachments (photos, videos, voice notes, files): each file is encrypted on the
// sender's device with its own random AES-256-GCM key before upload, so the storage service
// only ever holds unreadable bytes. The key travels inside the end-to-end encrypted message.

const b64 = (bytes) => {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Encrypts a file. Returns the encrypted blob to upload and { key, iv } for the message. */
export async function encryptFile(file) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, await file.arrayBuffer());
  return { blob: new Blob([data], { type: 'application/octet-stream' }), key: b64(key), iv: b64(iv) };
}

/** Decrypts downloaded bytes into a blob of the original type. */
export async function decryptToBlob(data, { key, iv, mime }) {
  const k = await crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, data);
  return new Blob([plain], { type: mime || 'application/octet-stream' });
}

// Which uploaded files are encrypted, and with what (filled as messages are decrypted).
const keys = new Map(); // url -> { key, iv, mime }

export function registerMediaKey(media) {
  if (media?.url && media.key && media.iv) keys.set(media.url, { key: media.key, iv: media.iv, mime: media.mime });
}

export const mediaKeyFor = (url) => keys.get(url) || null;

export function forgetMediaKeys() {
  keys.clear();
}
