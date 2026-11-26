import { create } from 'zustand';
import { ICE_SERVERS } from '../lib/config.js';
import { emitAck } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { uid } from '../lib/format.js';
import { playEndTone, startRingback, startRingtone, stopRingback, stopRingtone } from '../lib/notify.js';
import { clearCallNotification, isNativeApp, leaveNativeCall } from '../lib/native.js';
import { displayName } from './people.js';
import { toast } from './ui.js';
import * as e2ee from '../lib/e2ee/index.js';
import { useChat } from './chat.js';

// One active 1:1 call at a time. Media is peer-to-peer (WebRTC); the realtime service only
// relays signaling messages.

const RING_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 30_000; // answered, but the phones can't reach each other
const RECOVER_MS = 20_000; // connection dropped (network change...): give it this long to come back

let pc = null;
let pendingCandidates = [];
let ringTimeout = null;
let pendingAnswer = null; // { callId, until }: answered from the notification before the call arrived
let externalTimer = null;
let connectTimer = null;
let recoverTimer = null;
let restarts = 0;

// STUN/TURN servers from the API (TURN relays the encrypted call when a direct connection
// isn't possible, e.g. on mobile data). Fetched ahead of time and kept until they expire.
let ice = null; // { servers, until }
let iceLoading = null;
function loadIceServers() {
  if (ice && ice.until > Date.now()) return Promise.resolve(ice.servers);
  iceLoading ??= api('/api/calls/ice-servers')
    .then(({ iceServers, ttl }) => {
      // (A relay set in the app's own build settings is kept too.)
      const extra = ICE_SERVERS.filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
      const servers = [...(iceServers?.length ? iceServers : ICE_SERVERS.slice(0, 1)), ...extra];
      ice = { servers, until: Date.now() + Math.max(60, (ttl || 3600) - 60) * 1000 };
      return servers;
    })
    .catch(() => ICE_SERVERS)
    .finally(() => {
      iceLoading = null;
    });
  return iceLoading;
}
/** The servers, without holding the call up for more than a few seconds. */
const iceServers = () => Promise.race([loadIceServers(), new Promise((r) => setTimeout(() => r(ice?.servers || ICE_SERVERS), 4000))]);

async function getMedia(kind, facingMode = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls are not supported on this device');
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: kind === 'video' ? { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

function signal(data) {
  const { call } = useCall.getState();
  if (call) emitAck('call:signal', { callId: call.id, data }).catch(() => {});
}

/** Sends my call setup, signed with this device's key (so the server can't swap its encryption keys). */
async function sendSetup(sdp) {
  const { call } = useCall.getState();
  const auth = call ? await e2ee.signCallSetup(call.id, sdp).catch(() => null) : null;
  signal({ sdp, ...(auth && { auth }) });
}

/**
 * Checks the other side's call setup came from one of their devices. In an end-to-end
 * encrypted chat an unverifiable call is ended (someone may be in the middle).
 */
async function setupTrusted(call, data) {
  const ok = await e2ee.verifyCallSetup(call.id, data.sdp, data.auth, call.peer.id).catch(() => false);
  if (ok) {
    useCall.getState().patch({ verified: true });
    return true;
  }
  const encryptedChat = !!useChat.getState().conversations[call.conversationId]?.e2ee;
  return !(encryptedChat && e2ee.enabled());
}

/**
 * The caller asks for a fresh connection path (after a network change or a failed attempt):
 * same encryption keys, new routes, through the relay if needed.
 */
async function restartConnection() {
  const { call } = useCall.getState();
  if (!pc || !call || call.direction !== 'outgoing' || restarts >= 3) return;
  restarts++;
  try {
    pc.restartIce?.();
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await sendSetup(pc.localDescription.toJSON());
  } catch (e) {
    console.warn('call: reconnect failed', e);
  }
}

async function createPeer(localStream) {
  const servers = await iceServers();
  const callId = useCall.getState().call?.id;
  if (!callId) throw new Error('Call ended');
  pc = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle' });
  pendingCandidates = [];
  restarts = 0;
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  pc.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => useCall.getState().patch({ remoteStream: e.streams[0] || new MediaStream([e.track]) });
  const store = () => useCall.getState();
  // Answered but never connected (both behind strict networks, no relay): say so.
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (store().call?.id === callId && store().call.state !== 'active') store().hangup('Couldn’t connect the call. Check your internet connection.');
  }, CONNECT_TIMEOUT_MS);
  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    const { call } = store();
    if (!call || call.id !== callId) return;
    if (state === 'connected') {
      clearTimeout(connectTimer);
      clearTimeout(recoverTimer);
      recoverTimer = null;
      if (call.state !== 'active') store().patch({ state: 'active', startedAt: Date.now(), reconnecting: false });
      else if (call.reconnecting) store().patch({ reconnecting: false });
    } else if ((state === 'disconnected' || state === 'failed') && call.state === 'active') {
      // Dropped mid-call (switched Wi-Fi ↔ mobile data, weak signal): try to get it back.
      if (!call.reconnecting) store().patch({ reconnecting: true });
      if (state === 'failed') restartConnection();
      else setTimeout(() => pc?.connectionState === 'disconnected' && restartConnection(), 4000);
      if (!recoverTimer) {
        recoverTimer = setTimeout(() => {
          recoverTimer = null;
          if (store().call?.id === callId && pc?.connectionState !== 'connected') store().hangup('Connection lost');
        }, RECOVER_MS);
      }
    } else if (state === 'failed') {
      // Never connected: one more try along other routes before giving up.
      if (call.direction === 'outgoing' && restarts < 1) restartConnection();
      else if (call.direction !== 'outgoing') return; // (the caller retries; the connect timer ends it)
      else store().hangup('Couldn’t connect the call. Check your internet connection.');
    }
  };
  return pc;
}

async function flushCandidates() {
  for (const c of pendingCandidates) await pc.addIceCandidate(c).catch(() => {});
  pendingCandidates = [];
}

function cleanup() {
  clearTimeout(ringTimeout);
  clearTimeout(connectTimer);
  clearTimeout(recoverTimer);
  recoverTimer = null;
  stopRingtone();
  stopRingback();
  const { call } = useCall.getState();
  clearCallNotification(call?.id);
  call?.localStream?.getTracks().forEach((t) => t.stop());
  pc?.close();
  pc = null;
  pendingCandidates = [];
}

export const useCall = create((set, get) => ({
  call: null,
  // A call answered from outside the app (notification / incoming-call screen):
  // { callId, locked }. While locked, only the call is shown; when it ends, the phone goes back
  // to where it was (the lock screen, or the app that was in use).
  external: null,
  // { id, conversationId, peer: {id,name,avatarUrl}, kind, direction, state, startedAt,
  //   localStream, remoteStream, muted, cameraOff, facingMode, reachable, endReason }

  patch: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : {})),

  async startCall(conversationId, peer, kind) {
    if (get().call) return toast('You are already in a call');
    const id = uid();
    set({
      call: { id, conversationId, peer, kind, direction: 'outgoing', state: 'ringing', muted: false, cameraOff: false, facingMode: 'user' },
    });
    loadIceServers(); // (ready by the time they answer)
    try {
      const localStream = await getMedia(kind);
      if (get().call?.id !== id) return localStream.getTracks().forEach((t) => t.stop());
      get().patch({ localStream });
      startRingback(); // you hear it ringing while you wait
      const { reachable } = await emitAck('call:invite', { callId: id, conversationId, toUserId: peer.id, kind });
      get().patch({ reachable });
      ringTimeout = setTimeout(() => {
        if (get().call?.state !== 'ringing') return;
        playEndTone();
        get().hangup('No answer');
      }, RING_TIMEOUT_MS);
    } catch (e) {
      get().finish(e.name === 'NotAllowedError' ? 'Microphone/camera permission denied' : e.message);
    }
  },

  async acceptCall() {
    const { call } = get();
    if (!call || call.direction !== 'incoming') return;
    stopRingtone();
    clearCallNotification(call.id);
    try {
      const localStream = await getMedia(call.kind);
      get().patch({ localStream, state: 'connecting' });
      await createPeer(localStream);
      await emitAck('call:accept', { callId: call.id });
    } catch (e) {
      emitAck('call:reject', { callId: call.id }).catch(() => {});
      get().finish(e.name === 'NotAllowedError' ? 'Microphone/camera permission denied' : e.message);
    }
  },

  rejectCall() {
    const { call } = get();
    if (!call) return;
    emitAck('call:reject', { callId: call.id }).catch(() => {});
    get().finish('Declined');
  },

  hangup(reason = 'Call ended') {
    const { call } = get();
    if (!call) return;
    if (call.direction === 'incoming' && call.state === 'ringing') return get().rejectCall();
    emitAck('call:end', { callId: call.id }).catch(() => {});
    get().finish(reason);
  },

  /** Tears down media and shows the end reason briefly before closing the overlay. */
  finish(reason) {
    const id = get().call?.id;
    cleanup();
    get().patch({ state: 'ended', endReason: reason, localStream: null, remoteStream: null });
    setTimeout(() => {
      if (get().call?.id !== id) return;
      set({ call: null });
      get().endExternal(id);
    }, 1800);
  },

  /** The call answered from outside the app is over: leave the app as it was before. */
  endExternal(callId) {
    const { external } = get();
    if (!external || (callId && external.callId !== callId)) return;
    clearTimeout(externalTimer);
    set({ external: null });
    leaveNativeCall();
  },

  toggleMute() {
    const { call } = get();
    if (!call?.localStream) return;
    const muted = !call.muted;
    call.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    get().patch({ muted });
  },

  toggleCamera() {
    const { call } = get();
    if (!call?.localStream) return;
    const cameraOff = !call.cameraOff;
    call.localStream.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
    get().patch({ cameraOff });
  },

  async switchCamera() {
    const { call } = get();
    if (!call?.localStream || call.kind !== 'video') return;
    const facingMode = call.facingMode === 'user' ? 'environment' : 'user';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      const [newTrack] = stream.getVideoTracks();
      const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);
      call.localStream.getVideoTracks().forEach((t) => {
        call.localStream.removeTrack(t);
        t.stop();
      });
      call.localStream.addTrack(newTrack);
      get().patch({ facingMode, localStream: new MediaStream(call.localStream.getTracks()) });
    } catch {
      toast('Could not switch camera');
    }
  },

  // ------------------------------------------------------------ socket events

  onIncoming({ callId, conversationId, kind, from }) {
    const { call } = get();
    if (call?.id === callId) return; // the same call, re-sent when the app reconnected
    if (call) {
      emitAck('call:reject', { callId, reason: 'busy' }).catch(() => {});
      return;
    }
    set({
      // The caller as I know them (saved name, else @username or number).
      call: { id: callId, conversationId, peer: { ...from, name: displayName(from) }, kind, direction: 'incoming', state: 'ringing', muted: false, cameraOff: false, facingMode: 'user' },
    });
    ringTimeout = setTimeout(() => get().call?.state === 'ringing' && get().finish('Missed call'), RING_TIMEOUT_MS);
    loadIceServers(); // (ready if they answer)
    if (pendingAnswer?.callId === callId && pendingAnswer.until > Date.now()) {
      pendingAnswer = null;
      get().acceptCall(); // "Answer" was tapped on the notification
      return;
    }
    // In the background the phone's own ringing notification rings instead.
    if (!(isNativeApp() && document.visibilityState !== 'visible')) startRingtone();
  },

  /** "Answer" tapped on the ringing notification: accept now, or once the call reaches the app. */
  /** A call answered from outside the app (notification / lock screen): see `external`. */
  setExternal(callId, { locked = false, connected = () => get().call?.id === callId } = {}) {
    set({ external: { callId, locked } });
    clearTimeout(externalTimer);
    // The call ended before it reached the app: go back without showing anything.
    externalTimer = setTimeout(() => !connected() && get().endExternal(callId), 30_000);
  },

  answerWhenReady(callId, { locked = false, returnAfter = false } = {}) {
    if (returnAfter) get().setExternal(callId, { locked });
    const { call } = get();
    if (call?.id === callId && call.direction === 'incoming' && call.state === 'ringing') return get().acceptCall();
    pendingAnswer = { callId, until: Date.now() + RING_TIMEOUT_MS };
  },

  /** Back on screen while a call is ringing: ring in the app (the notification was removed). */
  onAppVisible() {
    const { call } = get();
    if (call?.direction === 'incoming' && call.state === 'ringing') startRingtone();
  },

  async onAccepted({ callId }) {
    const { call } = get();
    if (call?.id !== callId || !call.localStream) return;
    clearTimeout(ringTimeout);
    stopRingback(); // answered
    get().patch({ state: 'connecting' });
    try {
      await createPeer(call.localStream);
    } catch {
      return;
    }
    if (get().call?.id !== callId) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSetup(pc.localDescription.toJSON());
  },

  onRejected({ callId, reason }) {
    const { call } = get();
    if (call?.id !== callId || call.state === 'ended') return;
    playEndTone(); // declined / busy / no answer
    get().finish({ busy: 'User is busy', 'no-answer': 'No answer' }[reason] || 'Call declined');
  },

  onEnded({ callId, reason }) {
    const { call } = get();
    if (call?.id !== callId) return;
    get().finish(reason === 'missed' || call.state === 'ringing' ? 'Missed call' : 'Call ended');
  },

  onHandledElsewhere({ callId }) {
    if (get().call?.id === callId) {
      cleanup();
      set({ call: null });
      get().endExternal(callId);
    }
  },

  async onSignal({ callId, data }) {
    if (get().call?.id !== callId || !pc) return;
    try {
      if (data.sdp) {
        if (!(await setupTrusted(get().call, data))) {
          get().hangup('Couldn’t verify this call');
          return;
        }
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSetup(pc.localDescription.toJSON());
        }
        await flushCandidates();
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingCandidates.push(data.candidate);
      }
    } catch (e) {
      console.error('call signaling failed', e);
    }
  },
}));
