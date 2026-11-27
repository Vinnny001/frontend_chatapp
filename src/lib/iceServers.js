import { api } from './api.js';
import { ICE_SERVERS } from './config.js';

// STUN/TURN servers for calls, from the API (it hands out short-lived Cloudflare TURN logins).
// TURN relays a call's encrypted packets when the phones can't reach each other or the group
// call server directly: mobile data, strict Wi-Fi, and IPv6-only networks (which can't reach the
// IPv4 addresses a call server gives out, but can reach the relay by name).
// Used by 1:1 calls and group calls. Fetched ahead of time and kept until they expire.

let ice = null; // { servers, relay, until }
let loading = null;

export function loadIceServers() {
  if (ice && ice.until > Date.now()) return Promise.resolve(ice.servers);
  loading ??= api('/api/calls/ice-servers')
    .then(({ iceServers, ttl, relay }) => {
      // (A relay set in the app's own build settings is kept too.)
      const extra = ICE_SERVERS.filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
      const servers = [...(iceServers?.length ? iceServers : ICE_SERVERS.slice(0, 1)), ...extra];
      ice = { servers, relay: !!relay || extra.length > 0, until: Date.now() + Math.max(60, (ttl || 3600) - 60) * 1000 };
      return servers;
    })
    .catch(() => ICE_SERVERS)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The servers, without holding a call up for more than a few seconds. */
export const iceServers = () =>
  Promise.race([loadIceServers(), new Promise((r) => setTimeout(() => r(ice?.servers || ICE_SERVERS), 4000))]);

/** Does the list we have include a TURN relay? (false until loaded, or if the API has none) */
export const hasRelay = () => !!ice?.relay && ice.until > Date.now();
