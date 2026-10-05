import { useState } from 'react';
import { ArrowLeft, Bell, BellOff, Eraser, Info, MoreVertical, Phone, Search, Timer, Video, X } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Menu from '../common/Menu.jsx';
import { formatLastSeen } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useCall } from '../../store/call.js';
import { chatAvatarUrl, conversationTitle, isSelfChat, peerOf, useChat, presenceSelector } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

export function useSubtitle(conv, me) {
  const typing = useChat((s) => s.typing[conv.id]);
  const peer = peerOf(conv, me);
  const presence = useChat(presenceSelector(peer?.id));
  const iHideLastSeen = useAuth((s) => s.user?.settings?.showLastSeen === false);

  const typers = Object.entries(typing || {}).filter(([id]) => id !== me);
  if (typers.length) {
    const recording = typers.some(([, st]) => st === 'recording');
    if (conv.type === 'direct') return { text: recording ? 'recording audio…' : 'typing…', live: true };
    const names = typers.map(([id]) => conv.participants.find((p) => p.id === id)?.name?.split(' ')[0] || 'Someone');
    return { text: `${names.join(', ')} ${recording ? 'recording audio…' : typers.length > 1 ? 'are typing…' : 'is typing…'}`, live: true };
  }
  if (isSelfChat(conv, me)) return { text: 'Message yourself' };
  if (conv.type === 'direct') {
    if (presence?.online) return { text: 'online' };
    // Hiding my own last seen hides everyone else's from me too (as on WhatsApp).
    const lastSeen = iHideLastSeen ? null : presence?.lastSeen ?? peer?.lastSeen;
    return { text: lastSeen ? formatLastSeen(lastSeen) : '' };
  }
  const names = conv.participants.map((p) => (p.id === me ? 'You' : p.name?.split(' ')[0]));
  return { text: names.sort((a, b) => (a === 'You') - (b === 'You')).join(', ') };
}

export default function ChatHeader({ conv }) {
  const me = useAuth((s) => s.user?.id);
  const { setInfoOpen } = useUI.getState();
  const infoOpen = useUI((s) => s.infoOpen);
  const { closeConversation, setPrefs, clearChat } = useChat.getState();
  const startCall = useCall((s) => s.startCall);
  const [menu, setMenu] = useState(null);
  const subtitle = useSubtitle(conv, me);
  const peer = peerOf(conv, me);
  const title = conversationTitle(conv, me);

  const call = (kind) => {
    if (!peer) return toast('Group calls are coming soon');
    startCall(conv.id, { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl }, kind);
  };

  return (
    <header className="chat-header">
      <button className="icon-btn back-btn" onClick={closeConversation} aria-label="Back to chats">
        <ArrowLeft size={22} />
      </button>
      <button className="chat-header-main" onClick={() => setInfoOpen(infoOpen === 'info' ? false : 'info')}>
        <Avatar name={title} url={chatAvatarUrl(conv, me)} group={conv.type === 'group'} size={42} />
        <span className="chat-header-text">
          <span className="chat-title">
            {title}
            {conv.disappearingSeconds > 0 && <Timer size={14} className="muted-icon" aria-label="Disappearing messages on" />}
          </span>
          <span className={`chat-subtitle ${subtitle.live ? 'live' : ''}`}>{subtitle.text}</span>
        </span>
      </button>
      {conv.type === 'direct' && peer && (
        <>
          <button className="icon-btn" onClick={() => call('video')} aria-label="Video call" title="Video call">
            <Video size={21} />
          </button>
          <button className="icon-btn" onClick={() => call('audio')} aria-label="Voice call" title="Voice call">
            <Phone size={19} />
          </button>
        </>
      )}
      <button className="icon-btn" onClick={() => setInfoOpen(infoOpen === 'search' ? false : 'search')} aria-label="Search in chat" title="Search">
        <Search size={20} />
      </button>
      <button
        className="icon-btn"
        aria-label="Chat menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 220, y: r.bottom + 4 });
        }}
      >
        <MoreVertical size={20} />
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: conv.type === 'group' ? 'Group info' : peer ? 'Contact info' : 'Chat info', icon: Info, onClick: () => setInfoOpen('info') },
            { label: 'Disappearing messages', icon: Timer, onClick: () => setInfoOpen('info') },
            {
              label: conv.me?.muted ? 'Unmute notifications' : 'Mute notifications',
              icon: conv.me?.muted ? Bell : BellOff,
              onClick: () => setPrefs(conv.id, { muted: !conv.me?.muted }),
            },
            {
              label: 'Clear chat',
              icon: Eraser,
              onClick: () => window.confirm('Clear all messages in this chat for you?') && clearChat(conv.id).catch((e) => toast(e.message, 'error')),
            },
            { label: 'Close chat', icon: X, onClick: closeConversation },
          ]}
        />
      )}
    </header>
  );
}
