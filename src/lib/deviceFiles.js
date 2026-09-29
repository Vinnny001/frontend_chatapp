import { Capacitor, registerPlugin } from '@capacitor/core';
import { mediaUrl } from './config.js';
import { ensureMedia } from './media.js';

// Android: files in the app's private native storage (DeviceFilesPlugin.java). Used to hand
// documents to other apps (PDF/Word viewers) and media to the background sender.
const DeviceFiles = registerPlugin('DeviceFiles');
export const nativeFilesSupported = () => Capacitor.getPlatform() === 'android';

const CHUNK_BYTES = 512 * 1024;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Copies a Blob into native storage at `path` (relative to the app's files folder). */
export async function writeNativeFile(path, blob) {
  for (let offset = 0; offset < blob.size || offset === 0; offset += CHUNK_BYTES) {
    const chunk = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
    await DeviceFiles.write({ path, data: toBase64(chunk), append: offset > 0 });
    if (blob.size === 0) break;
  }
}

export const removeNativeFile = (path) => DeviceFiles.remove({ path }).catch(() => {});

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
const safeName = (name) => (name || 'document').replace(/[^\w.\- ()]+/g, '_').slice(-80);

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
    const href = blob ? URL.createObjectURL(blob) : navigator.onLine !== false ? mediaUrl(media.url) : null;
    if (!href) throw new Error('This document hasn’t been downloaded yet. Connect to the internet to open it.');
    const a = Object.assign(document.createElement('a'), { href, download: media.name || 'document', target: '_blank', rel: 'noopener' });
    a.click();
    if (blob) setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return;
  }
  if (!blob) throw new Error('This document hasn’t been downloaded yet. Connect to the internet to open it.');

  // One file per document, named like the original so the viewer app shows a sensible title.
  const path = `docs/${hash(media.url)}/${safeName(media.name)}`;
  const { exists, size } = await DeviceFiles.stat({ path });
  if (!exists || size !== blob.size) await writeNativeFile(path, blob);
  try {
    await DeviceFiles.open({ path, mime: media.mime || blob.type || '*/*' });
  } catch (err) {
    throw new Error(err?.code === 'NO_APP' ? 'No app on this phone can open this type of file.' : 'Could not open this document.');
  }
}
