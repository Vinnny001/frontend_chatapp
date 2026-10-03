import {
  isNativeApp,
  playNativeEndTone,
  startNativeRingback,
  startNativeRinging,
  stopNativeRingback,
  stopNativeRinging,
} from './native.js';

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

// ---- Caller side: what you hear while waiting for the other person to answer.

let ringbackTimer = null;

/** Two tones together (like a phone line's ringing / busy tones). */
function dualTone(f1, f2, seconds, volume = 0.06) {
  try {
    const ac = ctx();
    const t = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.03);
    gain.gain.setValueAtTime(volume, t + seconds - 0.05);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    gain.connect(ac.destination);
    for (const f of [f1, f2]) {
      const osc = ac.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + seconds);
    }
  } catch {
    /* audio not available */
  }
}

/** "Ringing…": the ringback tone until the call is answered, declined or given up. */
export function startRingback() {
  stopRingback();
  if (isNativeApp()) return startNativeRingback();
  const ring = () => dualTone(440, 480, 2);
  ring();
  ringbackTimer = setInterval(ring, 6000);
}

export function stopRingback() {
  clearInterval(ringbackTimer);
  ringbackTimer = null;
  stopNativeRingback();
}

/** Declined / busy / no answer: a few busy beeps. */
export function playEndTone() {
  stopRingback();
  if (isNativeApp()) return playNativeEndTone();
  [0, 0.5, 1].forEach((delay) => setTimeout(() => dualTone(480, 620, 0.25), delay * 1000));
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
