import { memo, useRef, useState } from 'react';
import {
  Ban,
  ChevronDown,
  CloudOff,
  Copy,
  Download,
  FileText,
  Forward,
  Info,
  Pencil,
  Play,
  Reply,
  RotateCw,
  SmilePlus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import Ticks from '../common/Ticks.jsx';
import Menu, { useContextMenu } from '../common/Menu.jsx';
import VoicePlayer from './VoicePlayer.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import MessageInfo from './MessageInfo.jsx';
import { mediaUrl } from '../../lib/config.js';
import { QUICK_REACTIONS } from '../../lib/emoji.js';
import { formatBytes, formatTime, linkify } from '../../lib/format.js';
import { useMediaSrc } from '../../lib/media.js';
import { messageStatus, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

const EDIT_WINDOW_MS = 24 * 3600 * 1000;
const DELETE_WINDOW_MS = 48 * 3600 * 1000;
const EMOJI_ONLY = /^(\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍️]|\s)+$/u;

function RichText({ text }) {
  return linkify(text).map((part, i) => {
    if (typeof part === 'string') return part;
    if (part.phone) {
      return (
        <button
          key={i}
          type="button"
          className="phone-link"
          onClick={(e) => {
            e.stopPropagation();
            useUI.getState().openPhoneMenu({ x: e.clientX, y: e.clientY, phone: part.phone });
          }}
        >
          {part.phone}
        </button>
      );
    }
    return (
      <a key={i} href={part.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
        {part.url}
      </a>
    );
  });
}

function ReplyQuote({ reply, conv, me, onClick }) {
  const author = reply.sender === me ? 'You' : conv.participants.find((p) => p.id === reply.sender)?.name || 'Someone';
  const label = reply.deletedForEveryone
    ? 'This message was deleted'
    : reply.text || { image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', audio: '🎵 Audio', file: `📄 ${reply.mediaName || 'Document'}` }[reply.type] || '';
  return (
    <button className="reply-quote" onClick={onClick}>
      <span className="reply-body">
        <strong>{author}</strong>
        <span>{label}</span>
      </span>
      {reply.mediaUrl && <ReplyThumb url={reply.mediaUrl} />}
    </button>
  );
}

function ReplyThumb({ url }) {
  const { src } = useMediaSrc(url);
  return src ? <img src={src} alt="" /> : null;
}

/** Shown when a photo/video/voice note was never downloaded and we're offline. */
function MissingMedia({ type }) {
  const label = { image: 'Photo', video: 'Video', voice: 'Voice message', audio: 'Audio' }[type] || 'File';
  return (
    <div className={`media-missing ${type}`}>
      <CloudOff size={22} />
      <span>{label} not downloaded. Connect to view it.</span>
    </div>
  );
}

function Media({ msg }) {
  const openViewer = useUI((s) => s.openViewer);
  const { media } = msg;
  // The stored copy when available (works offline), otherwise the network URL.
  const { src, missing } = useMediaSrc(media.url);
  const uploading = msg.pending && msg.progress != null && msg.progress < 1 && msg.status !== 'failed';

  if (missing && msg.type !== 'file') return <MissingMedia type={msg.type} />;
  if (!src && msg.type !== 'file') return <div className={`media-loading ${msg.type}`} />;

  if (msg.type === 'image') {
    return (
      <button className="media-thumb" onClick={() => openViewer({ url: media.url, type: 'image', name: media.name })}>
        <img src={src} alt={media.name || 'Photo'} loading="lazy" />
        {uploading && <span className="upload-ring">{Math.round(msg.progress * 100)}%</span>}
      </button>
    );
  }
  if (msg.type === 'video') {
    return (
      <button className="media-thumb" onClick={() => openViewer({ url: media.url, type: 'video', name: media.name })}>
        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline />
        <span className="play-badge">
          <Play size={26} fill="currentColor" />
        </span>
        {uploading && <span className="upload-ring">{Math.round(msg.progress * 100)}%</span>}
      </button>
    );
  }
  if (msg.type === 'voice') return <VoicePlayer src={src} duration={media.duration} progress={uploading ? msg.progress : null} />;
  if (msg.type === 'audio') return <audio className="audio-player" src={src} controls preload="metadata" />;
  // Documents: open from the network when online (phones can't open in-memory blobs),
  // otherwise from the stored copy.
  const href = navigator.onLine !== false && !String(media.url).startsWith('pending:') ? mediaUrl(media.url) : src;
  return (
    <a className="file-card" href={href || undefined} target="_blank" rel="noreferrer" download={media.name} onClick={(e) => e.stopPropagation()}>
      <FileText size={30} />
      <span className="file-info">
        <span className="file-name">{media.name || 'Document'}</span>
        <span className="file-meta">
          {uploading ? `Uploading ${Math.round(msg.progress * 100)}%` : `${formatBytes(media.size)} · ${(media.name?.split('.').pop() || 'file').toUpperCase()}`}
        </span>
      </span>
      <Download size={18} />
    </a>
  );
}

function Reactions({ reactions, me, onToggle, conv }) {
  const groups = reactions.reduce((acc, r) => {
    (acc[r.emoji] ||= []).push(r.user);
    return acc;
  }, {});
  const entries = Object.entries(groups);
  if (!entries.length) return null;
  const names = (ids) => ids.map((id) => (id === me ? 'You' : conv.participants.find((p) => p.id === id)?.name || 'Someone')).join(', ');
  return (
    <div className="reactions">
      {entries.map(([emoji, users]) => (
        <button key={emoji} className={`reaction ${users.includes(me) ? 'mine' : ''}`} onClick={() => onToggle(emoji)} title={names(users)}>
          {emoji}
          {users.length > 1 && <span>{users.length}</span>}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ msg, conv, me, grouped, flash }) {
  const { menu, open, close, longPress } = useContextMenu();
  const [picker, setPicker] = useState(null); // 'quick' | 'full'
  const [info, setInfo] = useState(false);
  const swipe = useRef({ x: 0, dx: 0 });
  const [dx, setDx] = useState(0);
  const chat = useChat.getState();
  const setForwarding = useUI((s) => s.setForwarding);

  if (msg.type === 'system') {
    return (
      <div className="system-pill" data-mid={msg.id}>
        {msg.text}
      </div>
    );
  }

  const mine = msg.sender === me;
  const status = messageStatus(msg, conv, me);
  const sender = !mine && conv.type === 'group' ? conv.participants.find((p) => p.id === msg.sender) : null;
  const deleted = msg.deletedForEveryone;
  const isAdmin = conv.type === 'group' && conv.me?.role === 'admin';
  const age = Date.now() - Date.parse(msg.createdAt);
  const emojiOnly = msg.type === 'text' && !deleted && msg.text.length <= 12 && EMOJI_ONLY.test(msg.text);
  const hasMedia = !deleted && msg.media;

  const reply = () => chat.setComposer(conv.id, { replyTo: msg, editing: null });
  const react = (emoji) => chat.react(msg, emoji);

  const menuItems = msg.pending
    ? [
        msg.status === 'failed' && { label: 'Retry', icon: RotateCw, onClick: () => chat.deliver(msg) },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => chat.deleteMessage(msg, false) },
      ]
    : deleted
      ? [{ label: 'Delete for me', icon: Trash2, danger: true, onClick: () => chat.deleteMessage(msg, false) }]
      : [
          { label: 'Reply', icon: Reply, onClick: reply },
          { label: 'React', icon: SmilePlus, onClick: () => setPicker('full') },
          msg.text && {
            label: 'Copy',
            icon: Copy,
            onClick: () => navigator.clipboard?.writeText(msg.text).then(() => toast('Copied'), () => toast('Could not copy')),
          },
          { label: 'Forward', icon: Forward, onClick: () => setForwarding(msg) },
          { label: msg.starred ? 'Unstar' : 'Star', icon: msg.starred ? StarOff : Star, onClick: () => chat.toggleStar(msg) },
          mine && msg.type === 'text' && age < EDIT_WINDOW_MS && {
            label: 'Edit',
            icon: Pencil,
            onClick: () => chat.setComposer(conv.id, { editing: msg, replyTo: null }),
          },
          mine && { label: 'Message info', icon: Info, onClick: () => setInfo(true) },
          { label: 'Delete for me', icon: Trash2, danger: true, onClick: () => chat.deleteMessage(msg, false) },
          ((mine && age < DELETE_WINDOW_MS) || isAdmin) && {
            label: 'Delete for everyone',
            icon: Trash2,
            danger: true,
            onClick: () => window.confirm('Delete this message for everyone?') && chat.deleteMessage(msg, true),
          },
        ];

  // Swipe right to reply (touch).
  const touch = {
    onTouchStart: (e) => {
      swipe.current = { x: e.touches[0].clientX, dx: 0 };
      longPress.onTouchStart(e);
    },
    onTouchMove: (e) => {
      longPress.onTouchMove();
      const d = Math.max(0, Math.min(90, e.touches[0].clientX - swipe.current.x));
      swipe.current.dx = d;
      if (d > 8 && !deleted && !msg.pending) setDx(d);
    },
    onTouchEnd: () => {
      longPress.onTouchEnd();
      if (swipe.current.dx > 60 && !deleted && !msg.pending) {
        navigator.vibrate?.(10);
        reply();
      }
      setDx(0);
    },
  };

  return (
    <div
      className={`msg-row ${mine ? 'out' : 'in'} ${grouped ? 'grouped' : ''} ${flash ? 'flash' : ''}`}
      data-mid={msg.id}
      onContextMenu={open}
      onClickCapture={longPress.onClickCapture}
      {...touch}
    >
      <div className="msg-stack" style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
        <div className={`bubble ${emojiOnly ? 'emoji-only' : ''} ${hasMedia && !msg.text && msg.type !== 'file' && msg.type !== 'voice' ? 'media-only' : ''}`}>
          {!grouped && sender && <div className="sender-name" style={{ color: `hsl(${[...sender.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 60% 45%)` }}>{sender.name}</div>}
          {msg.forwarded && !deleted && (
            <div className="forwarded">
              <Forward size={13} /> Forwarded
            </div>
          )}
          {msg.replyTo && !deleted && (
            <ReplyQuote reply={msg.replyTo} conv={conv} me={me} onClick={() => chat.jumpTo(conv.id, msg.replyTo.id)} />
          )}
          {deleted ? (
            <span className="deleted-text">
              <Ban size={15} /> {mine ? 'You deleted this message' : 'This message was deleted'}
            </span>
          ) : (
            <>
              {hasMedia && <Media msg={msg} />}
              {msg.text && (
                <span className="text">
                  <RichText text={msg.text} />
                </span>
              )}
            </>
          )}
          <span className="meta">
            {msg.starred && <Star size={11} fill="currentColor" />}
            {msg.editedAt && !deleted && <span className="edited">edited</span>}
            <span>{formatTime(msg.createdAt)}</span>
            {mine && !deleted && <Ticks status={status} />}
          </span>
          {!deleted && (
            <div className="bubble-actions">
              {!msg.pending && (
                <button className="bubble-btn" onClick={() => setPicker(picker ? null : 'quick')} aria-label="React">
                  <SmilePlus size={16} />
                </button>
              )}
              <button className="bubble-btn" onClick={open} aria-label="Message options">
                <ChevronDown size={18} />
              </button>
            </div>
          )}
        </div>
        {msg.status === 'failed' && (
          <button className="retry" onClick={() => chat.deliver(msg)}>
            <RotateCw size={13} /> Not sent. Tap to retry
          </button>
        )}
        <Reactions reactions={msg.reactions || []} me={me} conv={conv} onToggle={react} />
        {picker === 'quick' && (
          <div className="quick-reactions" onMouseLeave={() => setPicker(null)}>
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  react(e);
                  setPicker(null);
                }}
              >
                {e}
              </button>
            ))}
            <button className="more" onClick={() => setPicker('full')} aria-label="More reactions">
              +
            </button>
          </div>
        )}
        {picker === 'full' && (
          <div className="reaction-picker">
            <EmojiPicker
              onPick={(e) => {
                react(e);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
            />
          </div>
        )}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={close}
          header={
            !msg.pending && !deleted ? (
              <div className="menu-reactions">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      react(e);
                      close();
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null
          }
        />
      )}
      {info && <MessageInfo msg={msg} conv={conv} me={me} onClose={() => setInfo(false)} />}
    </div>
  );
}

export default memo(MessageBubble);
