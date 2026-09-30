import { isNativeApp, startNativeRinging, stopNativeRinging } from './native.js';

let audioCtx = null;

function ctx() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function tone(freqs, { duration = 0.12, gap = 0.06, volume = 0.08 } = {}) {
  try {
    const ac = ctx();
    let t = ac.currentTime;
    for (const f of freqs) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + duration);
      t += duration + gap;
    }
  } catch {
    /* audio not available */
  }
}

export const playIncoming = () => tone([880, 1320]);
export const playSent = () => tone([660], { duration: 0.08, volume: 0.04 });

let ringTimer = null;
export function startRingtone() {
  stopRingtone();
  // Phones: the real ringtone / vibration, following the ring mode (ring, vibrate, silent).
  if (isNativeApp()) return startNativeRinging();
  const ring = () => tone([740, 988, 740, 988], { duration: 0.18, gap: 0.04, volume: 0.1 });
  ring();
  ringTimer = setInterval(ring, 2200);
}
export function stopRingtone() {
  clearInterval(ringTimer);
  ringTimer = null;
  stopNativeRinging();
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export function showNotification(title, body, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/icon-192.png', tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some WebViews expose Notification but refuse to construct it */
  }
}
