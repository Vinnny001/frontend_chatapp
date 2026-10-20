// "support:update" from the server (a support request changed: a reply, closed): whoever shows
// support requests (Help, the admin page) refreshes.
const listeners = new Set();

export function onSupportUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function supportUpdated(payload) {
  listeners.forEach((fn) => fn(payload));
}
