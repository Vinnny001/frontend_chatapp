import { API_URL } from './config.js';

// Group invite links are served by the API (a plain https page that opens the app):
// https://<api>/join/<code>; the app itself is opened with chatapp://join/<code>.
const LINK = /^(?:https?:\/\/[^/\s]+|chatapp:\/)\/join\/([A-Za-z0-9_-]{16,40})\/?$/i;

export const inviteLink = (code) => `${API_URL}/join/${code}`;

/** The invite code in a link, or null when it isn't an invite link. */
export const inviteCodeOf = (url) => (url || '').trim().match(LINK)?.[1] || null;
