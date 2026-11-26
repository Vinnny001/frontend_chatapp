import { Capacitor, registerPlugin } from '@capacitor/core';
import { mediaUrl } from './config.js';
import { ensureMedia } from './media.js';

// Android/iOS: files in the app's private native storage (DeviceFilesPlugin.java / .swift).
// Used to open documents in the phone's viewer (Android apps / iOS Quick Look) and to hand
// media to the background sender.
export const DeviceFiles = registerPlugin('DeviceFiles');
export const nativeFilesSupported = () => ['android', 'ios'].includes(Capacitor.getPlatform());

// Big chunks, base64-encoded by the browser itself (FileReader): far faster than doing it in
// JS, so sharing or saving a video starts quickly. (3 MB: a multiple of 3, so chunks join.)
const CHUNK_BYTES = 3 * 1024 * 1024;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Copies a Blob into native storage at `path` (relative to the app's files folder). */
export async function writeNativeFile(path, blob) {
  for (let offset = 0; offset < blob.size || offset === 0; offset += CHUNK_BYTES) {
    const data = await toBase64(blob.slice(offset, offset + CHUNK_BYTES));
    await DeviceFiles.write({ path, data, append: offset > 0 });
    if (blob.size === 0) break;
  }
}

/** Writes `blob` at `path` unless the same file (same size) is already there. */
export async function ensureNativeFile(path, blob) {
  const { exists, size } = await DeviceFiles.stat({ path }).catch(() => ({}));
  if (!exists || size !== blob.size) await writeNativeFile(path, blob);
}

export const removeNativeFile = (path) => DeviceFiles.remove({ path }).catch(() => {});

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
const safeName = (name) => (name || 'document').replace(/[^\w.\- ()]+/g, '_').slice(-80);
/** Where a chat file's phone copy lives (one per file, named like the original). */
export const docPath = (url, name) => `docs/${hash(url)}/${safeName(name)}`;

/**
 * Opens a chat document the WhatsApp way: from the copy saved on the phone (works offline),
 * in whatever app handles it. Downloads it first if it isn't saved yet.
 * Throws with a user-facing message when that isn't possible.
 */
export async function openDocument(media) {
  // Just-sent files are still in memory (blob:); everything else comes from device storage.
  const blob = String(media.url).startsWith('blob:')
    ? await fetch(media.url).then((r) => r.blob())
    : await ensureMedia(media.url);
  if (!nativeFilesSupported()) {
    // Web: open the saved copy (or the network file) in a new tab / download it.
    // (An encrypted file is only ever opened decrypted, never from its raw address.)
    const href = blob ? URL.createObjectURL(blob) : navigator.onLine !== false && !media.key ? mediaUrl(media.url) : null;
    if (!href) throw new Error('This document hasn’t been downloaded yet. Connect to the internet to open it.');
    const a = Object.assign(document.createElement('a'), { href, download: media.name || 'document', target: '_blank', rel: 'noopener' });
    a.click();
    if (blob) setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return;
  }
  if (!blob) throw new Error('This document hasn’t been downloaded yet. Connect to the internet to open it.');

  // One file per document, named like the original so the viewer app shows a sensible title.
  const path = docPath(media.url, media.name);
  await ensureNativeFile(path, blob);
  try {
    await DeviceFiles.open({ path, mime: media.mime || blob.type || '*/*' });
  } catch (err) {
    throw new Error(err?.code === 'NO_APP' ? 'No app on this phone can open this type of file.' : 'Could not open this document.');
  }
}
