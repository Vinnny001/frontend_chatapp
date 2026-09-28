import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { formatDuration } from '../../lib/format.js';

const SPEEDS = [1, 1.5, 2];

export default function VoicePlayer({ src, duration: knownDuration, progress: uploadProgress }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration || 0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const a = audio.current;
    if (!a) return undefined;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => Number.isFinite(a.duration) && setDuration(a.duration);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('play', () => setPlaying(true));
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle(e) {
    e.stopPropagation();
    const a = audio.current;
    if (playing) return a.pause();
    // Only one voice note plays at a time.
    document.querySelectorAll('audio').forEach((other) => other !== a && other.pause());
    a.playbackRate = speed;
    a.play().catch(() => {});
  }

  function cycleSpeed(e) {
    e.stopPropagation();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  const total = duration || knownDuration || 0;
  return (
    <div className="voice" onClick={(e) => e.stopPropagation()}>
      <audio ref={audio} src={src} preload="metadata" />
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={uploadProgress != null}>
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <div className="voice-track">
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={Math.min(time, total || 1)}
          onChange={(e) => {
            audio.current.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
          style={{ '--pct': `${total ? (time / total) * 100 : 0}%` }}
          aria-label="Seek"
        />
        <span className="voice-time">
          {uploadProgress != null ? `Uploading ${Math.round(uploadProgress * 100)}%` : formatDuration(playing || time ? time : total)}
        </span>
      </div>
      {playing || time ? (
        <button className="voice-speed" onClick={cycleSpeed}>
          {speed}×
        </button>
      ) : (
        <Mic size={18} className="voice-mic" />
      )}
    </div>
  );
}
