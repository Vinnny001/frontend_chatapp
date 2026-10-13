import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { DeviceFiles } from './deviceFiles.js';

// How much room the app has for its data (encryption keys, messages, media), and the ways out
// when there's too little: the phone's storage settings, or the home screen.
const isNative = () => Capacitor.getPlatform() === 'android';

/** Below this, encryption (and the app) can't be relied on to save anything. */
export const LOW_SPACE_BYTES = 100 * 1024 * 1024;

/** { free, total } in bytes, or null when the device doesn't say. */
export async function freeSpace() {
  try {
    if (isNative()) return await DeviceFiles.space();
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota) return null;
    // The browser's allowance for this site: shrinks as the disk fills up.
    return { free: Math.max(0, est.quota - (est.usage || 0)), total: est.quota };
  } catch {
    return null;
  }
}

export function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
}

export const canOpenStorageSettings = isNative;
export const openStorageSettings = () => DeviceFiles.openStorageSettings().catch(() => {});
export const canGoHome = isNative;
export const goHome = () => CapacitorApp.minimizeApp().catch(() => {});
