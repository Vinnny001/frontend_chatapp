const trimSlash = (s) => s.replace(/\/+$/, '');
// Default to the host serving the page so a phone on the LAN hitting http://<pc-ip>:5173 works.
const host = typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.hostname : 'localhost';

export const API_URL = trimSlash(import.meta.env.VITE_API_URL || `http://${host}:5050`);
export const REALTIME_URL = trimSlash(import.meta.env.VITE_REALTIME_URL || `http://${host}:5051`);

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(import.meta.env.VITE_TURN_URL
    ? [
        {
          urls: import.meta.env.VITE_TURN_URL,
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_CREDENTIAL,
        },
      ]
    : []),
];

/** Uploaded files are stored as "/uploads/..." paths; resolve them against the API host. */
export function mediaUrl(url) {
  if (!url) return null;
  return url.startsWith('/') ? API_URL + url : url;
}
