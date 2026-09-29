import { Network } from '@capacitor/network';

// Whether we're on mobile data or Wi-Fi, for the media auto-download rules.
// Browsers often can't tell; anything that isn't clearly "cellular" counts as Wi-Fi.
let type = 'unknown';

Network.getStatus()
  .then((s) => (type = s.connectionType))
  .catch(() => {});
Network.addListener('networkStatusChange', (s) => (type = s.connectionType)).catch(() => {});

/** 'cellular' | 'wifi' */
export const connectionKind = () => (type === 'cellular' ? 'cellular' : 'wifi');
