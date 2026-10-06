import { useEffect, useState } from 'react';
import { FileText, Send, X } from 'lucide-react';
import { fileKind, formatBytes } from '../../lib/format.js';
import { OnceIcon } from './ViewOnce.jsx';

export default function AttachmentPreview({ files, onCancel, onSend }) {
  const [caption, setCaption] = useState('');
  const [index, setIndex] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  // Made and revoked in the same effect, so a re-run (React dev mode) never leaves dead previews.
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const made = files.map((f) => (/^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const file = files[index];
  const kind = fileKind(file);
  // View once: a single photo or video, without a caption (as on WhatsApp).
  const canViewOnce = files.length === 1 && (kind === 'image' || kind === 'video');
  const send = () => onSend(files, viewOnce ? '' : caption.trim(), { viewOnce: canViewOnce && viewOnce });

  return (
    <div className="attach-preview">
      <header>
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel">
          <X size={22} />
        </button>
        <span>{file.name}</span>
      </header>
      <div className="attach-stage">
        {kind === 'image' && <img src={urls[index]} alt="" />}
        {kind === 'video' && <video src={urls[index]} controls playsInline />}
        {(kind === 'file' || kind === 'audio') && (
          <div className="attach-file">
            <FileText size={64} strokeWidth={1.2} />
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
        )}
      </div>
      <div className="attach-bottom">
        <input
          autoFocus
          value={viewOnce ? '' : caption}
          disabled={viewOnce}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={viewOnce ? 'View once: can be opened one time' : 'Add a caption…'}
          maxLength={2000}
        />
        {canViewOnce && (
          <button
            type="button"
            className={`once-toggle ${viewOnce ? 'on' : ''}`}
            aria-pressed={viewOnce}
            aria-label="View once"
            title="View once"
            onClick={() => setViewOnce((v) => !v)}
          >
            <OnceIcon size={24} />
          </button>
        )}
        {files.length > 1 && (
          <div className="attach-thumbs">
            {files.map((f, i) => (
              <button key={i} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>
                {urls[i] && f.type.startsWith('image/') ? <img src={urls[i]} alt="" /> : <FileText size={20} />}
              </button>
            ))}
          </div>
        )}
        <button className="send-btn big" onClick={send} aria-label="Send">
          <Send size={22} />
          {files.length > 1 && <span className="badge">{files.length}</span>}
        </button>
      </div>
    </div>
  );
}
