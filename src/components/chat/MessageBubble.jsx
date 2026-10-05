import { memo, useRef, useState } from 'react';
import {
  Ban,
  ChevronDown,
  CloudDownload,
  CloudOff,
  Copy,
  Download,
  FileText,
  Forward,
  Info,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Reply,
  RotateCw,
  SmilePlus,
  Smartphone,
  Star,
  StarOff,
  Trash2,
  Video,
} from 'lucide-react';
import Ticks from '../common/Ticks.jsx';
import Menu, { useContextMenu } from '../common/Menu.jsx';
import VoicePlayer from './VoicePlayer.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import MessageInfo from './MessageInfo.jsx';
import Avatar from '../common/Avatar.jsx';
import Modal from '../common/Modal.jsx';
import { useAuth } from '../../store/auth.js';
import { QUICK_REACTIONS } from '../../lib/emoji.js';
import { formatBytes, formatTime, linkify } from '../../lib/format.js';
import { mediaKind, useMediaSrc } from '../../lib/media.js';
import { connectionKind } from '../../lib/network.js';
import { openDocument } from '../../lib/deviceFiles.js';
import { callSummary, isCallMessage, messageStatus, peerOf, useChat } from '../../store/chat.js';
import { useCall } from '../../store/call.js';
import { useGroupCall } from '../../store/groupCall.js';
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

/** Media not covered by the auto-download rules: tap to download (shows the size). */
function DownloadPrompt({ type, size, downloading, onDownload }) {
  const label = { image: 'Photo', video: 'Video', voice: 'Voice message', audio: 'Audio' }[type] || 'File';
  return (
    <button
      type="button"
      className={`media-missing media-download ${type}`}
      onClick={(e) => {
        e.stopPropagation();
        onDownload();
      }}
      disabled={downloading}
    >
      <CloudDownload size={24} className={downloading ? 'pulse' : ''} />
      <span>
        {downloading ? 'Downloading…' : `Download ${label.toLowerCase()}`}
        {size ? ` · ${formatBytes(size)}` : ''}
      </span>
    </button>
  );
}

function Media({ msg }) {
  const uploading = msg.pending && msg.progress != null && msg.progress < 1 && msg.status !== 'failed';
  // Documents download only when opened (or by auto-download / "Save chat for offline").
  if (msg.type === 'file') return <DocumentCard media={msg.media} uploadingProgress={uploading ? msg.progress : null} />;
  return <VisualMedia msg={msg} uploading={uploading} />;
}

function VisualMedia({ msg, uploading }) {
  const openViewer = useUI((s) => s.openViewer);
  const rules = useUI((s) => s.autoDownloadRules);
  const { media } = msg;
  // Stored copy when available (works offline); otherwise follow the auto-download rules.
  const auto = (rules[connectionKind()] || []).includes(mediaKind(msg.type));
  const { src, missing, needsDownload, downloading, download } = useMediaSrc(media.url, { auto });

  if (missing) return <MissingMedia type={msg.type} />;
  if (needsDownload) {
    return (
      <DownloadPrompt
        type={msg.type}
        size={media.size}
        downloading={downloading}
        onDownload={() => download().then((ok) => ok || toast('Download failed. Check your connection.', 'error'))}
      />
    );
  }
  if (!src) return <div className={`media-loading ${msg.type}`} />;

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
  return <audio className="audio-player" src={src} controls preload="metadata" />;
}

/** Tap to open in the phone's document app, from the saved copy (works offline). */
function DocumentCard({ media, uploadingProgress }) {
  const [opening, setOpening] = useState(false);
  async function open(e) {
    e.stopPropagation();
    if (opening) return;
    setOpening(true);
    try {
      await openDocument(media);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setOpening(false);
    }
  }
  const ext = (media.name?.split('.').pop() || 'file').toUpperCase();
  const apk = ext === 'APK';
  return (
    <button type="button" className="file-card" onClick={open}>
      {apk ? <Smartphone size={30} /> : <FileText size={30} />}
      <span className="file-info">
        <span className="file-name">{media.name || 'Document'}</span>
        <span className="file-meta">
          {uploadingProgress != null
            ? `Uploading ${Math.round(uploadingProgress * 100)}%`
            : opening
              ? 'Opening…'
              : `${formatBytes(media.size)} · ${apk ? 'Android app' : ext}`}
        </span>
      </span>
      <Download size={18} />
    </button>
  );
}

/** Who reacted with what, like WhatsApp's sheet: "All 3 · 👍 2 · ❤️ 1"; tap yours to remove it. */
function ReactionDetails({ reactions, me, conv, onRemove, onClose }) {
  const [tab, setTab] = useState('all');
  const counts = reactions.reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {});
  const shown = (tab === 'all' ? reactions : reactions.filter((r) => r.emoji === tab))
    .slice()
    .sort((a, b) => (a.user === me ? -1 : b.user === me ? 1 : 0));
  const person = (id) => (id === me ? null : conv.participants.find((p) => p.id === id));
  return (
    <Modal title="Reactions" onClose={onClose} className="reaction-details">
      <div className="reaction-tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          All {reactions.length}
        </button>
        {Object.entries(counts).map(([emoji, n]) => (
          <button key={emoji} className={tab === emoji ? 'active' : ''} onClick={() => setTab(emoji)}>
            {emoji} {n}
          </button>
        ))}
      </div>
      {shown.map((r) => {
        const p = person(r.user);
        const mine = r.user === me;
        return (
          <button key={r.user} className="reaction-person" disabled={!mine} onClick={() => mine && onRemove()}>
            <Avatar name={mine ? 'You' : p?.name} url={mine ? useAuth.getState().user?.avatarUrl : p?.avatarUrl} size={40} />
            <span className="person-info">
              <span className="person-name">{mine ? 'You' : p?.name || 'Someone'}</span>
              {mine && <span className="person-sub">Tap to remove</span>}
            </span>
            <span className="reaction-emoji">{r.emoji}</span>
          </button>
        );
      })}
    </Modal>
  );
}

function Reactions({ reactions, me, onRemove, conv }) {
  const [open, setOpen] = useState(false);
  const groups = reactions.reduce((acc, r) => {
    (acc[r.emoji] ||= []).push(r.user);
    return acc;
  }, {});
  const entries = Object.entries(groups);
  if (!entries.length) return null;
  const mine = reactions.some((r) => r.user === me);
  return (
    <>
      <button className={`reactions ${mine ? 'mine' : ''}`} onClick={() => setOpen(true)} aria-label="See reactions">
        {entries.map(([emoji]) => (
          <span key={emoji} className="reaction">
            {emoji}
          </span>
        ))}
        {reactions.length > 1 && <span className="reaction-count">{reactions.length}</span>}
      </button>
      {open && (
        <ReactionDetails
          reactions={reactions}
          me={me}
          conv={conv}
          onRemove={() => {
            onRemove();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** A call in the chat ("Missed voice call", "Video call · 2:31"); tap to call back. */
function CallBubble({ msg, conv, me }) {
  const { menu, open, close, longPress } = useContextMenu();
  const { title, detail, missed, outgoing } = callSummary(msg, me);
  const peer = peerOf(conv, me);
  const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
  const group = conv.type === 'group';
  const canCall = !!peer || group;
  const callBack = () =>
    group ? useGroupCall.getState().join(conv.id, msg.call.kind) : peer && useCall.getState().startCall(conv.id, peer, msg.call.kind);
  return (
    <div
      className={`msg-row ${outgoing ? 'out' : 'in'}`}
      data-mid={msg.id}
      onContextMenu={open}
      onClickCapture={longPress.onClickCapture}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
    >
      <div className="msg-stack">
        <button type="button" className={`bubble call-bubble ${missed ? 'missed' : ''}`} onClick={callBack} disabled={!canCall}>
          <span className="call-icon">
            <Icon size={18} />
          </span>
          <span className="call-text">
            <span className="call-title">{title}</span>
            <span className="call-detail">
              {msg.call.kind === 'video' ? <Video size={12} /> : <Phone size={12} />}
              {detail ? `${detail} · ` : ''}
              {formatTime(msg.createdAt)}
            </span>
          </span>
        </button>
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={[
            canCall && { label: msg.call.kind === 'video' ? 'Video call' : 'Voice call', icon: msg.call.kind === 'video' ? Video : Phone, onClick: callBack },
            { label: 'Delete for me', icon: Trash2, danger: true, onClick: () => useChat.getState().deleteMessage(msg, false) },
          ]}
        />
      )}
    </div>
  );
}

const LONG_TEXT = 500;

/** Long messages show the first part with "Read more", like WhatsApp. */
function LongText({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= LONG_TEXT || expanded) return <RichText text={text} />;
  // Cut at a word boundary so a link or phone number isn't split in half.
  const cut = text.lastIndexOf(' ', LONG_TEXT);
  return (
    <>
      <RichText text={text.slice(0, cut > LONG_TEXT * 0.6 ? cut : LONG_TEXT)} />
      …{' '}
      <button
        type="button"
        className="read-more"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
      >
        Read more
      </button>
    </>
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
  if (isCallMessage(msg)) return <CallBubble msg={msg} conv={conv} me={me} />;

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
                  <LongText text={msg.text} />
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
        <Reactions reactions={msg.reactions || []} me={me} conv={conv} onRemove={() => chat.react(msg, null)} />
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
