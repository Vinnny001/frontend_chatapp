import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Lock, Palette, Send, X } from 'lucide-react';
import { STATUS_COLORS, useStatus } from '../../store/status.js';
import { toast } from '../../store/ui.js';

/** A new status update: text on a colour, or a photo / video with a caption. */
export default function StatusComposer() {
  const kind = useStatus((s) => s.composing);
  const { compose, post } = useStatus.getState();
  const [text, setText] = useState('');
  const [color, setColor] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);

  useEffect(() => {
    setText('');
    setFile(null);
    setPreview(null);
    if (kind === 'media') setTimeout(() => picker.current?.click(), 50);
  }, [kind]);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  if (!kind) return null;
  const close = () => compose(null);

  function choose(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) {
      if (!file) close();
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function send() {
    setBusy(true);
    try {
      await post(kind === 'text' ? { text, bg: STATUS_COLORS[color] } : { file, text });
      toast('Status posted');
      close();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canSend = kind === 'text' ? !!text.trim() : !!file;

  return (
    <div className="status-composer" role="dialog" aria-label="New status update" style={kind === 'text' ? { background: STATUS_COLORS[color] } : undefined}>
      <header className="status-composer-top">
        <button className="icon-btn on-dark" onClick={close} aria-label="Close">
          <X size={24} />
        </button>
        {kind === 'text' && (
          <button className="icon-btn on-dark" onClick={() => setColor((c) => (c + 1) % STATUS_COLORS.length)} aria-label="Change colour" title="Change colour">
            <Palette size={22} />
          </button>
        )}
      </header>

      {kind === 'text' ? (
        <textarea
          className="status-text-input"
          autoFocus
          maxLength={700}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a status"
          aria-label="Status text"
        />
      ) : (
        <div className="status-media-pick">
          {preview ? (
            file.type.startsWith('video/') ? (
              <video src={preview} controls playsInline className="status-preview" />
            ) : (
              <img src={preview} alt="" className="status-preview" />
            )
          ) : (
            <button className="btn btn-ghost on-dark" onClick={() => picker.current?.click()}>
              <ImagePlus size={20} /> Choose a photo or video
            </button>
          )}
          <input ref={picker} type="file" accept="image/*,video/*" hidden onChange={choose} />
        </div>
      )}

      <footer className="status-composer-bottom">
        {kind === 'media' && file && (
          <input className="status-caption" maxLength={700} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a caption…" aria-label="Caption" />
        )}
        <span className="status-composer-note">
          <Lock size={12} /> End-to-end encrypted · disappears after 24 hours
        </span>
        <button className="send-btn" onClick={send} disabled={!canSend || busy} aria-label="Post status">
          <Send size={22} />
        </button>
      </footer>
    </div>
  );
}
