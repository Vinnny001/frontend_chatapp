import { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { mediaUrl } from '../../lib/config.js';
import { useUI } from '../../store/ui.js';

export default function MediaViewer() {
  const viewer = useUI((s) => s.viewer);
  const close = useUI((s) => s.closeViewer);

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, close]);

  if (!viewer) return null;
  const src = mediaUrl(viewer.url);
  return (
    <div className="viewer" onClick={close}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-title">{viewer.name}</span>
        <a className="icon-btn" href={src} download={viewer.name} target="_blank" rel="noreferrer" aria-label="Download">
          <Download size={20} />
        </a>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <X size={22} />
        </button>
      </div>
      <div className="viewer-content" onClick={(e) => e.stopPropagation()}>
        {viewer.type === 'video' ? <video src={src} controls autoPlay playsInline /> : <img src={src} alt={viewer.name || ''} />}
      </div>
    </div>
  );
}
