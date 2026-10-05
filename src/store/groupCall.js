import { create } from 'zustand';
import { api } from '../lib/api.js';
import { startRingback, startRingtone, stopRingback, stopRingtone } from '../lib/notify.js';
import { clearCallNotification, isNativeApp } from '../lib/native.js';
import { useAuth } from './auth.js';
import { useCall } from './call.js';
import { toast } from './ui.js';

// Group voice/video calls (3+ people) through LiveKit: the API hands out a pass for the
// group's call room; media goes through LiveKit's servers. One-to-one calls stay in call.js.

const WAIT_MS = 45_000; // starting a call: give up if nobody joins in this time
let room = null;
// LiveKit's library is big: loaded the first time a group call starts, not with the app.
let LK = null;
const loadLiveKit = async () => (LK ??= await import('livekit-client'));
let waitTimer = null;
let ringTimer = null;
const audioEls = new Map(); // remote audio track sid -> <audio>

/** Everyone in the room, for the call screen. */
function snapshot() {
  if (!room) return [];
  const people = [room.localParticipant, ...room.remoteParticipants.values()];
  return people.map((p) => {
    const cam = p.getTrackPublication(LK.Track.Source.Camera);
    const mic = p.getTrackPublication(LK.Track.Source.Microphone);
    let avatarUrl = null;
    try {
      avatarUrl = JSON.parse(p.metadata || '{}').avatarUrl || null;
    } catch {
      /* no metadata */
    }
    return {
      id: p.identity,
      label: p.name,
      avatarUrl,
      isLocal: p === room.localParticipant,
      speaking: p.isSpeaking,
      muted: !mic || mic.isMuted,
      videoTrack: cam?.track && !cam.isMuted ? cam.track : null,
    };
  });
}

function playRemoteAudio(track, publication) {
  if (track.kind !== LK.Track.Kind.Audio) return;
  const el = track.attach();
  el.dataset.groupCall = '1';
  document.body.appendChild(el);
  audioEls.set(publication.trackSid, el);
}

function stopRemoteAudio(track, publication) {
  const el = audioEls.get(publication.trackSid);
  if (el) {
    track.detach(el);
    el.remove();
    audioEls.delete(publication.trackSid);
  }
}

if (import.meta.env.DEV) window.__groupRoom = () => room; // debugging in development builds only

export const useGroupCall = create((set, get) => ({
  // { conversationId, callId, kind, state: 'connecting' | 'connected', startedAt, muted, cameraOn, facing }
  active: null,
  participants: [],
  // A group call ringing on this phone: { conversationId, callId, kind, startedBy }
  incoming: null,
  dismissed: {}, // call ids I declined or that stopped ringing

  /** Start the group's call, or join the one in progress. */
  async join(conversationId, kind = 'audio') {
    if (get().active) return toast('You’re already in a group call');
    if (useCall.getState().call) return toast('You’re already in a call');
    clearTimeout(ringTimer);
    stopRingtone();
    set({ incoming: null, active: { conversationId, kind, state: 'connecting', muted: false, cameraOn: kind === 'video', facing: 'user' } });
    try {
      const { url, token, groupCall, started } = await api(`/api/conversations/${conversationId}/group-call`, {
        method: 'POST',
        body: { kind },
      });
      clearCallNotification(groupCall.id);
      const { Room, RoomEvent, VideoPresets } = await loadLiveKit();
      const refresh = () => set({ participants: snapshot() });
      room = new Room({
        adaptiveStream: true, // each tile only receives the quality it's shown at
        dynacast: true, // nobody sends video nobody is watching
        // Group video at 640×360, like other messengers: light on data, battery and weak networks.
        videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
        publishDefaults: { videoSimulcastLayers: [VideoPresets.h180], videoCodec: 'vp8' },
      });
      room
        .on(RoomEvent.ParticipantConnected, () => {
          clearTimeout(waitTimer);
          stopRingback(); // someone joined
          refresh();
        })
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, (track, pub) => {
          playRemoteAudio(track, pub);
          refresh();
        })
        .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          stopRemoteAudio(track, pub);
          refresh();
        })
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.Disconnected, () => get().cleanup());
      // (Development only: window.__lkRelay forces LiveKit's relay, for testing restrictive networks.)
      const rtcConfig = import.meta.env.DEV && window.__lkRelay ? { iceTransportPolicy: 'relay' } : undefined;
      await room.connect(url, token, rtcConfig ? { rtcConfig } : undefined);
      await room.startAudio().catch(() => {});
      await room.localParticipant.setMicrophoneEnabled(true);
      const video = groupCall.kind === 'video' || kind === 'video';
      if (video) await room.localParticipant.setCameraEnabled(true);
      set((s) => ({
        active: s.active && {
          ...s.active,
          callId: groupCall.id,
          kind: groupCall.kind,
          state: 'connected',
          startedAt: Date.parse(groupCall.startedAt),
          cameraOn: video,
        },
      }));
      refresh();
      if (started && room.remoteParticipants.size === 0) {
        startRingback(); // you hear it ringing until someone joins
        waitTimer = setTimeout(() => {
          if (room && room.remoteParticipants.size === 0) {
            toast('No one joined the call');
            get().leave();
          }
        }, WAIT_MS);
      }
    } catch (e) {
      get().cleanup();
      useCall.getState().endExternal(); // answered from the lock screen but couldn't join: go back
      toast(e.name === 'NotAllowedError' ? 'Microphone/camera permission denied' : e.message || 'Could not join the call', 'error');
    }
  },

  async leave() {
    const { active } = get();
    if (!active) return;
    const r = room;
    room = null;
    await r?.disconnect().catch(() => {});
    api(`/api/conversations/${active.conversationId}/group-call/leave`, { method: 'POST' }).catch(() => {});
    get().cleanup();
  },

  cleanup() {
    clearTimeout(waitTimer);
    stopRingback();
    for (const el of audioEls.values()) el.remove();
    audioEls.clear();
    const r = room;
    room = null;
    r?.disconnect().catch(() => {});
    const { active } = get();
    set({ active: null, participants: [] });
    if (active?.callId) useCall.getState().endExternal(active.callId); // answered from the lock screen: go back
  },

  async toggleMute() {
    const { active } = get();
    if (!room || !active) return;
    const muted = !active.muted;
    await room.localParticipant.setMicrophoneEnabled(!muted);
    set({ active: { ...active, muted }, participants: snapshot() });
  },

  async toggleCamera() {
    const { active } = get();
    if (!room || !active) return;
    const cameraOn = !active.cameraOn;
    try {
      await room.localParticipant.setCameraEnabled(cameraOn, { facingMode: active.facing });
      set({ active: { ...get().active, cameraOn }, participants: snapshot() });
    } catch {
      toast('Could not turn the camera on');
    }
  },

  async switchCamera() {
    const { active } = get();
    const track = room?.localParticipant.getTrackPublication(LK.Track.Source.Camera)?.track;
    if (!track || !active) return;
    const facing = active.facing === 'user' ? 'environment' : 'user';
    try {
      await track.restartTrack({ facingMode: facing });
      set({ active: { ...get().active, facing }, participants: snapshot() });
    } catch {
      toast('Could not switch camera');
    }
  },

  // ---------------------------------------------------------------- ringing

  /** The group's call started / changed / ended (from the realtime connection). */
  onUpdate({ conversationId, groupCall }) {
    const { incoming, active, dismissed } = get();
    if (!groupCall) {
      if (incoming?.conversationId === conversationId) get().stopIncoming();
      if (active?.conversationId === conversationId && active.state === 'connected') get().cleanup();
      return;
    }
    const me = useAuth.getState().user?.id;
    if (active || useCall.getState().call || dismissed[groupCall.id]) return;
    if (groupCall.joined.includes(me) || incoming?.callId === groupCall.id) return;
    if (Date.now() - Date.parse(groupCall.startedAt) > WAIT_MS) return; // an ongoing call: "Join" in the chat instead
    set({ incoming: { conversationId, callId: groupCall.id, kind: groupCall.kind, startedBy: groupCall.startedBy } });
    // In the background the phone's own ringing notification rings instead.
    if (!(isNativeApp() && document.visibilityState !== 'visible')) startRingtone();
    ringTimer = setTimeout(() => get().stopIncoming(), WAIT_MS);
  },

  answerIncoming() {
    const { incoming } = get();
    if (incoming) get().join(incoming.conversationId, incoming.kind);
  },

  /** Decline: stop ringing here; the call goes on for the others. */
  stopIncoming() {
    const { incoming } = get();
    clearTimeout(ringTimer);
    stopRingtone();
    if (!incoming) return;
    clearCallNotification(incoming.callId);
    set((s) => ({ incoming: null, dismissed: { ...s.dismissed, [incoming.callId]: true } }));
  },
}));
