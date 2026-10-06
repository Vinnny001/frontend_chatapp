import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useChat } from '../../store/chat.js';
import { useUI } from '../../store/ui.js';

/** The ① badge used for view-once media. */
export function OnceIcon({ size = 18 }) {
  return (
    <span className="once-icon" style={{ width: size, height: size, fontSize: size * 0.6 }} aria-hidden="true">
      1
    </span>
  );
}

/**
 * A view-once photo/video in the chat. Recipients tap to open it (once); afterwards, and
 * always for the sender, it just says "Opened" / what it was.
 */
export function ViewOnceBody({ msg, conv, me }) {
  const mine = msg.sender === me;
  const opened = msg.openedBy || [];
  const what = msg.type === 'video' ? 'Video' : 'Photo';
  const openedByMe = opened.includes(me);
  const othersOpened = conv.participants.some((p) => p.id !== me && opened.includes(p.id));
  const canOpen = !mine && !openedByMe && !msg.pending;
  const label = mine ? (othersOpened ? 'Opened' : what) : openedByMe ? 'Opened' : what;
  return (
    <button
      type="button"
      className={`view-once ${canOpen ? 'ready' : 'done'}`}
      disabled={!canOpen}
      onClick={(e) => {
        e.stopPropagation();
        useChat.getState().openViewOnce(msg);
      }}
      aria-label={canOpen ? `View once ${what.toLowerCase()}. Tap to open` : `View once ${what.toLowerCase()}: ${label}`}
    >
      <OnceIcon size={22} />
      <span className="view-once-label">{label}</span>
    </button>
  );
}

/** Full screen, straight from the server (never saved on the phone); gone once closed. */
export function ViewOnceViewer() {
  const item = useUI((s) => s.viewOnce);
  const close = () => useUI.getState().setViewOnce(null);
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item]);
  if (!item) return null;
  return createPortal(
    <div className="view-once-viewer" role="dialog" aria-label="View once" onContextMenu={(e) => e.preventDefault()}>
      <header>
        <OnceIcon size={22} />
        <span>View once {item.type === 'video' ? 'video' : 'photo'}</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <X size={24} />
        </button>
      </header>
      <div className="view-once-stage">
        {item.type === 'video' ? (
          <video src={item.url} autoPlay controls playsInline controlsList="nodownload noremoteplayback" disablePictureInPicture />
        ) : (
          <img src={item.url} alt="" draggable={false} />
        )}
      </div>
    </div>,
    document.body
  );
}
