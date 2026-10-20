import { API_URL } from './config.js';

// "Chat with me" links, like wa.me: https://<api>/chat/<username or phone>?text=<message>
// (the app itself is opened with chatapp://chat/<who>?text=…). Opening one goes to the chat
// with that person, with the message typed in, never sent by itself.

const LINK = /^(?:https?:\/\/[^/\s]+|chatapp:\/)\/chat\/([^/?#\s]{3,40})\/?(?:\?([^#\s]*))?$/i;

/** A chat link for a username (without @) or a phone number, with an optional message. */
export function chatLink(who, text = '') {
  const id = String(who).replace(/^@/, '').replace(/[\s()-]/g, '');
  return `${API_URL}/chat/${encodeURIComponent(id)}${text.trim() ? `?text=${encodeURIComponent(text.trim())}` : ''}`;
}

/** { who, text } from a chat link, or null when it isn't one. */
export function chatLinkOf(url) {
  const m = (url || '').trim().match(LINK);
  if (!m) return null;
  const text = new URLSearchParams(m[2] || '').get('text') || '';
  return { who: decodeURIComponent(m[1]), text };
}
