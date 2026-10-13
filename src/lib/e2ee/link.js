// Linking a new device by QR code. While it waits for approval, the new device makes a one-time
// key pair and shows its public half in a QR code (with the sign-in request and its number).
// The signed-in device that scans it approves the sign-in and seals the history it sends to that
// key: only the device that showed the code can open it, even if the server slipped another
// device in between.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const canLink = () => !!window.crypto?.subtle;

/** The new device's one-time key: { publicKey (base64url), privateJwk }. */
export async function newLinkKey() {
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

export const linkCode = (requestId, match, publicKey) => `chatapp-link:1:${requestId}:${match}:${publicKey}`;

/** { requestId, match, publicKey } from a scanned code, or null. */
export function parseLinkCode(text = '') {
  const m = /^chatapp-link:1:([a-f0-9]{24}):(\d{2}):([A-Za-z0-9_-]{80,100})$/.exec(text.trim());
  return m && { requestId: m[1], match: Number(m[2]), publicKey: m[3] };
}

async function aesKey(privateKey, publicKeyBytes, salt, usage) {
  const peer = await crypto.subtle.importKey('raw', publicKeyBytes, ECDH, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('chatapp-link-history') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

/** Encrypts `data` so only the holder of `toPublicKey`'s private half can read it. `context` binds it (e.g. recipient). */
export async function seal(toPublicKey, data, context) {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const key = await aesKey(eph.privateKey, unb64u(toPublicKey), epk, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(JSON.stringify(data)));
  return { epk: b64u(epk), iv: b64u(iv), ct: b64u(ct) };
}

export async function unseal(privateJwk, sealed, context) {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const epk = unb64u(sealed.epk);
  const key = await aesKey(priv, epk, epk, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(sealed.iv), additionalData: enc.encode(context) }, key, unb64u(sealed.ct));
  return JSON.parse(dec.decode(pt));
}
