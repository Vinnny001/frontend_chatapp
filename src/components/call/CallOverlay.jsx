import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import { formatDuration } from '../../lib/format.js';
import { useCall } from '../../store/call.js';

function StreamVideo({ stream, muted, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
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

export default function CallOverlay() {
  const call = useCall((s) => s.call);
  const { acceptCall, rejectCall, hangup, toggleMute, toggleCamera, switchCamera } = useCall.getState();
  const timer = useTimer(call?.state === 'active' ? call.startedAt : null);
  if (!call) return null;

  const video = call.kind === 'video';
  const incoming = call.direction === 'incoming' && call.state === 'ringing';
  const status =
    call.state === 'ended'
      ? call.endReason
      : call.state === 'active'
        ? timer
        : call.state === 'connecting'
          ? 'Connecting…'
          : incoming
            ? `Incoming ${video ? 'video' : 'voice'} call`
            : call.reachable === false
              ? 'Calling…'
              : 'Ringing…';

  const showRemoteVideo = video && call.remoteStream && call.state === 'active';

  return (
    <div className={`call-overlay ${video ? 'video' : 'audio'}`}>
      {showRemoteVideo ? (
        <StreamVideo stream={call.remoteStream} className="remote-video" />
      ) : (
        // Audio-only calls still need an element to play the remote stream.
        call.remoteStream && <StreamVideo stream={call.remoteStream} className="hidden-media" />
      )}
      {video && call.localStream && !call.cameraOff && <StreamVideo stream={call.localStream} muted className={`local-video ${showRemoteVideo ? 'pip' : 'full'}`} />}

      <div className="call-info">
        {!showRemoteVideo && <Avatar name={call.peer?.name} url={call.peer?.avatarUrl} size={120} />}
        <h2>{call.peer?.name}</h2>
        <p className={call.state === 'ringing' ? 'pulse' : ''}>{status}</p>
      </div>

      <div className="call-controls">
        {incoming ? (
          <>
            <button className="call-btn decline" onClick={rejectCall} aria-label="Decline">
              <PhoneOff size={28} />
            </button>
            <button className="call-btn accept" onClick={acceptCall} aria-label="Accept">
              {video ? <Video size={28} /> : <Phone size={28} />}
            </button>
          </>
        ) : call.state !== 'ended' ? (
          <>
            <button className={`call-btn ${call.muted ? 'on' : ''}`} onClick={toggleMute} aria-label={call.muted ? 'Unmute' : 'Mute'}>
              {call.muted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            {video && (
              <>
                <button className={`call-btn ${call.cameraOff ? 'on' : ''}`} onClick={toggleCamera} aria-label="Toggle camera">
                  {call.cameraOff ? <VideoOff size={24} /> : <Video size={24} />}
                </button>
                <button className="call-btn" onClick={switchCamera} aria-label="Switch camera">
                  <SwitchCamera size={24} />
                </button>
              </>
            )}
            <button className="call-btn decline" onClick={() => hangup()} aria-label="End call">
              <PhoneOff size={26} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
