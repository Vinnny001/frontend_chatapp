import { useEffect, useMemo, useState } from 'react';
import { FileText, Send, X } from 'lucide-react';
import { fileKind, formatBytes } from '../../lib/format.js';

export default function AttachmentPreview({ files, onCancel, onSend }) {
  const [caption, setCaption] = useState('');
  const [index, setIndex] = useState(0);
  const urls = useMemo(() => files.map((f) => (/^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const file = files[index];
  const kind = fileKind(file);

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
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend(files, caption.trim())}
          placeholder="Add a caption…"
          maxLength={2000}
        />
        {files.length > 1 && (
          <div className="attach-thumbs">
            {files.map((f, i) => (
              <button key={i} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>
                {urls[i] && f.type.startsWith('image/') ? <img src={urls[i]} alt="" /> : <FileText size={20} />}
              </button>
            ))}
          </div>
        )}
        <button className="send-btn big" onClick={() => onSend(files, caption.trim())} aria-label="Send">
          <Send size={22} />
          {files.length > 1 && <span className="badge">{files.length}</span>}
        </button>
      </div>
    </div>
  );
}
