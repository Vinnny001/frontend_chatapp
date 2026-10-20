import { useEffect, useRef, useState } from 'react';
import { BellOff, Bell, Eye, MoreVertical, Send, Trash2, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Menu from '../common/Menu.jsx';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { useMediaSrc } from '../../lib/media.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';
import { displayName } from '../../store/people.js';
import { useStatus } from '../../store/status.js';
import { toast } from '../../store/ui.js';

const SHOW_MS = 5000; // a text or photo update; videos play to their end

const previewOf = (p) => (p.kind === 'text' ? p.text.slice(0, 140) : `${p.kind === 'video' ? '🎥 Video' : '📷 Photo'}${p.text ? ` · ${p.text.slice(0, 120)}` : ''}`);

function Media({ status, paused, onReady, onEnded }) {
  const p = status.payload;
  const { src } = useMediaSrc(p.media?.url);
  const video = useRef(null);
  useEffect(() => {
    if (!video.current) return;
    if (paused) video.current.pause();
    else video.current.play().catch(() => {});
  }, [paused, src]);
  if (p.kind === 'text') {
    return (
      <div className="status-text" style={{ background: p.bg }}>
        <p>{p.text}</p>
      </div>
    );
  }
  if (!src) return <div className="status-loading">Loading…</div>;
  return (
    <div className="status-media">
      {p.kind === 'video' ? (
        <video ref={video} src={src} playsInline autoPlay onLoadedMetadata={(e) => onReady(e.currentTarget.duration * 1000)} onEnded={onEnded} />
      ) : (
        <img src={src} alt="" onLoad={() => onReady(SHOW_MS)} />
      )}
      {p.text && <p className="status-caption-view">{p.text}</p>}
    </div>
  );
}

/** Full screen, one person's updates in turn: tap left / right to go back / on, hold to pause. */
export default function StatusViewer() {
  const viewer = useStatus((s) => s.viewer);
  const mine = useStatus((s) => s.mine);
  const others = useStatus((s) => s.others);
  const me = useAuth((s) => s.user);
  const { closeViewer, markViewed, remove, mute, openViewer } = useStatus.getState();
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(null); // ms, once the update is ready
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const [menu, setMenu] = useState(null);
  const [showViewers, setShowViewers] = useState(false);

  const own = viewer?.owner === 'me';
  const group = own ? { user: { ...me, id: me?.id }, statuses: mine } : others.find((g) => g.user.id === viewer?.owner);
  const list = group?.statuses || [];
  const index = Math.min(viewer?.index ?? 0, list.length - 1);
  const status = list[index];

  // Each new update: start over, and tell its author it was seen.
  useEffect(() => {
    setProgress(0);
    setDuration(status?.payload.kind === 'text' ? SHOW_MS : null);
    setShowViewers(false);
    if (status && !own) markViewed(group.user.id, status.id);
  }, [status?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The progress bar (and moving on when it's full).
  const typing = !!reply;
  useEffect(() => {
    if (!status || !duration || paused || typing || showViewers || menu) return undefined;
    let last = performance.now();
    let frame = 0;
    const step = (now) => {
      const next = Math.min(1, progress + (now - last) / duration);
      last = now;
      setProgress(next);
      if (next >= 1) go(1);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });

  if (!viewer || !status) {
    if (viewer) setTimeout(closeViewer, 0);
    return null;
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0) return setProgress(0);
    if (next >= list.length) {
      // On to the next person with unseen updates, else done.
      const queue = others.filter((g) => !g.muted && g.user.id !== viewer.owner && g.statuses.some((s) => !s.viewed));
      if (!own && queue.length) openViewer(queue[0].user.id, Math.max(0, queue[0].statuses.findIndex((s) => !s.viewed)));
      else closeViewer();
      return undefined;
    }
    openViewer(viewer.owner, next);
    return undefined;
  }

  async function sendReply(e) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    setReply('');
    try {
      const { conversation } = await api('/api/conversations/direct', { method: 'POST', body: { userId: group.user.id } });
      const chat = useChat.getState();
      chat.upsertConversation(conversation);
      chat.sendMessage(conversation.id, { text, statusRef: { id: status.id, owner: group.user.id, kind: status.payload.kind, preview: previewOf(status.payload), bg: status.payload.bg } });
      toast('Reply sent');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const name = own ? 'My status' : displayName(group.user);
  const holdProps = {
    onPointerDown: () => setPaused(true),
    onPointerUp: () => setPaused(false),
    onPointerLeave: () => setPaused(false),
  };

  return (
    <div className="status-viewer" role="dialog" aria-label={`Status of ${name}`}>
      <div className="status-bars">
        {list.map((s, i) => (
          <span key={s.id} className="status-bar">
            <span style={{ width: `${(i < index ? 1 : i === index ? progress : 0) * 100}%` }} />
          </span>
        ))}
      </div>
      <header className="status-viewer-top">
        <Avatar name={name} url={group.user.avatarUrl} size={38} />
        <span className="status-who">
          <strong>{name}</strong>
          <small>{formatListTime(status.createdAt)}</small>
        </span>
        {own ? (
          <button
            className="icon-btn on-dark"
            aria-label="Delete this update"
            title="Delete"
            onClick={() => window.confirm('Delete this status update?') && remove(status.id).catch((e) => toast(e.message, 'error'))}
          >
            <Trash2 size={20} />
          </button>
        ) : (
          <button
            className="icon-btn on-dark"
            aria-label="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 200, y: r.bottom });
            }}
          >
            <MoreVertical size={20} />
          </button>
        )}
        <button className="icon-btn on-dark" onClick={closeViewer} aria-label="Close">
          <X size={24} />
        </button>
      </header>

      <div className="status-stage" {...holdProps}>
        <Media status={status} paused={paused || typing || showViewers || !!menu} onReady={(ms) => setDuration(ms || SHOW_MS)} onEnded={() => go(1)} />
        <button className="status-tap prev" onClick={() => go(-1)} aria-label="Previous" />
        <button className="status-tap next" onClick={() => go(1)} aria-label="Next" />
      </div>

      {own ? (
        <footer className="status-viewer-bottom">
          <button className="status-views" onClick={() => setShowViewers((v) => !v)}>
            <Eye size={18} /> {status.viewers.length} {status.viewers.length === 1 ? 'view' : 'views'}
          </button>
          {showViewers && (
            <div className="status-viewers">
              {!status.viewers.length && <p className="hint">Nobody has seen it yet.</p>}
              {status.viewers.map((v) => (
                <div key={v.user.id} className="person-row">
                  <Avatar name={displayName(v.user)} url={v.user.avatarUrl} size={36} />
                  <span className="person-info">
                    <span className="person-name">{displayName(v.user)}</span>
                    <span className="person-sub">{formatListTime(v.at)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </footer>
      ) : (
        <form className="status-viewer-bottom status-reply" onSubmit={sendReply}>
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" aria-label="Reply" maxLength={2000} />
          <button className="send-btn" disabled={!reply.trim()} aria-label="Send reply">
            <Send size={20} />
          </button>
        </form>
      )}

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: group.muted ? `Unmute ${name}` : `Mute ${name}`,
              icon: group.muted ? Bell : BellOff,
              onClick: () => mute(group.user.id, !group.muted).then(() => toast(group.muted ? 'Unmuted' : `${name}’s updates muted`)),
            },
          ]}
        />
      )}
    </div>
  );
}
