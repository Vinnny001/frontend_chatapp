import { create } from 'zustand';
import { ICE_SERVERS } from '../lib/config.js';
import { emitAck } from '../lib/socket.js';
import { uid } from '../lib/format.js';
import { startRingtone, stopRingtone } from '../lib/notify.js';
import { clearCallNotification, isNativeApp } from '../lib/native.js';
import { toast } from './ui.js';

// One active 1:1 call at a time. Media is peer-to-peer (WebRTC); the realtime service only
// relays signaling messages.

const RING_TIMEOUT_MS = 45_000;

let pc = null;
let pendingCandidates = [];
let ringTimeout = null;
let pendingAnswer = null; // { callId, until }: answered from the notification before the call arrived

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

function createPeer(localStream) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pendingCandidates = [];
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  pc.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => useCall.getState().patch({ remoteStream: e.streams[0] });
  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === 'connected') {
      const { call } = useCall.getState();
      if (call && call.state !== 'active') useCall.getState().patch({ state: 'active', startedAt: Date.now() });
    } else if (state === 'failed') {
      useCall.getState().hangup('Connection lost');
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
  stopRingtone();
  const { call } = useCall.getState();
  clearCallNotification(call?.id);
  call?.localStream?.getTracks().forEach((t) => t.stop());
  pc?.close();
  pc = null;
  pendingCandidates = [];
}

export const useCall = create((set, get) => ({
  call: null,
  // { id, conversationId, peer: {id,name,avatarUrl}, kind, direction, state, startedAt,
  //   localStream, remoteStream, muted, cameraOff, facingMode, reachable, endReason }

  patch: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : {})),

  async startCall(conversationId, peer, kind) {
    if (get().call) return toast('You are already in a call');
    const id = uid();
    set({
      call: { id, conversationId, peer, kind, direction: 'outgoing', state: 'ringing', muted: false, cameraOff: false, facingMode: 'user' },
    });
    try {
      const localStream = await getMedia(kind);
      if (get().call?.id !== id) return localStream.getTracks().forEach((t) => t.stop());
      get().patch({ localStream });
      const { reachable } = await emitAck('call:invite', { callId: id, conversationId, toUserId: peer.id, kind });
      get().patch({ reachable });
      ringTimeout = setTimeout(() => get().call?.state === 'ringing' && get().hangup('No answer'), RING_TIMEOUT_MS);
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
      createPeer(localStream);
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
    setTimeout(() => get().call?.id === id && set({ call: null }), 1800);
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
      call: { id: callId, conversationId, peer: from, kind, direction: 'incoming', state: 'ringing', muted: false, cameraOff: false, facingMode: 'user' },
    });
    ringTimeout = setTimeout(() => get().call?.state === 'ringing' && get().finish('Missed call'), RING_TIMEOUT_MS);
    if (pendingAnswer?.callId === callId && pendingAnswer.until > Date.now()) {
      pendingAnswer = null;
      get().acceptCall(); // "Answer" was tapped on the notification
      return;
    }
    // In the background the phone's own ringing notification rings instead.
    if (!(isNativeApp() && document.visibilityState !== 'visible')) startRingtone();
  },

  /** "Answer" tapped on the ringing notification: accept now, or once the call reaches the app. */
  answerWhenReady(callId) {
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
    get().patch({ state: 'connecting' });
    createPeer(call.localStream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ sdp: pc.localDescription.toJSON() });
  },

  onRejected({ callId, reason }) {
    if (get().call?.id !== callId) return;
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
    }
  },

  async onSignal({ callId, data }) {
    if (get().call?.id !== callId || !pc) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal({ sdp: pc.localDescription.toJSON() });
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
