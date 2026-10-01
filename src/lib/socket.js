import { io } from 'socket.io-client';
import { REALTIME_URL } from './config.js';

let socket = null;

let appActive = typeof document === 'undefined' || document.visibilityState === 'visible';

/** The app came on screen / went to the background: others see "online" / "last seen". */
export function setAppActive(active) {
  if (active === appActive) return;
  appActive = active;
  if (socket?.connected) socket.emit('presence:state', { active }, () => {});
}

export function connectSocket(token) {
  socket?.disconnect();
  socket = io(REALTIME_URL, {
    // Sent on every (re)connect: whether the app is on screen ("online" means open, as on WhatsApp).
    auth: (cb) => cb({ token, active: appActive }),
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export const getSocket = () => socket;

/** Emits with an acknowledgement; resolves with the server's reply or rejects with its error. */
export function emitAck(event, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Not connected'));
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (err) reject(new Error('The server did not respond'));
      else if (!res?.ok) reject(new Error(res?.error || 'Request failed'));
      else resolve(res);
    });
  });
}

/** Fire-and-forget emit that is dropped (not buffered) while offline, e.g. typing. */
export function emitVolatile(event, payload) {
  if (socket?.connected) socket.volatile.emit(event, payload);
}
