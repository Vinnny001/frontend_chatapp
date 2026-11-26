import { Capacitor } from '@capacitor/core';
import { DeviceFiles, docPath, ensureNativeFile, nativeFilesSupported } from './deviceFiles.js';

// Handing a file to another app (WhatsApp, Gmail, Drive, Files...) or saving it.
//  - Phone: the system share sheet (DeviceFilesPlugin.share); "Save to phone" puts it in
//    Downloads/ChatApp (Android) where the Files app finds it.
//  - Web: the browser's share sheet where it can share files, else a download.

const safeName = (name) => (name || 'file').replace(/[^\w.\- ()]+/g, '_').slice(-80);

/**
 * The file's copy in the phone's app storage. `key` (a chat file's address) reuses the copy
 * made the last time it was opened or shared, so the share sheet comes up at once.
 */
async function nativeCopy(blob, name, key) {
  const path = key ? docPath(key, name) : `share/${Date.now().toString(36)}/${safeName(name)}`;
  await ensureNativeFile(path, blob);
  return path;
}

async function nativeShare(blob, name, { title, key } = {}) {
  const path = await nativeCopy(blob, name, key);
  try {
    await DeviceFiles.share({ path, mime: blob.type || 'application/octet-stream', title: title || 'Share' });
  } catch (err) {
    throw new Error(err?.code === 'NO_APP' ? 'No app on this phone can receive this file.' : 'Couldn’t share this file.');
  }
}

function download(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/**
 * Share a file to another app (falls back to downloading it where sharing files isn't possible).
 * `key`: the chat file's address, to reuse its copy on the phone.
 */
export async function shareFile(blob, name, { title, key } = {}) {
  if (nativeFilesSupported()) return nativeShare(blob, name, { title, key });
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title || name });
      return undefined;
    } catch (err) {
      if (err?.name === 'AbortError') return undefined; // closed the sheet
    }
  }
  download(blob, name);
  return undefined;
}

/** Can this device also share files (besides saving them)? */
export const canShareFiles = () =>
  nativeFilesSupported() || !!navigator.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });

/**
 * Save a file in the phone's storage, where the Files app can find it: Downloads/ChatApp on
 * Android, "Save to Files" on iPhone, a download on the web. → where it went (for a message).
 */
export async function saveToDevice(blob, name) {
  if (Capacitor.getPlatform() === 'android') {
    const path = await nativeCopy(blob, name);
    const { location } = await DeviceFiles.saveToDownloads({ path, name: safeName(name), mime: blob.type || 'application/octet-stream' });
    return location;
  }
  if (Capacitor.getPlatform() === 'ios') {
    await nativeShare(blob, name, { title: 'Save to Files' });
    return null;
  }
  download(blob, name);
  return 'Downloads';
}

/** @deprecated kept for callers: on a phone shares, on the web downloads. */
export async function saveOrShareFile(blob, name, { title } = {}) {
  if (nativeFilesSupported()) return nativeShare(blob, name, { title });
  download(blob, name);
  return undefined;
}
