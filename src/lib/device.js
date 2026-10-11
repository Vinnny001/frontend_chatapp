import { Capacitor } from '@capacitor/core';

/**
 * How this device introduces itself when signing in ("ChatApp on Pixel 5", "Edge on Windows"):
 * shown in Linked devices, in sign-in approval prompts and in the new-sign-in email.
 */
export function deviceInfo() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
  if (platform === 'android') {
    // "Linux; Android 13; Pixel 5 Build/…" (newer browsers hide the model as "K").
    const model = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/|\))/)?.[1]?.trim();
    return { platform, name: `ChatApp on ${model && model !== 'K' ? model : 'Android'}` };
  }
  if (platform === 'ios') return { platform, name: `ChatApp on ${/iPad/.test(ua) ? 'iPad' : 'iPhone'}` };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return { platform: 'web', name: `${browser}${os ? ` on ${os}` : ''}` };
}

/** The device id inside a login token (absent on tokens from before linked devices). */
export function tokenDeviceId(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).did || null;
  } catch {
    return null;
  }
}
