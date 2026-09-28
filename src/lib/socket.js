import { io } from 'socket.io-client';
import { REALTIME_URL } from './config.js';

let socket = null;

export function connectSocket(token) {
  socket?.disconnect();
  socket = io(REALTIME_URL, {
    auth: { token },
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
