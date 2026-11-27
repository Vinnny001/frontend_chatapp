import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Play, Plus, Send, Trash2, X } from 'lucide-react';
import { fileKind, formatBytes } from '../../lib/format.js';
import { MAX_PICK, copyPicked, skippedText } from '../../lib/pickedFiles.js';
import { toast, useUI } from '../../store/ui.js';
import { OnceIcon } from './ViewOnce.jsx';
import { useMentions } from './useMentions.jsx';

let nextKey = 0;
const itemOf = (file, caption = '') => ({ key: ++nextKey, file, caption });
const isVisual = (file) => /^(image|video)\//.test(file.type);
const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Audio', file: 'Document' };

/**
 * Before sending photos, videos or documents: a large preview of each, a strip to move between
 * them (add more, remove one), and a caption for each (sent with that one). Enter follows the
 * "Enter sends" setting. → onSend([{ file, caption }], { viewOnce })
 */
export default function AttachmentPreview({ files, conv, me, title, onCancel, onSend, initialCaption = '' }) {
  const enterToSend = useUI((s) => s.enterToSend);
  const [items, setItems] = useState(() => files.map((f, i) => itemOf(f, i === 0 ? initialCaption : '')));
  const [index, setIndex] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  const input = useRef(null);
  const backdrop = useRef(null);
  const addInput = useRef(null);
  const touch = useRef(null);

  // Preview addresses: made and released together, so none is used after it's released.
  const [urls, setUrls] = useState({});
  useEffect(() => {
    const made = Object.fromEntries(items.filter((it) => isVisual(it.file)).map((it) => [it.key, URL.createObjectURL(it.file)]));
    setUrls(made);
    return () => Object.values(made).forEach((u) => URL.revokeObjectURL(u));
  }, [items.map((it) => it.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = items[Math.min(index, items.length - 1)];
  const urlOf = (it) => urls[it.key] || null;
  const caption = item?.caption || '';
  const setCaption = (value) => setItems((list) => list.map((it) => (it.key === item.key ? { ...it, caption: value } : it)));
  // @mentions in the caption, as in the message box.
  const mentions = useMentions({ conv, me, text: caption, update: setCaption, input });

  const kind = item ? fileKind(item.file) : 'file';
  const allMedia = items.every((it) => /^(image|video)\//.test(it.file.type));
  // View once: a single photo or video.
  const canViewOnce = items.length === 1 && (kind === 'image' || kind === 'video');
  const total = useMemo(() => items.reduce((n, it) => n + it.file.size, 0), [items]);

  const send = () => onSend(items.map((it) => ({ file: it.file, caption: mentions.withTokens(it.caption.trim()) })), { viewOnce: canViewOnce && viewOnce });
  const go = (i) => {
    mentions.close();
    setIndex(Math.max(0, Math.min(items.length - 1, i)));
  };

  function remove() {
    if (items.length === 1) return onCancel();
    setItems((list) => list.filter((it) => it.key !== item.key));
    setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    return undefined;
  }

  async function addMore(list) {
    const room = MAX_PICK - items.length;
    if (room <= 0) return toast(`Up to ${MAX_PICK} files at once`);
    const { files: copies, skipped } = await copyPicked([...list].slice(0, room));
    if (skipped.length) toast(skippedText(skipped), 'error');
    if (!copies.length) return undefined;
    setItems((cur) => [...cur, ...copies.map((f) => itemOf(f))]);
    setIndex(items.length); // show the first one added
    return undefined;
  }

  // Grow with the caption, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [caption, item?.key]);

  // ← / → between items (when not typing), Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target === input.current) return;
      if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'ArrowRight') go(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  return (
    <div className="attach-preview" role="dialog" aria-label="Send media">
      <header className="attach-top">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel">
          <X size={22} />
        </button>
        <div className="attach-title">
          <strong>{items.length > 1 ? `${KIND_LABEL[kind]} ${index + 1} of ${items.length}` : KIND_LABEL[kind]}</strong>
          <span>
            {item.file.name} · {formatBytes(item.file.size)}
            {items.length > 1 ? ` · ${formatBytes(total)} in all` : ''}
          </span>
        </div>
        <button className="icon-btn" onClick={remove} aria-label={items.length > 1 ? 'Remove this one' : 'Cancel'} title="Remove">
          <Trash2 size={20} />
        </button>
      </header>

      <div
        className="attach-stage"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
          if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
          touch.current = null;
        }}
      >
        {kind === 'image' && urlOf(item) && <img key={item.key} src={urlOf(item)} alt="" />}
        {kind === 'video' && urlOf(item) && <video key={item.key} src={urlOf(item)} controls playsInline />}
        {(kind === 'file' || kind === 'audio') && (
          <div className="attach-file">
            <FileText size={72} strokeWidth={1.1} />
            <strong>{item.file.name}</strong>
            <span>
              {formatBytes(item.file.size)} · {(item.file.name.split('.').pop() || 'file').toUpperCase()}
            </span>
          </div>
        )}
        {items.length > 1 && index > 0 && (
          <button className="attach-nav prev" onClick={() => go(index - 1)} aria-label="Previous">
            <ChevronLeft size={26} />
          </button>
        )}
        {items.length > 1 && index < items.length - 1 && (
          <button className="attach-nav next" onClick={() => go(index + 1)} aria-label="Next">
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      <div className="attach-bottom">
        <div className="attach-thumbs" role="tablist" aria-label="Files to send">
          {items.map((it, i) => (
            <button key={it.key} role="tab" aria-selected={i === index} className={i === index ? 'active' : ''} onClick={() => go(i)} title={it.file.name}>
              {urlOf(it) && it.file.type.startsWith('image/') && <img src={urlOf(it)} alt="" />}
              {urlOf(it) && it.file.type.startsWith('video/') && (
                <>
                  <video src={`${urlOf(it)}#t=0.1`} preload="metadata" muted playsInline />
                  <Play size={14} fill="currentColor" className="thumb-play" />
                </>
              )}
              {!isVisual(it.file) && (
                <span className="thumb-doc">
                  <FileText size={18} />
                  <small>{(it.file.name.split('.').pop() || '').slice(0, 4).toUpperCase()}</small>
                </span>
              )}
              {it.caption.trim() && <span className="thumb-captioned" aria-label="Has a caption" />}
            </button>
          ))}
          {items.length < MAX_PICK && (
            <button className="attach-add" onClick={() => addInput.current?.click()} aria-label="Add more" title="Add more">
              <Plus size={22} />
            </button>
          )}
          <input
            ref={addInput}
            type="file"
            hidden
            multiple
            accept={allMedia ? 'image/*,video/*' : '*/*'}
            onChange={(e) => {
              const list = [...e.target.files];
              e.target.value = '';
              if (list.length) addMore(list);
            }}
          />
        </div>

        {mentions.picker && <div className="attach-mentions">{mentions.picker}</div>}
        <div className="attach-compose">
          <div className="composer-field attach-caption">
            <div ref={backdrop} className="composer-highlight" aria-hidden="true">
              {mentions.highlighted}
              {'​'}
            </div>
            <textarea
              key={item.key}
              ref={input}
              rows={1}
              autoFocus
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                mentions.find(e.target.value, e.target.selectionStart);
              }}
              onScroll={(e) => {
                if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onBlur={() => setTimeout(mentions.close, 150)}
              onKeyDown={(e) => {
                if (mentions.onKeyDown(e)) return;
                // Same as the message box: Enter sends only when "Enter sends" is on.
                if (e.key === 'Enter' && !e.shiftKey && enterToSend && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={viewOnce ? 'Add a caption… (view once)' : items.length > 1 ? `Caption for this ${KIND_LABEL[kind].toLowerCase()}…` : 'Add a caption…'}
              maxLength={2000}
              aria-label="Caption"
            />
          </div>
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
        </div>
        <div className="attach-send-row">
          {title && <span className="attach-to">To: {title}</span>}
          <button className="send-btn big" onClick={send} aria-label="Send">
            <Send size={22} />
            {items.length > 1 && <span className="badge">{items.length}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
