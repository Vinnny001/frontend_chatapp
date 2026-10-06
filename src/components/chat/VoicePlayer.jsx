import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { formatDuration } from '../../lib/format.js';

const SPEEDS = [1, 1.5, 2];
const SPEED_KEY = 'voiceSpeed';

// One speed for every voice note, remembered like WhatsApp's.
function savedSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

/** When a voice note ends, the next one further down the chat starts (as on WhatsApp). */
function playNext(current) {
  const all = [...document.querySelectorAll('.voice')];
  const next = all[all.indexOf(current.closest('.voice')) + 1];
  next?.querySelector('.voice-play:not(:disabled)')?.click();
}

export default function VoicePlayer({ src, duration: knownDuration, progress: uploadProgress }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration || 0);
  const [speed, setSpeed] = useState(savedSpeed);

  useEffect(() => {
    const a = audio.current;
    if (!a) return undefined;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => Number.isFinite(a.duration) && setDuration(a.duration);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
      playNext(a);
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
    a.playbackRate = savedSpeed(); // may have been changed on another voice note
    setSpeed(a.playbackRate);
    a.play().catch(() => {});
  }

  function cycleSpeed(e) {
    e.stopPropagation();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      /* not saved: still applies to this one */
    }
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
