import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Users, Video, VideoOff } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import { formatDuration } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';
import { useGroupCall } from '../../store/groupCall.js';

function VideoTile({ track, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return undefined;
    track.attach(el);
    return () => track.detach(el);
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : ''} />;
}

function useTimer(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? formatDuration((now - startedAt) / 1000) : null;
}

/** Group calls: the incoming ring ("Ann is calling the group") and the call itself (a grid). */
export default function GroupCallOverlay() {
  const active = useGroupCall((s) => s.active);
  const incoming = useGroupCall((s) => s.incoming);
  const participants = useGroupCall((s) => s.participants);
  const me = useAuth((s) => s.user);
  const convId = active?.conversationId || incoming?.conversationId;
  const conv = useChat((s) => (convId ? s.conversations[convId] : null));
  const gc = useGroupCall.getState();
  const timer = useTimer(active?.state === 'connected' && participants.length > 1 ? active.startedAt : null);
  if (!active && !incoming) return null;

  // People as I know them (saved name, @username or number), from the group's member list.
  const nameOf = (p) => {
    if (p.isLocal || p.id === me?.id) return 'You';
    return conv?.participants.find((x) => x.id === p.id)?.name || p.label || 'Someone';
  };
  const groupName = conv?.name || 'Group';

  if (!active) {
    const starter = conv?.participants.find((x) => x.id === incoming.startedBy)?.name || 'Someone';
    return (
      <div className="call-overlay group-call ringing">
        <div className="call-info">
          <Avatar name={groupName} url={conv?.avatarUrl} group size={120} />
          <h2>{groupName}</h2>
          <p className="call-status">
            {starter} is calling the group · {incoming.kind === 'video' ? 'video' : 'voice'}
          </p>
        </div>
        <div className="call-controls">
          <button className="call-btn decline" onClick={gc.stopIncoming} aria-label="Decline">
            <PhoneOff size={26} />
          </button>
          <button className="call-btn accept" onClick={gc.answerIncoming} aria-label="Join">
            {incoming.kind === 'video' ? <Video size={26} /> : <Phone size={26} />}
          </button>
        </div>
      </div>
    );
  }

  const alone = active.state === 'connected' && participants.length <= 1;
  const status = active.state === 'connecting' ? 'Connecting…' : alone ? 'Ringing the group…' : timer;
  return (
    <div className={`call-overlay group-call ${active.kind}`}>
      <header className="group-call-header">
        <Users size={18} />
        <strong>{groupName}</strong>
        <span>{status}</span>
      </header>
      <div className={`group-grid n${Math.min(participants.length, 9)}`}>
        {participants.map((p) => (
          <div key={p.id} className={`group-tile ${p.speaking ? 'speaking' : ''}`}>
            {p.videoTrack ? (
              <VideoTile track={p.videoTrack} mirror={p.isLocal && active.facing === 'user'} />
            ) : (
              <Avatar name={nameOf(p)} url={p.isLocal ? me?.avatarUrl : p.avatarUrl} size={72} />
            )}
            <span className="group-tile-name">
              {p.muted && <MicOff size={13} />} {nameOf(p)}
            </span>
          </div>
        ))}
      </div>
      <div className="call-controls">
        <button className={`call-btn ${active.muted ? 'on' : ''}`} onClick={gc.toggleMute} aria-label={active.muted ? 'Unmute' : 'Mute'}>
          {active.muted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        <button className={`call-btn ${active.cameraOn ? '' : 'on'}`} onClick={gc.toggleCamera} aria-label={active.cameraOn ? 'Camera off' : 'Camera on'}>
          {active.cameraOn ? <Video size={24} /> : <VideoOff size={24} />}
        </button>
        {active.cameraOn && (
          <button className="call-btn" onClick={gc.switchCamera} aria-label="Switch camera">
            <SwitchCamera size={24} />
          </button>
        )}
        <button className="call-btn decline" onClick={gc.leave} aria-label="Leave call">
          <PhoneOff size={26} />
        </button>
      </div>
    </div>
  );
}
