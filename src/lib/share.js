import { DeviceFiles, nativeFilesSupported, writeNativeFile } from './deviceFiles.js';

// Handing a file to another app (WhatsApp, Gmail, Drive, Files...) or saving it.
//  - Phone: the system share sheet (DeviceFilesPlugin.share), which also offers "Save to Files/Drive".
//  - Web: the browser's share sheet where it can share files, else a download.

const safeName = (name) => (name || 'file').replace(/[^\w.\- ()]+/g, '_').slice(-80);

async function nativeShare(blob, name, title) {
  const path = `share/${Date.now().toString(36)}/${safeName(name)}`;
  await writeNativeFile(path, blob);
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

/** Share a file to another app (falls back to downloading it where sharing files isn't possible). */
export async function shareFile(blob, name, { title } = {}) {
  if (nativeFilesSupported()) return nativeShare(blob, name, title);
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

/** Save a file the user made (an export): download on the web, share sheet ("Save to...") on a phone. */
export async function saveOrShareFile(blob, name, { title } = {}) {
  if (nativeFilesSupported()) return nativeShare(blob, name, title);
  download(blob, name);
  return undefined;
}
