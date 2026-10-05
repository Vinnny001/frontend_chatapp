import { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { mediaUrl } from '../../lib/config.js';
import { useMediaSrc } from '../../lib/media.js';
import { useUI } from '../../store/ui.js';

export default function MediaViewer() {
  const viewer = useUI((s) => s.viewer);
  const close = useUI((s) => s.closeViewer);
  const { src, missing } = useMediaSrc(viewer?.url); // stored copy works offline

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, close]);

  if (!viewer) return null;
  const downloadHref = navigator.onLine !== false ? mediaUrl(viewer.url) : src;
  return (
    <div className="viewer" onClick={close}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-title">{viewer.name}</span>
        {/* Someone else's profile photo: view only; only its owner can download it. */}
        {!viewer.noDownload && (
          <a className="icon-btn" href={downloadHref || undefined} download={viewer.name} target="_blank" rel="noreferrer" aria-label="Download">
            <Download size={20} />
          </a>
        )}
        <button className="icon-btn" onClick={close} aria-label="Close">
          <X size={22} />
        </button>
      </div>
      <div className="viewer-content" onClick={(e) => e.stopPropagation()}>
        {missing ? (
          <p className="viewer-missing">Not downloaded yet. Connect to the internet to view it.</p>
        ) : !src ? null : viewer.type === 'video' ? (
          <video src={src} controls autoPlay playsInline />
        ) : (
          <img
            src={src}
            alt={viewer.name || ''}
            className={viewer.noDownload ? 'no-save' : undefined}
            draggable={!viewer.noDownload}
            onContextMenu={viewer.noDownload ? (e) => e.preventDefault() : undefined}
          />
        )}
      </div>
    </div>
  );
}
